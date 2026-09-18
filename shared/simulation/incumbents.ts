/**
 * The companies that already own the market, and how they fight to keep it.
 *
 * Nine tenths of the niche belongs to these four before a single player joins.
 * They are not scenery and they are not a difficulty slider — they are the
 * reason the game has a shape: a new company cannot win by being vaguely good,
 * only by being specifically better than a particular incumbent at something a
 * particular segment cares about.
 *
 * ## What they do under pressure
 *
 * The behaviour the brief asks for, and the behaviour real incumbents show:
 * **they defend what is loyal and let the rest go.** A big company losing
 * share does not fight everywhere. It works out which customers are actually
 * at risk, decides which of those are worth keeping, and quietly abandons the
 * ones who were never going to stay — the price-shoppers, the perpetually
 * unhappy, the ones a rival can have. That looks like weakness for a year and
 * is the reason they are still standing in year ten.
 *
 * So as pressure rises, an incumbent here:
 *
 *   - **spends on service before price.** Keeping a loyal customer is cheaper
 *     than buying back a lost one, and cutting price to hold the fringe just
 *     trains everybody to wait for a discount.
 *   - **concedes the fringe deliberately.** Below a threshold of how much a
 *     segment is worth holding, it stops paying to defend it.
 *   - **gets slower, not stupider.** Size is an advantage in money and a
 *     disadvantage in speed: their quality moves at a fraction of a small
 *     team's pace, which is the opening a player has.
 *
 * ## Why this is not an AI model call
 *
 * A language model asked to "play the incumbent" gives a different answer to
 * the same board twice, cannot be tested, costs money per turn, and fails
 * closed at the worst moment — mid-season, with fifty teams waiting on a tick.
 * The behaviour below is legible, deterministic and free. Nova's place in this
 * feature is explaining what happened to the people it happened to, not
 * deciding it.
 */
import type { Company, Economy, Niche, IncumbentPosture } from "./types";
import { appealFor, saturate } from "./market";

/** How an incumbent's year comes out, before the market is resolved. */
export interface IncumbentMoves {
  price: number;
  quality: number;
  brand: number;
  service: number;
  capacity: number;
  /** Spent this year defending, which comes out of their cash like anyone else's. */
  spend: number;
  /** Segments it has decided to stop paying to defend. Legible so a player can be told. */
  conceded: string[];
  /** One line, in plain words, for the year's report. */
  note: string;
}

const POSTURES: Record<IncumbentPosture, {
  /** How much of a threat it takes before they react at all. */
  patience: number;
  /** How much they will move price to defend, at most. */
  priceFlex: number;
  /** How fast their quality moves, as a fraction of the niche's pace. */
  pace: number;
  /** How readily they give up a segment that is slipping. */
  concedes: number;
  blurb: string;
}> = {
  fortress: { patience: 0.55, priceFlex: 0.04, pace: 0.35, concedes: 0.3, blurb: "would rather lose the fringe than cheapen itself" },
  brawler: { patience: 0.2, priceFlex: 0.18, pace: 0.5, concedes: 0.1, blurb: "follows a newcomer down in price and burns its own margin doing it" },
  coaster: { patience: 0.75, priceFlex: 0.06, pace: 0.15, concedes: 0.55, blurb: "notices late, and only defends what is obviously bleeding" },
  innovator: { patience: 0.35, priceFlex: 0.02, pace: 0.9, concedes: 0.35, blurb: "answers competition with a better product rather than a lower price" },
};

export const postureBlurb = (posture: IncumbentPosture): string => POSTURES[posture].blurb;

/**
 * How much of this incumbent's business is actually under threat.
 *
 * Not "is someone else in the market" — how much better the best rival looks
 * to the customers this company actually holds, weighted by how many of them
 * there are. A rival winning a segment the incumbent barely serves is not a
 * threat to it, and an incumbent that panicked about that would be a worse
 * opponent and a worse teacher.
 */
export function threatLevel(company: Company, rivals: Company[], niche: Niche): number {
  let weighted = 0;
  let total = 0;
  for (const segment of niche.segments) {
    const mine = company.customers[segment.id] ?? 0;
    if (mine <= 0) continue;
    const myAppeal = appealFor(company, segment);
    const best = Math.max(...rivals.map((r) => appealFor(r, segment)), 0);
    weighted += mine * Math.max(0, best - myAppeal);
    total += mine;
  }
  return total > 0 ? weighted / total : 0;
}

/**
 * A year of decisions for one incumbent.
 *
 * The shape of the response matters more than its size: under real pressure
 * they put money into keeping the customers who might still be kept, and take
 * it out of chasing the ones already leaving.
 */
export function incumbentYear(
  company: Company,
  rivals: Company[],
  niche: Niche,
  economy: Economy,
): IncumbentMoves {
  const posture = POSTURES[company.posture ?? "fortress"];
  const threat = threatLevel(company, rivals, niche);
  // Below their patience, nothing has happened worth reacting to.
  const pressure = Math.max(0, threat - posture.patience * 0.3);
  const reacting = pressure > 0.02;

  /*
   * Which segments to keep paying for. A segment is worth defending if it is
   * still mostly theirs and still mostly loyal; one that is both slipping and
   * flighty is conceded, which is what lets a player actually gain a foothold
   * instead of grinding against an opponent that fights everywhere forever.
   */
  const conceded: string[] = [];
  for (const segment of niche.segments) {
    const mine = company.customers[segment.id] ?? 0;
    if (mine <= 0) continue;
    const bestRival = Math.max(...rivals.map((r) => appealFor(r, segment)), 0);
    const mineAppeal = appealFor(company, segment);
    const losing = bestRival > mineAppeal + 0.05;
    const flighty = segment.loyalty < 0.5;
    /*
     * Conceded when it is both slipping and flighty — and only by a posture
     * willing to let go. Deterministic on purpose: the same board must always
     * produce the same year, or a season cannot be replayed, tested, or
     * explained to the people who lived it.
     */
    if (losing && flighty && posture.concedes >= 0.3) conceded.push(segment.id);
  }

  // Service first: cheaper to keep someone than to win them back, and it does
  // not teach the market to wait for a discount.
  const serviceLift = reacting ? pressure * 9 * (1 - posture.priceFlex * 2) : 0.4;
  const service = clamp(company.service + serviceLift - 0.6);

  // Quality moves at the pace of a large company: real, and slow.
  const quality = clamp(company.quality + niche.innovationPace * posture.pace * (reacting ? 2.2 : 1.1));

  // Brand decays without spend; big companies keep topping it up.
  const brand = clamp(company.brand + (reacting ? pressure * 5 : 0.8) - 1.2);

  /*
   * Price is the last lever, and a fortress barely touches it. A discount is
   * the one move that cannot be taken back cheaply: it resets what customers
   * think the thing is worth, and every competitor has to answer it.
   */
  const priceCut = reacting ? Math.min(posture.priceFlex, pressure * posture.priceFlex * 2.5) : 0;
  const price = Math.max(company.unitCost * 1.08, company.price * (1 - priceCut));

  // Capacity follows demand, with the sluggishness of scale.
  const held = Object.values(company.customers).reduce((sum, n) => sum + n, 0);
  const capacity = Math.round(Math.max(held * 1.05, company.capacity * (reacting ? 1.04 : 1.01)));

  const spend =
    serviceLift * 42_000 +
    (quality - company.quality) * 70_000 +
    Math.max(0, brand - company.brand) * 38_000 +
    capacity * 0.6 * economy.costIndex;

  return {
    price, quality, brand, service, capacity, spend, conceded,
    note: buildNote(company, posture.blurb, reacting, pressure, conceded.length, priceCut),
  };
}

function buildNote(company: Company, blurb: string, reacting: boolean, pressure: number, concededCount: number, priceCut: number): string {
  if (!reacting) {
    const conceding = concededCount > 0
      ? ` It stopped defending ${concededCount} segment${concededCount === 1 ? "" : "s"} without appearing to notice they were going.`
      : "";
    return `${company.name} carried on as though nothing had changed — it ${blurb}.${conceding}`;
  }
  const parts: string[] = [];
  if (priceCut > 0.01) parts.push(`cut price ${Math.round(priceCut * 100)}%`);
  parts.push("put money into keeping the customers it already had");
  if (concededCount > 0) parts.push(`stopped defending ${concededCount} segment${concededCount === 1 ? "" : "s"} it judged already lost`);
  return `${company.name} felt the pressure (${Math.round(pressure * 100)}%) and ${parts.join(", ")}.`;
}

const clamp = (n: number): number => Math.max(0, Math.min(100, n));

/**
 * What the market looked like before anyone arrived.
 *
 * Their 90% is not spread evenly: each incumbent is strongest in the segments
 * its posture implies, which is what gives a team something to aim at. An
 * innovator holds the quality-led customers; a coaster is fat on the ones who
 * have not looked around in years and is the obvious first target.
 */
export function seedIncumbents(niche: Niche): Company[] {
  return niche.incumbents.map((seed) => {
    const customers: Record<string, number> = {};
    for (const segment of niche.segments) {
      // Weight their hold by how well the segment suits their posture, then
      // scale to the share the niche says they own.
      const fit =
        seed.posture === "innovator" ? 0.6 + segment.qualityFocus * 0.8
        : seed.posture === "brawler" ? 0.6 + segment.priceSensitivity * 0.8
        : seed.posture === "fortress" ? 0.6 + segment.loyalty * 0.8
        : 0.6 + (1 - segment.loyalty) * 0.5;
      customers[segment.id] = Math.round(segment.size * seed.startingShare * fit);
    }
    const held = Object.values(customers).reduce((sum, n) => sum + n, 0);
    const price = niche.segments[0].referencePrice * seed.priceIndex;

    return {
      id: seed.id,
      name: seed.name,
      kind: "incumbent" as const,
      posture: seed.posture,
      cash: held * price * 0.35,
      debt: 0,
      creditLimit: held * price * 0.5,
      reputation: 55 + seed.quality * 0.25,
      quality: seed.quality,
      brand: seed.brand,
      service: seed.service,
      capacity: Math.round(held * 1.15),
      unitCost: niche.baseUnitCost * (seed.posture === "brawler" ? 0.88 : 1),
      price,
      customers,
      assets: [],
      // Everywhere already, which is most of what makes them incumbents.
      cities: [],
      founderShare: 1,
      seats: [],
    };
  });
}

/** Kept for the tests that check spend scales with pressure rather than jumping. */
export const pressureCurve = (threat: number, patience: number): number => saturate(Math.max(0, threat - patience * 0.3), 0.25);
