import { useQuery } from "@tanstack/react-query";
import {
  ENTITLEMENTS, PLAN_PRESENTATION, normalizeTier, minimumTierFor,
  type BooleanFeature, type Entitlements, type TierId,
} from "@shared/plans";

/** Shape of GET /api/subscription. Unlimited numbers arrive as -1. */
export interface SubscriptionResponse {
  tier: string;
  creditsUsed: number;
  creditsLimit: number;
  creditsRemaining: number;
  unlimited: boolean;
  fairUseCap: number | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  entitlements: Omit<Entitlements, "credits" | "privateProjects"> & {
    credits: number;
    privateProjects: number;
  };
  privateProjectsUsed: number;
  creditCosts: Record<string, number>;
}

/**
 * Single source of truth for what the signed-in user can do.
 *
 * Server routes enforce the same rules via server/entitlements.ts — this hook
 * exists so the UI can show a targeted upsell instead of letting someone click
 * a button that will 402.
 */
export function useEntitlements() {
  const { data, isLoading, error } = useQuery<SubscriptionResponse>({
    queryKey: ["/api/subscription"],
  });

  const tier: TierId = normalizeTier(data?.tier);
  // Fall back to the local table while loading so gated UI stays hidden
  // rather than flashing available and then disappearing.
  const entitlements = data?.entitlements ?? {
    ...ENTITLEMENTS[tier],
    credits: ENTITLEMENTS[tier].credits === Infinity ? -1 : ENTITLEMENTS[tier].credits,
    privateProjects: ENTITLEMENTS[tier].privateProjects === Infinity ? -1 : ENTITLEMENTS[tier].privateProjects,
  };

  return {
    isLoading,
    error,
    tier,
    plan: PLAN_PRESENTATION[tier],
    entitlements,
    subscription: data,

    /** True when the current plan includes a boolean feature. */
    can: (feature: BooleanFeature) => entitlements[feature] === true,

    /** The plan someone needs to upgrade to for a feature, for upsell copy. */
    requiredPlanFor: (feature: BooleanFeature) => {
      const required = minimumTierFor(feature);
      return required ? PLAN_PRESENTATION[required] : null;
    },

    creditsUsed: data?.creditsUsed ?? 0,
    creditsLimit: data?.creditsLimit ?? ENTITLEMENTS[tier].credits,
    creditsRemaining: data?.creditsRemaining ?? 0,
    isUnlimited: data?.unlimited ?? ENTITLEMENTS[tier].credits === Infinity,

    privateProjectsUsed: data?.privateProjectsUsed ?? 0,
    privateProjectLimit: entitlements.privateProjects,
    canCreatePrivateProject:
      entitlements.privateProjects === -1 ||
      (data?.privateProjectsUsed ?? 0) < entitlements.privateProjects,
  };
}
