import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

/**
 * Plan and credit state, mirroring the web app's useEntitlements hook.
 *
 * Unlimited numbers arrive as -1 over the wire (JSON has no Infinity), so
 * callers get pre-computed booleans rather than having to remember that.
 */
export function useEntitlementsQuery() {
  const { data, isLoading } = useQuery({
    queryKey: ["subscription"],
    queryFn: () => api<any>("/api/subscription"),
  });

  const ent = data?.entitlements ?? {};
  const privateLimit = ent.privateProjects ?? 0;

  return {
    isLoading,
    tier: data?.tier ?? "free",
    entitlements: ent,
    creditsUsed: data?.creditsUsed ?? 0,
    creditsLimit: data?.creditsLimit ?? 0,
    creditsRemaining: data?.creditsRemaining ?? 0,
    isUnlimited: data?.unlimited ?? false,
    creditCosts: data?.creditCosts ?? {},
    privateLimit,
    privateUsed: data?.privateProjectsUsed ?? 0,
    canCreatePrivate:
      privateLimit === -1 || (data?.privateProjectsUsed ?? 0) < privateLimit,
    /** Boolean feature check, e.g. can("aiRoadmap"). */
    can: (feature: string) => ent[feature] === true,
  };
}
