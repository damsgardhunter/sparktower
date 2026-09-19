/**
 * The reveal.
 *
 * Half an hour of arguing with a stranger comes down to this screen, so it is
 * built as a reveal rather than a report: one enormous number first, then how
 * it got there, then where the two of you placed.
 *
 * ## What the screen is doing
 *
 * The ten-year valuation is the headline and nothing competes with it. Beneath
 * it, the peak — and *when* the peak lands, which is the more interesting
 * number: a company that peaks in year three and declines is a different story
 * from one still climbing at ten, and the pair should be able to see which one
 * they built.
 *
 * The five scores are bars rather than numbers in a table. A bar makes "we
 * were strong on product and hopeless at reaching anyone" legible in about a
 * second, which a column of four-digit numbers does not.
 *
 * Every score carries its rank. "812" means nothing on its own; "812 — 4th of
 * 61" is the sentence somebody screenshots.
 */
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp, Trophy } from "lucide-react";
import { money } from "@shared/sprints/budget";
import { SCORE_MAX, scoreBand, type DimensionId } from "@shared/sprints/scoring";

export interface StandingRow {
  id: DimensionId; title: string; blurb: string;
  score: number; band: string; rank: number; of: number;
}

/** A score, as a bar with its rank on the end. */
function ScoreBar({ row, betterIsLower }: { row: StandingRow; betterIsLower: boolean }) {
  /*
   * The bar is filled by how *good* the score is, not by its raw value, so the
   * risk bar doesn't read as a triumph when it is the opposite. The number
   * beside it stays the real one, because the board is called "lowest risk"
   * and a player comparing the two would spot a fudge instantly.
   */
  const goodness = betterIsLower ? SCORE_MAX - row.score : row.score;
  const pct = (goodness / SCORE_MAX) * 100;

  return (
    <div data-testid={`score-${row.id}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{row.title}</span>
        <span className="shrink-0 text-sm tabular-nums">
          <span className="font-semibold">{row.score}</span>
          <span className="text-muted-foreground">/{SCORE_MAX}</span>
        </span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-700 ease-out",
            pct >= 77.5 ? "bg-emerald-500" : pct >= 45 ? "bg-sky-500" : pct >= 27.5 ? "bg-amber-500" : "bg-rose-500",
          )}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{row.blurb}</span>
        {/* A number alone means nothing. A placing is the bit people read. */}
        <span className="shrink-0 font-medium tabular-nums">
          {row.band} · {ordinal(row.rank)} of {row.of}
        </span>
      </div>
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export function VerdictScreen({
  verdict, standings, companyName, onPlayAgain, onSeeBoards,
}: {
  verdict: {
    tenYear: number; peak: number; peakYear: number; overall: number;
    summary: string; advice: string[] | null; fromModel: boolean;
  } | null;
  standings: StandingRow[] | null;
  companyName: string;
  onPlayAgain: () => void;
  onSeeBoards: () => void;
}) {
  if (!verdict) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-lg font-medium">Working out what you built…</p>
        <p className="text-sm text-muted-foreground">Ten years is a long time. This takes a moment.</p>
      </div>
    );
  }

  /*
   * The model couldn't be reached. Said plainly rather than shown as a score,
   * because a middling number presented as a judgement is a judgement the
   * product did not make and cannot support.
   */
  if (!verdict.fromModel) {
    return (
      <div className="space-y-4 py-10 text-center">
        <h2 className="text-2xl font-semibold">{companyName}</h2>
        <p className="mx-auto max-w-md text-muted-foreground">{verdict.summary}</p>
        <Button onClick={onPlayAgain}>Play again</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* The headline. Nothing competes with it. */}
      <div className="rounded-2xl border bg-gradient-to-b from-primary/5 to-transparent p-6 text-center">
        <p className="text-sm text-muted-foreground">{companyName}, ten years from now</p>
        <p
          data-testid="verdict-ten-year"
          className="mt-1 text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl"
        >
          {money(verdict.tenYear)}
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
          <span className="flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Peak</span>
            <span className="font-semibold tabular-nums">{money(verdict.peak)}</span>
            <span className="text-muted-foreground">in year {verdict.peakYear}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Trophy className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Overall</span>
            <span className="font-semibold tabular-nums">{verdict.overall}</span>
            <Badge variant="secondary">{scoreBand(verdict.overall)}</Badge>
          </span>
        </div>

        {/*
          * Peaking before year ten means it declined from there, which is a
          * story worth telling rather than a number to bury.
          */}
        {verdict.peakYear < 10 && verdict.peak > verdict.tenYear && (
          <p className="mt-3 text-sm text-muted-foreground">
            It peaked in year {verdict.peakYear} and came down from there.
          </p>
        )}
      </div>

      {verdict.summary && (
        <div className="rounded-xl border bg-card p-5">
          <p className="leading-relaxed">{verdict.summary}</p>
        </div>
      )}

      {standings && (
        <div className="space-y-4 rounded-xl border bg-card p-5">
          <h3 className="font-semibold">How you scored</h3>
          {standings.map((row) => (
            <ScoreBar key={row.id} row={row} betterIsLower={row.id === "risk"} />
          ))}
        </div>
      )}

      {verdict.advice && verdict.advice.length > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <h3 className="font-semibold">What would have made it worth more</h3>
          <ul className="mt-2 space-y-2">
            {verdict.advice.map((a, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="text-muted-foreground">{i + 1}.</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Button onClick={onPlayAgain} data-testid="button-play-again">Play again</Button>
        <Button variant="outline" onClick={onSeeBoards} data-testid="button-see-boards">
          See the leaderboards
        </Button>
      </div>
    </div>
  );
}

export { ordinal };
