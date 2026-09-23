/**
 * How long things take to work.
 *
 * Almost everything a team decided used to land in the year they decided it.
 * Spend on brand in year three, and year three's customers had heard of you;
 * ship features in year three, and year three's customers were using them.
 * That made fourteen years into fourteen independent one-year games: nothing a
 * team did had to be planned, so nothing rewarded planning.
 *
 * Real companies do not work like that, and the gap between a decision and its
 * effect is where most of the judgement is. So:
 *
 *   - **Brand** lands half this year and half next. Awareness builds; it does
 *     not switch on. Performance marketing is the exception — paying for clicks
 *     buys this year's clicks — which is exactly the trade between the two.
 *   - **Quality** shipped this year is felt next year, and research the year
 *     after that. The product people are talking about is last year's.
 *   - **Capacity** built this year opens next year. A cut is immediate — you
 *     can close a floor faster than you can fit one out.
 *   - **A new hire** is paid from their first day and is not much use until
 *     their second. After that they are the cheapest service in the game.
 *
 * Pure. The engine and the forecast both call these, so the forecast can never
 * quietly disagree with what the year will actually do.
 */
import type { Company } from "./types";
import { SALARY } from "./decisions";

/** The share of a brand campaign felt in the year it runs. The rest arrives next year. */
export const BRAND_NOW = 0.5;

/**
 * How much service one established member of staff is worth, as a multiple
 * of their salary spent on support.
 *
 * More than one on purpose. Support spend buys service this year and is gone;
 * a person you hired last year keeps delivering it for as long as you keep
 * them. That is the whole case for hiring — and it only holds if a year of
 * patience is paid back, or nobody would ever wait a year for anything.
 */
export const STAFF_LEVERAGE = 1.5;

export interface BrandLanding {
  /** Brand added this year: this campaign's first half plus last campaign's second. */
  now: number;
  /** Carried to next year. */
  next: number;
  /** What last year's campaign delivered this year, for the note. */
  landed: number;
}

/**
 * `per` is one period's share of a year: 1 yearly, 1/4 quarterly, 1/12 monthly.
 *
 * A pipeline that emptied itself every call would land a year's worth of brand
 * in a quarter, so a period releases only its share of what is waiting. The
 * steady state and the annual throughput come out the same at every cadence —
 * a quarter adds a quarter of the campaign and releases a quarter of the queue
 * — and at `per = 1` the arithmetic is exactly what it always was.
 */
export function brandLanding(company: Pick<Company, "brandPipeline">, gained: number, per = 1): BrandLanding {
  const waiting = Math.max(0, company.brandPipeline ?? 0);
  const landed = waiting * per;
  const thisYear = Math.max(0, gained) * BRAND_NOW;
  return { now: thisYear + landed, next: waiting - landed + (Math.max(0, gained) - thisYear), landed };
}

export interface QualityLanding {
  /** Quality arriving this year, built over the last one or two. */
  landed: number;
  /** What lands next year: this year's shipping and research already a year in. */
  pipeline: number;
  /** Research just started: two years out. */
  pipelineLater: number;
}

export function qualityLanding(
  company: Pick<Company, "pipeline" | "pipelineLater">,
  shipped: number,
  researched: number,
  per = 1,
): QualityLanding {
  const near = Math.max(0, company.pipeline ?? 0);
  const far = Math.max(0, company.pipelineLater ?? 0);
  // Each stage passes on a period's share, so a two-year research bet still
  // takes two years however many decisions the table files in one.
  const landed = near * per;
  const moved = far * per;
  return {
    landed,
    pipeline: near - landed + Math.max(0, shipped) + moved,
    pipelineLater: far - moved + Math.max(0, researched),
  };
}

export interface Staffing {
  /** Staff here since last year: the ones who are any use this year. */
  established: number;
  /** Joined this year: paid, not yet useful. */
  newHires: number;
  /** Everybody, carried to next year as established. */
  next: number;
  /** What the established staff are worth, as support spend. */
  supportEquivalent: number;
}

export function staffing(company: Pick<Company, "staff">, headcount: number, per = 1): Staffing {
  const wanted = Math.max(0, Math.round(headcount));
  const have = Math.max(0, company.staff ?? 0);
  const established = Math.min(wanted, have);
  return {
    established,
    newHires: wanted - established,
    // A hire settles in over a year, not over whatever a period happens to be.
    // Whole people. A period's share of a hire is still a fraction of a
    // person until it is rounded, and "1.5 new hires this month" is not a
    // sentence a report can print.
    next: Math.round(have + (wanted - have) * per),
    /*
     * A year of what the established staff are worth, as support spend —
     * scaled, because it is added to a period's support budget and weighed
     * against a period's threshold. Unscaled, a quarterly season's staff were
     * worth four years of support a year and service ran away: 75 points
     * against a yearly season's 60 on the same plan.
     */
    supportEquivalent: established * SALARY * STAFF_LEVERAGE * per,
  };
}

export interface CapacityBuild {
  /** What the company can serve this year. */
  now: number;
  /** What it will have next year. */
  next: number;
  /** Room ordered this year that is not open yet. */
  building: number;
}

export function capacityBuild(company: Pick<Company, "capacity">, target: number, per = 1): CapacityBuild {
  const current = Math.max(0, Math.round(company.capacity));
  const wanted = Math.max(0, Math.round(target));
  return {
    // A cut is immediate; growth waits a year — a quarter opens a quarter of it.
    now: Math.min(current, wanted),
    // Whole units of room, for the same reason — and because capacity feeds
    // the spill pass, where a fractional seat became a fractional customer.
    next: wanted > current ? Math.round(current + (wanted - current) * per) : wanted,
    building: Math.max(0, wanted - current),
  };
}
