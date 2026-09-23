/**
 * The year-end report: what happened, line by line, and why.
 *
 * ## Why this is the most important screen in the simulation
 *
 * A decision you cannot trace to an outcome is a decision you cannot learn
 * from, and the whole promise of a fortnight-long season is fourteen chances
 * to learn. Until this existed a year came back as four figures and a handful
 * of sentences: you lost two million, and nothing said which of the five of you
 * lost it; you had fewer customers, and nothing said who took them or why.
 *
 * So it is laid out in the order a team argues about a bad year:
 *
 *   1. **The result**, in one line, so nobody has to hunt for it.
 *   2. **The accounts** — every cost with its owner's name on it, which is
 *      what turns "we lost money" into "marketing spent 2.1m to win 900k".
 *   3. **The cash** — started with this, ended with that, and every step
 *      between, including the ones that were not trading.
 *   4. **The customers**, segment by segment: who you won them from, who took
 *      them from you, and the reason for the biggest loss in one sentence.
 *   5. **Everybody else** — what each rival visibly did, which is half of why
 *      your year went the way it did.
 *
 * Every total on this screen is the sum of the lines above it, checked in
 * test/unit/forecast.test.ts. A report that does not add up is the one people
 * stop reading.
 */
import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CompanyReport } from "@shared/simulation/resolve";
import { lookOf } from "@/components/sim/market-look";
import {
  Loader2, TrendingUp, TrendingDown, Minus, ArrowRight, Users, Banknote, Receipt, Swords, AlertTriangle,
} from "lucide-react";
import { SimHeader } from "@/components/sim/sim-header";

interface ReportPayload {
  years: number[];
  year?: number;
  totalYears?: number;
  companyName?: string | null;
  niche: { id: string; name: string; voice: Record<string, string> };
  report: CompanyReport | null;
}

const money = (n: number, signed = false) => {
  const sign = n < 0 ? "−" : signed && n > 0 ? "+" : "";
  const a = Math.abs(n);
  const body = a >= 1_000_000 ? `£${(a / 1_000_000).toFixed(2)}m` : a >= 10_000 ? `£${Math.round(a / 1_000)}k` : `£${Math.round(a).toLocaleString()}`;
  return `${sign}${body}`;
};
const count = (n: number) => Math.round(n).toLocaleString();
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default function SimulationReportPage() {
  const { id, year } = useParams<{ id: string; year?: string }>();
  const [, navigate] = useLocation();
  const { data, isLoading, isError } = useQuery<ReportPayload>({
    queryKey: [`/api/sim/ventures/${id}/reports${year ? `/${year}` : ""}`],
  });

  if (isLoading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  if (isError || !data) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <Card className="rounded-2xl nova-ring-soft"><CardContent className="p-6 text-sm text-muted-foreground">This report could not be loaded.</CardContent></Card>
      </div>
    );
  }

  const r = data.report;
  const v = data.niche.voice;
  const look = lookOf(data.niche.id);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-4">
      <SimHeader
        icon={look.Icon}
        title={<>{r ? `Year ${r.year}` : "No years yet"}{data.companyName ? ` · ${data.companyName}` : ""}</>}
        titleTestId="text-report-title"
        subtitle={<>{data.niche.name}{data.totalYears ? ` · of ${data.totalYears}` : ""}</>}
        onBack={() => navigate(`/simulation/${id}`)}
        backLabel="Back to the desk"
        backTestId="button-back"
      >

        {/* Every year of the season, so the story can be read back. */}
        {data.years.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mt-4" data-testid="year-picker">
            {data.years.map((y) => (
              <Button
                key={y}
                size="sm"
                variant={y === r?.year ? "default" : "outline"}
                className="h-7 px-2.5 text-xs"
                onClick={() => navigate(`/simulation/${id}/report/${y}`)}
                data-testid={`button-year-${y}`}
              >
                {y}
              </Button>
            ))}
          </div>
        )}
      </SimHeader>

      {!r ? (
        <Card className="rounded-2xl nova-ring-soft"><CardContent className="p-6 text-sm text-muted-foreground">
          The first year has not resolved yet. Its report appears here the morning after.
        </CardContent></Card>
      ) : !r.pnl ? (
        <Card className="rounded-2xl nova-ring-soft"><CardContent className="p-6 text-sm text-muted-foreground">
          This year resolved before the full report existed, so only the summary survives: {money(r.revenue)} of sales, {money(r.profit)} of profit, {count(r.customers)} {v.customers}.
        </CardContent></Card>
      ) : (
        <>
          <Headline r={r} voice={v} />
          <Accounts r={r} />
          <CashBridgeCard r={r} />
          <Customers r={r} voice={v} />
          <Rivals r={r} voice={v} />
          {r.notes.length > 0 && (
            <Card className="rounded-2xl nova-ring-soft">
              <CardContent className="p-5 space-y-2">
                <h2 className="text-sm font-semibold">What else the year said</h2>
                {r.notes.map((n, i) => <p key={i} className="text-sm text-muted-foreground">{n}</p>)}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Headline({ r, voice }: { r: CompanyReport; voice: Record<string, string> }) {
  const up = r.shareChange > 0.0005;
  const down = r.shareChange < -0.0005;
  return (
    <Card className="rounded-2xl nova-ring nova-glow" data-testid="card-headline">
      <CardContent className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Big label="Profit after tax" value={money(r.profit)} tone={r.profit < 0 ? "bad" : "good"} testId="text-profit" />
        <Big label="Sales" value={money(r.revenue)} />
        <Big
          label={voice.customers.charAt(0).toUpperCase() + voice.customers.slice(1)}
          value={count(r.customers)}
          sub={<span className={up ? "text-primary" : down ? "text-destructive" : ""}>
            {pct(r.marketShare)} share, {up ? "up" : down ? "down" : "flat"}{up || down ? ` ${(Math.abs(r.shareChange) * 100).toFixed(1)}` : ""}
          </span>}
        />
        <Big label="Place" value={`#${r.rank}`} sub={`by what the owners hold, ${money(r.founderValue)}`} />
      </CardContent>
    </Card>
  );
}

function Big({ label, value, sub, tone, testId }: { label: string; value: string; sub?: React.ReactNode; tone?: "good" | "bad"; testId?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${tone === "bad" ? "text-destructive" : ""}`} data-testid={testId}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

/**
 * The accounts, each line with its owner.
 *
 * The seat that spent it is named beside each cost, because the argument the
 * morning after a bad year is not "costs were high", it is whose were. A bar
 * against revenue makes the proportions visible without anyone doing
 * division: a marketing line longer than the sales line is a sentence nobody
 * needs to finish.
 */
function Accounts({ r }: { r: CompanyReport }) {
  const p = r.pnl!;
  const lines: { label: string; seat: string; amount: number; help?: string }[] = [
    { label: "Cost to serve", seat: "operations", amount: p.costToServe, help: "Making and delivering what was sold." },
    { label: "Salaries", seat: "the table", amount: p.salaries, help: "Five seats, the staff, and more of both the wider you sell." },
    { label: "Marketing", seat: "marketing", amount: p.marketing },
    { label: "Product", seat: "technology", amount: p.product, help: "Features, reliability, research and paying down debt." },
    { label: "Support and efficiency", seat: "operations", amount: p.operations, help: "Support, efficiency, recruiting, training, and the plant: automating it, a second shift, stock held ahead." },
    { label: "Capacity", seat: "operations", amount: p.capacity ?? 0, help: "Room built and room leased this year." },
    { label: "Idle capacity", seat: "operations", amount: p.idleCapacity, help: "Room that was paid for and never used." },
    { label: "Incidents", seat: "the table", amount: p.incidents ?? 0, help: "What last year's breach, lawsuit or recall cost to clean up, after any insurer paid." },
    { label: "Partner share", seat: "the table", amount: p.partners ?? 0, help: "The cut of revenue owed on a distribution deal the table signed." },
    { label: "Insurance", seat: "finance", amount: p.insurance ?? 0, help: "The premium on whatever the company chose to cover." },
    { label: "Interest", seat: "finance", amount: p.interest },
  ];
  const scale = Math.max(p.revenue, ...lines.map((l) => l.amount), 1);
  return (
    <Card className="rounded-2xl nova-ring-soft" data-testid="card-accounts">
      <CardContent className="p-5 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-1.5"><Receipt className="h-4 w-4 text-muted-foreground" /> The accounts</h2>
        <Row label="Sales" amount={p.revenue} scale={scale} positive strong />
        {lines.map((l) => (
          <Row key={l.label} label={l.label} note={l.seat} help={l.help} amount={-l.amount} scale={scale} testId={`row-pnl-${l.label.toLowerCase().replace(/[^a-z]+/g, "-")}`} />
        ))}
        {/*
          * Planning is the odd one out: it is not a cost but the effect of the
          * marketing seat's forecast, which saves money when it was close and
          * costs it when it was wide. On its own row with its own sign, so the
          * column above can be read as costs and still add up to the profit.
          */}
        {(p.planning ?? 0) !== 0 && (
          <Row
            label="Planning"
            note="marketing"
            help={(p.planning ?? 0) > 0
              ? "The forecast was close enough to buy at the right volumes."
              : "The forecast was wide, and the year was bought at the wrong volumes."}
            amount={p.planning ?? 0}
            scale={scale}
            positive={(p.planning ?? 0) > 0}
            testId="row-pnl-planning"
          />
        )}
        <div className="border-t border-border pt-2">
          <Row label="Profit before tax" amount={p.operatingProfit} scale={scale} strong />
        </div>
        <Row
          label="Tax"
          note="at 20%"
          help={p.tax === 0 && p.operatingProfit > 0 ? "None this year: earlier losses were set against it." : undefined}
          amount={-p.tax}
          scale={scale}
        />
        <div className="border-t border-border pt-2">
          <Row label="Profit" amount={p.profit} scale={scale} strong testId="row-pnl-profit" />
        </div>
        {p.lossesCarried > 0 && (
          <p className="text-xs text-muted-foreground">
            {money(p.lossesCarried)} of losses carried forward: the next {money(p.lossesCarried)} of profit is tax-free.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, note, help, amount, scale, positive, strong, testId }: {
  label: string; note?: string; help?: string; amount: number; scale: number; positive?: boolean; strong?: boolean; testId?: string;
}) {
  const width = Math.min(100, (Math.abs(amount) / scale) * 100);
  return (
    <div data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className={strong ? "font-semibold" : ""}>
          {label}
          {note && <span className="text-xs text-muted-foreground ml-1.5">{note}</span>}
        </span>
        <span className={`tabular-nums shrink-0 ${strong ? "font-semibold" : ""} ${amount < 0 && strong ? "text-destructive" : ""}`}>
          {money(amount, positive)}
        </span>
      </div>
      {!strong && amount !== 0 && (
        <div className="h-1.5 mt-1 rounded-full bg-muted overflow-hidden">
          <div className={`h-full rounded-full ${amount >= 0 ? "bg-primary" : "bg-destructive/60"}`} style={{ width: `${width}%` }} />
        </div>
      )}
      {help && <p className="text-[11px] text-muted-foreground mt-0.5">{help}</p>}
    </div>
  );
}

/** Started with, ended with, and every step between — the trading ones and the others. */
function CashBridgeCard({ r }: { r: CompanyReport }) {
  const b = r.cashBridge!;
  let running = b.opening;
  return (
    <Card className="rounded-2xl nova-ring-soft" data-testid="card-cash">
      <CardContent className="p-5 space-y-2">
        <h2 className="text-sm font-semibold flex items-center gap-1.5"><Banknote className="h-4 w-4 text-muted-foreground" /> The cash</h2>
        <p className="text-sm text-muted-foreground" data-testid="text-cash-summary">
          Started the year with {money(b.opening)} and ended it with {money(b.closing)}
          {b.closing >= b.opening ? `, ${money(b.closing - b.opening)} better off.` : `, ${money(b.opening - b.closing)} down.`}
        </p>
        <div className="space-y-1.5 pt-1">
          {b.lines.map((l, i) => {
            running += l.amount;
            return (
              <div key={i} className="flex items-baseline justify-between gap-3 text-sm" data-testid={`row-cash-${i}`}>
                <span className="text-muted-foreground">{l.label}</span>
                <span className="flex items-baseline gap-3 shrink-0 tabular-nums">
                  <span className={l.amount < 0 ? "text-destructive" : "text-primary"}>{money(l.amount, true)}</span>
                  <span className="text-xs text-muted-foreground w-20 text-right">{money(running)}</span>
                </span>
              </div>
            );
          })}
        </div>
        <div className="border-t border-border pt-2 flex justify-between text-sm font-semibold">
          <span>In the bank</span><span className="tabular-nums">{money(b.closing)}</span>
        </div>
        {r.debt > 0 && <p className="text-xs text-muted-foreground">And {money(r.debt)} owed.</p>}
      </CardContent>
    </Card>
  );
}

/**
 * Every customer accounted for, segment by segment.
 *
 * "Lost 41,000 swipers to Pairwise, who undercut you by £9" is the sentence a
 * year exists to produce, so it leads each segment when there is one. Below it,
 * the movements in the order they happen: who you held, who you won and from
 * whom, who you lost and to whom, who you could not serve and where they went.
 */
function Customers({ r, voice }: { r: CompanyReport; voice: Record<string, string> }) {
  return (
    <Card className="rounded-2xl nova-ring-soft" data-testid="card-customers">
      <CardContent className="p-5 space-y-4">
        <h2 className="text-sm font-semibold flex items-center gap-1.5"><Users className="h-4 w-4 text-muted-foreground" /> Where the {voice.customers} went</h2>
        {r.segments!.map((s) => {
          const moved = s.end - s.start;
          const lost = s.lostTo.reduce((a, f) => a + f.count, 0);
          const won = s.wonFrom.reduce((a, f) => a + f.count, 0);
          return (
            <div key={s.segmentId} className="rounded-lg border border-border p-3.5 space-y-2" data-testid={`segment-${s.segmentId}`}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium text-sm">{s.name}</p>
                <p className="text-sm tabular-nums flex items-center gap-1.5">
                  {count(s.start)} <ArrowRight className="h-3 w-3 text-muted-foreground" /> <span className="font-semibold">{count(s.end)}</span>
                  <span className={`text-xs ${moved > 0 ? "text-primary" : moved < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {moved > 0 ? `+${count(moved)}` : moved < 0 ? `−${count(-moved)}` : "±0"}
                  </span>
                </p>
              </div>
              {s.why && <p className="text-sm" data-testid={`text-why-${s.segmentId}`}>{s.why}</p>}
              <div className="grid gap-1 text-xs text-muted-foreground">
                {s.fresh > 0 && <p>New to the market and chose you: <span className="text-foreground tabular-nums">{count(s.fresh)}</span></p>}
                {won > 0 && <p>Won from {s.wonFrom.map((f) => `${f.name} (${count(f.count)})`).join(", ")}</p>}
                {lost > 0 && <p>Lost to {s.lostTo.map((f) => `${f.name} (${count(f.count)})`).join(", ")}</p>}
                {s.turnedAway > 0 && (
                  <p className="text-amber-600">
                    Turned away: {count(s.turnedAway)}
                    {s.sentTo.length > 0 && ` — ${s.sentTo.map((f) => `${count(f.count)} to ${f.name}`).join(", ")}`}
                  </p>
                )}
                {s.pickedUp > 0 && <p>Picked up from rivals who were full: <span className="text-foreground tabular-nums">{count(s.pickedUp)}</span></p>}
              </div>
              {s.shortOf.length > 0 && (
                <p className="text-xs text-destructive flex gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                  {s.shortOf.map((x) => x.axis === "price"
                    ? `Priced ${money(x.by)} above the ${money(x.expected)} they stop listening at`
                    : `${Math.max(1, Math.round(x.by))} below the ${x.axis} of ${x.expected} they expect`).join("; ")}.
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** What everybody else visibly did — estimated from outside, the way a rival would see it. */
function Rivals({ r, voice }: { r: CompanyReport; voice: Record<string, string> }) {
  const rivals = [...(r.rivals ?? [])].sort((a, b) => b.shareAfter - a.shareAfter);
  return (
    <Card className="rounded-2xl nova-ring-soft" data-testid="card-rivals">
      <CardContent className="p-5 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-1.5"><Swords className="h-4 w-4 text-muted-foreground" /> What {voice.rivals} did</h2>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground text-left">
                <th className="font-medium py-1.5 px-1">Company</th>
                <th className="font-medium py-1.5 px-1 text-right">Price {voice.per}</th>
                <th className="font-medium py-1.5 px-1 text-right">Share</th>
                <th className="font-medium py-1.5 px-1 text-right">Spent, roughly</th>
                <th className="font-medium py-1.5 px-1">Moves</th>
              </tr>
            </thead>
            <tbody>
              {rivals.map((m) => {
                const priceMove = m.priceAfter - m.priceBefore;
                const shareMove = m.shareAfter - m.shareBefore;
                const moves = [
                  m.positioning && `went for ${m.positioning.toLowerCase()}`,
                  m.conceded.length > 0 && `stopped defending ${m.conceded.join(", ").toLowerCase()}`,
                  m.capacityAfter > m.capacityBefore * 1.1 && `built ${voice.capacityShort}`,
                  m.capacityAfter < m.capacityBefore * 0.9 && `cut ${voice.capacityShort}`,
                ].filter(Boolean);
                return (
                  <tr key={m.id} className="border-t border-border align-top" data-testid={`row-rival-${m.id}`}>
                    <td className="py-2 px-1">
                      <span className="font-medium">{m.name}</span>
                      {m.kind === "player" && <Badge variant="outline" className="ml-1.5 text-[10px]">a team</Badge>}
                    </td>
                    <td className="py-2 px-1 text-right tabular-nums">
                      {money(m.priceAfter)}
                      {priceMove !== 0 && (
                        <span className={`block text-[11px] ${priceMove < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                          {priceMove < 0 ? `cut ${money(-priceMove)}` : `up ${money(priceMove)}`}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-1 text-right tabular-nums">
                      {pct(m.shareAfter)}
                      <span className="flex justify-end items-center gap-0.5 text-[11px] text-muted-foreground">
                        {shareMove > 0.0005 ? <TrendingUp className="h-3 w-3 text-primary" /> : shareMove < -0.0005 ? <TrendingDown className="h-3 w-3 text-destructive" /> : <Minus className="h-3 w-3" />}
                        {(Math.abs(shareMove) * 100).toFixed(1)}
                      </span>
                    </td>
                    <td className="py-2 px-1 text-right tabular-nums">{m.spent > 0 ? `~${money(m.spent)}` : "—"}</td>
                    <td className="py-2 px-1 text-xs text-muted-foreground">{moves.length > 0 ? moves.join("; ") : "held course"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Spending is estimated from outside and rounded to the nearest quarter of a million — nobody sees a rival's accounts.
        </p>
      </CardContent>
    </Card>
  );
}
