import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp } from "lucide-react";
import type { CapitalProfile } from "@shared/capital";

const BAND_TONE: Record<CapitalProfile["band"]["id"], string> = {
  not_yet: "text-rose-600 dark:text-rose-400",
  early: "text-amber-600 dark:text-amber-400",
  with_work: "text-sky-600 dark:text-sky-400",
  strong: "text-emerald-600 dark:text-emerald-400",
  very_strong: "text-emerald-600 dark:text-emerald-400",
};

/**
 * The fundability score: one number, what it's made of, and how each route fits.
 * Worked out from the capital-profile answers the same way every time, so it
 * moves only when the answers do — and each part says what raises it.
 */
export function CapitalProfileCard({ capital }: { capital: CapitalProfile & { route: string | null } }) {
  if (capital.answered === 0) return null;
  const tone = BAND_TONE[capital.band.id];
  const best = capital.routeFit[0];
  const radius = 34, circumference = 2 * Math.PI * radius;
  return (
    <Card data-testid="capital-profile-card">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative h-20 w-20 shrink-0" aria-label={`Fundability score ${capital.score} out of 100`}>
            <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90">
              <circle cx="40" cy="40" r={radius} className="stroke-muted" strokeWidth="8" fill="none" />
              <circle cx="40" cy="40" r={radius} className={`${tone} stroke-current`} strokeWidth="8" fill="none" strokeLinecap="round"
                strokeDasharray={circumference} strokeDashoffset={circumference * (1 - capital.score / 100)} />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-2xl font-bold tabular-nums" data-testid="capital-score">{capital.score}</span>
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5" /> Fundability today</p>
            <p className={`text-lg font-semibold ${tone}`} data-testid="capital-band">{capital.band.label}</p>
            <p className="text-xs text-muted-foreground">
              How a lender or investor would likely see you now, from your answers{capital.answered < 5 ? ` (${capital.answered} of 5 steps so far)` : ""}. Not the odds of approval — every part below says what raises it.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {capital.parts.map((p) => (
            <div key={p.key} className="space-y-1" data-testid={`capital-part-${p.key}`}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span>{p.label}</span>
                <span className="tabular-nums text-muted-foreground">{p.score}/{p.max}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary" style={{ width: `${(p.score / p.max) * 100}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">{p.why}{p.raise ? <> <span className="text-foreground">Raise it:</span> {p.raise}</> : null}</p>
            </div>
          ))}
        </div>

        {capital.answered >= 3 && (
          <div className="space-y-1.5 border-t border-border pt-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Route fit</p>
            <div className="flex flex-wrap gap-1.5">
              {capital.routeFit.map((r) => (
                <Badge key={r.route} variant={capital.route === r.route ? "default" : "outline"} className="gap-1 font-normal" title={r.why} data-testid={`route-fit-${r.route}`}>
                  {r.label} <span className="tabular-nums font-semibold">{r.score}</span>
                  {capital.route === r.route && <span className="text-[10px] uppercase">· your route</span>}
                </Badge>
              ))}
            </div>
            {!capital.route && best && <p className="text-xs text-muted-foreground">Best fit today: {best.label} — {best.why}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
