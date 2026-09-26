/**
 * The games you've already played, and where each of them placed.
 *
 * ## Why a score alone was not enough
 *
 * This list used to be five rows reading "Unnamed startup — 612/1000". A
 * number out of a thousand, with nothing to compare it to, is not a result: it
 * is a number. Nobody knows whether 612 is good, and nobody can tell whether
 * the game they played last week was better than the one before it except by
 * subtracting.
 *
 * So every finished game now shows where it came on each of the five boards —
 * "3rd of 412 on capital efficiency" — because a placing is the only version
 * of a score that means something on its own. It also makes the five
 * dimensions legible as *different games to be good at*: a company that placed
 * 200th overall and 4th on risk is a genuinely interesting result, and the old
 * row had no way of saying so.
 *
 * ## The one good thing, first
 *
 * Every card leads with the board that game placed highest on, by percentile
 * rather than by rank — 2nd of 3 is not better than 50th of 4,000. Every
 * finished game should be able to say one true good thing about itself; that
 * is the line that makes somebody come back tomorrow, on a game they can only
 * play once a day.
 *
 * Risk is shown the right way round wherever it appears. The board is "lowest
 * risk", so a low number is a good result, and a bar drawn from the raw score
 * would show the safest company in the room as the emptiest.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Trophy, Sparkles } from "lucide-react";
import { DIMENSIONS, scoreBand, type DimensionId } from "@shared/sprints/scoring";

export interface Placing { rank: number; of: number }

export interface PastGame {
  id: string;
  name: string | null;
  era: string | null;
  outcome: "verdict" | "abandoned";
  youLeft: boolean;
  endedAt: string | null;
  verdict: {
    overall: number;
    tenYear: number | null;
    peak: number | null;
    peakYear: number | null;
    fromModel: boolean;
    scores: Record<DimensionId, number>;
  } | null;
  places: (Record<DimensionId, Placing> & { overall?: Placing }) | null;
}

/** "1st", "22nd", "113th" — English, including the teens, which the naive rule gets wrong. */
export function ordinal(n: number): string {
  const teen = n % 100;
  if (teen >= 11 && teen <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** A valuation, at whatever scale it happens to be. */
export function valuation(n: number | null): string {
  if (n == null || n <= 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 1)}bn`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

const stamp = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

/**
 * How well a placing actually went, 0–1.
 *
 * Percentile, not rank: coming 2nd of 3 is not an achievement and coming 50th
 * of 4,000 is. Used to pick the board a card leads with, and to colour it.
 */
const percentile = (p: Placing) => (p.of <= 1 ? 1 : (p.of - p.rank) / (p.of - 1));

/** The board this game did best on, by percentile. */
function bestBoard(places: PastGame["places"]): { dimension: (typeof DIMENSIONS)[number]; placing: Placing } | null {
  if (!places) return null;
  let best: { dimension: (typeof DIMENSIONS)[number]; placing: Placing } | null = null;
  for (const dimension of DIMENSIONS) {
    const placing = places[dimension.id];
    if (!placing) continue;
    if (!best || percentile(placing) > percentile(best.placing)) best = { dimension, placing };
  }
  return best;
}

export function PastGames({ games }: { games: PastGame[] }) {
  if (!games.length) return null;
  return (
    <div className="space-y-2" data-testid="game-history">
      {games.map((game) => <PastGameCard key={game.id} game={game} />)}
    </div>
  );
}

function PastGameCard({ game }: { game: PastGame }) {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const verdict = game.verdict;
  const best = bestBoard(game.places);

  return (
    <div className="rounded-xl border border-border overflow-hidden" data-testid={`past-game-${game.id}`}>
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 min-w-0 items-center gap-2.5 p-3 text-left hover:bg-muted/50 transition-colors"
          aria-expanded={open}
          data-testid={`button-past-game-${game.id}`}
        >
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{game.name || "Unnamed startup"}</p>
            {/*
              * One true good thing, where a bare score used to be. A game that
              * was never scored says which of the two reasons applies, because
              * a blank where a number goes reads as a spinner that never ends.
              */}
            <p className="truncate text-xs text-muted-foreground">
              {game.outcome === "abandoned"
                ? (game.youLeft ? "You left this one" : "Your partner left")
                : !verdict
                  ? "Being scored…"
                  : best
                    ? <>Best board: {ordinal(best.placing.rank)} of {best.placing.of} on {best.dimension.title.toLowerCase()}</>
                    : scoreBand(verdict.overall)}
              {game.endedAt && <span className="text-muted-foreground/70"> · {stamp(game.endedAt)}</span>}
            </p>
          </div>
          {verdict && (
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold tabular-nums" data-testid={`text-past-score-${game.id}`}>{verdict.overall}</p>
              <p className="text-[10px] text-muted-foreground">of 1000</p>
            </div>
          )}
        </button>
      </div>

      {open && (
        <div className="border-t border-border bg-muted/20 p-3 space-y-3">
          {!verdict ? (
            <p className="text-sm text-muted-foreground">
              {game.outcome === "abandoned"
                ? "Nobody finished this one, so there is nothing to score. The decisions you did make are still there."
                : "The valuation hasn't landed yet. It retries on its own — come back in a minute."}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{valuation(verdict.tenYear)}</p>
                  <p className="text-[11px] text-muted-foreground">worth in ten years</p>
                </div>
                {verdict.peak != null && verdict.peak > 0 && (
                  <div>
                    <p className="text-sm tabular-nums">{valuation(verdict.peak)}</p>
                    <p className="text-[11px] text-muted-foreground">peak{verdict.peakYear ? `, year ${verdict.peakYear}` : ""}</p>
                  </div>
                )}
                {game.places?.overall && (
                  <Badge variant="secondary" className="ml-auto" data-testid={`badge-overall-place-${game.id}`}>
                    <Trophy className="mr-1 h-3 w-3" />
                    {ordinal(game.places.overall.rank)} of {game.places.overall.of} overall
                  </Badge>
                )}
              </div>

              {/* The five boards. A placing per board, because that is what a score means. */}
              <div className="grid gap-1.5 sm:grid-cols-2">
                {DIMENSIONS.map((d) => {
                  const score = verdict.scores[d.id] ?? 0;
                  // "Lowest risk" is a board you win by scoring low; the bar has to agree with the title.
                  const shown = d.betterIs === "lower" ? 1000 - score : score;
                  const placing = game.places?.[d.id] ?? null;
                  return (
                    <div key={d.id} className="rounded-lg border border-border bg-background p-2.5 space-y-1" data-testid={`board-${d.id}-${game.id}`}>
                      <div className="flex items-baseline gap-2">
                        <p className="flex-1 truncate text-xs font-medium">{d.title}</p>
                        <span className="text-xs tabular-nums text-muted-foreground">{score}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <div className="h-full rounded-full bg-primary" style={{ width: `${(shown / 1000) * 100}%` }} />
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {placing
                          ? <><span className="font-medium text-foreground">{ordinal(placing.rank)}</span> of {placing.of}</>
                          : scoreBand(shown)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => navigate(`/sprints/game/${game.id}`)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
              data-testid={`button-open-past-${game.id}`}
            >
              <Sparkles className="h-3.5 w-3.5" /> Open it
            </button>
            <button
              type="button"
              onClick={() => navigate("/sprints/boards")}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
            >
              <Trophy className="h-3.5 w-3.5" /> See the boards
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
