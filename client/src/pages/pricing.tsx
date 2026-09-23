import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useWallet } from "@/components/payment-dialog";
import { errorText } from "@/lib/api-error";
import {
  PRICING_ROWS, PRICING_NOTICE, TOP_UP_CENTS, TOP_UP_DEFAULTS,
  MONTHLY_SMALL_ACTIONS, DAY_PASS_HOURS, formatMoney,
} from "@shared/plans";
import { cn } from "@/lib/utils";
import { Check, Clock, Loader2, Wallet as WalletIcon } from "lucide-react";

/**
 * What it costs.
 *
 * There are no plans on this page any more, and that is the product decision
 * it exists to state: everything a person does themselves is free forever, a
 * month's worth of small Nova actions comes with that, and Nova doing a whole
 * piece of work for you is bought in plain dollars, once, at a price you can
 * read before you press anything.
 *
 * The page used to sell four subscription tiers the server no longer charges
 * for — a price list that had stopped being true, which is worse than not
 * having one. The rows come from shared/plans (PRICING_ROWS) so that this page
 * and the dialog that asks for money can never quote different numbers.
 */
export default function Pricing() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: wallet } = useWallet(!!user);
  const [amountCents, setAmountCents] = useState<number>(TOP_UP_DEFAULTS[1] ?? 1000);
  const [showAll, setShowAll] = useState(false);

  const topUp = useMutation({
    mutationFn: async (cents: number) => (await apiRequest("POST", "/api/nova/top-up", {
      amountCents: cents, returnTo: "/pricing",
    })).json() as Promise<{ url?: string }>,
    onSuccess: ({ url }) => {
      if (url) { window.location.href = url; return; }
      toast({ title: "Couldn't start checkout", variant: "destructive" });
    },
    onError: (e) => toast({ title: "Couldn't start checkout", description: errorText(e), variant: "destructive" }),
  });

  const options = showAll ? TOP_UP_CENTS : TOP_UP_DEFAULTS;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16 space-y-8">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">What it costs</h1>
        <p className="text-muted-foreground">
          Everything you do yourself is free, forever. You pay only when Nova does a piece of work for you —
          once, per thing, at a price you see first.
        </p>
      </header>

      {/* Signed in: what you actually have, before any list of prices. */}
      {user && (
        <Card data-testid="card-wallet">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <WalletIcon className="h-4 w-4" /> Your balance
              </span>
              <span className="text-2xl font-semibold tabular-nums" data-testid="text-wallet-balance">
                {wallet ? wallet.balanceDisplay : "—"}
              </span>
            </div>

            {wallet && (
              <p className="text-sm text-muted-foreground" data-testid="text-wallet-allowance">
                {wallet.dayPassActive ? (
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    Day pass on — small Nova actions are unlimited
                    {wallet.dayPassUntil ? ` until ${new Date(wallet.dayPassUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}.
                  </span>
                ) : (
                  `${wallet.allowanceRemaining} of ${wallet.allowanceLimit} free Nova actions left this month.`
                )}
              </p>
            )}

            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {options.map((cents) => (
                  <button
                    key={cents}
                    type="button"
                    onClick={() => setAmountCents(cents)}
                    data-testid={`button-amount-${cents}`}
                    className={cn(
                      "rounded-md border px-4 py-2 text-sm font-medium transition-colors",
                      amountCents === cents ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
                    )}
                  >
                    {formatMoney(cents)}
                  </button>
                ))}
                {!showAll && (
                  <button type="button" onClick={() => setShowAll(true)} className="px-2 text-sm text-muted-foreground hover:text-foreground" data-testid="button-more-amounts">
                    More
                  </button>
                )}
              </div>
              <Button onClick={() => topUp.mutate(amountCents)} disabled={topUp.isPending} data-testid="button-top-up">
                {topUp.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Working…</> : `Add ${formatMoney(amountCents)}`}
              </Button>
              <p className="text-xs text-muted-foreground">
                It never expires and it works on anything. There's no plan, so there's nothing to cancel.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* The list itself, straight from shared/plans so it can't drift from what you're charged. */}
      <div className="rounded-xl border divide-y" data-testid="list-prices">
        {PRICING_ROWS.map((row) => (
          <div key={row.label} className="flex items-start gap-4 p-4" data-testid={`row-price-${row.label}`}>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="font-medium leading-snug">{row.label}</p>
              <p className="text-sm text-muted-foreground">{row.detail}</p>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-md px-2 py-1 text-sm font-semibold tabular-nums",
                row.price === "Free" ? "bg-emerald-500/10 text-emerald-600" : "bg-muted",
              )}
            >
              {row.price}
            </span>
          </div>
        ))}
      </div>

      <div className="space-y-3 text-sm text-muted-foreground">
        <p className="flex items-start gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          {PRICING_NOTICE}
        </p>
        <p className="flex items-start gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          The {MONTHLY_SMALL_ACTIONS} free Nova actions reset at the start of every month. If you run out mid-flow,
          a {formatMoney(100)} day pass covers them for {DAY_PASS_HOURS} hours — or you wait, and they come back.
        </p>
      </div>
    </div>
  );
}
