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

export function brandLanding(company: Pick<Company, "brandPipeline">, gained: number): BrandLanding {
  const landed = Math.max(0, company.brandPipeline ?? 0);
  const thisYear = Math.max(0, gained) * BRAND_NOW;
  return { now: thisYear + landed, next: Math.max(0, gained) - thisYear, landed };
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
): QualityLanding {
  return {
    landed: Math.max(0, company.pipeline ?? 0),
    pipeline: Math.max(0, shipped) + Math.max(0, company.pipelineLater ?? 0),
    pipelineLater: Math.max(0, researched),
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

export function staffing(company: Pick<Company, "staff">, headcount: number): Staffing {
  const wanted = Math.max(0, Math.round(headcount));
  const established = Math.min(wanted, Math.max(0, company.staff ?? 0));
  return {
    established,
    newHires: wanted - established,
    next: wanted,
    supportEquivalent: established * SALARY * STAFF_LEVERAGE,
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

export function capacityBuild(company: Pick<Company, "capacity">, target: number): CapacityBuild {
  const current = Math.max(0, Math.round(company.capacity));
  const wanted = Math.max(0, Math.round(target));
  return {
    // A cut is immediate; growth waits a year.
    now: Math.min(current, wanted),
    next: wanted,
    building: Math.max(0, wanted - current),
  };
}
