import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useEntitlements } from "@/hooks/use-entitlements";
import { FlaskConical, RotateCcw } from "lucide-react";
import { TIER_IDS, PLAN_PRESENTATION, type TierId } from "@shared/plans";

/**
 * Development-only tier override, so every entitlement layer can be exercised
 * without holding four Stripe subscriptions.
 *
 * Renders only when `import.meta.env.DEV` — it's stripped from production
 * builds entirely, and the matching /api/dev/* routes 404 outside development.
 */
export function TierSwitcher() {
  const { toast } = useToast();
  const { tier, subscription, creditsUsed, creditsLimit, isUnlimited } = useEntitlements();

  if (!import.meta.env.DEV) return null;

  const refresh = () => {
    // Entitlements affect nearly every query, so clear the whole cache.
    queryClient.invalidateQueries();
  };

  const setTierMutation = useMutation({
    mutationFn: async (next: TierId) => {
      const res = await apiRequest("POST", "/api/dev/set-tier", { tier: next });
      return res.json();
    },
    onSuccess: (result: { tier: TierId }) => {
      toast({ title: `Now on ${PLAN_PRESENTATION[result.tier].name}`, description: "Dev override — not a real subscription." });
      refresh();
    },
    onError: (err: any) => {
      const raw = err?.message || "";
      const jsonStart = raw.indexOf("{");
      let description = "Couldn't switch tier.";
      if (jsonStart >= 0) {
        try { description = JSON.parse(raw.slice(jsonStart)).message || description; } catch { /* keep */ }
      }
      toast({ title: "Tier switch failed", description, variant: "destructive" });
    },
  });

  const resetCreditsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/dev/reset-credits");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Credits reset to 0 used" });
      refresh();
    },
    onError: () => toast({ title: "Couldn't reset credits", variant: "destructive" }),
  });

  const hasRealSubscription = Boolean(subscription?.stripeSubscriptionId);

  return (
    <div className="px-2 py-2 rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 space-y-2" data-testid="tier-switcher">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-500">
        <FlaskConical className="h-3 w-3" /> Dev: test tiers
      </div>

      <Select
        value={tier}
        disabled={setTierMutation.isPending || hasRealSubscription}
        onValueChange={(next) => setTierMutation.mutate(next as TierId)}
      >
        <SelectTrigger className="h-8 text-xs" data-testid="select-dev-tier">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TIER_IDS.map((t) => (
            <SelectItem key={t} value={t} className="text-xs">
              {PLAN_PRESENTATION[t].name}
              {PLAN_PRESENTATION[t].priceMonthly > 0 && ` — $${PLAN_PRESENTATION[t].priceMonthly}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">
          {creditsUsed} / {isUnlimited ? "∞" : creditsLimit} used
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[10px] gap-1"
          disabled={resetCreditsMutation.isPending}
          onClick={() => resetCreditsMutation.mutate()}
          data-testid="button-dev-reset-credits"
        >
          <RotateCcw className="h-2.5 w-2.5" /> Reset
        </Button>
      </div>

      {hasRealSubscription && (
        <p className="text-[10px] text-muted-foreground leading-snug">
          Locked: you have a real Stripe subscription. Cancel it in the billing portal to use the override.
        </p>
      )}
    </div>
  );
}
