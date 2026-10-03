/**
 * How customers choose, and why they mostly don't.
 *
 * This is the part of the simulation that decides whether the game is any
 * good, so it is worth saying plainly what it is built to avoid.
 *
 * **The failure it is built to avoid** is the one every business game has:
 * share follows spend. Cut price, buy customers. Spend on marketing, buy
 * customers. When that is true, the game is an arithmetic exercise, the team
 * with the best spreadsheet wins, and four of the five seats are decoration.
 *
 * So customers here do two things instead.
 *
 * **They stay.** Every customer already belongs to somebody, and each year
 * they ask whether to leave. Loyalty decides how much better the alternative
 * must be before the question even registers. A segment at 0.85 loyalty barely
 * looks up; the same segment after two years of a supplier under-delivering
 * looks up at everything. Incumbents begin holding mostly the former — that is
 * what 90% share is made of, and why it cannot be bought in year one.
 *
 * **They compare on what they care about.** Every segment weighs price,
 * quality, brand and service differently, so there is no universally good
 * offer — only offers that fit a segment. This is what makes "which customers
 * are we for" a real decision rather than a flavour.
 *
 * And the offer itself multiplies. Marketing reach on a product that can't be
 * delivered produces churn rather than customers; quality nobody has heard of
 * produces nothing. One seat pulling hard while the others idle moves very
 * little, which is the whole design.
 */
import { expectationPenalty, expectationsFor, topPriceCeiling } from "./criteria";
import { hasTier, priceFor } from "./responsibilities";
import { featureAppeal } from "./product";
import { DEAL_CHASERS_LEAVE, promoAppeal } from "./world";
import { termsAppeal } from "./treasury";
import type { Company, Economy, Niche, Segment } from "./types";

/** What a company is offering a particular segment this year, after everything interacts. */
export interface Offer {
  companyId: string;
  /** 0–1, how attractive this is to this segment before loyalty is considered. */
  appeal: number;
  /** What they'd pay. */
  price: number;
  /** How many units this company could actually serve, across all segments. */
  capacity: number;
}

/** Diminishing returns, bounded 0–1. Doubling spend never doubles effect — the second million buys less than the first. */
export const saturate = (value: number, half: number): number => (value <= 0 ? 0 : value / (value + half));

/** 0–100 scores read as 0–1 without letting a bad input escape the range. */
const unit = (score: number): number => Math.max(0, Math.min(100, score)) / 100;

/**
 * How much a segment likes what a company is offering.
 *
 * Multiplicative on purpose. An offer is only as good as its weakest part that
 * the segment cares about: a product nobody has heard of scores near zero on
 * brand for a brand-led segment however good it is, and no amount of quality
 * rescues it. Teams learn this in year one and it is the lesson the whole game
 * is built to teach.
 */
/**
 * How long a company keeps a run at the niche it found, and how fast that
 * closes.
 *
 * The advantage of opening a niche is not only that its people want what you
 * built. It is that for a while nobody else is *describing* them as a group —
 * the rivals have a product for the segment, not for the corner of it you
 * went and named. That is a real and temporary thing, and it is the whole
 * reason finding a niche is worth a year of research money.
 *
 * Three years, fading. By the end everybody has noticed and it is an ordinary
 * segment that happens to suit you, which is the honest long-run position.
 */
export const NICHE_HEAD_START_YEARS = 3;
export const NICHE_HEAD_START = 0.45;

/** What a rival's offer is worth to people it is not built for, yet. */
export function headStartAgainst(segment: Segment, company: Company, year?: number, periods = 1): number {
  if (!segment.foundBy?.length || segment.foundBy.includes(company.id)) return 1;
  if (year === undefined || segment.foundInYear === undefined) return 1;
  // `year` counts periods, and the head start is measured in years.
  const since = (year - segment.foundInYear) / Math.max(1, periods);
  if (since >= NICHE_HEAD_START_YEARS) return 1;
  // Strongest the year it is found, gone by the third.
  return 1 - NICHE_HEAD_START * (1 - Math.max(0, since) / NICHE_HEAD_START_YEARS);
}

/**
 * The most a company can charge over what the segment expects, having earned it.
 *
 * Nine per cent, at the very top of every axis the segment cares about.
 *
 * It was eighteen, set while the market could hold half again as many
 * customers as it had people. Once that was fixed the market became finite
 * and margin started mattering more than volume on its own, which tipped the
 * premium play into winning all seven markets. Twelve puts the restaurant
 * chain back in the hands of the regional play and leaves every strategy a
 * market of its own — which is what `balance.test.ts` is there to hold.
 */
export const PRICE_LICENCE_MAX = 0.09;

/**
 * What this company has earned the right to charge.
 *
 * A segment's `referencePrice` is what it expects to pay *for the ordinary
 * thing*. Judging every company against the same number meant a company with
 * quality 90 and brand 90 was punished for charging more than one with
 * quality 30 — so the only thing being good ever bought was volume, and
 * volume is exactly what a company at 85% of its capacity cannot use.
 *
 * Measured, that was the whole reason skill did not matter: money put into
 * the product came back as customers the company could not serve, so spending
 * nothing beat spending well, and the deliberately weak bot outlived the
 * strong one.
 *
 * Weighted by what this segment actually cares about, so a premium licence is
 * earned from the people who are buying on quality and service and not from
 * the ones buying on price. At the middle of the scale it is exactly 1, which
 * leaves an ordinary company exactly where it was.
 */
export function priceLicence(company: Company, segment: Segment): number {
  const weight = segment.qualityFocus + segment.brandFocus + segment.serviceFocus;
  if (weight <= 0) return 1;
  const standing = (unit(company.quality) * segment.qualityFocus
    + unit(company.brand) * segment.brandFocus
    + unit(company.service) * segment.serviceFocus) / weight;
  return 1 + PRICE_LICENCE_MAX * Math.max(0, standing - 0.5) * 2;
}

export function appealFor(company: Company, segment: Segment, year?: number, marketCeiling?: number): number {
  // Price, relative to what this segment thinks is normal. Cheaper is better,
  // but only until it isn't — a price far under the reference reads as cheap
  // rather than good, and quality-led segments distrust it.
  // Each segment judges the price it is offered: its own tier, where there is one.
  const priceRatio = priceFor(company, segment.id) / (segment.referencePrice * priceLicence(company, segment));
  /*
   * Cheaper helps, and only so much. Uncapped, this rewarded undercutting
   * without limit: a company charging a quarter of what a premium segment
   * expected scored 1.24 on price and walked off with the customers a
   * newcomer should have needed years of service to earn. A discount can make
   * an offer attractive; it cannot make it something it isn't.
   *
   * The ceiling sits just above parity because every other axis tops out at
   * exactly 1: quality, brand and service cannot score better than perfect, so
   * a price allowed to score 1.15 was the only way any company could beat a
   * flawless one, and being cheap quietly outranked being good at anything.
   */
  const priceScore = Math.min(1.08, Math.max(0.02, 1 - segment.priceSensitivity * (priceRatio - 1) * 1.6));
  /*
   * And far below the going rate, price stops reading as value and starts
   * reading as a warning — most sharply to the segments buying on quality and
   * on being looked after, who know what those cost to provide.
   */
  const distrust = Math.min(1, (segment.qualityFocus + segment.serviceFocus) / 1.4);
  const suspiciouslyCheap = priceRatio < 0.6 ? Math.max(0.35, 1 - (0.6 - priceRatio) * distrust * 1.5) : 1;

  const qualityScore = unit(company.quality);
  const brandScore = unit(company.brand);
  const serviceScore = unit(company.service);
  // Reputation is not a fifth axis — it is the multiplier on being believed at
  // all. A company nobody trusts gets less credit for everything it claims.
  const trust = 0.55 + 0.45 * unit(company.reputation);

  /*
   * Weighted geometric mean: each factor is raised to how much this segment
   * cares about it, then multiplied. A factor a segment doesn't care about
   * contributes ~1 and drops out; one it cares about deeply can sink the whole
   * offer on its own. That asymmetry is the point — it is what an arithmetic
   * average would smooth away, and smoothing it away is what makes a business
   * game feel like a spreadsheet.
   */
  const weights = [
    { score: priceScore * suspiciouslyCheap, weight: segment.priceSensitivity },
    { score: qualityScore, weight: segment.qualityFocus },
    { score: brandScore, weight: segment.brandFocus },
    { score: serviceScore, weight: segment.serviceFocus },
  ];
  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0) || 1;
  const appeal = weights.reduce(
    (product, w) => product * Math.pow(Math.max(0.02, w.score), w.weight / totalWeight),
    1,
  );

  /*
   * And what the segment expects this year. Below a floor on something it
   * weighs heavily, a segment does not trade the shortfall off against a good
   * price — it rules you out, most of the way. See criteria.ts.
   *
   * Only when the year is known: the incumbents' threat assessment calls this
   * without one, and a defender reading the market should see preference, not
   * this year's rules, which it is not the one being judged by.
   */
  const expected = year === undefined ? 1 : expectationPenalty(company, segment, year, marketCeiling);

  return Math.max(0, Math.min(1, appeal * trust * expected));
}

/** How big a segment is this year, before anyone competes for it. */
export function segmentDemand(segment: Segment, year: number, economy: Economy, periods = 1): number {
  // Growth is annual, so it compounds over the year however many periods make one.
  return Math.round(segment.size * Math.pow(1 + segment.growth, (year - 1) / Math.max(1, periods)) * economy.demand);
}

export interface AllocationResult {
  /** companyId → segmentId → customers held at the end of the year. */
  held: Record<string, Record<string, number>>;
  /** Customers who wanted a company that couldn't serve them, by company. Lost, and they remember. */
  unserved: Record<string, number>;
  /** How much of each segment moved this year — the churn a team can actually see. */
  switched: Record<string, number>;
  /**
   * Who took whom: segment → the company they left → the company that won
   * them. Never includes a company winning back its own leavers. Counted
   * before the winner's capacity is applied — these are people who *chose*
   * the winner, which is the thing a report is explaining.
   */
  flows: Record<string, Record<string, Record<string, number>>>;
  /** New demand each company won in each segment, before capacity. */
  fresh: Record<string, Record<string, number>>;
  /**
   * Customers a shrinking segment took away, by segment and company.
   *
   * A segment is a number of people, and that number moves — the economy
   * turns, the growth rates differ. When it falls below what the companies in
   * it are holding, somebody has to lose customers, and before this nobody
   * did: holdings only ever grew, so by year twelve of a fourteen-year season
   * the companies in dating apps held 9.3 million customers in a market of
   * 6.0 million people.
   *
   * Taken proportionally, because a market getting smaller is not a rival
   * winning and should not read as one.
   */
  shrank: Record<string, Record<string, number>>;
  /** segment → company → customers it won and could not serve. */
  turnedAway: Record<string, Record<string, number>>;
  /**
   * Where those turned-away customers went instead: segment → the company
   * that turned them away → the rival that had room. Whatever fitted nowhere
   * left the market for the year.
   */
  spill: Record<string, Record<string, Record<string, number>>>;
}

/**
 * Who ends the year with whom.
 *
 * Two passes, and the order matters.
 *
 * First, everyone who already belongs to someone decides whether to stay. They
 * only consider leaving if a rival's appeal beats their current supplier's by
 * more than their loyalty tolerates — and even then only a fraction actually
 * move, because people are slow. This is the incumbents' moat, and it is also
 * why a team that wins a segment keeps winning it: the moat becomes theirs.
 *
 * Second, everyone not yet served — new demand, plus the customers who just
 * left someone — is allocated by appeal alone. This is the only pool that
 * moves quickly, and it is where a new entrant lives in its first years.
 *
 * Capacity binds last, and cruelly: a company that wins more customers than it
 * can serve keeps only what it can deliver, and the rest leave with an opinion.
 * That is the COO's seat made real.
 */
/**
 * The share of a market a company can even be considered by.
 *
 * Not a quality measure — a brilliant product in one city out of six is
 * invisible to five sixths of the people who would have chosen it. This is
 * what makes "where do we sell" a decision rather than a detail, and what
 * makes the incumbents hard: they are already everywhere.
 */
/**
 * How hard the company is pushing in each region it sells in.
 *
 * The marketing seat splits its attention across the open regions; a region
 * given more than its natural share is worth up to 40% more there, one given
 * less is worth up to 40% less. Regions left out of the split share what is
 * left in proportion to their size, so a seat that says nothing is spread
 * evenly and nothing changes — the lever is concentration, not free reach.
 */
export function regionWeights(company: Company, niche: Niche): Map<string, number> {
  const open = new Set(Array.isArray(company.cities) ? company.cities : niche.cities.map((c) => c.id));
  const here = niche.cities.filter((c) => open.has(c.id));
  const base = new Map(here.map((c) => [c.id, c.weight * (company.ramp?.[c.id] ?? 1)]));
  const total = [...base.values()].reduce((sum, w) => sum + w, 0);
  const focus = company.regionFocus;
  if (!focus || total <= 0) return base;

  const named = here.filter((c) => Number(focus[c.id]) > 0);
  const namedShare = named.reduce((sum, c) => sum + Math.max(0, Math.min(100, Number(focus[c.id]) || 0)), 0) / 100;
  const restWeight = here.filter((c) => !named.includes(c)).reduce((sum, c) => sum + (base.get(c.id) ?? 0), 0);
  const rest = Math.max(0, 1 - Math.min(1, namedShare));

  const out = new Map<string, number>();
  for (const c of here) {
    const w = base.get(c.id) ?? 0;
    const fair = w / total;
    const attention = named.includes(c)
      ? Math.max(0, Math.min(100, Number(focus[c.id]) || 0)) / 100
      : restWeight > 0 ? rest * (w / restWeight) : 0;
    const pushed = fair > 0 ? Math.max(0.6, Math.min(1.4, 0.6 + 0.8 * (attention / fair))) : 1;
    out.set(c.id, w * pushed);
  }
  return out;
}

/**
 * How hard the company is pushing at each segment.
 *
 * The same shape as the regional split, and the same rule: a segment given
 * more than its share of the marketing is worth up to 25% more, one given
 * less up to 25% less, and a seat that says nothing is spread evenly and
 * nothing changes. Concentration, not free reach — a campaign aimed at
 * everybody is aimed at nobody.
 */
export function segmentPush(company: Company, niche: Niche, segmentId: string): number {
  const focus = company.segmentFocus;
  if (!focus) return 1;
  const total = niche.segments.reduce((sum, s) => sum + s.size, 0) || 1;
  const sizes = new Map(niche.segments.map((s) => [s.id, s.size]));
  const named = niche.segments.filter((s) => Number(focus[s.id]) > 0);
  const namedShare = named.reduce((sum, s) => sum + Math.max(0, Math.min(100, Number(focus[s.id]) || 0)), 0) / 100;
  const restSize = niche.segments.filter((s) => !named.includes(s)).reduce((sum, s) => sum + s.size, 0);
  const rest = Math.max(0, 1 - Math.min(1, namedShare));
  const fair = (sizes.get(segmentId) ?? 0) / total;
  if (fair <= 0) return 1;
  const attention = Number(focus[segmentId]) > 0
    ? Math.max(0, Math.min(100, Number(focus[segmentId]) || 0)) / 100
    : restSize > 0 ? rest * ((sizes.get(segmentId) ?? 0) / restSize) : 0;
  return Math.max(0.75, Math.min(1.25, 0.75 + 0.5 * (attention / fair)));
}

/** The share of the market a company can be considered by, once its regional push is counted. */
/**
 * How much overflow a company can take in, as a multiple of what it won by
 * being chosen in the same segment in the same period.
 *
 * Deliberately loose, and bounded from below by the catalogue rather than
 * chosen for the startup case. The property that does the work holds at any
 * value: a company nobody chose this period wins nothing on merit, so it has
 * no allowance and cannot be handed a market for owning an empty plant.
 *
 * The number only decides the middle, and the five-team catalogue seasons
 * decide the number. Measured on `balance.test.ts`, which asserts that more
 * than one of five teams finishes with a business worth something:
 *
 *     cap 4  ✗ one team in five survived
 *     cap 5  ✗ one team in five survived
 *     cap 6  ✓ (exactly on the boundary)
 *     cap 8  ✓ chosen, for margin
 *
 * Those markets are fed by overflow more than anybody realised, which is worth
 * knowing on its own and is written down in `docs/simulation-backlog.md`. It
 * also means this is a partial fix: at eight, a four-year season of deciding
 * nothing ends down £745 with its customers halved and a company worth a third
 * of a played one — losing, but not painfully.
 */
export const SPILL_TOPUP_MAX = 3;

export function regionalReach(company: Company, niche: Niche): number {
  if (company.kind === "incumbent") return 1;
  const total = [...regionWeights(company, niche).values()].reduce((sum, w) => sum + w, 0);
  return Math.max(0, Math.min(1, total));
}

/**
 * How well the regions a company sells in suit one segment.
 *
 * Regions differ in who lives there (see `City.mix`): a university city is
 * full of people who swipe, a rural one of people who will never leave their
 * supplier. Selling in the places your customers actually are is worth
 * something, and selling nationally is worth exactly the market average —
 * which is what the baseline divides out, so a company everywhere is
 * unaffected however the mixes are written.
 */
export function regionalFit(company: Company, niche: Niche, segmentId: string): number {
  if (company.kind === "incumbent") return 1;
  const weights = regionWeights(company, niche);
  let mine = 0;
  let total = 0;
  for (const c of niche.cities) {
    const w = weights.get(c.id);
    if (!w) continue;
    mine += w * (c.mix?.[segmentId] ?? 1);
    total += w;
  }
  if (total <= 0) return 1;
  const baseline = niche.cities.reduce((sum, c) => sum + c.weight * (c.mix?.[segmentId] ?? 1), 0)
    / (niche.cities.reduce((sum, c) => sum + c.weight, 0) || 1);
  return baseline > 0 ? (mine / total) / baseline : 1;
}

export function reachOf(company: Company, niche: Niche): number {
  if (company.kind === "incumbent") return 1;
  /*
   * A company from before cities existed is treated as selling everywhere.
   *
   * Seasons already running have a world stored without this field, and the
   * alternative to a default is a fortnight of somebody's game silently
   * collapsing to zero reach because a feature shipped underneath them.
   */
  if (!Array.isArray(company.cities)) return 1;
  const open = new Set(company.cities);
  // A region opened this year is reached only as far as the brand reaches (see `firstYearReach`).
  const reach = niche.cities.filter((c) => open.has(c.id)).reduce((sum, c) => sum + c.weight * (company.ramp?.[c.id] ?? 1), 0);
  return Math.max(0, Math.min(1, reach));
}

/**
 * The positioning multiplier for one company in one segment.
 *
 * Kept here rather than folded into the company's stats because it is a
 * statement about who you are for, not a change in what you are: the same
 * product, more appealing to the people it was built for and slightly less to
 * everybody else.
 */
export const POSITIONING_FOR_THEM = 1.18;
export const POSITIONING_FOR_OTHERS = 0.92;

export const positioningFor = (company: Company, segmentId: string): number =>
  !company.positioning ? 1 : company.positioning === segmentId ? POSITIONING_FOR_THEM : POSITIONING_FOR_OTHERS;

/**
 * How much of your business has to be in a segment before declaring for it pays.
 *
 * Positioning is a trade, not a bonus, and it is easy to read it as a bonus:
 * 1.18 to the people you chose and 0.92 to everybody else. Declare for a segment
 * holding a tenth of your customers and you have bought eighteen per cent more
 * appeal to a tenth of the market by giving up eight per cent of the other nine
 * tenths, which is a worse company.
 *
 * Break-even falls out of those two numbers and is not tuned: with a fraction s
 * of demand in the chosen segment, appeal moves by
 * `0.92 + (1.18 - 0.92) * s`, which clears 1 at `0.08 / 0.26`. So a little under
 * a third.
 *
 *     restaurant chain  lunch 60%  ·  delivery 25%  ·  families 15%
 *     construction      homeowners 86%  ·  developers 12%  ·  public 2%
 *
 * Which is to say: in construction there is one segment worth declaring for and
 * in a restaurant chain there is one, and a company that declares for either of
 * the others has made itself worse. `bestSegment` in `bot-play.ts` weighs fit,
 * size and loyalty but not this penalty, so on its own it will happily choose a
 * small segment that suits the company and cost it the market.
 */
export const POSITIONING_BREAK_EVEN =
  (1 - POSITIONING_FOR_OTHERS) / (POSITIONING_FOR_THEM - POSITIONING_FOR_OTHERS);

/**
 * The share of this company's demand that sits in one segment.
 *
 * Its own customers once it has any, and the segment's share of the market
 * before that — a company in year one has nobody, and "nobody" is not evidence
 * that a segment is small.
 */
export function demandShareOf(company: Pick<Company, "customers">, niche: Niche, segmentId: string): number {
  const mine = company.customers ?? {};
  const held = Object.values(mine).reduce((sum, n) => sum + (Number(n) || 0), 0);
  if (held > 0) return (Number(mine[segmentId]) || 0) / held;
  const total = niche.segments.reduce((sum, g) => sum + g.size, 0);
  return total > 0 ? (niche.segments.find((g) => g.id === segmentId)?.size ?? 0) / total : 0;
}

export function allocate(
  companies: Company[],
  niche: Niche,
  year: number,
  economy: Economy,
  /** How many decisions make a year: 1, 4 or 12. `year` counts periods, not years. */
  periods = 1,
): AllocationResult {
  /** One period's share of a year: 1 yearly, 1/4 quarterly, 1/12 monthly. */
  const per = 1 / Math.max(1, periods);
  const held: Record<string, Record<string, number>> = {};
  const unserved: Record<string, number> = {};
  const switched: Record<string, number> = {};
  const flows: AllocationResult["flows"] = {};
  const fresh: AllocationResult["fresh"] = {};
  const shrank: AllocationResult["shrank"] = {};
  const turnedAway: AllocationResult["turnedAway"] = {};
  const spill: AllocationResult["spill"] = {};
  /**
   * What each company won by being chosen this period, per segment.
   *
   * Kept because the overflow below is bounded by it. See `SPILL_TOPUP_MAX`.
   */
  const wonOnMerit: Record<string, Record<string, number>> = {};
  for (const c of companies) { held[c.id] = {}; unserved[c.id] = 0; }

  /** Appeal per segment, kept so the spill pass uses the same preferences the year was decided on. */
  const appealBySegment: Record<string, Record<string, number>> = {};

  /** The last price anybody in this market will pay. See `topPriceCeiling`. */
  const marketCeiling = topPriceCeiling(niche.segments, year);

  for (const segment of niche.segments) {
    flows[segment.id] = {};
    fresh[segment.id] = {};
    const demand = segmentDemand(segment, year, economy, periods);
    const appeal: Record<string, number> = {};
    // Features built for this segment count too (see `product.ts`), and a promotion to the people who watch the price (see `world.ts`).
    for (const c of companies) appeal[c.id] = appealFor(c, segment, year, marketCeiling) * headStartAgainst(segment, c, year, periods) * positioningFor(c, segment.id) * featureAppeal(c, segment.id, year) * promoAppeal(c.promo, segment) * termsAppeal(c) * segmentPush(c, niche, segment.id);
    appealBySegment[segment.id] = appeal;

    const bestAppeal = Math.max(...companies.map((c) => appeal[c.id]), 0.0001);

    /*
     * Pass one: who stays. A customer's tolerance is their segment's loyalty —
     * a rival has to be that much better before staying even comes into
     * question, and then only a slice actually moves in any one year. People
     * change supplier slowly, and a simulation where they don't is a
     * simulation where brands are worthless.
     */
    /*
     * First, the segment itself. If there are fewer people in it than the
     * companies between them are holding, the difference goes — taken from
     * everybody in proportion, because a market getting smaller is not a
     * rival winning.
     */
    shrank[segment.id] = {};
    const heldAtStart = companies.reduce((sum, c) => sum + (c.customers[segment.id] ?? 0), 0);
    const shrinkRatio = heldAtStart > demand && heldAtStart > 0 ? demand / heldAtStart : 1;

    const leaving: Record<string, number> = {};
    let poolForNewcomers = 0;
    /** What is held after the market shrank, before anybody churns. What `open` is measured against. */
    let heldAfterShrink = 0;
    for (const c of companies) {
      const started = c.customers[segment.id] ?? 0;
      if (started <= 0) continue;
      const current = shrinkRatio < 1 ? Math.floor(started * shrinkRatio) : started;
      heldAfterShrink += current;
      if (current < started) shrank[segment.id][c.id] = started - current;

      const mine = appeal[c.id];
      const gap = Math.max(0, bestAppeal - mine);
      /*
       * Above the tolerance, a fraction leaves, scaled by how much better the
       * alternative is. Never everyone at once: a total collapse in one year
       * is not how markets behave, and it takes the game away from a team that
       * could still recover.
       *
       * The ceiling was half a segment a year, which let a strong offer strip
       * an incumbent in three years and made the ninety per cent the brief
       * describes as a wall feel like a formality. A third is still fast — it
       * is the outer limit of what a genuinely better product achieves against
       * an inattentive rival — and it makes the years in between matter.
       */
      /*
       * Scaled to the gaps that are actually reachable.
       *
       * This was `0.06 + loyalty * 0.34`, a span of 0.06 to 0.40 — against
       * appeal gaps that top out near 0.19, because appeal is a weighted
       * geometric mean of scores that cannot exceed one. A segment at loyalty
       * 0.86 therefore had a tolerance of 0.352 against a best-possible gap
       * of 0.192: not loyal, impermeable. Nothing any company could ever do
       * would move one of its customers.
       *
       * It went unnoticed because the open pool counted every leaver twice
       * and left a tenth of each segment unclaimed, so a challenger took
       * those instead and it looked like the door was open. With the
       * arithmetic fixed the wall was the only thing left.
       *
       * At 0.02 to 0.15 a company that is genuinely far better takes about
       * six per cent a year from the most devoted segment in the game and
       * fourteen from the most flighty, which is a door in both.
       */
      const tolerance = 0.06 + segment.loyalty * 0.34;
      const excess = Math.max(0, gap - tolerance);
      /*
       * Annual plans hold some customers in place: they have paid for the year.
       * `retention` is set on the way into the market from the finance seat's
       * discount (see `annualPlans`), and scales down how many would leave.
       */
      const locked = Math.max(0, Math.min(0.9, c.retention ?? 0));
      /*
       * A tier priced past what the segment will pay at all, and loyalty stops
       * protecting you. Without this a loyal, price-blind segment could be
       * charged anything — a premium tier at five times its ceiling kept most
       * of its customers, because loyalty only ever let a third of them go in
       * a year. The further over, the more leave: a few per cent over costs a
       * few per cent, double the ceiling costs most of them.
       */
      /*
       * A tier is judged against what these people will pay; a list price
       * against the last ceiling in the market, for the reason given in
       * `expectationPenalty`. Judging a list price per segment would make
       * every company that prices above its cheapest segment a gouger, which
       * is most of them; judging it against nothing at all — which is what
       * this did — made a price of any size cost nothing, and the customers a
       * company held stopped falling however far it went.
       */
      const askedOf = priceFor(c, segment.id);
      /*
       * Judged against what *these* people will pay, tier or no tier.
       *
       * The appeal side judges a list price against the dearest ceiling in the
       * market, and the reason given there is a good one: who *chooses* you is
       * a market-wide comparison, and marking a company down for pricing above
       * its cheapest segment would mark down most companies.
       *
       * Staying is not choosing. This loop is already per segment, and the
       * customers in it are the ones actually paying the bill — so the
       * question is not "is this dear for the market" but "is this more than
       * the people paying it can afford". Asked the market-wide way, a company
       * could charge eighteen times what its largest segment references and
       * those customers were shielded by the ceiling of a richer segment they
       * were not in. Measured over sixteen quarters: putting the price up 20%
       * every period ended at £274 in a market referencing £15, winning
       * nothing and losing two customers a period, with five times the revenue
       * of holding steady and a company worth ten times the best honest
       * strategy in the game.
       */
      const ceiling = expectationsFor(segment, year).priceCeiling;
      const over = Math.max(0, askedOf / Math.max(1, ceiling) - 1);
      /*
       * And this one is not an annual rate.
       *
       * Every other rate here is a year's worth, divided by `per` so a quarter
       * moves a quarter of it. That is right for shopping around: deciding to
       * leave takes time. It is wrong for a price somebody cannot pay, and the
       * line above already says so — "a few per cent over costs a few per
       * cent, double the ceiling costs most of them" — which is what these
       * numbers mean read as a period, and is not what they did.
       *
       * Scaled, an 85% *annual* ceiling removed only 21% of a segment in a
       * quarter however absurd the price. Customers fell about a fifth a
       * period while a price put up by half each period rose faster, so
       * revenue — customers times price — climbed for ever. Measured over
       * sixteen quarters: raising the price 50% every period ended at £10,389
       * in a market that references £15, with twelve customers left, £124,668
       * of annual revenue and a company worth 79 times the best honest
       * strategy in the game. It was the dominant move by an enormous margin,
       * and it made every other decision decoration.
       *
       * Past what you can afford you do not buy a worse one — you do not buy,
       * and you do not take a year to not buy.
       */
      const unaffordable = Math.min(0.95, over * 0.6) * (1 - locked);
      // Every rate here is an annual one — a third of a segment a year is the
      // outer limit — so a quarter moves a quarter of it. Without this a
      // quarterly season churned its market four times as fast as a yearly one.
      /*
       * And a price that went up on the people already paying it.
       *
       * Everything above judges the price a company is *at*: it lowers appeal,
       * and appeal decides who chooses them. None of it notices the company
       * putting its price up on the customers it already has, which is the
       * event those customers actually experience. A founder took theirs from
       * 19 to 91 and lost nobody — arithmetically defensible while every seat
       * they had was full, and still a company nobody walked out of.
       *
       * Scaled by how much it went up rather than by where it landed, so this
       * does not double-count the level. Loyalty is what it is for: a devoted
       * segment forgives a rise a flighty one leaves over. Capped well below
       * the ordinary churn ceiling because a rise is a reason to shop around,
       * not an eviction.
       */
      const was = Math.max(1, c.priceWas ?? priceFor(c, segment.id));
      const rise = Math.max(0, priceFor(c, segment.id) / was - 1);
      const resented = Math.min(0.2, rise * (1.3 - segment.loyalty) * 0.5);
      const shopping = Math.max(Math.min(0.35, excess * (1.8 - segment.loyalty)), resented) * (1 - locked) * per;
      /*
       * And the annual plans that ended this period, whose holders are now
       * looking at the list price for the first time in a year. That is a rise
       * on people already paying — the thing this loop has always said they
       * leave over — and it is the one cost of a deep discount that does not
       * scale linearly with the discount. See `annualPlans`.
       *
       * Forgiven the same way an ordinary rise is: a devoted segment shrugs at
       * it and a flighty one walks.
       */
      const unwinding = Math.max(0, c.unwind ?? 0) * per * (1.3 - segment.loyalty);
      const leaveRate = Math.min(1, Math.max(shopping, unaffordable) + unwinding);
      /*
       * And last year's deal-chasers: customers a promotion won, who leave
       * faster than the rest once the deal is over.
       */
      const chasers = Math.min(current, Math.max(0, c.dealChasers?.[segment.id] ?? 0)) * DEAL_CHASERS_LEAVE * per;
      leaving[c.id] = Math.min(current, Math.round(current * leaveRate + chasers));

      held[c.id][segment.id] = current - leaving[c.id];
      poolForNewcomers += leaving[c.id];
    }

    /*
     * Two different things, and conflating them broke the finer cadences.
     *
     * `open` is the part of the segment nobody supplies at all. That is a
     * **stock**: it does not care how often the table is asked, and only a
     * period's share of it goes shopping in any one period.
     *
     * `poolForNewcomers` is everybody who just left somebody. That is a
     * **flow**, and it has already been scaled — `leaveRate` is an annual
     * rate divided by `per` above.
     *
     * Each leaver is counted **once**. They used to be counted twice — once
     * because `alreadyHeld` is measured after they go, and once as
     * `poolForNewcomers` — so `alreadyHeld + upForGrabs` exceeded the
     * segment's population by the churn, every period, for ever. Holdings
     * only grew: by year twelve of a fourteen-year season the companies in
     * dating apps held 9.3 million customers in a market of 6.0 million
     * people, and every number downstream of that — revenue, cash, the value
     * a season is ranked on — was inflated by half.
     *
     * Counted once, the arithmetic closes exactly: `alreadyHeld` is what
     * stayed, `open` is what nobody supplies, `poolForNewcomers` is what just
     * came loose, and the three of them are the segment.
     *
     * The old line measured the open pool *after* churn, which quietly folded
     * the leavers into it and then scaled the sum. At a quarterly cadence
     * incumbents shed a quarter as many customers, so the pool shrank on its
     * own and then got quartered again: a company entering the market won
     * 1,970 customers in its first quarter where a yearly season won 60,480 in
     * its first year. Separating them makes a period's opportunity a quarter
     * of a year's, which is the whole of what it should be.
     */
    /*
     * Measured after the shrink, not before it. Taken from `heldAtStart` this
     * handed the contraction straight back to the incumbents: they shed
     * customers, and the pool those customers should have fallen into was
     * still being sized as though they had not.
     */
    const heldBefore = Math.min(heldAfterShrink, demand);
    const alreadyHeld = companies.reduce((sum, c) => sum + (held[c.id][segment.id] ?? 0), 0);
    const open = Math.max(0, demand - heldBefore);
    /*
     * `open` is not scaled, and that is the point.
     *
     * These are people with no supplier at all. They are standing there in
     * period one whether the table meets yearly or monthly, and whoever has
     * the appeal and the room can take them — which is exactly how a new
     * company gets its first customers, because the incumbents win more of
     * this pool than they can serve and the overflow spills to whoever has
     * space. Quartering it stopped that happening at all: a company entering
     * a quarterly market won 1,970 customers in its first quarter against
     * 60,480 in a yearly season's first year, and never caught up.
     *
     * It self-limits without any help: once everybody has taken what they can
     * serve, `open` is empty and stays empty. What refills the market period
     * after period is churn, and churn *is* scaled.
     */
    const newDemand = open;
    /*
     * And it cannot offer more seats than the segment has people.
     *
     * The leavers are deliberately in this pool twice — once because
     * `alreadyHeld` is measured after they go, once as `poolForNewcomers` —
     * which is old and is what lets a report say who took whom. Uncapped it
     * also meant every company's holdings could only grow: by year twelve of
     * a fourteen-year season the companies in dating apps between them held
     * 9.3 million customers in a market of 6.0 million people, and everything
     * downstream of that — revenue, cash, the value a season is ranked on —
     * was inflated by half.
     */
    const upForGrabs = newDemand + poolForNewcomers;
    switched[segment.id] = poolForNewcomers;

    if (upForGrabs <= 0) continue;

    /*
     * Pass two: the open pool, split by appeal. Squared, because choosing is
     * not proportional — being slightly better than everyone wins more than
     * slightly more customers, which is what makes a genuinely better offer
     * worth the years it takes to build.
     *
     * Reach multiplies appeal for new customers only. Whoever you already have
     * stays yours — leaving a city does not repossess its customers — but the
     * people choosing this year can only choose a company that sells where
     * they live.
     */
    const weights = companies.map((c) => ({
      id: c.id,
      // Where a company sells, how hard it is pushing there, and who lives there.
      weight: Math.pow(appeal[c.id], 2) * regionalReach(c, niche) * regionalFit(c, niche, segment.id),
    }));
    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    if (totalWeight <= 0) continue;

    for (const { id, weight } of weights) {
      const share = weight / totalWeight;
      /*
       * Reach is a ceiling, not only a handicap.
       *
       * It already multiplied appeal, which makes a company in one region less
       * attractive than the same company everywhere — but a weight is relative,
       * and appeal is squared, so a good enough company still won customers in
       * regions it had never opened. A founder selling in one city worth 9% of
       * the market held 16.8% of it, which is not a hard market to enter; it is
       * a market where the regions are decoration.
       *
       * The lever says the true thing already: "only builders in a city cluster
       * you have opened can choose you, however good you are." This is that
       * sentence, enforced. What a company cannot reach it does not win, and
       * the customers stay where they were rather than being handed to the
       * next-best company — nobody else reached them either.
       */
      const company = companies.find((c) => c.id === id)!;
      const within = segment.size * regionalReach(company, niche) * regionalFit(company, niche, segment.id);
      const already = held[id][segment.id] ?? 0;
      const room = Math.max(0, Math.round(within) - already);
      const won = Math.min(Math.round(upForGrabs * share), room);
      held[id][segment.id] = already + won;
      /* What this company won by being chosen, which is what bounds the overflow it can absorb below. */
      (wonOnMerit[id] ??= {})[segment.id] = ((wonOnMerit[id] ?? {})[segment.id] ?? 0) + won;

      /*
       * Who these people were, for the year's report. The pool is one pool, so
       * each winner took the same slice of every company's leavers and of the
       * new demand — which is what lets a report say "lost 41,000 to Pairwise"
       * rather than only "lost 41,000".
       */
      let fromRivals = 0;
      for (const [from, left] of Object.entries(leaving)) {
        if (from === id || left <= 0) continue;
        const taken = Math.round(left * share);
        if (taken <= 0) continue;
        ((flows[segment.id][from] ??= {})[id] = taken);
        fromRivals += taken;
      }
      // Whatever is left of the win is new demand, or their own leavers won back.
      const regained = Math.round((leaving[id] ?? 0) * share);
      fresh[segment.id][id] = Math.max(0, won - fromRivals - regained);
    }
  }

  /*
   * Capacity, applied after everything. A company that has won more than it can
   * deliver serves what it can and loses the rest — and those customers are
   * counted, because failing to deliver is a fact a team should be told about
   * rather than a number that quietly never appears.
   */
  const room: Record<string, number> = {};
  for (const c of companies) {
    const total = Object.values(held[c.id]).reduce((sum, n) => sum + n, 0);
    const capacity = Math.max(0, Math.floor(c.capacity));
    if (total <= capacity) {
      room[c.id] = capacity - total;
      continue;
    }

    const ratio = capacity / total;
    unserved[c.id] = total - capacity;
    room[c.id] = 0;
    let kept = 0;
    for (const segmentId of Object.keys(held[c.id])) {
      const before = held[c.id][segmentId];
      held[c.id][segmentId] = Math.floor(before * ratio);
      kept += held[c.id][segmentId];
      (turnedAway[segmentId] ??= {})[c.id] = before - held[c.id][segmentId];
    }
    // Flooring leaves a few seats spare; they are room, not waste.
    room[c.id] = Math.max(0, capacity - kept);
  }

  /*
   * And where the turned-away go: straight to a rival with room.
   *
   * They used to vanish. A company that under-built lost the customers and a
   * little reputation, and nobody else gained anything — so being short of
   * capacity was a missed opportunity rather than a gift to the competition,
   * and the forecast was a number nobody could get badly wrong. Now the
   * people you could not serve go to whoever they would have chosen next,
   * provided that company can take them, and they arrive as its customers.
   *
   * Split by the same appeal the year was decided on, and capped by each
   * rival's remaining room. What fits nowhere leaves the market for the year.
   */
  for (const segment of niche.segments) {
    const rejected = turnedAway[segment.id];
    if (!rejected) continue;
    const appeal = appealBySegment[segment.id] ?? {};
    spill[segment.id] = {};

    /*
     * Pass one: what every company would take, before anybody actually does.
     *
     * The allowance below is shared between everyone who turned somebody away
     * this period, and a company can only spend it once. Applied as the
     * rejections were walked, the first rival processed used the whole
     * allowance up and the last one's customers had nowhere to go — an
     * under-built company's overflow vanished or not depending on where its id
     * happened to sit in an object. So the wanting is worked out first and the
     * allowance shared out in proportion to it.
     */
    const wants: { from: string; to: string; wanted: number }[] = [];
    const askedOf: Record<string, number> = {};
    for (const [from, count] of Object.entries(rejected)) {
      if (count <= 0) continue;
      const takers = companies
        .filter((c) => c.id !== from && room[c.id] > 0)
        /*
         * Weighted by appeal, and by how many of these people the company
         * could actually take.
         *
         * Appeal alone decided the split, and what a taker could not hold was
         * not passed on — it evaporated. That is a rounding detail until two
         * companies want the overflow, and then it is a cliff. Measured: a
         * well-known rival that finished **105 customers short of its own
         * capacity** was handed 96.9% of the claim on 45,695 people its
         * neighbour had turned away, took its 105, and the other 44,000 ceased
         * to exist — while the newcomer beside it with room for 27,373 was
         * left the 3.1% its appeal had earned.
         *
         * Worse, that rival only had room at all because a *stronger*
         * newcomer had taken enough on merit to leave it 105 short. So
         * improving the product moved the newcomer from receiving all of the
         * overflow to a thirtieth of it, and a company that bought a patent
         * and a distribution deal finished the year with fewer customers than
         * the same company owning nothing.
         *
         * Scaling each claim by the share of the rejected it could hold says
         * the true thing — a company with room for a hundred is not a
         * candidate for forty-five thousand — and leaves the rest with the
         * companies that can use it.
         */
        .map((c) => ({
          id: c.id,
          weight: Math.pow(appeal[c.id] ?? 0, 2) * regionalReach(c, niche) * regionalFit(c, niche, segment.id)
            * Math.min(1, Math.max(0, room[c.id] ?? 0) / Math.max(1, count)),
        }))
        .filter((t) => t.weight > 0);
      const total = takers.reduce((sum, t) => sum + t.weight, 0);
      if (total <= 0) continue;
      /*
       * Scaled by how the rival compares with the company that turned them
       * away. Somebody who queued for Ember does not settle for a brand they
       * have never heard of just because it had a free table; they settle for
       * the next thing they would actually have chosen, or they go home.
       */
      const theirs = appeal[from] ?? 0;
      for (const t of takers) {
        const willing = theirs > 0 ? Math.min(1, (appeal[t.id] ?? 0) / theirs) : 1;
        const wanted = Math.round(count * (t.weight / total) * willing);
        if (wanted <= 0) continue;
        wants.push({ from, to: t.id, wanted });
        askedOf[t.id] = (askedOf[t.id] ?? 0) + wanted;
      }
    }

    /**
     * Each taker's slice of what it was asked for, once its allowance applies.
     *
     * The takers are only the companies with room left, so in a market whose
     * incumbents are all full that set is one company — and it took `willing`
     * of everything every rival turned away, however unknown it was. A company
     * that decided *nothing at all* was handed a thousand customers in its
     * first period this way, in segments it had a 0.6% claim on, and ended a
     * four-year season richer than it started. Room was not a bet; it was a
     * customer magnet, and the biggest empty plant won.
     *
     * Bounding the intake by what the company won on merit says the thing that
     * is actually true: overflow tops a business up, it does not make one. A
     * company nobody chose this period has nothing to top up. A company
     * genuinely competing for the segment has a large allowance and never
     * notices this line — which is why the five-team catalogue seasons are
     * where they were, and why narrowing the door itself was not the answer:
     * tried, it killed four teams in five. See `SPILL_TOPUP_MAX`.
     */
    const allowed: Record<string, number> = {};
    for (const [id, asked] of Object.entries(askedOf)) {
      const merit = wonOnMerit[id]?.[segment.id] ?? 0;
      const allowance = Math.round(merit * SPILL_TOPUP_MAX);
      allowed[id] = asked > 0 ? Math.min(1, allowance / asked) : 0;
    }

    for (const { from, to, wanted: asked } of wants) {
      const wanted = Math.round(asked * (allowed[to] ?? 0));
      if (wanted <= 0) continue;
      /*
       * And the same ceiling the allocation above uses.
       *
       * Somebody turned away by a rival is still a person living somewhere.
       * Without this they went to whoever had the most empty room regardless
       * of whether that company sells where they live — which is how a founder
       * open in one region worth 9% of the market ended a period holding 21%
       * of it: the allocation refused to hand them customers they could not
       * reach, and the overflow handed them over anyway.
       */
      const taker = companies.find((c) => c.id === to)!;
      const within = Math.round(segment.size * regionalReach(taker, niche) * regionalFit(taker, niche, segment.id));
      const reachRoom = Math.max(0, within - (held[to][segment.id] ?? 0));
      const taken = Math.min(wanted, room[to], reachRoom);
      if (taken <= 0) continue;
      room[to] -= taken;
      held[to][segment.id] = (held[to][segment.id] ?? 0) + taken;
      (spill[segment.id][from] ??= {})[to] = ((spill[segment.id][from] ?? {})[to] ?? 0) + taken;
    }
  }

  return { held, unserved, switched, flows, fresh, shrank, turnedAway, spill };
}

/** Everyone's share of the whole niche, 0–1, for the table everyone reads first. */
export function marketShares(held: Record<string, Record<string, number>>): Record<string, number> {
  const totals: Record<string, number> = {};
  let grand = 0;
  for (const [companyId, bySegment] of Object.entries(held)) {
    const total = Object.values(bySegment).reduce((sum, n) => sum + n, 0);
    totals[companyId] = total;
    grand += total;
  }
  if (grand <= 0) return Object.fromEntries(Object.keys(totals).map((id) => [id, 0]));
  return Object.fromEntries(Object.entries(totals).map(([id, n]) => [id, n / grand]));
}

/**
 * A threshold in the money of the market being played.
 *
 * Every "what a point of brand costs" number in the engine is absolute:
 * £220,000 buys sixteen points, £180,000 buys nine. Those are right for the
 * seven markets written by hand, which are all worth about £400m a year. In a
 * market worth £1.65m — which is what Nova correctly writes when asked about
 * scheduling software for small veterinary practices — £220,000 is thirteen
 * per cent of the entire market, so every lever costs more than the company
 * could ever earn and none of them do anything.
 *
 * Scaling the threshold keeps the *decision* identical: spend a tenth of what
 * the market is worth and get the same effect you would in any other market.
 * The seven are scale one, so nothing about them changes at all.
 */
export const atScale = (amount: number, scale = 1): number =>
  amount * Math.max(0.001, scale);

/**
 * The pace this company gets better at its work, which is its customers' pace.
 *
 * `niche.innovationPace` is one number for a whole market, and that is right
 * wherever the trade is the trade. Where a market's segments are different
 * businesses wearing one name — fitting out houses and tendering for public
 * infrastructure are both "construction" — the pace belongs to the segment the
 * company declared itself for. See `Segment.innovationPace`.
 *
 * Falls back to the market's own pace, so a company that has declared no
 * positioning, or declared one for a segment that does not override it, gets
 * exactly what it got before.
 */
export const paceFor = (
  company: Pick<Company, "positioning">,
  niche: Pick<Niche, "innovationPace" | "segments">,
): number => {
  const aimed = company.positioning
    ? niche.segments.find((s) => s.id === company.positioning)
    : undefined;
  return aimed?.innovationPace ?? niche.innovationPace;
};

/**
 * Everyone's share of the regions they actually sell in, 0–1.
 *
 * `marketShares` answers "how much of this market is yours", and on a world map
 * that question has an honest answer nobody can use: a company trading well in
 * Leeds and nowhere else holds about two tenths of one per cent of a global
 * market, and the standings said so. A team winning its own continent read as a
 * rounding error, so the number everybody looks at first was the number least
 * worth looking at.
 *
 * This is the other reading, and both belong on the table — one says how big a
 * business it is, the other says how well it is being run.
 *
 * The denominator is the market inside the company's own footprint: everybody's
 * customers, scaled by how far this company reaches. That is an approximation —
 * it assumes the regions a company trades in hold their weighted share of the
 * market's customers, because `allocate` reports who was won per segment and
 * not per region — and it has the property that matters: at full reach it is
 * `reachOf` of one, so this is *exactly* `marketShares` for any company selling
 * everywhere, and the two columns agree the moment a company has finished
 * expanding. It is only ever the local reading that differs, which is the only
 * place the old number was misleading.
 */
export function sharesWhereSold(
  held: Record<string, Record<string, number>>,
  companies: Company[],
  niche: Niche,
): Record<string, number> {
  const totals: Record<string, number> = {};
  let everyone = 0;
  for (const [companyId, bySegment] of Object.entries(held)) {
    const mine = Object.values(bySegment).reduce((sum, n) => sum + n, 0);
    totals[companyId] = mine;
    everyone += mine;
  }
  const out: Record<string, number> = {};
  for (const id of Object.keys(totals)) {
    const company = companies.find((c) => c.id === id);
    /*
     * A floor on the footprint rather than a guard against dividing by zero: a
     * company part-way through opening its first region has a `ramp` well under
     * one, and without this its share of "the market it sells in" climbs towards
     * infinity as the denominator vanishes.
     */
    const footprint = company ? Math.max(0.01, reachOf(company, niche)) : 1;
    const within = everyone * footprint;
    out[id] = within > 0 ? Math.min(1, totals[id] / within) : 0;
  }
  return out;
}
