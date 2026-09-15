import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { CapitalProfile } from "@shared/capital";

const BAND_TONE: Record<CapitalProfile["band"]["id"], string> = {
  not_yet: "text-rose-600 dark:text-rose-400",
  early: "text-amber-600 dark:text-amber-400",
  with_work: "text-sky-600 dark:text-sky-400",
  strong: "text-emerald-600 dark:text-emerald-400",
  very_strong: "text-emerald-600 dark:text-emerald-400",
};

/**
 * The fundability score: one number, its parts as bars, and how each route
 * fits. Worked out from the capital-profile answers the same way every time,
 * so it moves only when the answers do. What raises each part is one click
 * away rather than on screen.
 */
export function CapitalProfileCard({ capital }: { capital: CapitalProfile & { route: string | null } }) {
  const [why, setWhy] = useState(false);
  if (capital.answered === 0) return null;
  const tone = BAND_TONE[capital.band.id];
  const best = capital.routeFit[0];
  const radius = 26, circumference = 2 * Math.PI * radius;
  return (
    <div className="rounded-lg border border-border divide-y divide-border" data-testid="capital-profile-card">
      <div className="p-3 sm:p-4 flex items-center gap-4 flex-wrap">
        <div className="relative h-16 w-16 shrink-0" aria-label={`Fundability score ${capital.score} out of 100`} title="How a lender or investor would likely see you now, from your answers. Not the odds of approval.">
          <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
            <circle cx="32" cy="32" r={radius} className="stroke-muted" strokeWidth="7" fill="none" />
            <circle cx="32" cy="32" r={radius} className={`${tone} stroke-current transition-all duration-700`} strokeWidth="7" fill="none" strokeLinecap="round"
              strokeDasharray={circumference} strokeDashoffset={circumference * (1 - capital.score / 100)} />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-xl font-bold tabular-nums" data-testid="capital-score">{capital.score}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-base font-semibold ${tone}`} data-testid="capital-band">{capital.band.label}</p>
          <p className="text-xs text-muted-foreground">Fundability today{capital.answered < 5 ? ` · ${capital.answered}/5 answered` : ""}</p>
        </div>
        <button className="text-xs text-primary hover:underline flex items-center gap-1" onClick={() => setWhy(!why)} data-testid="button-capital-why">
          {why ? "Hide" : "How to raise it"}{why ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>

      <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
        {capital.parts.map((p) => (
          <div key={p.key} className={`space-y-1 ${why ? "sm:col-span-2" : ""}`} data-testid={`capital-part-${p.key}`}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium">{p.label}</span>
              <span className="tabular-nums text-muted-foreground">{p.score}/{p.max}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${(p.score / p.max) * 100}%` }} />
            </div>
            {why && <p className="text-xs text-muted-foreground">{p.why}{p.raise ? <> <span className="text-foreground">Raise it:</span> {p.raise}</> : null}</p>}
          </div>
        ))}
      </div>

      {capital.answered >= 3 && (
        <div className="p-3 sm:p-4 space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Route fit</p>
          <div className="flex flex-wrap gap-1.5">
            {capital.routeFit.map((r) => (
              <Badge key={r.route} variant={capital.route === r.route ? "default" : "outline"} className="gap-1 font-normal" title={r.why} data-testid={`route-fit-${r.route}`}>
                {r.label} <span className="tabular-nums font-semibold">{r.score}</span>
                {capital.route === r.route && <span className="text-[10px] uppercase">· your route</span>}
              </Badge>
            ))}
          </div>
          {!capital.route && best && <p className="text-xs text-muted-foreground line-clamp-1" title={best.why}>Best fit: {best.label}</p>}
        </div>
      )}
    </div>
  );
}
