import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Check, Zap, Crown, Rocket, Sparkles, Loader2, ExternalLink } from "lucide-react";
import { useLocation } from "wouter";
import { useEffect } from "react";

interface Plan {
  id: string;
  name: string;
  description: string;
  price: number;
  priceId: string | null;
  features: string[];
  tier: string;
  credits: number;
}

interface Subscription {
  tier: string;
  creditsUsed: number;
  creditsLimit: number;
  creditsRemaining: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

const tierIcons: Record<string, any> = {
  free: Zap,
  spark_pro: Rocket,
  spark_business: Crown,
  spark_unlimited: Sparkles,
};

const tierColors: Record<string, string> = {
  free: "border-border",
  spark_pro: "border-blue-500/50 shadow-blue-500/10",
  spark_business: "border-primary/50 shadow-primary/10 ring-2 ring-primary/20",
  spark_unlimited: "border-amber-500/50 shadow-amber-500/10",
};

export default function Pricing() {
  const { toast } = useToast();
  const [location] = useLocation();

  const { data: plans, isLoading: plansLoading } = useQuery<Plan[]>({
    queryKey: ["/api/plans"],
  });

  const { data: subscription, isLoading: subLoading } = useQuery<Subscription>({
    queryKey: ["/api/subscription"],
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe/sync-subscription");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async (priceId: string) => {
      const res = await apiRequest("POST", "/api/checkout", { priceId });
      return res.json();
    },
    onSuccess: (data: { url: string }) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to start checkout. Please try again.", variant: "destructive" });
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/billing-portal");
      return res.json();
    },
    onSuccess: (data: { url: string }) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to open billing portal.", variant: "destructive" });
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "true") {
      toast({ title: "Subscription activated!", description: "Your plan has been upgraded. Enjoy your new credits!" });
      syncMutation.mutate();
      window.history.replaceState({}, "", "/pricing");
    } else if (params.get("canceled") === "true") {
      toast({ title: "Checkout canceled", description: "No changes were made to your subscription." });
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

  const currentTier = subscription?.tier || "free";
  const creditsUsed = subscription?.creditsUsed || 0;
  const creditsLimit = subscription?.creditsLimit || 20;
  const creditsRemaining = subscription?.creditsRemaining ?? 20;
  const isUnlimited = currentTier === "spark_unlimited";
  const progressPercent = isUnlimited ? 0 : Math.min(100, (creditsUsed / creditsLimit) * 100);

  return (
    <div className="h-full overflow-y-auto p-6 md:p-8 lg:p-12">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="text-center space-y-3">
          <h1 className="text-3xl font-bold" data-testid="text-pricing-title">Pricing Plans</h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Choose the right plan for your AI-powered project workflow. All plans include access to contests, leaderboard, and community features.
          </p>
        </div>

        <Card className="mx-auto max-w-md" data-testid="card-credit-usage">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Your Credit Usage</CardTitle>
            <CardDescription>
              {isUnlimited
                ? "Unlimited credits — use AI as much as you want!"
                : `${creditsUsed} of ${creditsLimit} credits used this month`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!isUnlimited && (
              <div className="space-y-2">
                <Progress value={progressPercent} className="h-3" data-testid="progress-credits" />
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>{creditsRemaining} credits remaining</span>
                  <span>Resets monthly</span>
                </div>
              </div>
            )}
            {isUnlimited && (
              <div className="flex items-center gap-2 text-primary">
                <Sparkles className="h-5 w-5" />
                <span className="font-medium">Unlimited plan active</span>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="text-center text-sm text-muted-foreground">
          <span>AI Chat = 1 credit</span>
          <span className="mx-3">•</span>
          <span>Video Generation = 5 credits</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {(plans || []).map((plan) => {
            const Icon = tierIcons[plan.tier] || Zap;
            const isCurrentPlan = currentTier === plan.tier;
            const isPopular = plan.tier === "spark_business";

            return (
              <Card
                key={plan.id}
                className={`relative flex flex-col transition-all hover:shadow-lg ${tierColors[plan.tier] || ""} ${isCurrentPlan ? "ring-2 ring-primary" : ""}`}
                data-testid={`card-plan-${plan.tier}`}
              >
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground shadow-md" data-testid="badge-popular">
                      Most Popular
                    </Badge>
                  </div>
                )}
                {isCurrentPlan && (
                  <div className="absolute -top-3 right-4">
                    <Badge variant="outline" className="bg-background shadow" data-testid="badge-current-plan">
                      Current Plan
                    </Badge>
                  </div>
                )}

                <CardHeader className="text-center pb-2 pt-6">
                  <div className="mx-auto mb-3 h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Icon className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  <CardDescription className="text-sm">{plan.description}</CardDescription>
                </CardHeader>

                <CardContent className="flex-1 space-y-4">
                  <div className="text-center">
                    <span className="text-4xl font-bold">
                      {plan.price === 0 ? "Free" : `$${plan.price}`}
                    </span>
                    {plan.price > 0 && (
                      <span className="text-muted-foreground text-sm">/month</span>
                    )}
                  </div>

                  <div className="text-center">
                    <Badge variant="secondary" className="text-xs">
                      {plan.credits === -1 ? "Unlimited" : `${plan.credits}`} AI credits/month
                    </Badge>
                  </div>

                  <ul className="space-y-2">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>

                <CardFooter className="pt-4">
                  {isCurrentPlan ? (
                    plan.tier === "free" ? (
                      <Button variant="outline" className="w-full" disabled data-testid="button-current-free">
                        Current Plan
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
                        Manage Subscription
                      </Button>
                    )
                  ) : plan.priceId ? (
                    <Button
                      className="w-full gap-2"
                      onClick={() => checkoutMutation.mutate(plan.priceId!)}
                      disabled={checkoutMutation.isPending}
                      data-testid={`button-subscribe-${plan.tier}`}
                    >
                      {checkoutMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      {currentTier !== "free" ? "Switch Plan" : "Subscribe"}
                    </Button>
                  ) : (
                    <Button variant="outline" className="w-full" disabled data-testid="button-free-tier">
                      Free Forever
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>

        <div className="text-center text-sm text-muted-foreground space-y-1">
          <p>All paid plans include a 30-day money-back guarantee.</p>
          <p>Payments are processed securely through Stripe.</p>
        </div>
      </div>
    </div>
  );
}
