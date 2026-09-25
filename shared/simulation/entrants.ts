/**
 * The companies that turn up because you made it look easy.
 *
 * Until now the cast was fixed: the incumbents a market was written with, the
 * tables that joined, and nobody else for fourteen years. That is the biggest
 * thing missing from a market being alive. In the real world the force that
 * punishes a company for getting comfortable is not usually an existing rival
 * moving — it is somebody new arriving because the margins looked good from
 * outside, and the clearest signal that a market is worth entering is
 * somebody having just entered it and done well.
 *
 * So a market watches itself. When there is demand nobody is serving, when
 * the people already here are charging well above what it costs them, and
 * especially when a newcomer has just proved it can be done, somebody else
 * turns up — and they turn up aimed at whatever just worked.
 *
 * Two rules this is built to.
 *
 *   - **Deterministic.** Seeded from the season and the year, so a season
 *     replays exactly and "where did they come from" has an answer.
 *   - **They start from nothing.** An entrant arrives with no customers and
 *     has to win them like anybody else. Handing them share would take it
 *     from the people playing, which is a punishment for doing well rather
 *     than a consequence of it.
 */
import type { Company, Niche, Segment } from "./types";
import { appealFor } from "./market";
import { between, pick, rng } from "./random";
import { marketScale } from "./world";

/** What a market looks like from outside, this year. */
export interface Attractiveness {
  /** 0–1, how worth entering this looks. */
  score: number;
  /** Demand nobody served last year, as a share of the market. */
  unserved: number;
  /** How far above cost the people here are pricing. */
  margin: number;
  /** The best share any newcomer has taken. Somebody doing well is the loudest signal there is. */
  proof: number;
  /** The segment an entrant would aim at, if one came. */
  aimAt: Segment | null;
}

/**
 * How many entrants a market can hold before it is simply crowded.
 *
 * A market with two companies in it has room; one with a dozen does not, and
 * a season that kept adding them would end as a list rather than a contest.
 * Scaled to the market's size: a £400m market supports more companies than a
 * £2m one, which is the whole reason a small market feels different.
 */
export function roomFor(niche: Niche): number {
  return Math.round(4 + 8 * Math.sqrt(marketScale(niche)));
}

/** What this market looks like to somebody outside it. */
export function attractivenessOf(input: {
  niche: Niche;
  companies: Company[];
  /** Customers who wanted somebody last year and could not be served, by company. */
  turnedAway?: Record<string, number>;
}): Attractiveness {
  const { niche, companies, turnedAway } = input;
  const demand = niche.segments.reduce((sum, s) => sum + s.size, 0) || 1;

  /*
   * Demand nobody served. The clearest invitation there is: people tried to
   * buy and could not, which is a queue somebody else would like to serve.
   */
  const missed = Object.values(turnedAway ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
  const unserved = Math.min(1, missed / demand);

  /*
   * What the people here are taking. A market where everybody prices at twice
   * what it costs them is one an outsider can undercut; a market running thin
   * is not worth the trouble.
   */
  const sellers = companies.filter((c) => Object.values(c.customers ?? {}).some((n) => n > 0));
  const margins = sellers.map((c) => {
    const price = Number(c.price) || 0;
    const cost = Number(c.unitCost) || 0;
    return price > 0 ? Math.max(0, (price - cost) / price) : 0;
  });
  const margin = margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : 0;

  /*
   * And whether anybody has just shown it can be done. A newcomer taking real
   * share is worth more as a signal than any amount of theory about the
   * market, because it is evidence rather than argument.
   */
  const total = companies.reduce((sum, c) => sum + held(c), 0) || 1;
  const proof = Math.max(0, ...companies.filter((c) => c.kind === "player").map((c) => held(c) / total));

  const score = Math.min(1, unserved * 1.4 + Math.max(0, margin - 0.45) * 1.2 + proof * 1.6);

  /*
   * Where they would aim. At whoever is winning, if somebody is — that is
   * what copying a niche means — and otherwise at the biggest segment nobody
   * has a grip on.
   */
  const winner = [...companies].filter((c) => c.kind === "player").sort((a, b) => held(b) - held(a))[0];
  const aimAt = winner && held(winner) > 0
    ? bestHeldSegment(winner, niche)
    : [...niche.segments].sort((a, b) => b.size * (1 - b.loyalty) - a.size * (1 - a.loyalty))[0] ?? null;

  return { score, unserved, margin, proof, aimAt };
}

const held = (c: Company) => Object.values(c.customers ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0);

/** The segment this company is actually winning, which is the one worth copying. */
function bestHeldSegment(company: Company, niche: Niche): Segment | null {
  let best: Segment | null = null;
  let bestShare = 0;
  for (const s of niche.segments) {
    const share = (company.customers?.[s.id] ?? 0) / Math.max(1, s.size);
    if (share > bestShare) { bestShare = share; best = s; }
  }
  return best ?? niche.segments[0] ?? null;
}

const NAMES = [
  "Halberd", "Kestrel", "Marlow", "Pennant", "Quarry", "Rooksley", "Stitch",
  "Tamworth", "Upshot", "Vantage", "Whitcombe", "Yarrow", "Bellwether", "Cardinal",
];

/**
 * Who turns up this year, if anybody.
 *
 * At most one a year on purpose. A market that gains three companies in a
 * year is a gold rush, and a season of gold rushes is noise — one arrival is
 * something a table notices, talks about, and can actually respond to, which
 * is the point of it happening at all.
 */
export function entrantsFor(input: {
  seasonId: string;
  year: number;
  /** How many periods make a year: the three-year wait is three years. */
  periods?: number;
  niche: Niche;
  companies: Company[];
  turnedAway?: Record<string, number>;
}): Company[] {
  const { seasonId, year, niche, companies, periods = 1 } = input;
  /*
   * Not in the first two years. A market needs a year of somebody trading in
   * it before there is anything to have noticed, and a table that meets a new
   * rival in year one has not done anything to attract one.
   */
  if (year < 3 * Math.max(1, periods)) return [];
  if (companies.length >= roomFor(niche)) return [];

  const look = attractivenessOf({ niche, companies, turnedAway: input.turnedAway });
  if (look.score <= 0.25) return [];

  /*
   * A chance rather than a threshold, so an attractive market does not
   * produce an entrant every single year like clockwork. Seeded, so it
   * produces the same one on a replay.
   */
  const seed = `${seasonId}:${year}:entrant`;
  if (rng(seed)() > Math.min(0.7, look.score)) return [];

  const aim = look.aimAt ?? niche.segments[0];
  if (!aim) return [];

  const taken = new Set(companies.map((c) => c.name));
  const name = NAMES.find((n) => !taken.has(`${n} ${suffixFor(niche)}`)) ?? `Newcomer ${year}`;

  /*
   * What they are like. Aimed at the segment that attracted them, so they are
   * genuinely good at the thing that just worked — which is what makes them
   * worth worrying about rather than set dressing.
   */
  const keen = between(`${seed}:keen`, 0.85, 1.15);
  const posture = pick(`${seed}:posture`, aim.priceSensitivity > 0.6 ? ["brawler", "coaster"] : ["innovator", "fortress"]) as Company["posture"];
  const quality = clamp(35 + aim.qualityFocus * 45 * keen);
  const service = clamp(35 + aim.serviceFocus * 45 * keen);

  return [{
    id: `entrant-${year}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}`,
    name: `${name} ${suffixFor(niche)}`,
    kind: "incumbent",
    posture,
    /*
     * Funded like somebody who raised on the strength of what they saw here,
     * and with no customers at all. They have to win them like anybody else.
     */
    cash: Math.round(aim.size * aim.referencePrice * 0.02),
    debt: 0,
    creditLimit: Math.round(aim.size * aim.referencePrice * 0.03),
    reputation: 45,
    quality,
    brand: 6,
    service,
    capacity: Math.round(aim.size * 0.06),
    /*
     * Everywhere the market is. An entrant with a plan for this market has
     * already decided where it sells; the interesting constraint on them is
     * winning customers, not opening an office.
     */
    cities: niche.cities.map((c) => c.id),
    founderShare: 1,
    unitCost: niche.baseUnitCost * (posture === "brawler" ? 0.9 : 1),
    price: Math.round(aim.referencePrice * (posture === "brawler" ? 0.9 : 1.02)),
    customers: {},
    assets: [],
    seats: [],
    scale: companies.find((c) => c.scale !== undefined)?.scale ?? 1,
    /** So a screen can say what they came for. */
    enteredInYear: year,
    enteredAfter: aim.id,
  }];
}

const clamp = (n: number) => Math.max(5, Math.min(95, Math.round(n)));
const suffixFor = (niche: Niche) => niche.voice?.unit === "cover" ? "Kitchens" : "Group";
