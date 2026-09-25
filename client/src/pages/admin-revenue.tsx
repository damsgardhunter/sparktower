import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { formatMoney } from "@shared/plans";

/**
 * What SparkTower has actually collected, and how much of it is really ours.
 *
 * The page is built around one identity, stated on it in plain words:
 *
 *     ours = collected − sent out − owed
 *
 * Every pound a card was charged is in exactly one of four places — escrow, a
 * creator's bank, somebody's spendable balance, or ours — so the last one is a
 * subtraction rather than a guess. `server/platform-revenue.ts` explains why
 * that holds and which movements are deliberately *not* counted.
 *
 * The liabilities are shown as prominently as the takings on purpose. Held
 * pledges are refundable to the backer and user balances are credit people can
 * spend tomorrow; an owner who reads only the top line and plans around it is
 * planning around other people's money.
 */

interface PlatformRevenue {
  collected: { topUpsCents: number; pledgesCents: number; totalCents: number };
  sentOutCents: number;
  owed: { escrowCents: number; balancesCents: number; totalCents: number };
  oursCents: number;
  peopleWithBalance: number;
}

export default function AdminRevenue() {
  const { data, isLoading, error } = useQuery<PlatformRevenue>({
    queryKey: ["/api/admin/revenue"],
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });

  /* The API answers 404 to anyone who shouldn't know this exists; so does the page. */
  if (error) {
    return <div className="max-w-2xl mx-auto px-4 py-24 text-center text-muted-foreground" data-testid="revenue-denied">Not found</div>;
  }
  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-24" data-testid="revenue-loading">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6" data-testid="page-admin-revenue">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Revenue</h1>
        <p className="text-muted-foreground mt-1">
          What SparkTower has collected, what it owes, and what's left.
        </p>
      </div>

      <Card data-testid="card-ours">
        <CardContent className="p-5">
          <p className="text-xs font-medium text-muted-foreground">SparkTower's, after everything owed</p>
          <p className="text-4xl font-bold tabular-nums mt-1" data-testid="text-ours">{formatMoney(data.oursCents)}</p>
          <p className="text-sm text-muted-foreground mt-2">
            Cash position, not profit. Stripe's processing fees and what the model calls cost
            aren't taken off this.
          </p>
        </CardContent>
      </Card>

      <Section title="Collected" total={data.collected.totalCents} testId="collected"
        blurb="Money a card was actually charged for. Posting a challenge and buying action packs come out of a balance that was already topped up, so they aren't counted again here.">
        <Row label="Nova top-ups" cents={data.collected.topUpsCents} testId="topups" />
        <Row label="Backing pledges" cents={data.collected.pledgesCents} testId="pledges" />
      </Section>

      <Section title="Already sent out" total={data.sentOutCents} testId="sentout"
        blurb="Released to creators' banks through Stripe, after our fee. This money has left." />

      <Section title="Owed to other people" total={data.owed.totalCents} testId="owed"
        blurb="Collected, but other people can still claim or spend it. Not yours to plan around.">
        <Row label="Pledges in escrow, still refundable" cents={data.owed.escrowCents} testId="escrow" />
        <Row label={`Balances held by ${data.peopleWithBalance} ${data.peopleWithBalance === 1 ? "person" : "people"}`}
          cents={data.owed.balancesCents} testId="balances" />
      </Section>

      <p className="text-sm text-muted-foreground" data-testid="revenue-payout-note">
        Paying SparkTower's own money out to your bank is set up in your Stripe dashboard, under
        payouts — it isn't something this page does. What's here is the platform's position, so
        you can see how much of the Stripe balance is genuinely yours to take.
      </p>
    </div>
  );
}

function Section(props: {
  title: string; total: number; blurb: string; testId: string; children?: React.ReactNode;
}) {
  return (
    <Card data-testid={`card-${props.testId}`}>
      <CardContent className="p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-medium">{props.title}</h2>
          <span className="text-xl font-semibold tabular-nums" data-testid={`text-${props.testId}`}>
            {formatMoney(props.total)}
          </span>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{props.blurb}</p>
        {props.children && <div className="mt-3 space-y-1.5 border-t pt-3">{props.children}</div>}
      </CardContent>
    </Card>
  );
}

function Row({ label, cents, testId }: { label: string; cents: number; testId: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums" data-testid={`text-${testId}`}>{formatMoney(cents)}</span>
    </div>
  );
}
