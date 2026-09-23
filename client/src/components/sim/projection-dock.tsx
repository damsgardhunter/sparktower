/**
 * The year's projection, pinned where the decisions are made.
 *
 * The full projection (projection-panel.tsx) sits near the top of the desk,
 * and the levers that move it sit three screens further down — so the moment a
 * seat started changing something, the numbers it changed had scrolled away.
 * This keeps the few that matter in view the whole way down: revenue, profit
 * and cash at the end of the year, how full the company is, and what the table
 * has committed against what it has. Every number redraws as the draft changes.
 *
 * It shares its data with the full panel (`useProjection`, same query key), so
 * pinning it costs no extra requests. On a wide screen it is a rail beside the
 * desk; on a phone, a bar along the bottom that opens into the same thing.
 *
 * Colours: the change arrows use the panel's validated `--viz-good` /
 * `--viz-bad`, and never alone — always with an arrow, a sign and words.
 */
import { useState } from "react";
import { LiveDot } from "@/components/nova";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, ChevronUp, ShieldAlert, AlertTriangle, Banknote } from "lucide-react";
import { useProjection, gbp } from "./projection-panel";

export interface Commitment {
  spend: number;
  fixed: number;
  available: number;
  openingCost: number;
  bySeat: { role: string; spend: number }[];
}

interface DockProps {
  ventureId: string;
  draft: Record<string, any> | null;
  filedStamp: string;
  /** What the table has committed, worked out on the desk from every seat's filing and this draft. */
  live: Commitment | null;
  /** The market's own words — "listeners", "diners". */
  customersWord: string;
  warnings: string[];
}

/** A figure, and what this seat's unfiled change is doing to it. */
function Figure({ label, value, delta, testId }: { label: string; value: number; delta: number; testId: string }) {
  const moved = Math.abs(delta) >= 1;
  const up = delta > 0;
  return (
    <div data-testid={testId}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("text-xl font-extrabold tracking-tight tabular-nums", value < 0 && "text-[var(--viz-bad)]")}>{gbp(value)}</p>
      {moved && (
        <p className={cn("flex items-center gap-0.5 text-[11px] font-medium", up ? "text-[var(--viz-good)]" : "text-[var(--viz-bad)]")} data-testid={`${testId}-delta`}>
          {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {up ? "+" : ""}{gbp(delta)} <span className="font-normal text-muted-foreground">from your change</span>
        </p>
      )}
    </div>
  );
}

function DockBody({ ventureId, draft, filedStamp, live, customersWord, warnings }: DockProps) {
  const { data, isFetching } = useProjection(ventureId, draft, filedStamp);
  const committed = live ? live.spend + live.fixed : 0;
  const over = live ? committed > live.available : false;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold">{data ? `Year ${data.year}, if it ended today` : "This year, if it ended today"}</p>
          <p className="text-[11px] text-muted-foreground">Updates as you change your plan</p>
        </div>
        {/* Live: pulses while the next answer is being worked out. */}
        <LiveDot size="md" active={isFetching} aria-label={isFetching ? "Updating" : "Up to date"} data-testid="dock-live" />
      </div>

      {!data ? (
        <div className="h-32 animate-pulse rounded-xl bg-muted/40" />
      ) : (
        <div className={cn("space-y-3 transition-opacity", isFetching && "opacity-70")}>
          {data.drafted.bankrupt && (
            <p className="flex items-start gap-1.5 rounded-lg border border-[var(--viz-status-critical)] p-2 text-xs font-medium">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--viz-status-critical)]" />
              This plan runs out of money and credit.
            </p>
          )}
          <Figure testId="dock-revenue" label="Revenue" value={data.drafted.revenue} delta={data.drafted.revenue - data.filed.revenue} />
          <Figure testId="dock-profit" label="Profit after tax" value={data.drafted.profit} delta={data.drafted.profit - data.filed.profit} />
          <Figure testId="dock-cash" label="Cash at year end" value={data.drafted.cashEnd} delta={data.drafted.cashEnd - data.filed.cashEnd} />

          {/* How full the company is. */}
          <div data-testid="dock-room">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>{Math.round(data.drafted.customers).toLocaleString()} {customersWord}</span>
              <span>of {Math.round(data.drafted.capacityNow).toLocaleString()} room</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full nova-chip" style={{ width: `${Math.min(100, (data.drafted.customers / Math.max(1, data.drafted.capacityNow)) * 100)}%` }} />
            </div>
            {data.drafted.turnedAway > 0 && (
              <p className="mt-1 text-[11px] text-[var(--viz-bad)]">{Math.round(data.drafted.turnedAway).toLocaleString()} turned away for want of room</p>
            )}
          </div>
        </div>
      )}

      {live && (
        <div className="border-t pt-3" data-testid="dock-committed">
          <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            <Banknote className="h-3.5 w-3.5" /> The table has committed
          </p>
          <p className={cn("text-lg font-extrabold tabular-nums", over && "text-destructive")} data-testid="text-commitment">{gbp(committed)}</p>
          <p className="text-[11px] text-muted-foreground">against {gbp(live.available)} available · {gbp(live.fixed)} of it salaries</p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", over ? "bg-destructive" : "nova-chip")} style={{ width: `${Math.min(100, (committed / Math.max(1, live.available)) * 100)}%` }} />
          </div>
          {over && <p className="mt-1 text-[11px] font-medium text-destructive">More than the company has, credit included.</p>}
          {/* Who is spending it — the thing the table argues about. */}
          <div className="mt-2 space-y-1">
            {live.openingCost > 0 && (
              <p className="flex justify-between text-[11px] text-amber-600" data-testid="text-opening-cost">
                <span>opening new places</span><span className="tabular-nums">{gbp(live.openingCost)}</span>
              </p>
            )}
            {live.bySeat.filter((b) => b.spend > 0).map((b) => (
              <p key={b.role} className="flex justify-between text-[11px]">
                <span className="uppercase text-muted-foreground">{b.role}</span><span className="tabular-nums">{gbp(b.spend)}</span>
              </p>
            ))}
            {live.bySeat.every((b) => b.spend === 0) && <p className="text-[11px] text-muted-foreground">Nobody has committed anything yet.</p>}
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="space-y-1.5">
          {warnings.map((w, i) => (
            <p key={i} className="flex gap-1.5 rounded-lg bg-destructive/10 p-2 text-[11px] text-destructive" data-testid="text-warning">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Beside the desk, on a wide screen: stays in view the whole way down. */
export function ProjectionRail(props: DockProps & { top: number }) {
  return (
    /*
     * The aside itself is what sticks. A sticky child inside a grid cell can
     * only travel within that cell, and the cell is exactly as tall as the
     * dock — so pinning the inner card went nowhere and the dock scrolled away
     * with everything else. Stuck at the grid-item level, it rides the whole
     * height of the desk.
     */
    <aside className="viz-root sticky hidden self-start rounded-2xl nova-ring nova-glow p-4 lg:block" style={{ top: props.top }} data-testid="projection-rail">
      <DockBody {...props} />
    </aside>
  );
}

/** Along the bottom, on a phone: the two numbers people check, opening into the rest. */
export function ProjectionBar(props: DockProps) {
  const [open, setOpen] = useState(false);
  const { data } = useProjection(props.ventureId, props.draft, props.filedStamp);
  return (
    <div className="viz-root sticky bottom-0 z-20 -mx-4 lg:hidden" data-testid="projection-bar">
      <div className="mx-2 mb-2 rounded-2xl nova-ring nova-glow backdrop-blur">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          aria-expanded={open}
          data-testid="button-projection-bar"
        >
          <span className="flex gap-5">
            <span>
              <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Profit</span>
              <span className={cn("text-base font-extrabold tabular-nums", (data?.drafted.profit ?? 0) < 0 && "text-[var(--viz-bad)]")}>{data ? gbp(data.drafted.profit) : "…"}</span>
            </span>
            <span>
              <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Cash at year end</span>
              <span className={cn("text-base font-extrabold tabular-nums", (data?.drafted.cashEnd ?? 0) < 0 && "text-[var(--viz-bad)]")}>{data ? gbp(data.drafted.cashEnd) : "…"}</span>
            </span>
          </span>
          <ChevronUp className={cn("h-4 w-4 shrink-0 transition-transform", !open && "rotate-180")} />
        </button>
        {open && <div className="max-h-[60vh] overflow-y-auto border-t px-4 py-3"><DockBody {...props} /></div>}
      </div>
    </div>
  );
}
