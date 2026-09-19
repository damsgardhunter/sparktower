/**
 * What this year will do to the company — live, as the table decides it.
 *
 * The desk could show how many customers might want the company and how much
 * the table had committed to spend, but never what those added up to: what
 * the year earns, what it costs, what it leaves in the bank. Every seat decided
 * its piece blind to the whole and found out overnight.
 *
 * This runs the year (see `@shared/simulation/projection`) with everything the
 * table has filed plus the draft on this seat's screen, and redraws as either
 * changes: a teammate filing, or a hand on a slider here. Each headline number
 * carries what *your* unfiled change is doing to it, because that is the
 * question a seat is actually asking while it edits.
 *
 * Built from a validated data-viz palette (see `.viz-root` in `index.css`):
 * cash in and out is polarity, so it is a blue/orange pair rather than the
 * reserved good/bad greens and reds; status colours appear only where they
 * mean a state, and always beside an icon and a word.
 */
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Table2, BarChart3, ShieldAlert } from "lucide-react";

interface Projection {
  year: number;
  customers: number;
  turnedAway: number;
  capacityNow: number;
  capacityNext: number;
  revenue: number;
  profit: number;
  cashStart: number;
  cashEnd: number;
  lines: { label: string; amount: number }[];
  stats: {
    brand: { now: number; coming: number };
    quality: { now: number; coming: number };
    service: { now: number };
    reputation: { now: number };
  };
  credit: { score: number; grade: string; rate: number; emergencyDrawn: number };
  target: { amount: number; projected: number; met: boolean; strikes: number; wouldRemove: boolean } | null;
  bankrupt: boolean;
  nextYearDemand: { likely: number; low: number; high: number } | null;
}

export interface ProjectionResponse {
  year: number;
  yourRole: string | null;
  filed: Projection;
  drafted: Projection;
  absent: string[];
}

const TITLES: Record<string, string> = {
  ceo: "chief executive", cmo: "marketing", cfo: "finance", cto: "technology", coo: "operations",
};

/** Money the way a person reads it at a glance. */
export function gbp(n: number): string {
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 1_000_000_000) return `${sign}£${(a / 1_000_000_000).toFixed(1)}bn`;
  if (a >= 1_000_000) return `${sign}£${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}m`;
  if (a >= 1_000) return `${sign}£${Math.round(a / 1_000)}k`;
  return `${sign}£${Math.round(a)}`;
}
const count = (n: number) => Math.round(n).toLocaleString();

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ─── Stat tile ────────────────────────────────────────────────────────────────

/**
 * One headline number, and what the draft on this screen does to it.
 *
 * The delta says direction with an arrow as well as a colour, and colour
 * follows whether the move is good — more profit is good, but it is the arrow
 * and the sign that carry it, never the colour alone.
 */
function StatTile({ label, value, delta, sub, testId }: {
  label: string; value: number; delta: number; sub: string; testId: string;
}) {
  const moved = Math.abs(delta) >= 1;
  const up = delta > 0;
  return (
    <div className="rounded-xl border bg-card p-4" data-testid={testId}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tracking-tight", value < 0 && "text-[var(--viz-bad)]")}>
        {gbp(value)}
      </p>
      <div className="mt-1 flex min-h-[1.25rem] items-center gap-1.5 text-xs">
        {moved ? (
          <span
            className={cn("inline-flex items-center gap-0.5 font-medium", up ? "text-[var(--viz-good)]" : "text-[var(--viz-bad)]")}
            data-testid={`${testId}-delta`}
          >
            {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            {up ? "+" : ""}{gbp(delta)}
            <span className="font-normal text-muted-foreground">from your change</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{sub}</span>
        )}
      </div>
    </div>
  );
}

// ─── The cash bridge ─────────────────────────────────────────────────────────

/**
 * Where the money goes, from the balance the year starts with to the one it
 * ends with.
 *
 * A waterfall: every movement floats from where the running total stood, in
 * blue if it brings money in and orange if it takes it out, between two grey
 * totals. Few enough bars that each carries its value at the tip; a table
 * view carries the same numbers for anyone who would rather read them.
 */
function CashBridge({ p }: { p: Projection }) {
  const [asTable, setAsTable] = useState(false);

  const bars = useMemo(() => {
    let running = p.cashStart;
    const out: { label: string; from: number; to: number; kind: "total" | "in" | "out"; amount: number }[] = [
      { label: "Start of year", from: 0, to: p.cashStart, kind: "total", amount: p.cashStart },
    ];
    for (const line of p.lines) {
      const next = running + line.amount;
      out.push({ label: line.label, from: running, to: next, kind: line.amount >= 0 ? "in" : "out", amount: line.amount });
      running = next;
    }
    out.push({ label: "End of year", from: 0, to: p.cashEnd, kind: "total", amount: p.cashEnd });
    return out;
  }, [p]);

  const lo = Math.min(0, ...bars.flatMap((b) => [b.from, b.to]));
  const hi = Math.max(1, ...bars.flatMap((b) => [b.from, b.to]));
  const span = hi - lo || 1;
  const pct = (n: number) => ((n - lo) / span) * 100;

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold">Where the money goes</h4>
          <p className="text-xs text-muted-foreground">From the balance you start with to the one you end with.</p>
        </div>
        <button
          type="button"
          onClick={() => setAsTable(!asTable)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          aria-pressed={asTable}
          data-testid="toggle-bridge-table"
        >
          {asTable ? <BarChart3 className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />}
          {asTable ? "Chart" : "Table"}
        </button>
      </div>

      {asTable ? (
        <table className="mt-3 w-full text-sm">
          <tbody>
            {bars.map((b) => (
              <tr key={b.label} className="border-t border-border/60">
                <td className="py-1.5 text-muted-foreground">{b.label}</td>
                <td className="py-1.5 text-right font-medium tabular-nums">
                  {b.kind === "total" ? gbp(b.amount) : `${b.amount >= 0 ? "+" : ""}${gbp(b.amount)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="mt-4 space-y-2" data-testid="cash-bridge">
          {bars.map((b) => {
            const left = pct(Math.min(b.from, b.to));
            const width = Math.max(0.6, pct(Math.max(b.from, b.to)) - left);
            const colour = b.kind === "total" ? "bg-[var(--viz-total)]" : b.kind === "in" ? "bg-[var(--viz-in)]" : "bg-[var(--viz-out)]";
            return (
              /*
               * Label above the bar on a phone, beside it on anything wider —
               * a fixed label column on a 400px screen left the bars slivers.
               */
              <div key={b.label} className="grid grid-cols-1 items-center gap-x-3 gap-y-0.5 sm:grid-cols-[minmax(7rem,11rem)_1fr]" title={`${b.label}: ${gbp(b.amount)}`}>
                <span className="truncate text-xs text-muted-foreground">{b.label}</span>
                <div className="relative h-5">
                  {/* The zero line, so a negative balance reads as negative. */}
                  {lo < 0 && <div className="absolute inset-y-0 w-px bg-[var(--viz-grid)]" style={{ left: `${pct(0)}%` }} />}
                  <div
                    className={cn("absolute top-1/2 h-3 -translate-y-1/2 rounded-[4px] transition-all duration-300", colour)}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                  {/*
                    * The value goes on whichever side of the bar has room, and
                    * never on top of it: after the bar's end when it stops
                    * short of the edge, before its start when it runs to it.
                    */}
                  <span
                    className={cn(
                      "absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] font-medium tabular-nums text-foreground",
                      left + width > 72 ? "-translate-x-full pr-1.5" : "pl-1.5",
                    )}
                    style={{ left: `${left + width > 72 ? left : left + width}%` }}
                  >
                    {b.kind === "total" ? gbp(b.amount) : `${b.amount >= 0 ? "+" : ""}${gbp(b.amount)}`}
                  </span>
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--viz-in)]" />Money in</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--viz-out)]" />Money out</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--viz-total)]" />Balance</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Customers and capacity ──────────────────────────────────────────────────

/**
 * Who you serve this year against the room you already have — and, since
 * capacity ordered now opens next year, next year's room against next year's
 * demand. The second line is the one the operations seat should be looking at.
 */
function Capacity({ p }: { p: Projection }) {
  const wanted = p.customers + p.turnedAway;
  const scale = Math.max(1, p.capacityNow, wanted);
  const nextDemand = p.nextYearDemand;
  const nextScale = Math.max(1, p.capacityNext, nextDemand?.high ?? 0);
  const short = nextDemand ? p.capacityNext < nextDemand.low : false;
  const idle = nextDemand ? p.capacityNext > nextDemand.high * 1.3 : false;

  return (
    <div className="rounded-xl border bg-card p-4">
      <h4 className="text-sm font-semibold">Customers and room</h4>

      <p className="mt-3 text-xs text-muted-foreground">This year — with the room you already have</p>
      <div className="mt-1.5 flex h-4 w-full gap-[2px] overflow-hidden rounded-[4px] bg-[var(--viz-track)]" data-testid="capacity-now">
        <div className="h-full rounded-l-[4px] bg-[var(--viz-in)] transition-all duration-300" style={{ width: `${(p.customers / scale) * 100}%` }} />
        {p.turnedAway > 0 && (
          <div className="h-full bg-[var(--viz-out)] transition-all duration-300" style={{ width: `${(p.turnedAway / scale) * 100}%` }} />
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--viz-in)]" />{count(p.customers)} served</span>
        {p.turnedAway > 0 && (
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--viz-out)]" />{count(p.turnedAway)} turned away</span>
        )}
        <span className="text-muted-foreground">of {count(p.capacityNow)} room</span>
      </div>

      {nextDemand && (
        <>
          <p className="mt-4 text-xs text-muted-foreground">Next year — what you are building now, against likely demand</p>
          <div className="relative mt-1.5 h-4 w-full rounded-[4px] bg-[var(--viz-track)]" data-testid="capacity-next">
            {/* The demand range, as a band; the room being built, as a bar. */}
            <div
              className="absolute inset-y-0 rounded-[4px] bg-[var(--viz-coming)]"
              style={{ left: `${(nextDemand.low / nextScale) * 100}%`, width: `${((nextDemand.high - nextDemand.low) / nextScale) * 100}%` }}
              title={`Likely demand: ${count(nextDemand.low)}–${count(nextDemand.high)}`}
            />
            <div
              className="absolute inset-y-0 w-[3px] rounded-full bg-foreground"
              style={{ left: `calc(${Math.min(100, (p.capacityNext / nextScale) * 100)}% - 1.5px)` }}
              title={`Room next year: ${count(p.capacityNext)}`}
            />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--viz-coming)]" />Likely demand {count(nextDemand.low)}–{count(nextDemand.high)}</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-[3px] rounded-full bg-foreground" />Room {count(p.capacityNext)}</span>
            {short && (
              <span className="inline-flex items-center gap-1 font-medium text-[var(--viz-bad)]">
                <AlertTriangle className="h-3.5 w-3.5" /> Short — people will be turned away
              </span>
            )}
            {idle && (
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                <AlertTriangle className="h-3.5 w-3.5 text-[var(--viz-status-warning)]" /> More room than demand — idle room costs money
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Standing ────────────────────────────────────────────────────────────────

/**
 * Brand, quality, service, reputation — this year, and what is already on its
 * way. Brand lands over two years and quality a year after it is built, so the
 * paler extension is the part of this year's work that customers will not see
 * until next year. It is the lag made visible.
 */
function Meter({ label, now, coming }: { label: string; now: number; coming?: number }) {
  const n = Math.max(0, Math.min(100, now));
  const c = Math.max(0, Math.min(100 - n, coming ?? 0));
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">
          {Math.round(n)}
          {c >= 0.5 && <span className="text-muted-foreground"> +{c.toFixed(1)} next year</span>}
        </span>
      </div>
      <div className="mt-1 flex h-2 w-full gap-[2px] overflow-hidden rounded-[4px] bg-[var(--viz-track)]">
        <div className="h-full rounded-l-[4px] bg-[var(--viz-now)] transition-all duration-300" style={{ width: `${n}%` }} />
        {c >= 0.5 && <div className="h-full bg-[var(--viz-coming)] transition-all duration-300" style={{ width: `${c}%` }} />}
      </div>
    </div>
  );
}

function Standing({ p }: { p: Projection }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <h4 className="text-sm font-semibold">Where the company stands</h4>
      <div className="mt-3 space-y-3">
        <Meter label="Brand" now={p.stats.brand.now} coming={p.stats.brand.coming} />
        <Meter label="Quality" now={p.stats.quality.now} coming={p.stats.quality.coming} />
        <Meter label="Service" now={p.stats.service.now} />
        <Meter label="Reputation" now={p.stats.reputation.now} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--viz-now)]" />This year</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--viz-coming)]" />Arriving next year</span>
      </div>
    </div>
  );
}

// ─── Credit and the board ────────────────────────────────────────────────────

const GRADE_STATUS: Record<string, { tone: string; word: string }> = {
  AAA: { tone: "var(--viz-status-good)", word: "Excellent" },
  AA: { tone: "var(--viz-status-good)", word: "Strong" },
  A: { tone: "var(--viz-status-good)", word: "Good" },
  BBB: { tone: "var(--viz-status-warning)", word: "Adequate" },
  BB: { tone: "var(--viz-status-warning)", word: "Speculative" },
  B: { tone: "var(--viz-status-serious)", word: "Weak" },
  CCC: { tone: "var(--viz-status-serious)", word: "Poor" },
  D: { tone: "var(--viz-status-critical)", word: "Distressed" },
};

function Money({ p }: { p: Projection }) {
  const status = GRADE_STATUS[p.credit.grade] ?? GRADE_STATUS.BB;
  const t = p.target;
  const progress = t ? Math.min(100, (t.projected / Math.max(1, t.amount)) * 100) : 0;

  return (
    <div className="rounded-xl border bg-card p-4">
      <h4 className="text-sm font-semibold">Credit and investors</h4>

      <div className="mt-3 flex items-center gap-3">
        {/* The grade, with its word beside it — never the colour alone. */}
        <span
          className="inline-flex h-11 min-w-[3.25rem] items-center justify-center rounded-lg border-2 px-2 text-lg font-bold"
          style={{ borderColor: status.tone }}
          data-testid="credit-grade"
        >
          {p.credit.grade}
        </span>
        <div className="text-sm">
          <p className="font-medium">{status.word}</p>
          <p className="text-xs text-muted-foreground">
            Borrowing costs {(p.credit.rate * 100).toFixed(1)}% a year at this rating
          </p>
        </div>
      </div>

      {p.credit.emergencyDrawn > 0 && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-muted/60 p-2.5 text-xs">
          <ShieldAlert className="mt-px h-4 w-4 shrink-0 text-[var(--viz-status-critical)]" />
          <span>
            This plan runs out of cash. An emergency loan of <span className="font-semibold">{gbp(p.credit.emergencyDrawn)}</span> would
            cover it — at a punitive rate, with a hit to reputation and the rating.
          </span>
        </p>
      )}

      {t && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">Investors' revenue target this year</span>
            <span className="font-medium tabular-nums">{gbp(t.projected)} / {gbp(t.amount)}</span>
          </div>
          {/* A neutral track: this fill is a status, not a step of the blue ramp. */}
          <div className="mt-1 h-2 w-full overflow-hidden rounded-[4px] bg-[var(--viz-grid)]" data-testid="target-meter">
            <div
              className="h-full rounded-[4px] transition-all duration-300"
              style={{ width: `${progress}%`, background: t.met ? "var(--viz-status-good)" : "var(--viz-status-serious)" }}
            />
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs">
            {t.met ? (
              <><CheckCircle2 className="h-3.5 w-3.5 text-[var(--viz-status-good)]" /> On course to meet it.</>
            ) : t.wouldRemove ? (
              <><AlertTriangle className="h-3.5 w-3.5 text-[var(--viz-status-critical)]" /><span className="font-medium">A second miss — the board would remove the chief executive.</span></>
            ) : (
              <><AlertTriangle className="h-3.5 w-3.5 text-[var(--viz-status-warning)]" /> On course to miss it. {t.strikes > 0 ? "" : "One miss is a warning; two remove the chief executive."}</>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── The panel ────────────────────────────────────────────────────────────────

/**
 * The projection for this seat's draft, fetched once however many places show
 * it. The panel and the desk's pinned dock (projection-dock.tsx) both call
 * this with the same arguments, so they share one query key and one request.
 */
export function useProjection(ventureId: string, draft: Record<string, any> | null, filedStamp: string) {
  const debounced = useDebounced(draft, 450);
  const draftKey = debounced ? JSON.stringify(debounced) : "";
  return useQuery<ProjectionResponse>({
    queryKey: ["sim-projection", ventureId, draftKey, filedStamp],
    queryFn: async () => {
      const url = `/api/sim/ventures/${ventureId}/projection${draftKey ? `?draft=${encodeURIComponent(draftKey)}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    // Hold the last answer while the next one is worked out — no flash.
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
}

export function ProjectionPanel({ ventureId, draft, filedStamp }: {
  ventureId: string;
  /** This seat's unfiled draft, or null. */
  draft: Record<string, any> | null;
  /** Changes whenever a teammate files, so the projection re-runs exactly then. */
  filedStamp: string;
}) {
  const { data, isFetching, isError } = useProjection(ventureId, draft, filedStamp);

  if (!data) {
    if (isError) return null;
    return <div className="viz-root h-40 animate-pulse rounded-2xl border bg-muted/30" />;
  }

  const p = data.drafted;
  const f = data.filed;

  return (
    <section
      className={cn("viz-root space-y-3 rounded-2xl border bg-muted/20 p-4 transition-opacity", isFetching && "opacity-70")}
      data-testid="projection-panel"
      aria-busy={isFetching}
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Year {data.year}, as it stands</h3>
          <p className="text-xs text-muted-foreground">
            Everything the table has filed{draft ? ", plus your changes" : ""} — run through the year, if the rest of the market holds still.
          </p>
        </div>
        {data.absent.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Not filed yet: {data.absent.map((r) => TITLES[r] ?? r).join(", ")} — running on last year's plan.
          </p>
        )}
      </div>

      {p.bankrupt && (
        <p className="flex items-center gap-1.5 rounded-lg border border-[var(--viz-status-critical)] p-2.5 text-sm font-medium">
          <ShieldAlert className="h-4 w-4 text-[var(--viz-status-critical)]" />
          This plan runs out of money and credit. The company would be bankrupt at the end of the year.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile testId="proj-revenue" label="Revenue" value={p.revenue} delta={p.revenue - f.revenue}
          sub={`${count(p.customers)} customers`} />
        <StatTile testId="proj-profit" label="Profit after tax" value={p.profit} delta={p.profit - f.profit}
          sub={p.profit >= 0 ? "in the black" : "a loss this year"} />
        <StatTile testId="proj-cash" label="Cash at year end" value={p.cashEnd} delta={p.cashEnd - f.cashEnd}
          sub={`from ${gbp(p.cashStart)}`} />
      </div>

      {/*
        * Two columns of two, so neither side is a tall card beside a short one
        * with a hole under it: the money and where the company stands on the
        * left, its room and its credit on the right.
        */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          <CashBridge p={p} />
          <Standing p={p} />
        </div>
        <div className="space-y-3">
          <Capacity p={p} />
          <Money p={p} />
        </div>
      </div>
    </section>
  );
}
