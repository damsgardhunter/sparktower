import type { Response } from "express";
import { storage } from "./storage";
import {
  getEntitlements, normalizeTier, minimumTierFor, PLAN_PRESENTATION,
  MEMORY_MESSAGE_LIMIT, TASK_GEN_LIMIT, FAIR_USE_MONTHLY_CAP,
  type BooleanFeature, type Entitlements, type TierId,
} from "@shared/plans";
import { TEXT_MODEL, PRIORITY_TEXT_MODEL } from "./aiModels";
import { enforceRateLimit } from "./moderation";

export interface UserEntitlements extends Entitlements {
  tier: TierId;
}

export async function getUserEntitlements(userId: string): Promise<UserEntitlements> {
  const user = await storage.getUser(userId);
  const tier = normalizeTier(user?.subscriptionTier);
  return { tier, ...getEntitlements(tier) };
}

/**
 * Shape returned to the client on a 402. The frontend uses `requiredTier` to
 * show a targeted upsell ("Builder unlocks this") instead of a generic error.
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
 * Guards a boolean-gated feature. Returns the entitlements when allowed, or
 * null after writing a 402 — callers should `return` immediately on null.
 *
 *   const ent = await requireFeature(res, userId, "aiRoadmap", "AI Roadmap Builder");
 *   if (!ent) return;
 */
export async function requireFeature(
  res: Response,
  userId: string,
  feature: BooleanFeature,
  label: string
): Promise<UserEntitlements | null> {
  const ent = await getUserEntitlements(userId);
  if (ent[feature] === true) return ent;

  const requiredTier = minimumTierFor(feature);
  const body: UpgradeRequiredBody = {
    message: requiredTier
      ? `${label} is available on the ${PLAN_PRESENTATION[requiredTier].name} plan and above.`
      : `${label} is not available on your plan.`,
    code: "upgrade_required",
    feature,
    currentTier: ent.tier,
    requiredTier,
    requiredTierName: requiredTier ? PLAN_PRESENTATION[requiredTier].name : null,
  };
  res.status(402).json(body);
  return null;
}

/**
 * Guards a level-gated feature (analytics, task generation, ...) by requiring
 * the tier's level to be one of `allowed`.
 */
export async function requireLevel<K extends keyof Entitlements>(
  res: Response,
  userId: string,
  key: K,
  allowed: Entitlements[K][],
  label: string,
  requiredTier: TierId
): Promise<UserEntitlements | null> {
  const ent = await getUserEntitlements(userId);
  if (allowed.includes(ent[key])) return ent;

  const body: UpgradeRequiredBody = {
    message: `${label} is available on the ${PLAN_PRESENTATION[requiredTier].name} plan and above.`,
    code: "upgrade_required",
    feature: String(key),
    currentTier: ent.tier,
    requiredTier,
    requiredTierName: PLAN_PRESENTATION[requiredTier].name,
  };
  res.status(402).json(body);
  return null;
}

/**
 * Credit guard. Handles the Pro fair-use ceiling too: Pro is unlimited for any
 * realistic human use, but a runaway automation hits the cap and gets a clear
 * message rather than silently costing us thousands of dollars.
 */
export async function requireCredits(
  res: Response,
  userId: string,
  amount: number,
  label: string
): Promise<UserEntitlements | null> {
  /*
   * Every AI endpoint passes through here for its credit check, which makes
   * this the one place a per-minute limit covers all of them — thirty routes,
   * none of which has to remember to add it. Credits cap the month; this caps
   * the burst, which is the shape a script has and a person doesn't.
   */
  if (!(await enforceRateLimit(res, userId, "ai"))) return null;

  const ent = await getUserEntitlements(userId);
  const sub = await storage.getUserSubscription(userId);

  if (ent.credits === Infinity) {
    if (sub.creditsUsed + amount > FAIR_USE_MONTHLY_CAP) {
      res.status(429).json({
        message:
          `You've reached the fair-use limit of ${FAIR_USE_MONTHLY_CAP.toLocaleString()} AI actions ` +
          `this month. Get in touch and we'll sort it out.`,
        code: "fair_use_limit",
        creditsUsed: sub.creditsUsed,
        fairUseCap: FAIR_USE_MONTHLY_CAP,
        tier: ent.tier,
      });
      return null;
    }
    return ent;
  }

  if (sub.creditsRemaining < amount) {
    res.status(403).json({
      message: `Not enough credits for ${label}. This costs ${amount} credit${amount === 1 ? "" : "s"}.`,
      code: "insufficient_credits",
      cost: amount,
      creditsRemaining: sub.creditsRemaining,
      creditsLimit: sub.creditsLimit,
      tier: ent.tier,
    });
    return null;
  }

  return ent;
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
 * Returns null when allowed, or an upgrade body when the cap is reached.
 */
export async function checkPrivateProjectQuota(
  userId: string
): Promise<{ allowed: true } | { allowed: false; body: UpgradeRequiredBody & { limit: number; current: number } }> {
  const ent = await getUserEntitlements(userId);

  if (ent.privateProjects === Infinity) return { allowed: true };

  const current = await storage.countPrivateProjects(userId);
  if (current < ent.privateProjects) return { allowed: true };

  const requiredTier: TierId = ent.privateProjects === 0 ? "starter" : "builder";
  return {
    allowed: false,
    body: {
      message:
        ent.privateProjects === 0
          ? "Private projects are available on the Starter plan and above."
          : `You've used all ${ent.privateProjects} private projects on your plan. Builder includes unlimited.`,
      code: "upgrade_required",
      feature: "privateProjects",
      currentTier: ent.tier,
      requiredTier,
      requiredTierName: PLAN_PRESENTATION[requiredTier].name,
      limit: ent.privateProjects,
      current,
    },
  };
}
