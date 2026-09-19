/**
 * Ten Years From Now — the shapes and the few pure rules the phone needs.
 *
 * Metro can't resolve the web app's `@shared` alias, so anything the screens
 * compute locally has to live here rather than being imported from
 * `shared/sprints/*`. That is a duplicate, and duplicates rot — so two things
 * keep it honest:
 *
 *   - **The catalogues are not duplicated.** The card decks and the fourteen
 *     ways to spend a million come from `GET /api/games/rules` and the deck
 *     endpoint, not from a copy pasted in here. Those are the parts most
 *     likely to change, and a stale copy of them would silently show a phone a
 *     different game from the one the server is scoring.
 *   - **What is duplicated is tested against the original.** See
 *     `test/unit/mobile-game-mirror.test.ts`, which fails if these drift from
 *     `shared/sprints/*`.
 *
 * So what's here is only the arithmetic: money, and the budget maths a screen
 * needs between keystrokes without asking the server.
 */

/** What the pair are given in round five. */
export const BUDGET_TOTAL = 1_000_000;

export type Allocation = Record<string, number>;

/** One thing money can go into. Sent by the server; shaped here. */
export interface SpendOption {
  id: string;
  label: string;
  detail: string;
  consequence: string;
  group: "Hiring" | "Product" | "Getting customers" | "Keeping it standing";
  step: number;
  minimumUseful: number;
}

export interface DeckCard {
  id: string;
  label: string;
  detail: string;
  consequence: string;
  group: string;
}

export const ROUNDS = ["idea", "customer", "model", "product", "spend", "verdict"] as const;
export type Round = (typeof ROUNDS)[number];

export const PLAYABLE_ROUNDS: string[] = ROUNDS.filter((r) => r !== "verdict");

export const ROUND_COPY: Record<string, { title: string; blurb: string }> = {
  idea: { title: "The idea", blurb: "Bring one each. Pick one together." },
  customer: { title: "The customer", blurb: "Who is this actually for? Pick from the deck, or invent someone." },
  model: { title: "The money", blurb: "How does it make any? Argue it out, then commit." },
  product: {
    title: "The product",
    blurb: "What does it do better than what already exists — and which of those actually matter?",
  },
  spend: { title: "The first million", blurb: "You've been lent a million dollars and a year. Spend it." },
  verdict: { title: "Ten years from now", blurb: "What it's worth, what it could have been worth, and where you two rank." },
};

/** Up to ten advantages, at most three of them core. */
export const MAX_CLAIMS = 10;
export const MAX_CORE_CLAIMS = 3;
export const MAX_CUSTOM_CARDS = 4;

export interface Claim {
  text: string;
  core: boolean;
}

/** Scores run 0–1000 everywhere in this game. */
export const SCORE_MAX = 1000;

export const allocated = (a: Allocation): number =>
  Object.values(a).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0);

export const unallocated = (a: Allocation): number => BUDGET_TOTAL - allocated(a);

export interface BudgetSummary {
  total: number;
  byGroup: { group: string; amount: number }[];
}

/** What a phone needs to draw the bar. The server does the authoritative sum. */
export function summariseBudget(a: Allocation, options: readonly SpendOption[]): BudgetSummary {
  const groups = new Map<string, number>();
  let total = 0;
  for (const option of options) {
    const amount = Math.max(0, Number(a[option.id]) || 0);
    total += amount;
    groups.set(option.group, (groups.get(option.group) ?? 0) + amount);
  }
  return {
    total,
    byGroup: [...groups.entries()].map(([group, amount]) => ({ group, amount })),
  };
}

/**
 * Money, the way the screens write it.
 *
 * Mirrors `money()` in shared/sprints/budget.ts exactly — a phone showing
 * "$2.4B" where the web shows "$2,400,000,000" on the same leaderboard is the
 * kind of difference people screenshot.
 */
export function money(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000) return `$${(n / 1_000_000_000_000).toFixed(abs >= 10_000_000_000_000 ? 0 : 1)}T`;
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

/** What a score is called, so a screen never shows a bare number. */
export function scoreBand(score: number): string {
  if (score >= 900) return "Exceptional";
  if (score >= 775) return "Strong";
  if (score >= 625) return "Promising";
  if (score >= 450) return "Workable";
  if (score >= 275) return "Shaky";
  return "Struggling";
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export function clockText(seconds: number | null): string {
  if (seconds === null) return "—";
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** What the screen says about how a round ended. */
export const SETTLE_COPY: Record<string, string> = {
  agreed: "You both went for it.",
  // Fires after either merge round, so it must be true of a list of product
  // claims as well as of two budgets being averaged.
  merged: "Both of yours went in — the two were combined.",
  coin: "You couldn't agree, so the coin decided.",
  unopposed: "Only one of you answered, so that's what stands.",
  nobody: "Neither of you answered in time.",
};
