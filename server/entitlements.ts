import type { Response } from "express";
import { storage } from "./storage";
import {
  getEntitlements, normalizeTier, MEMORY_MESSAGE_LIMIT, TASK_GEN_LIMIT,
  OUTCOME_PRICE_CENTS, ACTIONS_PER_PACK, TOP_UP_CENTS, topUpFor, formatMoney,
  PAY_ENDPOINTS, type PaymentRequiredBody, type Wallet,
  type BooleanFeature, type Entitlements, type TierId, type PricedOutcomeId,
} from "@shared/plans";
import { TEXT_MODEL, PRIORITY_TEXT_MODEL } from "./aiModels";
import { enforceRateLimit, consumeRateLimit } from "./moderation";
import { overCeiling, type Refusal } from "./ai-spend";
import { holdCredits, holdMoney, holdCovered, holdAction } from "./credit-reservations";
import { spend, walletOf, dayPassActive, hasBuildPass, spendBoughtAction, devUnlimited } from "./wallet";

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
  const buyable = outcome === "actionPack" || outcome === "imagePass";
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
/**
 * A ceiling refused, said in a way somebody can act on.
 *
 * 429 rather than 403: nothing is wrong with the account or the request, it
 * has simply arrived too soon, and the client should say "tomorrow" rather
 * than "upgrade". `retryAfterSeconds` is deliberately absent — the window is
 * a rolling day and the exact second it frees depends on which call rolls
 * off, which is more precision than the sentence needs.
 */
function refuseCeiling(res: Response, over: Refusal, tier: string): void {
  if (over.kind === "platform") {
    /*
     * The platform's own ceiling, not this person's. 503 rather than 429: it
     * is the service that is unavailable, nothing about their account is
     * wrong, and they should be told that plainly rather than left to think
     * they have done something.
     */
    res.status(503).json({
      code: "ai_paused",
      message: over.tier === "free"
        ? "Nova is paused for free accounts for the rest of today — more people arrived than we planned for. It comes back tomorrow, and a paid plan isn't affected."
        : "Nova is paused for the rest of today while we sort out capacity. Nothing has been charged. Sorry — this one is on us.",
      tier: over.tier,
      upgradeUrl: over.tier === "free" ? "/pricing" : undefined,
    });
    return;
  }

  const body = over.kind === "daily_credits"
    ? {
        message: `That's today's limit of ${over.cap} AI credits. It resets as the day rolls on — or upgrade for a bigger one.`,
        code: "daily_credit_cap",
        spentToday: over.spent, dailyCap: over.cap, cost: over.amount,
      }
    : over.kind === "action_day"
      ? {
          message: `You've run that ${over.cap} time${over.cap === 1 ? "" : "s"} today, which is the limit for this plan. It's one of the expensive ones — try again tomorrow.`,
          code: "action_daily_cap",
          action: over.action, used: over.used, cap: over.cap,
        }
      : {
          message: `You've run that ${over.cap} times in the last thirty days, which is the limit for this plan.`,
          code: "action_monthly_cap",
          action: over.action, used: over.used, cap: over.cap,
        };
  res.status(429).json({ ...body, tier, upgradeUrl: "/pricing" });
}

export async function requireCredits(
  res: Response,
  userId: string,
  amount: number,
  label: string,
  opts?: {
    outcome?: PricedOutcomeId;
    projectId?: string | null;
    /**
     * The action's key, for the few that carry a ceiling of their own (see
     * `HEAVY_ACTION_LIMITS`). Optional: a call that names none is still bound
     * by the platform brake and, on the allowance path, the daily credit cap.
     */
    action?: string;
  }
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

  /*
   * A developer's account, outside production: nothing is ever charged.
   *
   * This replaced a dropdown offering four tiers that were all free, which
   * could not do the one thing it was there for — running the same small
   * action forty times in a row, or opening the whole-business card again
   * after buying it once. Both of those now just work.
   *
   * Two gates, deliberately. The column is only settable through a route that
   * 404s in production, and it is only *honoured* outside production, so a row
   * that somehow arrived in a production database with the flag set still pays
   * like everybody else. A switch that turns off billing is worth being
   * paranoid about, and the cost of the second check is one boolean.
   *
   * `holdCovered` rather than an early `return ent`: the route at the other
   * end still calls deductCredits when it finishes, and without a hold to
   * settle against it would fall through and take an action off the month's
   * allowance — which is the one thing this is supposed to stop.
   */
  if (process.env.NODE_ENV !== "production" && await devUnlimited(userId)) {
    holdCovered(res, userId, opts?.outcome);
    return ent;
  }

  const outcome = opts?.outcome;
  const projectId = opts?.projectId ?? null;

  /*
   * The ceilings, before anything is charged.
   *
   * Only the platform brake is enforced here, and the two account ceilings
   * are deliberately not, because both were written against a subscription
   * model that pay-per-use replaced. Under it a tier meant a price and an
   * allowance; here every tier is free, every tier draws the same monthly
   * allowance, and what bounds spending is the price of the outcome. The
   * tables did not come across with that, and applying them as they stand
   * does the opposite of what they were for:
   *
   *   - `HEAVY_ACTION_LIMITS` gives the free tier `{day: 0}` for codeAudit,
   *     loopAudit and simulationBuild — an honest cap when free meant the
   *     unpaid tier, and a total block now that it is the only tier anybody
   *     is on. Enforcing it would refuse those three to every user, and for
   *     the priced ones it would refuse them *after* taking the money.
   *
   *   - `DAILY_CREDIT_CAP` no longer counts anything real. It still rises
   *     10/25/60/120 across tiers that are now identical, so two of its
   *     entries exceed the whole 25-action month they are drawn from. Worse,
   *     the units stopped matching: this path charges **one** per small
   *     action while the cap counts the CREDIT_COSTS-weighted `amount`, so an
   *     eight credit action would count eight times against a ten credit day
   *     while taking one off the allowance.
   *
   * So `action` is threaded through and passed on, and the day those tables
   * are retuned for a world where every account is free this becomes a
   * one-line change — but nothing refuses on them until somebody does that
   * sum. Burst is bounded by the AI rate limit at the top of this function,
   * and cost by the price.
   */
  const over = await overCeiling(userId, ent.tier, 0, opts?.action);
  if (over?.kind === "platform") {
    refuseCeiling(res, over, ent.tier);
    return null;
  }

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
  /*
   * A pass somebody already bought, honoured to the hour it was sold for.
   *
   * Nothing sells one any more. Checked before the bought actions on purpose:
   * while a pass is running it covers everything, so it would be daylight
   * robbery to quietly spend a pack the same person had also paid for.
   */
  if (await dayPassActive(userId)) {
    holdCovered(res, userId);
    return ent;
  }
  /*
   * And then the actions they bought, one at a time.
   *
   * Taken here rather than at settle-time so two requests arriving together
   * cannot both spend the last one; `holdAction` is what hands it back if the
   * work never happens.
   */
  if (await spendBoughtAction(userId)) {
    holdAction(res, userId);
    return ent;
  }

  const wallet = await walletOf(userId);
  const pack = OUTCOME_PRICE_CENTS.actionPack;
  const affordable = wallet.balanceCents >= pack;
  res.status(402).json(paymentRequired({
    message: affordable
      ? `You've used all ${wallet.allowanceLimit} free Nova actions this month. ` +
        `${formatMoney(pack)} buys ${ACTIONS_PER_PACK} more — they don't expire — ` +
        `and you have ${wallet.balanceDisplay} on your account.`
      : `You've used all ${wallet.allowanceLimit} free Nova actions this month. ` +
        `${formatMoney(pack)} buys ${ACTIONS_PER_PACK} more, whenever you want them. ` +
        `Your allowance resets at the start of next month — ${label} is free again then.`,
    label, outcome: "actionPack", cents: pack, wallet,
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
