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
export function appealFor(company: Company, segment: Segment): number {
  // Price, relative to what this segment thinks is normal. Cheaper is better,
  // but only until it isn't — a price far under the reference reads as cheap
  // rather than good, and quality-led segments distrust it.
  const priceRatio = company.price / segment.referencePrice;
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

  return Math.max(0, Math.min(1, appeal * trust));
}

/** How big a segment is this year, before anyone competes for it. */
export function segmentDemand(segment: Segment, year: number, economy: Economy): number {
  return Math.round(segment.size * Math.pow(1 + segment.growth, year - 1) * economy.demand);
}

export interface AllocationResult {
  /** companyId → segmentId → customers held at the end of the year. */
  held: Record<string, Record<string, number>>;
  /** Customers who wanted a company that couldn't serve them, by company. Lost, and they remember. */
  unserved: Record<string, number>;
  /** How much of each segment moved this year — the churn a team can actually see. */
  switched: Record<string, number>;
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
  const reach = niche.cities.filter((c) => open.has(c.id)).reduce((sum, c) => sum + c.weight, 0);
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
export const positioningFor = (company: Company, segmentId: string): number =>
  !company.positioning ? 1 : company.positioning === segmentId ? 1.18 : 0.92;

export function allocate(
  companies: Company[],
  niche: Niche,
  year: number,
  economy: Economy,
): AllocationResult {
  const held: Record<string, Record<string, number>> = {};
  const unserved: Record<string, number> = {};
  const switched: Record<string, number> = {};
  for (const c of companies) { held[c.id] = {}; unserved[c.id] = 0; }

  // What each company can still deliver, spent down as customers are assigned.
  const capacityLeft: Record<string, number> = Object.fromEntries(companies.map((c) => [c.id, c.capacity]));

  for (const segment of niche.segments) {
    const demand = segmentDemand(segment, year, economy);
    const appeal: Record<string, number> = {};
    for (const c of companies) appeal[c.id] = appealFor(c, segment) * positioningFor(c, segment.id);

    const bestAppeal = Math.max(...companies.map((c) => appeal[c.id]), 0.0001);

    /*
     * Pass one: who stays. A customer's tolerance is their segment's loyalty —
     * a rival has to be that much better before staying even comes into
     * question, and then only a slice actually moves in any one year. People
     * change supplier slowly, and a simulation where they don't is a
     * simulation where brands are worthless.
     */
    let poolForNewcomers = 0;
    for (const c of companies) {
      const current = c.customers[segment.id] ?? 0;
      if (current <= 0) continue;

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
      const tolerance = 0.06 + segment.loyalty * 0.34;
      const excess = Math.max(0, gap - tolerance);
      const leaveRate = Math.min(0.35, excess * (1.8 - segment.loyalty));
      const leaving = Math.round(current * leaveRate);

      held[c.id][segment.id] = current - leaving;
      poolForNewcomers += leaving;
    }

    const alreadyHeld = companies.reduce((sum, c) => sum + (held[c.id][segment.id] ?? 0), 0);
    // New demand this year, plus everyone who just left somebody.
    const upForGrabs = Math.max(0, demand - alreadyHeld) + poolForNewcomers;
    switched[segment.id] = poolForNewcomers;

    if (upForGrabs <= 0) continue;

    /*
     * Pass two: the open pool, split by appeal. Squared, because choosing is
     * not proportional — being slightly better than everyone wins more than
     * slightly more customers, which is what makes a genuinely better offer
     * worth the years it takes to build.
     */
    /*
     * Reach multiplies appeal for new customers only. Whoever you already have
     * stays yours — leaving a city does not repossess its customers — but the
     * people choosing this year can only choose a company that sells where
     * they live.
     */
    const weights = companies.map((c) => ({
      id: c.id,
      weight: Math.pow(appeal[c.id], 2) * reachOf(c, niche),
    }));
    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    if (totalWeight <= 0) continue;

    for (const { id, weight } of weights) {
      const won = Math.round(upForGrabs * (weight / totalWeight));
      held[id][segment.id] = (held[id][segment.id] ?? 0) + won;
    }
  }

  /*
   * Capacity, applied after everything. A company that has won more than it can
   * deliver serves what it can and loses the rest — and those customers are
   * counted, because failing to deliver is a fact a team should be told about
   * rather than a number that quietly never appears.
   */
  for (const c of companies) {
    const total = Object.values(held[c.id]).reduce((sum, n) => sum + n, 0);
    const room = capacityLeft[c.id];
    if (total <= room) continue;

    const ratio = room / total;
    unserved[c.id] = total - room;
    for (const segmentId of Object.keys(held[c.id])) {
      held[c.id][segmentId] = Math.floor(held[c.id][segmentId] * ratio);
    }
  }

  return { held, unserved, switched };
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
