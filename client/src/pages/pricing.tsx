import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useEntitlements } from "@/hooks/use-entitlements";
import {
  Check, Minus, Loader2, ExternalLink, Compass, Sparkles, Map, Rocket, AlertCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { TierId } from "@shared/plans";

interface ApiPlan {
  id: string;
  tier: TierId;
  stage: string;
  name: string;
  promise: string;
  headline: string;
  pitch: string;
  price: number;
  priceId: string | null;
  cta: string;
  featured: boolean;
  footnote: string | null;
  highlights: string[];
  credits: number;
  privateProjects: number;
  checkoutAvailable: boolean;
}

interface PlansResponse {
  plans: ApiPlan[];
  comparison: { label: string; values: Record<TierId, boolean | string> }[];
  fairUseNotice: string;
  creditCosts: Record<string, number>;
  stripeConfigured: boolean;
}

const stageIcons: Record<string, typeof Compass> = {
  Explore: Compass,
  Start: Sparkles,
  Build: Map,
  Accelerate: Rocket,
};

const TIER_ORDER: TierId[] = ["free", "starter", "builder", "pro"];

export default function Pricing() {
  const { toast } = useToast();
  const [pendingTier, setPendingTier] = useState<TierId | null>(null);

  const { data, isLoading: plansLoading } = useQuery<PlansResponse>({
    queryKey: ["/api/plans"],
  });

  const {
    tier: currentTier, isLoading: subLoading, creditsUsed, creditsLimit,
    creditsRemaining, isUnlimited, subscription,
  } = useEntitlements();

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe/sync-subscription");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/subscription"] }),
  });

  const checkoutMutation = useMutation({
    mutationFn: async ({ priceId }: { priceId: string; tier: TierId }) => {
      const res = await apiRequest("POST", "/api/checkout", { priceId });
      return res.json();
    },
    onSuccess: (result: { url?: string }) => {
      if (result.url) window.location.href = result.url;
      else {
        setPendingTier(null);
        toast({ title: "Couldn't start checkout", description: "No checkout URL was returned.", variant: "destructive" });
      }
    },
    onError: (err: any) => {
      setPendingTier(null);
      toast({ title: "Couldn't start checkout", description: err?.message || "Please try again.", variant: "destructive" });
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/billing-portal");
      return res.json();
    },
    onSuccess: (result: { url?: string }) => {
      if (result.url) window.location.href = result.url;
    },
    onError: () => toast({ title: "Couldn't open the billing portal", variant: "destructive" }),
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "true") {
      toast({ title: "You're all set!", description: "Your plan is active. Nova just leveled up." });
      syncMutation.mutate();
      window.history.replaceState({}, "", "/pricing");
    } else if (params.get("canceled") === "true") {
      toast({ title: "Checkout canceled", description: "No changes were made to your plan." });
      window.history.replaceState({}, "", "/pricing");
    }
  }, []);

  if (plansLoading || subLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const plans = [...(data?.plans || [])].sort(
    (a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)
  );
  const usagePercent = isUnlimited || creditsLimit <= 0
    ? 0
    : Math.min(100, (creditsUsed / creditsLimit) * 100);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-10 md:py-14 space-y-14">
        {/* Sell the outcome, not the credits. */}
        <header className="text-center space-y-4 max-w-3xl mx-auto">
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight" data-testid="text-pricing-title">
            Tell Nova where you want to go.
          </h1>
          <p className="text-lg md:text-xl text-secondary">
            Nova helps you figure out how to get there — turning a vague idea into a project,
            a plan, and the people you need to build it.
          </p>
        </header>

        {!data?.stripeConfigured && (
          <div className="max-w-2xl mx-auto flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4" data-testid="banner-stripe-unconfigured">
            <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
            <div className="text-sm space-y-1">
              <p className="font-medium">Checkout isn't connected yet</p>
              <p className="text-muted-foreground">
                Plans are shown from the catalog, but paid upgrades need Stripe keys in <code className="text-xs">.env</code> plus{" "}
                <code className="text-xs">npm run stripe:seed</code>.
              </p>
            </div>
          </div>
        )}

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 items-start">
          {plans.map((plan) => {
            const Icon = stageIcons[plan.stage] || Compass;
            const isCurrent = currentTier === plan.tier;
            const featured = plan.featured;

            return (
              <Card
                key={plan.tier}
                className={`relative flex flex-col h-full transition-all ${
                  featured
                    ? "border-primary shadow-xl shadow-primary/10 xl:scale-[1.04] xl:-my-2 z-10"
                    : "hover:shadow-md"
                } ${isCurrent ? "ring-2 ring-primary/60" : ""}`}
                data-testid={`card-plan-${plan.tier}`}
              >
                {featured && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <Badge className="shadow-md gap-1" data-testid="badge-recommended">
                      <Sparkles className="h-3 w-3" /> Most popular
                    </Badge>
                  </div>
                )}
                {isCurrent && (
                  <div className="absolute -top-3 right-4 z-10">
                    <Badge variant="outline" className="bg-background shadow" data-testid={`badge-current-${plan.tier}`}>
                      Your plan
                    </Badge>
                  </div>
                )}

                <CardContent className="flex flex-col h-full p-6 space-y-5">
                  {/* Progression stage, not the credit count. */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${featured ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground" data-testid={`text-stage-${plan.tier}`}>
                        {plan.stage}
                      </span>
                    </div>
                    <div className="space-y-1">
                      <h2 className="text-2xl font-bold">{plan.name}</h2>
                      <p className="text-sm text-primary font-medium">{plan.promise}</p>
                    </div>
                  </div>

                  <p className="text-sm text-secondary leading-relaxed">{plan.pitch}</p>

                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold" data-testid={`text-price-${plan.tier}`}>
                      {plan.price === 0 ? "Free" : `$${plan.price.toFixed(2)}`}
                    </span>
                    {plan.price > 0 && <span className="text-muted-foreground text-sm">/month</span>}
                  </div>

                  <div className="space-y-2.5 flex-1">
                    {plan.highlights.map((item, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <Check className={`h-4 w-4 mt-0.5 shrink-0 ${featured ? "text-primary" : "text-primary/70"}`} />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2 pt-1">
                    {isCurrent ? (
                      plan.tier === "free" ? (
                        <Button variant="outline" className="w-full" disabled data-testid="button-current-free">
                          Your current plan
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          className="w-full gap-2"
                          onClick={() => portalMutation.mutate()}
                          disabled={portalMutation.isPending}
                          data-testid="button-manage-subscription"
                        >
                          {portalMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                          Manage plan
                        </Button>
                      )
                    ) : plan.tier === "free" ? (
                      <Button
                        variant="outline"
                        className="w-full gap-2"
                        onClick={() => portalMutation.mutate()}
                        disabled={portalMutation.isPending}
                        data-testid="button-downgrade-free"
                      >
                        {portalMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Switch to Free
                      </Button>
                    ) : (
                      <Button
                        className="w-full"
                        variant={featured ? "default" : "outline"}
                        disabled={!plan.priceId || checkoutMutation.isPending}
                        onClick={() => {
                          setPendingTier(plan.tier);
                          checkoutMutation.mutate({ priceId: plan.priceId!, tier: plan.tier });
                        }}
                        data-testid={`button-subscribe-${plan.tier}`}
                      >
                        {checkoutMutation.isPending && pendingTier === plan.tier && (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        )}
                        {plan.priceId ? plan.cta : "Unavailable"}
                      </Button>
                    )}
                    {plan.footnote && (
                      <p className="text-xs text-muted-foreground text-center leading-snug" data-testid={`text-footnote-${plan.tier}`}>
                        {plan.footnote}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Current usage — meaningful once you're signed in, not a sales element. */}
        {subscription && (
          <Card className="max-w-2xl mx-auto" data-testid="card-credit-usage">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-semibold">Your Nova usage this month</p>
                  <p className="text-sm text-muted-foreground">
                    {isUnlimited
                      ? `${creditsUsed.toLocaleString()} actions used — unlimited on your plan`
                      : `${creditsUsed} of ${creditsLimit} credits used`}
                  </p>
                </div>
                <Badge variant="secondary" data-testid="badge-usage-tier">
                  {plans.find((p) => p.tier === currentTier)?.name || "Free"}
                </Badge>
              </div>
              {!isUnlimited && (
                <div className="space-y-1.5">
                  <Progress value={usagePercent} className="h-2" data-testid="progress-credits" />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{creditsRemaining} remaining</span>
                    <span>Resets at the start of each month</span>
                  </div>
                </div>
              )}
              {data?.creditCosts && (
                <p className="text-xs text-muted-foreground">
                  Nova chat 1 credit · Roadmap {data.creditCosts.roadmapGeneration} · Roadmap update{" "}
                  {data.creditCosts.roadmapUpdate} · Health check {data.creditCosts.healthCheck} · Video{" "}
                  {data.creditCosts.videoGeneration}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Full matrix — the details live down here, deliberately. */}
        <section className="space-y-5">
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-bold">Compare every plan</h2>
            <p className="text-muted-foreground text-sm">All the details, including credit limits.</p>
          </div>

          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full min-w-[46rem] border-collapse text-sm" data-testid="table-comparison">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left font-medium text-muted-foreground py-3 pr-4 w-[16rem]">Feature</th>
                  {TIER_ORDER.map((tier) => {
                    const plan = plans.find((p) => p.tier === tier);
                    return (
                      <th key={tier} className="py-3 px-3 text-center min-w-[8.5rem]">
                        <div className="space-y-0.5">
                          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                            {plan?.stage}
                          </div>
                          <div className={`font-semibold ${plan?.featured ? "text-primary" : ""}`}>{plan?.name}</div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {(data?.comparison || []).map((row) => (
                  <tr key={row.label} className="border-b border-border/50" data-testid={`row-compare-${row.label}`}>
                    <td className="py-2.5 pr-4 text-muted-foreground">{row.label}</td>
                    {TIER_ORDER.map((tier) => {
                      const value = row.values[tier];
                      return (
                        <td key={tier} className="py-2.5 px-3 text-center">
                          {value === true ? (
                            <Check className="h-4 w-4 text-primary mx-auto" aria-label="Included" />
                          ) : value === false ? (
                            <Minus className="h-4 w-4 text-muted-foreground/40 mx-auto" aria-label="Not included" />
                          ) : (
                            <span className="font-medium">{value}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="max-w-2xl mx-auto text-center space-y-2 text-xs text-muted-foreground pb-6">
          {data?.fairUseNotice && <p data-testid="text-fair-use">{data.fairUseNotice}</p>}
          <p>Cancel anytime from the billing portal. Payments are processed securely by Stripe.</p>
        </div>
      </div>
    </div>
  );
}
