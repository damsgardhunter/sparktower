/**
 * What a segment actually weighs when it chooses.
 *
 * ## The gap this closes
 *
 * Every segment already carried four numbers — how much it cares about price,
 * quality, brand and service — and the engine has always used them: they are
 * the exponents in `appealFor`'s weighted geometric mean. But nobody could see
 * them. A player was shown a segment's reference price and whether it was
 * "hard to take", and from that was expected to work out that the swipers
 * choose almost entirely on price and brand while the long-haulers barely look
 * at price at all.
 *
 * That made "who the company is for" a flag rather than a bet. Positioning a
 * dating app at the long-haulers is a sound strategy only if you know what
 * the long-haulers want and how far you are from giving it to them — and
 * neither was on any screen.
 *
 * ## Two things, both shown
 *
 * **Weights**: the four focuses, normalised to percentages that sum to a
 * hundred. The same numbers the engine uses, so the screen can never describe
 * a segment the maths does not.
 *
 * **Expectations**: a floor on the things a segment weighs heavily, which
 * rises every year. Below it the segment does not merely like you less — it
 * marks you down sharply, because that is how buyers with a criterion behave:
 * a long-hauler does not trade a quality of 40 against a low price, they rule
 * the app out. And a ceiling on price, above which a segment stops listening.
 *
 * Expectations rise because markets do. A product that was good enough in year
 * one is ordinary in year six, and a team that stops investing is not standing
 * still, it is being overtaken by the market's idea of normal. That is the
 * pressure that makes a fourteen-year season more than one good decision
 * repeated.
 *
 * Derived from the segment rather than written into each niche, so there is
 * one rule and it cannot drift between markets: a segment that weighs quality
 * heavily expects more of it, a segment that weighs it lightly expects nothing
 * in particular.
 */
import type { Company, Segment } from "./types";

export type Axis = "price" | "quality" | "brand" | "service";

export interface Weights {
  price: number;
  quality: number;
  brand: number;
  service: number;
}

/** The segment's four focuses as shares of a hundred. Rounded, and forced to sum to exactly 100. */
export function weightsOf(segment: Segment): Weights {
  const raw: Weights = {
    price: segment.priceSensitivity,
    quality: segment.qualityFocus,
    brand: segment.brandFocus,
    service: segment.serviceFocus,
  };
  const total = raw.price + raw.quality + raw.brand + raw.service || 1;
  const pct = (Object.keys(raw) as Axis[]).map((k) => ({ k, v: (raw[k] / total) * 100 }));
  const rounded = pct.map((p) => ({ ...p, r: Math.floor(p.v) }));
  // Largest remainders take the leftover points, so the four always read as 100.
  let left = 100 - rounded.reduce((sum, p) => sum + p.r, 0);
  for (const p of [...rounded].sort((a, b) => (b.v - b.r) - (a.v - a.r))) {
    if (left <= 0) break;
    p.r += 1;
    left -= 1;
  }
  return Object.fromEntries(rounded.map((p) => [p.k, p.r])) as unknown as Weights;
}

/**
 * Only criteria a segment weighs at least this much come with a floor.
 *
 * A segment that barely notices service has no service standard: it will not
 * rule a company out for something it does not care about, and a screen that
 * listed a floor for every axis would bury the two that matter.
 */
export const FLOOR_FROM = 0.55;

/** How far a floor rises each year. A point and a half: slow enough to plan for, fast enough to punish coasting. */
export const DRIFT_PER_YEAR = 1.5;

export interface Expectation {
  axis: "quality" | "service";
  /** The minimum, 0–100, this year. */
  atLeast: number;
}

export interface Expectations {
  floors: Expectation[];
  /** The most this segment will pay before it stops listening. */
  priceCeiling: number;
}

export function expectationsFor(segment: Segment, year: number): Expectations {
  const drift = DRIFT_PER_YEAR * Math.max(0, year - 1);
  const floors: Expectation[] = [];
  const add = (axis: Expectation["axis"], focus: number) => {
    if (focus < FLOOR_FROM) return;
    floors.push({ axis, atLeast: Math.min(90, Math.round(15 + focus * 50 + drift)) });
  };
  /*
   * Quality and service, and never brand.
   *
   * A floor is a standard the product has to meet, and awareness is not a
   * property of the product. The first version set one on brand too, and it
   * shut the door this whole game is built around: the swipers — the flighty,
   * winnable segment every newcomer comes in through — "expected" a brand of
   * 46 from companies that start at 8, and every new team spent its first
   * three years penalised by half in the one segment it could take. Customers
   * weigh how well known you are. They do not refuse to consider you for
   * being new, or nobody would ever be new.
   */
  add("quality", segment.qualityFocus);
  add("service", segment.serviceFocus);

  /*
   * The price at which this segment's liking for your price has halved — the
   * point where, in plain terms, it stops listening.
   *
   * Read straight off `appealFor`'s price curve rather than invented beside
   * it. The first version set its own ceiling and penalised crossing it on
   * top of what the price curve already did, so a company priced above what
   * swipers pay was marked down twice for the same pound, and every strategy
   * that aimed at the dear end of a market went bankrupt in year two. The
   * ceiling is a description of the maths, not a second tax on it.
   *
   * Held steady across the season: prices in these markets do not inflate
   * with the expectation of quality, which is exactly what squeezes a team
   * trying to buy its way over a rising floor.
   */
  const priceCeiling = Math.round(segment.referencePrice * (1 + 0.3125 / Math.max(0.05, segment.priceSensitivity)));
  return { floors, priceCeiling };
}

export interface Shortfall {
  axis: Axis;
  /** How far short: points below a floor, or currency above the ceiling. */
  by: number;
}

/** Where a company falls short of what this segment expects this year. */
export function shortfalls(company: Pick<Company, "quality" | "brand" | "service" | "price">, segment: Segment, year: number): Shortfall[] {
  const { floors, priceCeiling } = expectationsFor(segment, year);
  const out: Shortfall[] = [];
  for (const f of floors) {
    const have = company[f.axis];
    if (have < f.atLeast) out.push({ axis: f.axis, by: Math.round((f.atLeast - have) * 10) / 10 });
  }
  if (company.price > priceCeiling) out.push({ axis: "price", by: Math.round(company.price - priceCeiling) });
  return out;
}

/**
 * What falling short costs, as a multiplier on appeal.
 *
 * Each missed floor takes off two per cent a point, scaled by how much the
 * segment weighs that axis, down to a floor of its own: a company can be ruled
 * out, but not driven to zero, because a segment where nobody meets the
 * standard still buys from somebody.
 */
export function expectationPenalty(company: Pick<Company, "quality" | "brand" | "service" | "price">, segment: Segment, year: number): number {
  const weights = { quality: segment.qualityFocus, service: segment.serviceFocus };
  let factor = 1;
  for (const s of shortfalls(company, segment, year)) {
    // Price over the ceiling is already priced in by the price curve itself.
    if (s.axis === "price") continue;
    factor *= Math.max(0.45, 1 - s.by * 0.02 * weights[s.axis as "quality" | "service"]);
  }
  return Math.max(0.3, factor);
}

const AXIS_WORD: Record<Axis, string> = { price: "price", quality: "quality", brand: "brand", service: "service" };

/**
 * A segment's taste in one sentence, for the screens.
 *
 * Leads with what dominates, and names what does not register at all — "barely
 * notice price" is the single most useful thing to know about a premium
 * segment, and a list of four percentages makes the reader find it.
 */
export function describeWeights(segment: Segment): string {
  const w = weightsOf(segment);
  const order = (Object.keys(w) as Axis[]).sort((a, b) => w[b] - w[a]);
  const [first, second] = order;
  const last = order[order.length - 1];
  const lead = w[first] >= 40
    ? `Choose mostly on ${AXIS_WORD[first]} (${w[first]}%)`
    : `Weigh ${AXIS_WORD[first]} (${w[first]}%) and ${AXIS_WORD[second]} (${w[second]}%) above all`;
  const tail = w[last] <= 15 ? `, and barely notice ${AXIS_WORD[last]}` : "";
  return `${lead}${tail}.`;
}
