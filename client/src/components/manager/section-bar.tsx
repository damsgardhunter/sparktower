/**
 * The three sections — Ship, Systemize, Funding — as symbols under the header.
 *
 * They're parallel paths: clicking one only changes what you're looking at.
 * The tile is the symbol, big enough to hit and to recognise at a glance; the
 * name is one word and appears above it on hover, so the row stays quiet until
 * someone reaches for it. Progress stays visible whatever the pointer is doing
 * — it's the thing you want to see without touching anything — and the open
 * section keeps its name on, so "where am I" never needs a hover.
 *
 * The section being worked on is filled with the gradient and outlined in the
 * page's own colour; the others are the reverse, a plain tile in a quiet
 * border. The one you're in should be the thing the eye lands on.
 */
import type { ProjectGoal } from "@shared/goals";
import { SECTIONS, type SectionSummary } from "@/lib/sections";
import { NOVA_GRADIENT } from "./tabs";

/** One word each, for the hover label. Longer names live in the section's own screens. */
const WORD: Record<ProjectGoal, string> = {
  ship_mvp: "Ship",
  systemize_business: "Systemize",
  raise_funding: "Funding",
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
            className={`group relative rounded-xl p-[2px] transition-shadow ${active ? "bg-background shadow-md shadow-emerald-500/15" : "bg-neutral-200 dark:bg-neutral-800 hover:bg-emerald-300"}`}
            data-testid={`section-${s.goal}`}
          >
            <div className={`h-full min-h-[104px] sm:min-h-[116px] rounded-[10px] px-2 pt-1.5 pb-2 sm:px-3 flex flex-col items-center ${active ? NOVA_GRADIENT : "bg-background"}`}>
              {/* The name, one word, above the symbol: on while the section is open or the pointer is on it. */}
              <span
                className={`text-[11px] sm:text-xs font-semibold leading-4 transition-opacity ${active ? "text-white drop-shadow-sm opacity-100" : "text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`}
                data-testid={`section-word-${s.goal}`}
              >
                {word}
              </span>

              {/* The symbol fills the tile — the button itself, not a badge inside one. */}
              <span className="flex-1 flex items-center justify-center">
                <Icon
                  className={`h-11 w-11 sm:h-14 sm:w-14 shrink-0 transition-colors ${active ? "text-white drop-shadow-sm" : "text-muted-foreground group-hover:text-emerald-600"}`}
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              </span>

              {/* Progress, always on once the section is started; an empty track before that, so the row never jumps. */}
              <div className="w-full flex items-center gap-1.5">
                {/* On the filled tile the track and its count are white on the gradient; elsewhere the gradient is the fill. */}
                <div className={`h-1 flex-1 rounded-full overflow-hidden ${active ? "bg-white/30" : started ? "bg-muted" : "bg-muted/60 border border-dashed border-muted-foreground/25"}`}>
                  {started && <div className={`h-full rounded-full transition-all ${active ? "bg-white" : NOVA_GRADIENT}`} style={{ width: `${pct}%` }} />}
                </div>
                {started && (
                  <span className={`text-[10px] tabular-nums shrink-0 ${active ? "text-white/90" : "text-muted-foreground"}`} data-testid={`section-progress-${s.goal}`}>{done}/{total}</span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
