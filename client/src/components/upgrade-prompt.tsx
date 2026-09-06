import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lock, Sparkles } from "lucide-react";
import { useLocation } from "wouter";
import { PLAN_PRESENTATION, minimumTierFor, type BooleanFeature, type TierId } from "@shared/plans";

interface UpgradePromptProps {
  /**
   * The gated boolean feature; the pitched plan is derived from it. Omit and
   * pass `requiredTier` instead for level-gated features like analytics.
   */
  feature?: BooleanFeature;
  /** Explicit plan to pitch. Takes precedence over `feature`. */
  requiredTier?: TierId;
  /** What the user was trying to do, e.g. "Build an AI roadmap". */
  title: string;
  /** Why it's worth having — sell the outcome, not the entitlement. */
  description: string;
  /** Compact inline row instead of a full card. */
  variant?: "card" | "inline";
}

/**
 * Shown in place of a gated feature. Names the specific plan that unlocks it
 * rather than a generic "upgrade required", matching the 402 body the server
 * returns from requireFeature()/requireLevel().
 */
export function UpgradePrompt({ feature, requiredTier: explicitTier, title, description, variant = "card" }: UpgradePromptProps) {
  const [, setLocation] = useLocation();
  const requiredTier = explicitTier ?? (feature ? minimumTierFor(feature) : null);
  const plan = requiredTier ? PLAN_PRESENTATION[requiredTier] : null;
  const testId = feature || requiredTier || "upgrade";

  if (variant === "inline") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border bg-muted/30 px-4 py-3" data-testid={`upgrade-inline-${testId}`}>
        <div className="flex items-start gap-2.5 min-w-0">
          <Lock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium">{title}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => setLocation("/pricing")} data-testid={`button-upgrade-${testId}`}>
          {plan ? `Get ${plan.name}` : "Upgrade"}
        </Button>
      </div>
    );
  }

  return (
    <Card className="border-dashed" data-testid={`upgrade-card-${testId}`}>
      <CardContent className="p-6 flex flex-col items-center text-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <div className="space-y-1.5 max-w-md">
          <div className="flex items-center justify-center gap-2">
            <h3 className="font-semibold">{title}</h3>
            {plan && <Badge variant="secondary" className="text-xs">{plan.name}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button className="gap-2 mt-1" onClick={() => setLocation("/pricing")} data-testid={`button-upgrade-${testId}`}>
          <Sparkles className="h-4 w-4" />
          {plan ? plan.cta : "See plans"}
        </Button>
        {plan && plan.priceMonthly > 0 && (
          <p className="text-xs text-muted-foreground">${plan.priceMonthly.toFixed(2)}/month · cancel anytime</p>
        )}
      </CardContent>
    </Card>
  );
}
