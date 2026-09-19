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
import { expectationPenalty, expectationsFor } from "./criteria";
import { hasTier, priceFor } from "./responsibilities";
import { featureAppeal } from "./product";
import { DEAL_CHASERS_LEAVE, promoAppeal } from "./world";
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
export function appealFor(company: Company, segment: Segment, year?: number): number {
  // Price, relative to what this segment thinks is normal. Cheaper is better,
  // but only until it isn't — a price far under the reference reads as cheap
  // rather than good, and quality-led segments distrust it.
  // Each segment judges the price it is offered: its own tier, where there is one.
  const priceRatio = priceFor(company, segment.id) / segment.referencePrice;
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
  const expected = year === undefined ? 1 : expectationPenalty(company, segment, year);

  return Math.max(0, Math.min(1, appeal * trust * expected));
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
  /**
   * Who took whom: segment → the company they left → the company that won
   * them. Never includes a company winning back its own leavers. Counted
   * before the winner's capacity is applied — these are people who *chose*
   * the winner, which is the thing a report is explaining.
   */
  flows: Record<string, Record<string, Record<string, number>>>;
  /** New demand each company won in each segment, before capacity. */
  fresh: Record<string, Record<string, number>>;
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
  const flows: AllocationResult["flows"] = {};
  const fresh: AllocationResult["fresh"] = {};
  const turnedAway: AllocationResult["turnedAway"] = {};
  const spill: AllocationResult["spill"] = {};
  for (const c of companies) { held[c.id] = {}; unserved[c.id] = 0; }

  /** Appeal per segment, kept so the spill pass uses the same preferences the year was decided on. */
  const appealBySegment: Record<string, Record<string, number>> = {};

  for (const segment of niche.segments) {
    flows[segment.id] = {};
    fresh[segment.id] = {};
    const demand = segmentDemand(segment, year, economy);
    const appeal: Record<string, number> = {};
    // Features built for this segment count too (see `product.ts`), and a promotion to the people who watch the price (see `world.ts`).
    for (const c of companies) appeal[c.id] = appealFor(c, segment, year) * positioningFor(c, segment.id) * featureAppeal(c, segment.id, year) * promoAppeal(c.promo, segment);
    appealBySegment[segment.id] = appeal;

    const bestAppeal = Math.max(...companies.map((c) => appeal[c.id]), 0.0001);

    /*
     * Pass one: who stays. A customer's tolerance is their segment's loyalty —
     * a rival has to be that much better before staying even comes into
     * question, and then only a slice actually moves in any one year. People
     * change supplier slowly, and a simulation where they don't is a
     * simulation where brands are worthless.
     */
    const leaving: Record<string, number> = {};
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
      // Tiers only, for the reason given in `expectationPenalty`.
      const ceiling = expectationsFor(segment, year).priceCeiling;
      const over = hasTier(c, segment.id) ? Math.max(0, priceFor(c, segment.id) / Math.max(1, ceiling) - 1) : 0;
      const gouged = Math.min(0.85, over * 0.6);
      const leaveRate = Math.max(Math.min(0.35, excess * (1.8 - segment.loyalty)), gouged) * (1 - locked);
      /*
       * And last year's deal-chasers: customers a promotion won, who leave
       * faster than the rest once the deal is over.
       */
      const chasers = Math.min(current, Math.max(0, c.dealChasers?.[segment.id] ?? 0)) * DEAL_CHASERS_LEAVE;
      leaving[c.id] = Math.min(current, Math.round(current * leaveRate + chasers));

      held[c.id][segment.id] = current - leaving[c.id];
      poolForNewcomers += leaving[c.id];
    }

    const alreadyHeld = companies.reduce((sum, c) => sum + (held[c.id][segment.id] ?? 0), 0);
    // New demand this year, plus everyone who just left somebody.
    const newDemand = Math.max(0, demand - alreadyHeld);
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
      weight: Math.pow(appeal[c.id], 2) * reachOf(c, niche),
    }));
    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    if (totalWeight <= 0) continue;

    for (const { id, weight } of weights) {
      const share = weight / totalWeight;
      const won = Math.round(upForGrabs * share);
      held[id][segment.id] = (held[id][segment.id] ?? 0) + won;

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
    const capacity = Math.max(0, c.capacity);
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

    for (const [from, count] of Object.entries(rejected)) {
      if (count <= 0) continue;
      const takers = companies
        .filter((c) => c.id !== from && room[c.id] > 0)
        .map((c) => ({ id: c.id, weight: Math.pow(appeal[c.id] ?? 0, 2) * reachOf(c, niche) }))
        .filter((t) => t.weight > 0);
      const total = takers.reduce((sum, t) => sum + t.weight, 0);
      if (total <= 0) continue;

      /*
       * Scaled by how the rival compares with the company that turned them
       * away. Somebody who queued for Ember does not settle for a brand they
       * have never heard of just because it had a free table; they settle for
       * the next thing they would actually have chosen, or they go home. The
       * first version of this handed every overflow to whoever had room, and an
       * idle team with a large empty warehouse became profitable in year three
       * for having done nothing.
       */
      const theirs = appeal[from] ?? 0;
      for (const t of takers) {
        const willing = theirs > 0 ? Math.min(1, (appeal[t.id] ?? 0) / theirs) : 1;
        const wanted = Math.round(count * (t.weight / total) * willing);
        const taken = Math.min(wanted, room[t.id]);
        if (taken <= 0) continue;
        room[t.id] -= taken;
        held[t.id][segment.id] = (held[t.id][segment.id] ?? 0) + taken;
        (spill[segment.id][from] ??= {})[t.id] = taken;
      }
    }
  }

  return { held, unserved, switched, flows, fresh, turnedAway, spill };
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
