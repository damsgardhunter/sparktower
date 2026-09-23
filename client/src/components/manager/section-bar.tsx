/**
 * The three sections — Ship, Systemize, Funding — as symbols under the header.
 *
 * They're parallel paths: clicking one only changes what you're looking at.
 * One row, one line each: the symbol, the word, how far along, and a bar. It
 * used to be three 116px tiles carrying a large symbol with the name revealed
 * on hover — a sixth of the first screen spent on navigation that told a
 * keyboard or touch user nothing until they committed to a tap, above the step
 * the page exists to show. The name is always on now and the row is a third of
 * the height.
 *
 * The section being worked on is filled with the gradient and outlined in the
 * page's own colour; the others are the reverse, a plain tile in a quiet
 * border. The one you're in should be the thing the eye lands on.
 */
import type { ProjectGoal } from "@shared/goals";
import { SECTIONS, type SectionSummary } from "@/lib/sections";
import { NOVA_GRADIENT } from "./tabs";

/** One word each. Longer names live in the section's own screens. */
const WORD: Record<ProjectGoal, string> = {
  ship_mvp: "Ship",
  systemize_business: "Systemize",
  run_company: "Run",
};

export function SectionBar({ tracks, selected, onSelect }: {
  tracks: SectionSummary[] | undefined;
  selected: ProjectGoal;
  onSelect: (goal: ProjectGoal) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3" role="tablist" aria-label="Sections" data-testid="section-bar">
      {SECTIONS.map((s) => {
        const summary = tracks?.find((t) => t.goal === s.goal);
        const active = s.goal === selected;
        const started = summary?.started ?? false;
        const done = summary?.done ?? 0;
        const total = summary?.total ?? 0;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const Icon = s.icon;
        const word = WORD[s.goal];
        return (
          <button
            key={s.goal}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={started ? `${s.label} — ${done} of ${total} done` : `${s.label} — not started`}
            title={s.label}
            onClick={() => onSelect(s.goal)}
            className={`group relative rounded-lg p-[1.5px] transition-shadow ${active ? "bg-background shadow-sm shadow-emerald-500/15" : "bg-neutral-200 dark:bg-neutral-800 hover:bg-emerald-300"}`}
            data-testid={`section-${s.goal}`}
          >
            <div className={`h-full rounded-[7px] px-2.5 py-2 flex items-center gap-2.5 ${active ? NOVA_GRADIENT : "bg-background"}`}>
              <Icon
                className={`h-5 w-5 shrink-0 ${active ? "text-white drop-shadow-sm" : "text-muted-foreground group-hover:text-emerald-600"}`}
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1 text-left space-y-1">
                {/* The name is always on now. It was revealed on hover, which
                    kept the row quiet and meant a tile said nothing at all to
                    anyone not using a mouse — and the row was 116px tall to
                    hold a symbol doing the work of a word. */}
                <div className="flex items-baseline gap-1.5">
                  <span
                    className={`text-xs font-semibold leading-none truncate ${active ? "text-white drop-shadow-sm" : "text-foreground"}`}
                    data-testid={`section-word-${s.goal}`}
                  >
                    {word}
                  </span>
                  {started && (
                    <span className={`text-[10px] tabular-nums shrink-0 ${active ? "text-white/90" : "text-muted-foreground"}`} data-testid={`section-progress-${s.goal}`}>{done}/{total}</span>
                  )}
                </div>
                <div className={`h-1 rounded-full overflow-hidden ${active ? "bg-white/30" : started ? "bg-muted" : "bg-muted/60 border border-dashed border-muted-foreground/25"}`}>
                  {started && <div className={`h-full rounded-full transition-all ${active ? "bg-white" : NOVA_GRADIENT}`} style={{ width: `${pct}%` }} />}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
