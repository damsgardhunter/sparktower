import type { Response } from "express";
import { storage } from "./storage";
import {
  getEntitlements, normalizeTier, MEMORY_MESSAGE_LIMIT, TASK_GEN_LIMIT,
  OUTCOME_PRICE_CENTS, DAY_PASS_HOURS, TOP_UP_CENTS, topUpFor, formatMoney,
  PAY_ENDPOINTS, type PaymentRequiredBody, type Wallet,
  type BooleanFeature, type Entitlements, type TierId, type PricedOutcomeId,
} from "@shared/plans";
import { TEXT_MODEL, PRIORITY_TEXT_MODEL } from "./aiModels";
import { enforceRateLimit, consumeRateLimit } from "./moderation";
import { holdCredits, holdMoney, holdCovered } from "./credit-reservations";
import { spend, walletOf, dayPassActive, hasBuildPass } from "./wallet";

export interface UserEntitlements extends Entitlements {
  tier: TierId;
}

export async function getUserEntitlements(userId: string): Promise<UserEntitlements> {
  const user = await storage.getUser(userId);
  const tier = normalizeTier(user?.subscriptionTier);
  return { tier, ...getEntitlements(tier) };
}

/**
 * Shape returned to the client on a 402.
 *
 * Nothing is sold any more, so this is only ever "you can already do that" —
 * kept because thirty call sites still pass through requireFeature and a
 * botched deletion is a feature quietly disappearing.
 */
export interface UpgradeRequiredBody {
  message: string;
  code: "upgrade_required";
  feature: string;
  currentTier: TierId;
  requiredTier: TierId | null;
  requiredTierName: string | null;
}

/**
 * Used to guard a boolean-gated feature. Every feature is free for everyone
 * now, so this always allows and exists to hand the caller its entitlements.
 * Left in place deliberately: see the compatibility note in shared/plans.ts.
 */
export async function requireFeature(
  res: Response,
  userId: string,
  _feature: BooleanFeature,
  _label: string
): Promise<UserEntitlements | null> {
  return getUserEntitlements(userId);
}

/** Level gates, same story: nothing is gated, everyone gets the deepest level. */
export async function requireLevel<K extends keyof Entitlements>(
  res: Response,
  userId: string,
  _key: K,
  _allowed: Entitlements[K][],
  _label: string,
  _requiredTier: TierId
): Promise<UserEntitlements | null> {
  return getUserEntitlements(userId);
}

// ---------------------------------------------------------------------------
// Paying for an outcome
// ---------------------------------------------------------------------------

/**
 * The 402 a dialog is built on.
 *
 * A refusal has to answer three questions in one round trip, because the whole
 * point of holding a balance is that saying yes is one tap: **what does this
 * cost**, **what have I got**, and **what do I do about it**. A bare message
 * makes the client guess at all three, so it isn't one — `price` is the cost,
 * `wallet` is what they have, and `remedy` is the single next action, with the
 * endpoint that performs it already named.
 *
 * `remedy` is deliberately one value, not a list of options:
 *   - "buy_day_pass" — small actions, allowance spent, balance covers $1. One tap.
 *   - "top_up"       — the balance is short. `topUp.suggestCents` is the
 *                      smallest offered amount that clears it, so the dialog
 *                      can lead with one button and offer the rest behind it.
 *   - "none"         — nothing to buy (a rate limit, or an account problem).
 */
/** Builds the 402 body without sending it — company seasons need the same shape from a non-Nova route. */
export function paymentRequired(opts: {
  message: string;
  label: string;
  outcome: PricedOutcomeId | null;
  cents: number | null;
  wallet: Wallet;
}): PaymentRequiredBody {
  const { cents, wallet, outcome } = opts;
  const shortfall = cents == null ? 0 : Math.max(0, cents - wallet.balanceCents);
  /*
   * A pass is something the balance can buy outright; anything else that the
   * balance already covers was refused for a reason money won't fix, so there
   * is nothing to offer.
   */
  const buyable = outcome === "dayPass" || outcome === "imagePass";
  const remedy: PaymentRequiredBody["remedy"] =
    cents == null ? "none" : shortfall > 0 ? "top_up" : buyable ? "buy_pass" : "none";
  return {
    code: "payment_required",
    message: opts.message,
    label: opts.label,
    outcome,
    price: cents == null ? null : { cents, display: formatMoney(cents) },
    wallet,
    // A shortfall of zero on a non-day-pass outcome means the caller could
    // afford it and something else refused; there is nothing to suggest buying.
    remedy,
    topUp: shortfall > 0
      ? { shortfallCents: shortfall, suggestCents: topUpFor(shortfall), optionsCents: TOP_UP_CENTS }
      : null,
    endpoints: PAY_ENDPOINTS,
  };
}

/**
 * "Can this person pay for this outcome, and take the money."
 *
 * Every Nova route still calls this the way it always did, and the `amount`
 * argument is still a CREDIT_COSTS number at most call sites — but it is now
 * only read for one thing: zero means free, so an action that costs nothing
 * (the reputation rebuild) still says so instead of quietly eating an
 * allowance. Everything else is decided by `opts.outcome`:
 *
 *   - no outcome → a **small action**. The order is the one the product owner
 *     set: the monthly allowance first, then a day pass. There is no third
 *     step that silently takes a dollar — a chat turn must never turn into a
 *     purchase nobody tapped — so when neither covers it the answer is a 402
 *     offering the $1 pass, which the client buys in one tap and retries.
 *   - an outcome → a **price in dollars**, taken from the balance before the
 *     model runs, and given straight back if the route never delivers
 *     (holdMoney, server/credit-reservations.ts). A project covered by the
 *     whole-business pass is free here, which is what that purchase bought.
 *
 * Returns the entitlements when the work may proceed, or null after writing
 * the response — callers `return` immediately on null, as they always have.
 */
export async function requireCredits(
  res: Response,
  userId: string,
  amount: number,
  label: string,
  opts?: { outcome?: PricedOutcomeId; projectId?: string | null }
): Promise<UserEntitlements | null> {
  /*
   * Every AI endpoint passes through here, which makes this the one place a
   * per-minute limit covers all of them — thirty routes, none of which has to
   * remember to add it. The allowance caps the month, a day pass removes that
   * cap for a day, and this caps the burst, which is the shape a script has
   * and a person doesn't. It matters more under a pass than it ever did under
   * credits: "unlimited for 24 hours" is only unlimited for a person.
   */
  if (!(await enforceRateLimit(res, userId, "ai"))) return null;

  const ent = await getUserEntitlements(userId);
  if (amount <= 0) return ent;

  const outcome = opts?.outcome;
  const projectId = opts?.projectId ?? null;

  // --- A priced outcome: dollars. ---
  if (outcome) {
    // Covered by the whole-business build, and marked so the route's settle takes nothing.
    if (await hasBuildPass(userId, projectId)) { holdCovered(res, userId, outcome); return ent; }
    const cents = OUTCOME_PRICE_CENTS[outcome];
    const taken = await spend(userId, cents, { outcome, note: label, projectId });
    if (taken) {
      holdMoney(res, userId, cents, outcome, projectId);
      return ent;
    }
    const wallet = await walletOf(userId);
    res.status(402).json(paymentRequired({
      message:
        `${label} costs ${formatMoney(cents)}, and your balance is ${wallet.balanceDisplay}. ` +
        `Add money and it happens straight away — nothing you add ever expires.`,
      label, outcome, cents, wallet,
    }));
    return null;
  }

  /*
   * --- A small action: the build pass on this project, the allowance, the pass. ---
   *
   * The whole-business build comes first, and used to not be consulted here at all.
   * That purchase buys a project outright — the route that sells it says so:
   * "from here on every priced outcome on it is already paid for". But it was
   * only ever checked for *priced* outcomes, and the step work is a small
   * action, so the nine decisions the build deliberately hands back were each
   * charged to the free monthly allowance. Someone who bought the build and
   * then did what the build told them to do — "open one and pick" — spent
   * their allowance finishing a project they had already paid for, and once it
   * ran out was asked for $5 more to carry on. Paying for the whole business
   * has to cover the whole business.
   */
  if (await hasBuildPass(userId, projectId)) {
    holdCovered(res, userId);
    return ent;
  }
  if (await storage.chargeCredits(userId, 1)) {
    holdCredits(res, userId, 1);
    return ent;
  }
  if (await dayPassActive(userId)) {
    /*
     * Free under the pass. A hold worth nothing is left so that the route's
     * own deductCredits settles against it rather than falling back to taking
     * an action off the allowance — "unlimited for 24 hours" has to mean the
     * allowance stops moving. The fair-use ceiling still applies through the
     * AI burst limit above, which is what keeps "unlimited" honest.
     */
    holdCovered(res, userId);
    return ent;
  }

  const wallet = await walletOf(userId);
  const pass = OUTCOME_PRICE_CENTS.dayPass;
  const affordable = wallet.balanceCents >= pass;
  res.status(402).json(paymentRequired({
    message: affordable
      ? `You've used all ${wallet.allowanceLimit} free Nova actions this month. ` +
        `A ${formatMoney(pass)} day pass gives you unlimited small actions for the next ${DAY_PASS_HOURS} hours, ` +
        `and you have ${wallet.balanceDisplay} on your account.`
      : `You've used all ${wallet.allowanceLimit} free Nova actions this month. ` +
        `A ${formatMoney(pass)} day pass gives you unlimited small actions for the next ${DAY_PASS_HOURS} hours. ` +
        `Your allowance resets at the start of next month — ${label} is free again then.`,
    label, outcome: "dayPass", cents: pass, wallet,
  }));
  return null;
}

/**
 * The non-refusing form of requireCredits, for AI that's an optional extra on
 * a route that works without it (Nova's match reasons). True means it's
 * covered — by the pass, or by an allowance with room — and the AI burst limit
 * has space. False means skip the AI part. Nothing is written to the response,
 * and nothing is charged: the route's own deductCredits does that when the
 * answer is in.
 */
export async function reserveOptionalAi(userId: string, _amount = 1): Promise<boolean> {
  if (!(await dayPassActive(userId)) && !(await storage.checkCredits(userId, 1))) return false;
  return consumeRateLimit(userId, "ai");
}

/** Pro gets the stronger model; everyone else the standard one. */
export function modelFor(ent: Pick<Entitlements, "priorityAi">): string {
  return ent.priorityAi ? PRIORITY_TEXT_MODEL : TEXT_MODEL;
}

/** How many prior messages of project context Nova is given. */
export function memoryLimitFor(ent: Pick<Entitlements, "novaMemory">): number {
  return MEMORY_MESSAGE_LIMIT[ent.novaMemory];
}

/** Max tasks a single AI generation may return. */
export function taskLimitFor(ent: Pick<Entitlements, "aiTaskGeneration">): number {
  return TASK_GEN_LIMIT[ent.aiTaskGeneration];
}

/**
 * Depth of Nova's coaching, injected into system prompts so the paid tiers
 * genuinely behave differently rather than just unlocking buttons.
 */
/**
 * How Nova talks to a builder about their idea.
 *
 * The earlier version told the top tier to "pressure-test assumptions and name
 * risks", which a model reads as "find the weakness and push back" — and every
 * builder got the same push: narrow it, pick one thing, drop the rest. Advice
 * that is identical for everyone is advice for no one, and someone who came in
 * with three ideas and left with a lecture about focus doesn't come back.
 *
 * So the stance is fixed across tiers and only the depth changes: the idea is
 * the plan, the job is the sequence that makes it work, and a risk is only
 * worth naming alongside the move that handles it. Nova can be exacting about
 * order, effort and evidence without ever being the board that votes an idea
 * down.
 */
const NOVA_STANCE =
  "The builder's idea is the plan. Your job is to work out the sequence, effort and " +
  "evidence that make it succeed — not to replace it with a smaller one. Be positive " +
  "and calculating: specific about order, honest about effort, concrete about what " +
  "would prove each step worked. When you see a risk, say it in the same breath as the " +
  "move that handles it. When several directions are viable, lay them out with their " +
  "tradeoffs and let the builder choose — never give everyone the same 'focus on one " +
  "thing'. Deferring a step to later is fine and should be said as sequencing, not " +
  "cutting; removing an idea is the builder's call alone. Never tell them what to give up.";

export function coachingDirectiveFor(ent: Pick<Entitlements, "novaCoaching">): string {
  switch (ent.novaCoaching) {
    case "advanced":
      return (
        `${NOVA_STANCE} Coach at an advanced level: propose sequencing across the whole ` +
        "plan, reference the roadmap and milestones, give effort estimates, and for each " +
        "hard part name the earliest cheap test that would tell them if it's working."
      );
    case "enhanced":
      return (
        `${NOVA_STANCE} Coach at an enhanced level: break the work into concrete steps, ` +
        "say what to do next and why, and where the plan has a gap, fill it with a step."
      );
    default:
      return (
        `${NOVA_STANCE} Coach at a basic level: help them make the idea clear and ` +
        "concrete. Keep it short and specific; every reply should leave them with a next move."
      );
  }
}

/**
 * Whether a user may make another project private.
 *
 * Always yes. Privacy was a tier gate, and privacy is not Nova doing work for
 * anybody — it is a person deciding who sees their own project, which is the
 * definition of what stays free. The function and its shape survive because
 * two routes read `quota.allowed` and a third reads `quota.body`, and a
 * privacy check that goes missing is a project made public by accident.
 */
export async function checkPrivateProjectQuota(
  _userId: string
): Promise<{ allowed: true } | { allowed: false; body: UpgradeRequiredBody & { limit: number; current: number } }> {
  return { allowed: true };
}
