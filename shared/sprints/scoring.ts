/**
 * The verdict: what the thing is worth, and where the two of you rank.
 *
 * At the end of the game an AI is shown everything the pair decided — the
 * idea, the customer, the model, the product claims and the budget — and asked
 * what the company is worth ten years out, what its peak would have been, and
 * how it scores on five things.
 *
 * ## Why scores out of a thousand
 *
 * Out of ten, everything is a 7. Out of a hundred, everything is in the
 * sixties. A thousand-point scale is the smallest one where a model's natural
 * reluctance to use the ends of a range still leaves enough room for two
 * genuinely different startups to land a hundred points apart and for that gap
 * to read as meaningful. It also makes the leaderboard legible at a glance:
 * 840 beats 790 and you can see it without a decimal point.
 *
 * ## Why this module exists at all
 *
 * Because the model's output is not trustworthy and must not be stored as if
 * it were. It will return 1200, or -4, or "high", or omit a dimension, or
 * decide a nine-person company is worth four hundred trillion dollars. None of
 * that should reach a leaderboard. Everything here is the clamping, the
 * defaulting and the ranking — so there is exactly one place where a model's
 * enthusiasm turns into a number the product will stand behind.
 *
 * Pure: no database, no model call.
 */

/** The floor and ceiling of every score in this game. */
export const SCORE_MIN = 0;
export const SCORE_MAX = 1000;

export interface Dimension {
  id: DimensionId;
  /** What the leaderboard for it is called. */
  title: string;
  /** One line on what it is actually measuring. */
  blurb: string;
  /**
   * Which end is good.
   *
   * Four of the five are "higher". Risk is the exception and it is deliberate:
   * the board is called "Lowest risk", so the number behind it has to mean
   * risk, or the label and the score disagree and somebody eventually sorts it
   * the wrong way. Encoding the direction on the dimension itself is what
   * stops that being a bug waiting to happen — nothing ranks without asking.
   */
  betterIs: "higher" | "lower";
}

export type DimensionId = "growth" | "capital" | "product" | "acquisition" | "risk";

export const DIMENSIONS: Dimension[] = [
  {
    id: "growth", title: "Highest growth potential", betterIs: "higher",
    blurb: "How big this could get if it works — market size, and whether the model compounds.",
  },
  {
    id: "capital", title: "Best capital efficiency", betterIs: "higher",
    blurb: "How much company the first million actually bought.",
  },
  {
    id: "product", title: "Strongest product", betterIs: "higher",
    blurb: "Whether what it does better than the alternatives is real, and hard to copy.",
  },
  {
    id: "acquisition", title: "Best customer acquisition", betterIs: "higher",
    blurb: "Whether there is a believable way to reach the customer they picked, and afford it.",
  },
  {
    id: "risk", title: "Lowest risk", betterIs: "lower",
    blurb: "How many things have to go right. Lower is better on this one.",
  },
];

export const DIMENSION_IDS = DIMENSIONS.map((d) => d.id);

export type Scores = Record<DimensionId, number>;

/**
 * One company's verdict, after cleaning.
 *
 * `tenYear` and `peak` are in dollars. `peakYear` is when the peak happens,
 * which is a more interesting number than either: a company that peaks in year
 * three and declines is a different story from one still climbing at ten, and
 * the pair should see which they built.
 */
export interface Verdict {
  scores: Scores;
  tenYear: number;
  peak: number;
  peakYear: number;
  /** The model's short account of the reasoning, shown under the number. */
  summary: string;
  /** Per-dimension one-liners, so a score is never just a number. */
  notes: Partial<Record<DimensionId, string>>;
  /** What it would take to do better — the thing people actually read. */
  advice: string[];
}

const clampScore = (n: unknown): number => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 500; // A missing dimension is a middling one, not a zero.
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, Math.round(v)));
};

/**
 * The largest number this game will print.
 *
 * Models asked to value an imaginary company reach for trillions, and a
 * leaderboard topped by a $900T doodle is a leaderboard nobody believes. Two
 * hundred billion is roughly "one of the largest companies on earth" — high
 * enough that a genuinely brilliant answer is not squashed, low enough that
 * the number stays a claim about a business rather than a joke.
 */
export const VALUATION_CEILING = 200_000_000_000;

const clampMoney = (n: unknown): number => {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(VALUATION_CEILING, Math.round(v));
};

/**
 * A model's answer, turned into something storable.
 *
 * Every field is defaulted rather than rejected. A verdict that fails to parse
 * must not lose the pair their game: they spent half an hour on this, and "the
 * scoring service returned malformed JSON" is not an ending. A middling score
 * with an honest summary is.
 */
export function cleanVerdict(raw: unknown): Verdict {
  const source = (raw ?? {}) as Record<string, any>;
  const rawScores = (source.scores ?? source) as Record<string, unknown>;

  const scores = Object.fromEntries(
    DIMENSION_IDS.map((id) => [id, clampScore(rawScores?.[id])]),
  ) as Scores;

  const tenYear = clampMoney(source.tenYear ?? source.tenYearValuation);
  const peak = clampMoney(source.peak ?? source.peakValuation);

  /*
   * A peak below the ten-year value is a contradiction — the peak is the
   * highest it ever gets, and year ten is one of the years it passes through.
   * Models produce this surprisingly often. Believe the larger number rather
   * than refusing the verdict.
   */
  const peakFixed = Math.max(peak, tenYear);

  const peakYearRaw = Number(source.peakYear);
  const peakYear = Number.isFinite(peakYearRaw)
    ? Math.max(1, Math.min(10, Math.round(peakYearRaw)))
    // A company still worth its peak at ten years peaked at ten.
    : peakFixed === tenYear ? 10 : 7;

  const notes: Partial<Record<DimensionId, string>> = {};
  for (const id of DIMENSION_IDS) {
    const note = source.notes?.[id];
    if (typeof note === "string" && note.trim()) notes[id] = note.trim().slice(0, 300);
  }

  return {
    scores,
    tenYear,
    peak: peakFixed,
    peakYear,
    summary: typeof source.summary === "string" ? source.summary.trim().slice(0, 1200) : "",
    notes,
    advice: Array.isArray(source.advice)
      ? source.advice.filter((a: unknown) => typeof a === "string" && a.trim())
        .slice(0, 5).map((a: string) => a.trim().slice(0, 300))
      : [],
  };
}

/**
 * One number for the top of the results screen.
 *
 * The mean of the five, with risk inverted so that every contributor points
 * the same way. Risk has to be flipped rather than dropped: a company that
 * scores well everywhere because it is attempting something trivially safe has
 * not built the best startup in the room, and an overall score that ignored
 * risk would say it had.
 */
export function overallScore(scores: Scores): number {
  const parts = DIMENSIONS.map((d) =>
    d.betterIs === "lower" ? SCORE_MAX - scores[d.id] : scores[d.id]);
  return Math.round(parts.reduce((sum, n) => sum + n, 0) / parts.length);
}

/** What a score is called, so the screen never shows a bare number. */
export function scoreBand(score: number): string {
  if (score >= 900) return "Exceptional";
  if (score >= 775) return "Strong";
  if (score >= 625) return "Promising";
  if (score >= 450) return "Workable";
  if (score >= 275) return "Shaky";
  return "Struggling";
}

// ─── The leaderboard ─────────────────────────────────────────────────────────

export interface Standing<T> {
  entry: T;
  rank: number;
  score: number;
  /** How many were ranked, so a screen can say "4th of 26". */
  of: number;
}

/**
 * Rank everybody on one dimension.
 *
 * Ties share a rank and the next rank skips, the way finishing positions
 * work: two companies on 812 are both second, and the next is fourth. The
 * alternative — breaking ties by id or by whoever played first — invents a
 * difference between two identical results and shows it to both of them.
 */
export function rankBy<T>(
  entries: readonly T[],
  dimension: DimensionId,
  scoreOf: (entry: T) => Scores,
): Standing<T>[] {
  const dim = DIMENSIONS.find((d) => d.id === dimension);
  if (!dim) return [];
  return rankOn(entries, (entry) => scoreOf(entry)[dimension] ?? 0, dim.betterIs);
}

/**
 * Rank on any number at all, with the same tie rule.
 *
 * Exists because the overall board is not a dimension and so cannot go through
 * `rankBy` — and when it was ranked separately it quietly did the wrong thing:
 * positions were handed out by array index, so two companies on an identical
 * 812 came first and second. The five dimension boards shared the rank
 * correctly and the headline board did not, which is the worst way for an
 * inconsistency like this to exist, because the boards are read side by side.
 */
export function rankOn<T>(
  entries: readonly T[],
  valueOf: (entry: T) => number,
  betterIs: "higher" | "lower" = "higher",
): Standing<T>[] {
  const scored = entries.map((entry) => ({ entry, score: valueOf(entry) }));
  scored.sort((a, b) => (betterIs === "lower" ? a.score - b.score : b.score - a.score));

  const out: Standing<T>[] = [];
  let rank = 0;
  let previous: number | null = null;
  for (const [i, row] of scored.entries()) {
    if (previous === null || row.score !== previous) rank = i + 1;
    previous = row.score;
    out.push({ entry: row.entry, rank, score: row.score, of: scored.length });
  }
  return out;
}

/** Where one company placed on every board, for its own results screen. */
export function standingsFor<T>(
  entries: readonly T[],
  target: T,
  scoreOf: (entry: T) => Scores,
): Record<DimensionId, Standing<T> | null> {
  const out = {} as Record<DimensionId, Standing<T> | null>;
  for (const dim of DIMENSIONS) {
    out[dim.id] = rankBy(entries, dim.id, scoreOf).find((s) => s.entry === target) ?? null;
  }
  return out;
}

/**
 * The board a pair did best on.
 *
 * Every finished game should be able to say one true good thing about itself.
 * "You were 3rd of 40 on capital efficiency" is worth reading even when the
 * valuation was unkind, and it is the line that makes somebody play again.
 */
export function bestBoard<T>(
  entries: readonly T[],
  target: T,
  scoreOf: (entry: T) => Scores,
): { dimension: Dimension; standing: Standing<T> } | null {
  const all = standingsFor(entries, target, scoreOf);
  let best: { dimension: Dimension; standing: Standing<T> } | null = null;
  for (const dim of DIMENSIONS) {
    const standing = all[dim.id];
    if (!standing) continue;
    // Percentile rather than rank, so a 2nd of 3 doesn't beat a 5th of 200.
    const share = (standing.of - standing.rank) / Math.max(1, standing.of - 1);
    const bestShare = best ? (best.standing.of - best.standing.rank) / Math.max(1, best.standing.of - 1) : -1;
    if (share > bestShare) best = { dimension: dim, standing };
  }
  return best;
}
