/**
 * The decisions a person makes that a warm body never does.
 *
 * Bots file the obvious number: last year's, nudged. That is right for a seat
 * nobody took, and it is why a table learning to enter a market watches every
 * rival shrink instead of watching somebody do it. Three levers decide whether
 * a newcomer gets in, and until now no bot touched any of them deliberately.
 *
 *   - **Who to aim at.** A newcomer is unknown. It should sell to the people
 *     who care least about that, not to the biggest segment.
 *   - **What to charge.** Not a discount picked out of the air: the price that
 *     earns most, which is a different number for every segment and moves as
 *     the company gets better.
 *   - **Where to sell.** One region you are winning beats four you are
 *     invisible in.
 *
 * Everything here is arithmetic over the same `appealFor` the engine uses to
 * decide who wins a customer, so a bot reasons about the market the way the
 * market actually works rather than by a rule of thumb somebody wrote down.
 * Pure, and measured one lever at a time — the obvious version of two of these
 * made the game measurably worse, which is recorded in the backlog.
 */
import type { City, Company, Niche, Segment } from "./types";
import { appealFor } from "./market";

/**
 * How well this company suits a segment, ignoring price.
 *
 * The weighted geometric mean the engine uses, with price left out: what is
 * left is whether the things this segment cares about are the things this
 * company happens to have. A newcomer's weak axis is brand — it opens at 8
 * against a quality of 38 and a service of 40 — so this scores highest on the
 * segments that buy on anything else, which is exactly where a company nobody
 * has heard of should start.
 */
export function fitFor(company: Company, segment: Segment): number {
  const unit = (n: number) => Math.max(0.02, Math.min(1, (Number(n) || 0) / 100));
  const axes: [number, number][] = [
    [Math.max(0, segment.qualityFocus), unit(company.quality)],
    [Math.max(0, segment.brandFocus), unit(company.brand)],
    [Math.max(0, segment.serviceFocus), unit(company.service)],
  ];
  const weight = axes.reduce((sum, [w]) => sum + w, 0);
  // A segment that asks for nothing is satisfied by anyone; it says nothing
  // about fit, so it scores neutrally rather than best.
  if (weight <= 0) return 0.5;

  /*
   * A weighted geometric *mean*, not a product — the normalising exponent is
   * the whole point and leaving it out is a bug worth naming. The engine's
   * own `appealFor` takes the product, which is right there because it
   * compares companies *inside* one segment, where the weights are the same
   * for everyone and the bias cancels. Comparing one segment against another
   * is a different question, and unnormalised it answers a different one:
   * every score is below one, so raising it to a smaller exponent gives a
   * bigger number, and the "best fit" is always whichever segment demands
   * least. That picked the same segment for a company with brand 8 and one
   * with brand 90.
   */
  const product = axes.reduce((acc, [w, score]) => acc * Math.pow(score, w), 1);
  return Math.pow(product, 1 / weight);
}

/**
 * The segment worth aiming at, and what makes it worth it.
 *
 * Fit against how much of the market it is and how hard its people are to
 * move. A segment that suits you perfectly and has nobody in it is not a
 * plan; nor is the biggest one if everyone in it is loyal to somebody else.
 */
export function bestSegment(company: Company, niche: Niche): Segment | null {
  if (!niche.segments.length) return null;
  const total = niche.segments.reduce((sum, s) => sum + s.size, 0) || 1;
  return [...niche.segments]
    .map((s) => ({
      s,
      score: fitFor(company, s) * Math.pow(s.size / total, 0.5) * (1 - s.loyalty * 0.6),
    }))
    .sort((a, b) => b.score - a.score)[0].s;
}

/** Prices tried when looking for the one that earns most. Coarse on purpose: a person picks a round number. */
const STEPS = 24;

/**
 * What to charge a segment, to earn the most from it.
 *
 * Share times margin, maximised — and share against the companies actually
 * in this market, which is the part that makes it a decision rather than
 * arithmetic. Appeal on its own says how attractive an offer is; what decides
 * how many people take it is how attractive it is *compared to what else they
 * could have*, so the rivals go into the sum.
 *
 * Priced without them, the answer is always "charge more": margin rises
 * linearly and appeal falls slowly, so the peak sits at the top of whatever
 * range it is given. That version priced every segment in every market at
 * 135% of the going rate, including segments that buy on price, which is the
 * confident nonsense this function exists to avoid.
 *
 * It is not a discount rule either. For a quality-led segment against weak
 * rivals the answer often comes back above the reference, because the
 * engine's own model says being suspiciously cheap loses those people.
 */
export function bestPrice(company: Company, segment: Segment, rivals: Company[] = [], floorMultiple = 1.25): number {
  const cost = Math.max(0, Number(company.unitCost) || 0);
  const floor = Math.max(1, cost * floorMultiple);
  /*
   * Below about six tenths of the reference the engine treats a price as a
   * warning rather than a bargain, so there is nothing to find down there.
   */
  const low = Math.max(floor, segment.referencePrice * 0.6);
  const high = Math.max(low, segment.referencePrice * 1.35);

  // What everyone else is worth to this segment, which does not move with our price.
  const theirs = rivals.reduce((sum, r) => sum + Math.max(0, appealFor(r, segment)), 0);

  let best = Math.max(floor, segment.referencePrice);
  let bestValue = -Infinity;
  for (let i = 0; i <= STEPS; i++) {
    const price = low + ((high - low) * i) / STEPS;
    if (price <= cost) continue;
    const mine = Math.max(0, appealFor({ ...company, price } as Company, segment));
    const share = mine / (mine + theirs || 1);
    const value = share * (price - cost);
    if (value > bestValue) { bestValue = value; best = price; }
  }
  return best;
}

/**
 * The regions worth keeping.
 *
 * A newcomer's budget spread across five places is invisible in all five. The
 * regions are ranked by how much of the market they hold and how well the
 * company's chosen segment over-indexes there, and everything past the first
 * few is let go — but never the last one, because a company selling nowhere
 * sells nothing.
 */
export function regionsWorthKeeping(open: City[], segment: Segment | null, keep: number): string[] {
  if (open.length <= keep) return open.map((c) => c.id);
  const scored = [...open].sort((a, b) => weightOf(b, segment) - weightOf(a, segment));
  return scored.slice(0, Math.max(1, keep)).map((c) => c.id);
}

function weightOf(city: City, segment: Segment | null): number {
  const mix = segment ? ((city as any).segmentMix?.[segment.id] ?? 1) : 1;
  return Math.max(0.001, city.weight) * mix;
}
