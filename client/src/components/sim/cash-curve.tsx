/**
 * The bank balance, month by month, three ways.
 *
 * Hand-drawn SVG rather than a charting library, which is the pattern
 * everywhere else here, and it suits this chart particularly: the three lines
 * are not three series of equal weight. Doing nothing is the reference and is
 * drawn thin and grey; the expected case is the line people read; the slow
 * case is the one that decides whether the decision is survivable, so it is
 * drawn as prominently as the expected one rather than as an error bar.
 *
 * Zero is always on the chart even when no line goes near it. A cash chart
 * scaled to its own data can show a business falling from $80,000 to $40,000
 * as a line that plunges to the floor, which reads as ruin and isn't — and the
 * one time the floor genuinely is zero, the reader has been taught to ignore
 * it.
 */
import { money } from "./business-sim-types";
import type { Run } from "@shared/simulation/decision-sim";

const WIDTH = 640;
const HEIGHT = 180;
const PAD = { left: 8, right: 8, top: 12, bottom: 18 };

export function CashCurve({ likely, cautious, bold, without, currency }: {
  likely: Run; cautious: Run; bold?: Run; without: Run; currency?: string;
}) {
  /*
   * The good case was computed and never drawn.
   *
   * `answer()` has always run three confidences and the chart showed two of
   * them, so the one line an owner most wants to see — what it looks like if
   * this goes well — existed in the payload and nowhere on screen. Drawn
   * faintly, because it is the least likely of the three and a chart that
   * gives it equal weight is a chart that sells.
   */
  const series = [
    { key: "without", run: without, stroke: "currentColor", className: "text-muted-foreground/40", width: 1.5, dash: "4 3" },
    ...(bold ? [{ key: "bold", run: bold, stroke: "currentColor", className: "text-emerald-500/35", width: 1.5, dash: "5 3" }] : []),
    { key: "cautious", run: cautious, stroke: "currentColor", className: "text-amber-500", width: 2, dash: undefined },
    { key: "likely", run: likely, stroke: "currentColor", className: "text-emerald-500", width: 2.5, dash: undefined },
  ];

  const all = series.flatMap((s) => s.run.months.map((m) => m.cash));
  // Zero always in frame. See the note at the top of this file.
  const top = Math.max(0, ...all);
  const bottom = Math.min(0, ...all);
  const span = top - bottom || 1;
  const months = likely.months.length;

  const x = (month: number) =>
    PAD.left + ((month - 1) / Math.max(1, months - 1)) * (WIDTH - PAD.left - PAD.right);
  const y = (cash: number) =>
    PAD.top + (1 - (cash - bottom) / span) * (HEIGHT - PAD.top - PAD.bottom);

  const path = (run: Run) =>
    run.months.map((m, i) => `${i === 0 ? "M" : "L"}${x(m.month).toFixed(1)},${y(m.cash).toFixed(1)}`).join(" ");

  return (
    <div className="space-y-1.5" data-testid="cash-curve">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-[180px]"
        role="img"
        aria-label={`Bank balance over ${months} months: ${money(likely.endCash, currency)} if it goes as expected, ${money(cautious.endCash, currency)} if it goes slowly, ${money(without.endCash, currency)} if you do nothing.`}
      >
        {/* The line the whole decision is measured against: an empty bank. */}
        <line
          x1={PAD.left} x2={WIDTH - PAD.right} y1={y(0)} y2={y(0)}
          stroke="currentColor" strokeWidth={1} className="text-destructive/40" strokeDasharray="2 4"
        />
        {series.map((s) => (
          <path
            key={s.key}
            d={path(s.run)}
            fill="none"
            stroke={s.stroke}
            strokeWidth={s.width}
            strokeDasharray={s.dash}
            strokeLinejoin="round"
            strokeLinecap="round"
            className={s.className}
          />
        ))}
      </svg>
      <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
        <Key className="text-emerald-500" label={`As expected — ${money(likely.endCash, currency)}`} />
        <Key className="text-amber-500" label={`If it goes slowly — ${money(cautious.endCash, currency)}`} />
        {bold && <Key className="text-emerald-500/40" label={`If it goes well — ${money(bold.endCash, currency)}`} dashed />}
        <Key className="text-muted-foreground/50" label={`Doing nothing — ${money(without.endCash, currency)}`} dashed />
        <span className="ml-auto tabular-nums">month 1 → {months}</span>
      </div>
    </div>
  );
}

function Key({ className, label, dashed }: { className: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-0 w-4 border-t-2 ${dashed ? "border-dashed" : ""} ${className}`} style={{ borderColor: "currentColor" }} />
      <span>{label}</span>
    </span>
  );
}
