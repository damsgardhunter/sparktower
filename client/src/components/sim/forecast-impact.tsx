/**
 * What every saved decision is doing to the forecast — and to next year's.
 *
 * Three cards under the projection, each answering a question the panel could
 * not:
 *
 *   - **What each desk did.** The panel showed what *your unsaved* change would
 *     do, and nothing about anything already saved. So the moment a desk was
 *     filed — by a teammate, or by Nova on your behalf — its effect vanished
 *     from the screen, and a chief executive who had Nova plan their year saw
 *     every number exactly where it was. Each saved desk is now measured
 *     against the same year with that desk left on last year's plan, and
 *     every seat at the table sees every desk's line.
 *   - **Next year, on this course.** Half the levers pay later than they
 *     cost: research, recruiting, training, efficiency, a programme. Shown
 *     only this year they read as money thrown away.
 *   - **The team.** Targets, overrules, pay and a bonus pot act on people,
 *     and people were nowhere on the forecast.
 */
import { ArrowDown, ArrowUp, Minus, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMoney } from "@/components/sim/desk-currency";

export interface YearAhead {
  year: number; revenue: number; profit: number; customers: number; cashEnd: number;
  unitCost: number; brand: number; quality: number; service: number; reputation: number;
}
export interface SeatMood { role: string; loyaltyNow: number; loyaltyNext: number; stretch: "easy" | "fair" | "aggressive" }
export interface SeatImpact {
  role: string; revenue: number; profit: number; cashEnd: number; customers: number;
  next: { revenue: number; profit: number; customers: number; unitCost: number; quality: number; brand: number; service: number } | null;
}

const DESK: Record<string, string> = {
  ceo: "Chief executive", cmo: "Marketing", cfo: "Finance", cto: "Technology", coo: "Operations",
};

/** A signed change, with an arrow as well as a colour — never the colour alone. */
function Delta({ value, format, invert = false, testId }: {
  value: number; format: (n: number) => string; invert?: boolean; testId?: string;
}) {
  if (Math.abs(value) < 0.5) {
    return <span className="inline-flex items-center gap-0.5 text-muted-foreground" data-testid={testId}><Minus className="h-3 w-3" />none</span>;
  }
  const good = invert ? value < 0 : value > 0;
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 font-medium tabular-nums", good ? "text-[var(--viz-good)]" : "text-[var(--viz-bad)]")}
      data-testid={testId}
    >
      {value > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {value > 0 ? "+" : ""}{format(value)}
    </span>
  );
}

const people = (n: number) => Math.round(n).toLocaleString();
const points = (n: number) => n.toFixed(1);

/**
 * Each saved desk, taken out in turn.
 *
 * A row per desk that has filed, for every seat to read — the chief executive
 * sees what marketing's plan is worth, and marketing sees what the chief
 * executive's focus did to it. That is the argument this game is for, and it
 * needs the numbers on the table rather than in one person's head.
 */
export function SeatImpactCard({ impact, yourRole, solo }: { impact: SeatImpact[]; yourRole: string | null; solo?: boolean }) {
  const { compact } = useMoney();
  if (!impact.length) return null;
  return (
    <div className="rounded-xl border bg-card p-4" data-testid="card-seat-impact">
      <h4 className="text-sm font-semibold">What each saved desk is doing to the forecast</h4>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Against the same year with that desk left on last year's plan. Updates whenever anyone saves.
      </p>
      <div className="mt-3 space-y-2">
        {impact.map((row) => {
          /* The one thing a later-paying decision moved most, said in words. */
          const later: string[] = [];
          if (row.next) {
            if (Math.abs(row.next.unitCost) >= 0.01) later.push(`unit cost ${row.next.unitCost < 0 ? "down" : "up"} ${compact(Math.abs(row.next.unitCost))}`);
            if (Math.abs(row.next.quality) >= 0.1) later.push(`quality ${row.next.quality > 0 ? "+" : ""}${points(row.next.quality)}`);
            if (Math.abs(row.next.brand) >= 0.1) later.push(`brand ${row.next.brand > 0 ? "+" : ""}${points(row.next.brand)}`);
            if (Math.abs(row.next.service) >= 0.1) later.push(`service ${row.next.service > 0 ? "+" : ""}${points(row.next.service)}`);
          }
          return (
            <div key={row.role} className="rounded-lg border p-3" data-testid={`seat-impact-${row.role}`}>
              <p className="text-sm font-medium">
                {DESK[row.role] ?? row.role}
                {!solo && row.role === yourRole && <span className="font-normal text-muted-foreground"> · you</span>}
              </p>
              <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                <span className="text-muted-foreground">Profit this year</span>
                <Delta value={row.profit} format={compact} testId={`seat-impact-${row.role}-profit`} />
                <span className="text-muted-foreground">Customers</span>
                <Delta value={row.customers} format={people} />
                {row.next && (
                  <>
                    <span className="text-muted-foreground">Revenue next year</span>
                    <Delta value={row.next.revenue} format={compact} />
                    <span className="text-muted-foreground">Profit next year</span>
                    <Delta value={row.next.profit} format={compact} testId={`seat-impact-${row.role}-next-profit`} />
                  </>
                )}
              </div>
              {later.length > 0 && (
                <p className="mt-1.5 text-xs text-muted-foreground">Lands next year: {later.join(", ")}.</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The year after this one, if the company holds this course — and what the
 * unsaved draft on this screen does to it.
 */
export function NextYearCard({ p, f }: { p: YearAhead | null; f: YearAhead | null }) {
  const { compact } = useMoney();
  if (!p) return null;
  const rows: { label: string; value: string; delta: number; format: (n: number) => string; invert?: boolean }[] = [
    { label: "Revenue", value: compact(p.revenue), delta: p.revenue - (f?.revenue ?? p.revenue), format: compact },
    { label: "Profit", value: compact(p.profit), delta: p.profit - (f?.profit ?? p.profit), format: compact },
    { label: "Customers", value: people(p.customers), delta: p.customers - (f?.customers ?? p.customers), format: people },
    { label: "Cost of one unit", value: compact(p.unitCost), delta: p.unitCost - (f?.unitCost ?? p.unitCost), format: compact, invert: true },
    { label: "Quality", value: points(p.quality), delta: p.quality - (f?.quality ?? p.quality), format: points },
    { label: "Service", value: points(p.service), delta: p.service - (f?.service ?? p.service), format: points },
  ];
  return (
    <div className="rounded-xl border bg-card p-4" data-testid="card-next-year">
      <h4 className="text-sm font-semibold">Year {p.year}, if you hold this course</h4>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Where research, hiring, training, efficiency and programmes pay off. Decisions made once — a bet, an offer, a loan — are not repeated.
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        {rows.map((r) => (
          <div key={r.label}>
            <dt className="text-xs text-muted-foreground">{r.label}</dt>
            <dd className="font-medium tabular-nums">{r.value}</dd>
            {Math.abs(r.delta) >= 0.05 && (
              <dd className="text-xs"><Delta value={r.delta} format={r.format} invert={r.invert} /> <span className="text-muted-foreground">from your change</span></dd>
            )}
          </div>
        ))}
      </dl>
    </div>
  );
}

const STRETCH: Record<SeatMood["stretch"], string> = { easy: "easy target", fair: "fair target", aggressive: "aggressive target" };

/** Each colleague's loyalty now and once the year is out. */
export function TeamCard({ team }: { team: SeatMood[] }) {
  if (!team.length) return null;
  return (
    <div className="rounded-xl border bg-card p-4" data-testid="card-team-loyalty">
      <h4 className="flex items-center gap-1.5 text-sm font-semibold"><Users className="h-4 w-4" /> The team after this year</h4>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Loyalty moves with targets, overrules, pay and whether the year makes money. Below 30 they start looking; at 15 they go.
      </p>
      <div className="mt-3 space-y-1.5">
        {team.map((t) => (
          <div key={t.role} className="flex items-center justify-between gap-3 text-sm" data-testid={`team-${t.role}`}>
            <span>{DESK[t.role] ?? t.role} <span className="text-xs text-muted-foreground">· {STRETCH[t.stretch]}</span></span>
            <span className="flex items-center gap-2 tabular-nums">
              <span className="text-muted-foreground">{t.loyaltyNow}</span>
              <span className="text-muted-foreground">→</span>
              <span className={cn("font-medium", t.loyaltyNext < 30 && "text-[var(--viz-bad)]")}>{t.loyaltyNext}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
