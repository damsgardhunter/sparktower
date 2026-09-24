import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/api-error";
import { formatMoney } from "@shared/plans";
import { cn } from "@/lib/utils";
import { Banknote, ExternalLink, Loader2, Trophy, HeartHandshake, Wallet as WalletIcon, Check } from "lucide-react";

/**
 * What you've earned, where it went, and where the next of it should go.
 *
 * Money reaches a person here two ways, and the page is built around the
 * difference rather than hiding it behind one total. The SparkTower balance is
 * instant, needs no bank and is spendable on Nova the moment it lands; a bank
 * transfer is real money leaving the platform and needs everything Stripe asks
 * for before it will move. A person choosing between those is making a real
 * decision and deserves to see what each one costs them.
 *
 * The three figures are split by destination for the same reason. "You have
 * earned $450" is not something anybody can act on when $200 is escrowed
 * pending a reviewer, $150 is spendable right now and $100 left for a bank a
 * fortnight ago — those are three answers to three questions, and one total
 * answers none of them.
 */

type EarningState = "held" | "balance" | "bank";

interface EarningLine {
  id: string;
  kind: "backing" | "prize";
  amountCents: number;
  what: string;
  at: string;
  state: EarningState;
  note: string | null;
}

interface EarningsRead {
  toBalanceCents: number;
  toBankCents: number;
  heldCents: number;
  lines: EarningLine[];
  balanceCents: number;
  payoutTarget: "balance" | "bank";
  bank: { connected: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean; available: boolean };
}

export default function Earnings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [location] = useLocation();

  const { data, isLoading } = useQuery<EarningsRead>({
    queryKey: ["/api/earnings"],
    /*
     * The app defaults to `staleTime: Infinity`, which is right for most of it
     * and wrong for this. Somebody lands back here straight from Stripe's
     * onboarding form and the whole question they have is whether it worked; a
     * cached "not connected" from ninety seconds ago answers it wrongly.
     */
    staleTime: 0,
    refetchOnMount: "always",
  });

  /* Back from Stripe. Re-ask rather than trusting the redirect. */
  useEffect(() => {
    if (!window.location.search.includes("connected=1")) return;
    queryClient.invalidateQueries({ queryKey: ["/api/earnings"] });
    window.history.replaceState({}, "", "/earnings");
  }, [location, queryClient]);

  const connect = useMutation({
    mutationFn: async () => {
      /*
       * Two calls, because the account has to exist before a link to its
       * onboarding can be made. Creating one for somebody who already has one
       * is safe — the route returns the existing id — so this needs no branch.
       */
      await apiRequest("POST", "/api/stripe/connect-account", {});
      const res = await apiRequest("GET", "/api/stripe/connect-onboarding");
      return (await res.json()) as { url?: string };
    },
    onSuccess: ({ url }) => {
      if (url) { window.location.href = url; return; }
      toast({ title: "Couldn't open the bank setup", description: "Stripe didn't send us a link back. Try again in a minute.", variant: "destructive" });
    },
    onError: (e) => toast({ title: "Couldn't open the bank setup", description: errorText(e), variant: "destructive" }),
  });

  const dashboard = useMutation({
    mutationFn: async () => (await apiRequest("GET", "/api/stripe/connect-dashboard")).json() as Promise<{ url?: string }>,
    onSuccess: ({ url }) => { if (url) window.open(url, "_blank", "noopener"); },
    onError: (e) => toast({ title: "Couldn't open Stripe", description: errorText(e), variant: "destructive" }),
  });

  const setTarget = useMutation({
    mutationFn: async (target: "balance" | "bank") =>
      (await apiRequest("PATCH", "/api/earnings/target", { target })).json() as Promise<EarningsRead>,
    onSuccess: (fresh) => {
      queryClient.setQueryData(["/api/earnings"], fresh);
      // The sidebar's balance line reads the wallet, which this doesn't move — but the choice is worth confirming.
      toast({ title: fresh.payoutTarget === "balance" ? "Your earnings will land here" : "Your earnings will go to your bank" });
    },
    onError: (e) => toast({ title: "Couldn't change that", description: errorText(e), variant: "destructive" }),
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-24" data-testid="earnings-loading">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { bank } = data;
  const canUseBank = bank.available && bank.payoutsEnabled;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6" data-testid="page-earnings">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Earnings</h1>
        <p className="text-muted-foreground mt-1">
          Money people have put behind your work, and where it went.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {/*
          * "Paid into", not "in". This is everything that has ever landed in
          * the balance, which is not the same as what is in it now — spend
          * some on Nova and the two diverge, and a figure headed "in your
          * balance" that disagrees with the balance in the sidebar is the
          * kind of small lie that makes somebody distrust the whole page. The
          * current figure is stated on its own, under the choice below.
          */}
        <Figure label="Paid into your balance" cents={data.toBalanceCents} testId="balance"
          note="Earned here, then added to your balance." />
        <Figure label="Sent to your bank" cents={data.toBankCents} testId="bank"
          note="Left the platform." />
        <Figure label="Held" cents={data.heldCents} testId="held"
          note="Not yours yet — waiting on approval." />
      </div>

      {/*
        * The choice this page exists for. Releasing backed funds used to demand
        * a Stripe account and refuse without one, so a creator who never got
        * through Stripe's identity checks could not be paid at all.
        */}
      <Card data-testid="card-destination">
        <CardContent className="p-5">
          <p className="font-medium">Where your earnings should go</p>
          <p className="text-sm text-muted-foreground mt-1">
            You can change this whenever you like. It applies to money you earn from now on.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 mt-4">
            <DestinationChoice
              icon={<WalletIcon className="h-4 w-4" />}
              title="My SparkTower balance"
              body="Lands the moment it's approved. No bank, no forms, no waiting. Spend it on Nova."
              chosen={data.payoutTarget === "balance"}
              disabled={setTarget.isPending}
              onPick={() => setTarget.mutate("balance")}
              testId="pick-balance"
            />
            <DestinationChoice
              icon={<Banknote className="h-4 w-4" />}
              title="My bank account"
              body={canUseBank
                ? "Paid out through Stripe to the account you've connected."
                : "Needs a connected bank account before you can pick it."}
              chosen={data.payoutTarget === "bank"}
              disabled={setTarget.isPending || !canUseBank}
              onPick={() => setTarget.mutate("bank")}
              testId="pick-bank"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Your balance right now is {formatMoney(data.balanceCents)}, including anything you've topped up.
          </p>
        </CardContent>
      </Card>

      {/* The bank account, and what Stripe currently thinks of it. */}
      <Card data-testid="card-bank">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <Banknote className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              {!bank.available ? (
                <>
                  <p className="font-medium">Bank payouts aren't switched on here</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    This server isn't set up to send money to banks. Your earnings land in your
                    balance instead, which works exactly the same for paying for Nova.
                  </p>
                </>
              ) : !bank.connected ? (
                <>
                  <p className="font-medium">Connect a bank account</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Only needed if you want money sent out of SparkTower. Stripe handles the
                    details and the payouts — we never see your bank details.
                  </p>
                </>
              ) : !bank.detailsSubmitted ? (
                <>
                  <p className="font-medium">You started, but Stripe still needs a few things</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Until the form is finished, your bank can't be picked as a destination.
                    Picking up where you left off takes a minute.
                  </p>
                </>
              ) : !bank.payoutsEnabled ? (
                <>
                  <p className="font-medium">Stripe is still checking your details</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    You've done your part. Stripe sometimes asks for a document before it will
                    send money — if it needs one, it'll be waiting in your Stripe dashboard.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium">Your bank account is connected</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {data.payoutTarget === "bank"
                      ? "Money that becomes yours goes out to it automatically."
                      : "It's ready whenever you want to switch to it."}
                  </p>
                </>
              )}
              <div className="flex flex-wrap gap-2 mt-3">
                {bank.available && !bank.payoutsEnabled && (
                  <Button size="sm" variant="outline" onClick={() => connect.mutate()} disabled={connect.isPending} data-testid="button-connect-bank">
                    {connect.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                    {bank.connected ? "Finish setting up" : "Connect a bank account"}
                  </Button>
                )}
                {bank.available && bank.connected && (
                  <Button size="sm" variant="outline" onClick={() => dashboard.mutate()} disabled={dashboard.isPending} data-testid="button-stripe-dashboard">
                    {dashboard.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5 mr-1.5" />}
                    Open Stripe
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">Where it came from</h2>
        {data.lines.length === 0 ? (
          <Card data-testid="earnings-empty">
            <CardContent className="p-5 text-sm text-muted-foreground">
              Nothing yet. Money turns up here when somebody backs one of your projects, or when
              you win a company's challenge. Prizes land in your balance the moment you win them.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2" data-testid="earnings-lines">
            {data.lines.map((line) => (
              <Card key={`${line.kind}-${line.id}`} data-testid={`earning-${line.id}`}>
                <CardContent className="p-4 flex items-start gap-3">
                  {line.kind === "prize"
                    ? <Trophy className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    : <HeartHandshake className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{line.what}</span>
                      <StateBadge state={line.state} />
                    </div>
                    {line.note && <p className="text-sm text-muted-foreground mt-0.5">{line.note}</p>}
                  </div>
                  <span className="font-semibold tabular-nums shrink-0">{formatMoney(line.amountCents)}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Figure({ label, cents, note, testId }: { label: string; cents: number; note: string; testId: string }) {
  return (
    <Card data-testid={`figure-${testId}`}>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold tabular-nums mt-0.5" data-testid={`text-${testId}`}>{formatMoney(cents)}</p>
        <p className="text-xs text-muted-foreground mt-1">{note}</p>
      </CardContent>
    </Card>
  );
}

function DestinationChoice(props: {
  icon: React.ReactNode; title: string; body: string;
  chosen: boolean; disabled: boolean; onPick: () => void; testId: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onPick}
      disabled={props.disabled || props.chosen}
      data-testid={props.testId}
      aria-pressed={props.chosen}
      className={cn(
        "text-left rounded-lg border p-3 transition-colors",
        props.chosen ? "border-primary bg-primary/5" : "hover:bg-accent",
        props.disabled && !props.chosen && "opacity-50 cursor-not-allowed",
      )}
    >
      <div className="flex items-center gap-2">
        {props.icon}
        <span className="font-medium text-sm">{props.title}</span>
        {props.chosen && <Check className="h-3.5 w-3.5 text-primary ml-auto" />}
      </div>
      <p className="text-xs text-muted-foreground mt-1.5">{props.body}</p>
    </button>
  );
}

function StateBadge({ state }: { state: EarningState }) {
  if (state === "balance") return <Badge variant="default" className="text-xs">In your balance</Badge>;
  if (state === "bank") return <Badge variant="secondary" className="text-xs">Sent to bank</Badge>;
  return <Badge variant="outline" className="text-xs">Held</Badge>;
}
