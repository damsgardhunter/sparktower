import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@/components/payment-dialog";
import { FlaskConical, RotateCcw, Wallet as WalletIcon } from "lucide-react";
import { formatMoney } from "@shared/plans";

/**
 * The developer's corner of the sidebar.
 *
 * This used to be a dropdown of four tiers, from when the product sold
 * subscriptions. It has not sold one for a while: every tier is free, so the
 * dropdown offered four identical choices and could not do any of the three
 * things somebody testing actually needs.
 *
 *   - Run the same small action forty times. The month's twenty-five ran out
 *     halfway through a flow and the only way on was to buy a pack.
 *   - Open "Nova builds the whole business" again. Buying it writes a build
 *     pass, the card reads the pass, and there was no way to un-buy it — so
 *     testing the purchase was one shot per project, and the way to do it
 *     twice was to make another project.
 *   - Reach the simulator's paywall twice, which has the same shape: it counts
 *     itself bought as soon as a scenario exists.
 *
 * So: one switch that makes everything free, and one button that makes a
 * project forget what it has paid for. Both dev-only at the route, and the
 * switch is dev-only again where it is honoured — see server/entitlements.ts.
 *
 * Renders only under `import.meta.env.DEV`, so it is stripped from production
 * builds entirely.
 */
export function TierSwitcher() {
  const { toast } = useToast();
  const { data: wallet } = useWallet();
  /*
   * The project being looked at, read off the path rather than from useParams.
   *
   * This panel lives in the sidebar, which is not inside the project route's
   * match, so `useParams` has nothing in it here however deep the URL is. The
   * path is the honest source: the sidebar is outside the router's idea of
   * where you are, and it still knows what the address bar says.
   */
  const [location] = useLocation();
  const projectId = /^\/projects\/([0-9a-f-]{36})/.exec(location)?.[1];

  const refresh = () => {
    // Entitlements affect nearly every query, so clear the whole cache.
    queryClient.invalidateQueries();
  };

  const fail = (title: string) => (err: any) => {
    const raw = err?.message || "";
    const at = raw.indexOf("{");
    let description = "Have a look at the server log.";
    if (at >= 0) { try { description = JSON.parse(raw.slice(at)).message || description; } catch { /* keep */ } }
    toast({ title, description, variant: "destructive" });
  };

  const unlimited = useMutation({
    mutationFn: async (on: boolean) => (await apiRequest("POST", "/api/dev/unlimited", { on })).json(),
    onSuccess: (r: { devUnlimited: boolean }) => {
      toast({
        title: r.devUnlimited ? "Everything is free now" : "Back to paying like everybody else",
        description: r.devUnlimited
          ? "Small actions, the build, the simulator, schemes — none of them charge or count."
          : "The allowance and the price list apply again.",
      });
      refresh();
    },
    onError: fail("Couldn't change that"),
  });

  const topUp = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/dev/credit-wallet", { amountCents: 5_000 })).json(),
    onSuccess: () => { toast({ title: "Added $50", description: "No payment taken." }); refresh(); },
    onError: fail("Couldn't add that"),
  });

  const resetCredits = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/dev/reset-credits")).json(),
    onSuccess: () => { toast({ title: "This month's free actions are back" }); refresh(); },
    onError: fail("Couldn't reset those"),
  });

  const forget = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/dev/forget-purchases", { projectId })).json(),
    onSuccess: (r: { forgotten: Record<string, number> }) => {
      const gone = Object.entries(r.forgotten).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(", ");
      toast({
        title: "This project has forgotten what it paid for",
        description: gone ? `Removed ${gone}. Every paywall on it is back.` : "There was nothing to forget.",
      });
      refresh();
    },
    onError: fail("Couldn't forget those"),
  });

  // Below the hooks, not above them: an early return before a hook makes the
  // hook run on some renders and not others. Vite strips this branch in a production build.
  if (!import.meta.env.DEV) return null;

  const free = !!wallet?.devUnlimited;
  const busy = unlimited.isPending || topUp.isPending || resetCredits.isPending || forget.isPending;

  return (
    <div className="px-2 py-2 rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 space-y-2" data-testid="tier-switcher">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-500">
        <FlaskConical className="h-3 w-3" /> Dev
      </div>

      <label className="flex items-center justify-between gap-2 cursor-pointer">
        <span className="text-xs font-medium">Everything free</span>
        <Switch
          checked={free}
          disabled={busy}
          onCheckedChange={(on) => unlimited.mutate(on)}
          data-testid="switch-dev-unlimited"
        />
      </label>
      <p className="text-[10px] text-muted-foreground leading-snug">
        {free
          ? "Nothing charges and the allowance stops moving. Turn it off to see what a real account sees."
          : "Charges as a real account does. Turn it on to test a flow without running out."}
      </p>

      {/* What a real account has, so it is obvious which state is being tested. */}
      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="tabular-nums" data-testid="text-dev-wallet">
          {wallet ? `${wallet.balanceDisplay} · ${wallet.allowanceRemaining}/${wallet.allowanceLimit} free` : "…"}
          {wallet && wallet.actionsBought > 0 ? ` · ${wallet.actionsBought} bought` : ""}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] gap-1"
          disabled={busy} onClick={() => topUp.mutate()} data-testid="button-dev-topup"
        >
          <WalletIcon className="h-2.5 w-2.5" /> +{formatMoney(5_000)}
        </Button>
        <Button
          variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] gap-1"
          disabled={busy} onClick={() => resetCredits.mutate()} data-testid="button-dev-reset-credits"
        >
          <RotateCcw className="h-2.5 w-2.5" /> Reset actions
        </Button>
      </div>

      {/*
        * Per project, and only offered on one: this is what makes the
        * whole-business card and the simulator's paywall testable more than
        * once, and it throws away real work to do it.
        */}
      {projectId && (
        <Button
          variant="outline" size="sm" className="h-6 w-full px-1.5 text-[10px] gap-1"
          disabled={busy} onClick={() => forget.mutate()} data-testid="button-dev-forget-purchases"
        >
          <RotateCcw className="h-2.5 w-2.5" /> Un-buy this project
        </Button>
      )}
      {projectId && (
        <p className="text-[10px] text-muted-foreground leading-snug">
          Deletes its build pass, simulations and schemes so every paywall comes back. Destructive.
        </p>
      )}
    </div>
  );
}
