/**
 * The three sections — Ship, Systemize, Raise — as big buttons under the
 * header. They're parallel paths: clicking one only changes what you're
 * looking at. Progress is live (useSections polls).
 */
import type { ProjectGoal } from "@shared/goals";
import { SECTIONS, type SectionSummary } from "@/lib/sections";
import { Play } from "lucide-react";
import { NOVA_GRADIENT } from "./tabs";

export function SectionBar({ tracks, selected, onSelect }: {
  tracks: SectionSummary[] | undefined;
  selected: ProjectGoal;
  onSelect: (goal: ProjectGoal) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3" role="tablist" aria-label="Sections" data-testid="section-bar">
      {SECTIONS.map((s) => {
        const summary = tracks?.find((t) => t.goal === s.goal);
        const active = s.goal === selected;
        const started = summary?.started ?? false;
        const done = summary?.done ?? 0;
        const total = summary?.total ?? 0;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const Icon = s.icon;
        return (
          <button
            key={s.goal}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(s.goal)}
            className={`group relative rounded-xl p-[2px] text-left transition-shadow ${active ? `${NOVA_GRADIENT} shadow-md shadow-emerald-500/15` : "bg-neutral-200 dark:bg-neutral-800 hover:bg-emerald-300"}`}
            data-testid={`section-${s.goal}`}
          >
            <div className="h-full rounded-[10px] bg-background px-3 py-2.5 sm:p-4 flex items-center sm:items-start gap-3">
              <div className={`h-9 w-9 sm:h-10 sm:w-10 shrink-0 rounded-lg flex items-center justify-center transition-colors ${active ? `${NOVA_GRADIENT} text-white` : "bg-muted text-muted-foreground group-hover:text-emerald-600"}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={`font-semibold truncate ${active ? "text-foreground" : "text-foreground/75"}`}>{s.label}</p>
                  {started && (
                    <span className="text-xs tabular-nums text-muted-foreground shrink-0" data-testid={`section-progress-${s.goal}`}>{done}/{total}</span>
                  )}
                </div>
                <p className="hidden sm:block text-xs text-muted-foreground truncate mt-0.5">{s.blurb}</p>
                {started ? (
                  <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${NOVA_GRADIENT} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                ) : (
                  <div className="mt-1 sm:mt-2 flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-muted-foreground">Not started</span>
                    <span className="inline-flex items-center gap-1 font-medium text-emerald-600 opacity-80 group-hover:opacity-100">
                      <Play className="h-3 w-3" /> Start
                    </span>
                  </div>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
