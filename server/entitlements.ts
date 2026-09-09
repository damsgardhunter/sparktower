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
export function coachingDirectiveFor(ent: Pick<Entitlements, "novaCoaching">): string {
  switch (ent.novaCoaching) {
    case "advanced":
      return (
        "Coach at an advanced level. Pressure-test assumptions, name concrete risks and " +
        "tradeoffs, propose sequencing, and reference the project's roadmap and milestones " +
        "when relevant. Offer specific next actions with rough effort estimates."
      );
    case "enhanced":
      return (
        "Coach at an enhanced level. Break work into concrete steps, suggest what to tackle " +
        "next and why, and point out gaps in the plan. Keep it practical and specific."
      );
    default:
      return (
        "Coach at a basic level. Be encouraging and help the user clarify their idea. " +
        "Keep guidance high-level and short."
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
