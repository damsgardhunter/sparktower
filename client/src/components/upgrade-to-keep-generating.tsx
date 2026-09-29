import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useEntitlements } from "@/hooks/use-entitlements";
import { errorText } from "@/lib/api-error";
import { upgradeOptions, type CreditState } from "@shared/credits";
import { Loader2, Sparkles, Zap } from "lucide-react";

/** Fired when a generate is refused for credits (see apiRequest), or someone asks to upgrade from a low-credits notice. */
export const CREDITS_EVENT = "sparktower:credits";
export interface CreditsEventDetail { state: CreditState; message?: string; cost?: number; creditsRemaining?: number }

export function openUpgrade(detail: CreditsEventDetail) {
  window.dispatchEvent(new CustomEvent<CreditsEventDetail>(CREDITS_EVENT, { detail }));
}

interface Plan { id: string; tier: string; name: string; price: number; priceId: string | null; credits: number; promise: string; featured: boolean; checkoutAvailable: boolean }

/**
 * The revenue loop's turn: out of (or nearly out of) AI credits, the plans
 * above yours, and checkout that brings you back to the page you were on —
 * where the credits you just bought are waiting (see CheckoutReturn).
 * Mounted once, for the whole signed-in app.
 */
export function UpgradeToKeepGenerating() {
  const [detail, setDetail] = useState<CreditsEventDetail | null>(null);
  const { tier, subscription } = useEntitlements();
  const { toast } = useToast();

  useEffect(() => {
    const on = (e: Event) => setDetail((e as CustomEvent<CreditsEventDetail>).detail);
    window.addEventListener(CREDITS_EVENT, on);
    return () => window.removeEventListener(CREDITS_EVENT, on);
  }, []);

  const { data } = useQuery<{ plans: Plan[]; stripeConfigured: boolean }>({ queryKey: ["/api/plans"], enabled: !!detail });
  const options = upgradeOptions(data?.plans ?? [], tier);

  const checkout = useMutation({
    mutationFn: async (priceId: string) => (await apiRequest("POST", "/api/checkout", {
      priceId, returnTo: `${window.location.pathname}${window.location.search}`,
    })).json() as Promise<{ url?: string; switched?: boolean }>,
    onSuccess: ({ url, switched }) => {
      // A paying member upgrades the subscription they have — never a second one (see /api/checkout).
      if (switched) {
        void queryClient.invalidateQueries();
        toast({ title: "Plan upgraded", description: "The difference is prorated on your next invoice. Your credits are ready." });
        return;
      }
      if (url) window.location.href = url;
    },
    onError: (e) => toast({ title: "Couldn't start checkout", description: errorText(e), variant: "destructive" }),
  });

  const remaining = detail?.creditsRemaining ?? subscription?.creditsRemaining;
  return (
    <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
      <DialogContent className="max-w-lg" data-testid="upgrade-to-keep-generating">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Zap className="h-4 w-4 text-primary" />Upgrade to keep generating</DialogTitle>
          <DialogDescription>
            {detail?.state === "out"
              ? `${detail.message ?? "You're out of AI credits for this month."} Pick a plan and Nova picks up where it stopped.`
              : `${remaining ?? "A few"} credit${remaining === 1 ? "" : "s"} left this month. A plan gives Nova room to keep building your path.`}
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2" data-testid="upgrade-plan-options">
          {options.map((p) => (
            <li key={p.tier} className={`rounded-md border p-3 flex items-center gap-3 ${p.featured ? "border-primary/50 bg-primary/5" : "border-border"}`} data-testid={`upgrade-plan-${p.tier}`}>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{p.name} · ${p.price}/mo</p>
                <p className="text-xs text-muted-foreground">{p.credits < 0 ? "Unlimited AI credits" : `${p.credits} AI credits a month`} — {p.promise}</p>
              </div>
              {p.priceId ? (
                <Button size="sm" disabled={checkout.isPending} onClick={() => checkout.mutate(p.priceId!)} data-testid={`button-upgrade-${p.tier}`}>
                  {checkout.isPending && checkout.variables === p.priceId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Choose"}
                </Button>
              ) : (
                <a href="/pricing" className="text-xs text-primary hover:underline">See plan</a>
              )}
            </li>
          ))}
          {data && !options.length && <li className="text-sm text-muted-foreground">You're on the top plan. Your credits refill when your plan renews.</li>}
        </ul>
        <DialogFooter className="sm:justify-between gap-2">
          <a href="/pricing" className="text-xs text-muted-foreground hover:underline self-center">Compare every plan</a>
          <Button variant="outline" onClick={() => setDetail(null)}>Not now</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Back from Stripe on the page you left (?checkout=success): the plan is synced
 * — the webhook usually got there first — the credit count refreshed, and the
 * flag taken out of the address, so whatever you were generating is one click away.
 */
export function CheckoutReturn() {
  const [location] = useLocation();
  const { toast } = useToast();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("checkout");
    if (!outcome) return;
    params.delete("checkout");
    const rest = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    if (outcome === "canceled") {
      toast({ title: "Checkout canceled", description: "Nothing was charged." });
      return;
    }
    if (outcome !== "success") return;
    (async () => {
      try { await apiRequest("POST", "/api/stripe/sync-subscription"); } catch { /* the webhook sets the plan either way */ }
      await queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
      toast({ title: "You're upgraded", description: "Your plan is active." });
    })();
  }, [location, toast]);
  return null;
}

/** A quiet line where generating happens, once credits run low — before a generate is refused. */
export function LowCreditsNotice({ className = "" }: { className?: string }) {
  const { subscription } = useEntitlements();
  const state = subscription?.creditState;
  if (!subscription || !state || state === "ok") return null;
  return (
    <div className={`flex items-center gap-2 text-xs rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 flex-wrap ${className}`} data-testid="low-credits-notice">
      <Sparkles className="h-3.5 w-3.5 text-amber-600 shrink-0" />
      <span>{state === "out" ? "You're out of AI credits this month." : `${subscription.creditsRemaining} AI credit${subscription.creditsRemaining === 1 ? "" : "s"} left this month.`}</span>
      <button
        className="ml-auto text-primary font-medium hover:underline"
        onClick={() => openUpgrade({ state, creditsRemaining: subscription.creditsRemaining })}
        data-testid="button-low-credits-upgrade"
      >
        Upgrade to keep generating
      </button>
    </div>
  );
}

/**
 * A subscription payment failed (or was refunded): said once, at the top of
 * the app, with the way to fix it — the billing portal, which comes back here.
 */
export function BillingIssueNotice() {
  const { subscription } = useEntitlements();
  const { toast } = useToast();
  const portal = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/billing-portal", { returnTo: `${window.location.pathname}${window.location.search}` })).json() as Promise<{ url: string }>,
    onSuccess: ({ url }) => { if (url) window.location.href = url; },
    onError: (e) => toast({ title: "Couldn't open billing", description: errorText(e), variant: "destructive" }),
  });
  const issue = subscription?.billingIssue;
  if (!issue) return null;
  return (
    <div className="flex items-center gap-2 text-xs border-b border-destructive/30 bg-destructive/5 px-4 py-2 flex-wrap" data-testid={`billing-issue-${issue.kind}`}>
      <span>{issue.kind === "payment_failed" ? `Your last payment failed: ${issue.message}` : issue.message}</span>
      <button className="ml-auto text-primary font-medium hover:underline" disabled={portal.isPending} onClick={() => portal.mutate()} data-testid="button-billing-issue-fix">
        {issue.kind === "payment_failed" ? "Update your card" : "Manage billing"}
      </button>
    </div>
  );
}
