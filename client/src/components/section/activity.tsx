/** Recent activity on a section's path: what was finished, how long it took, and how the date moved. */
import { useState } from "react";
import { useNow } from "./live";
import { ago, day, estimate, type PathEvent } from "./path-types";
import { CheckCircle2 } from "lucide-react";

export function RecentActivity({ events }: { events: PathEvent[] }) {
  const now = useNow(60_000);
  const [all, setAll] = useState(false);
  const shown = all ? events : events.slice(0, 4);
  return (
    <div className="space-y-1" data-testid="path-activity">
      <ul className="divide-y divide-border/70">
        {shown.map((e) => {
          const moved = e.projectedBefore && e.projectedAfter && day(e.projectedBefore) !== day(e.projectedAfter);
          const earlier = moved && new Date(e.projectedAfter!).getTime() < new Date(e.projectedBefore!).getTime();
          return (
            <li key={e.id} className="flex items-center gap-2 py-2 text-sm">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              <span className="flex-1 min-w-0 truncate" title={e.title}>{e.title}</span>
              {e.actualMinutes != null && (
                <span className="hidden sm:inline text-[11px] text-muted-foreground tabular-nums shrink-0" title={e.estimateMinutes != null ? `Estimated ${estimate(e.estimateMinutes)}` : undefined}>{estimate(e.actualMinutes)}</span>
              )}
              {moved && (
                <span className={`text-[11px] tabular-nums shrink-0 ${earlier ? "text-emerald-600" : "text-amber-600"}`} title="Projected finish moved">
                  {day(e.projectedBefore)} → {day(e.projectedAfter)}
                </span>
              )}
              <span className="text-[11px] text-muted-foreground shrink-0 w-14 text-right">{ago(e.createdAt, now)}</span>
            </li>
          );
        })}
      </ul>
      {events.length > 4 && (
        <button className="text-xs text-primary hover:underline" onClick={() => setAll(!all)}>{all ? "Show less" : `Show all ${events.length}`}</button>
      )}
    </div>
  );
}
