/**
 * What this year will do to the company, before anybody commits to it.
 *
 * ## The question the desk could not answer
 *
 * The desk could tell a seat how many customers might want the company, and
 * how much the table had committed to spend. It could not put the two
 * together — what the year will actually *earn*, what it will cost line by
 * line, what that leaves in the bank — so every seat decided its own piece
 * blind to what the pieces added up to, and found out overnight.
 *
 * ## How it is worked out
 *
 * By running the year. Not a sketch of the engine: the engine, on a copy of
 * the world, with the team's decisions exactly as the tick would assemble
 * them — what each seat has filed, the draft the person looking is still
 * editing, and last year's plan standing in for any seat that has not filed,
 * at the caretaker's reduced pace the real year would give it.
 *
 * Two things are deliberately left out, because leaving them in would be a
 * leak dressed as a feature:
 *
 *   - **Rival teams' plans.** They run the year as if doing nothing new. What
 *     they have filed is theirs until the tick.
 *   - **The year's news.** It is decided from the state of the market and is
 *     secret until the year runs.
 *
 * So this is what the year does to you if the rest of the market holds still —
 * which is the honest version of a question nobody can answer exactly.
 *
 * ## Why twice
 *
 * Once as filed, once with your draft on top. The difference is the thing a
 * seat actually wants to know while a hand is on a slider: not "where is the
 * company going" but "what does *my* change do to it".
 */
import { resolveYear, type CompanyReport } from "./resolve";
import { decisionsForYear } from "./season";
import { forecastDemand, type Forecast } from "./forecast";
import { reviewInvestors } from "./finance";
import type { TeamDecisions } from "./decisions";
import type { Company, Economy, Role, World } from "./types";

export interface Projection {
  year: number;
  customers: number;
  turnedAway: number;
  /** What the company can serve this year — what it already has. */
  capacityNow: number;
  /** What it will have next year, once what is being built opens. */
  capacityNext: number;

  revenue: number;
  profit: number;
  cashStart: number;
  cashEnd: number;
  /** The year's accounts, line by line, as the report will show them. */
  lines: { label: string; amount: number }[];

  /** Where the company's standing is heading: this year, and what is already on its way for next. */
  stats: {
    brand: { now: number; coming: number };
    quality: { now: number; coming: number };
    service: { now: number };
    reputation: { now: number };
  };

  credit: { score: number; grade: string; rate: number; emergencyDrawn: number };
  /** The investors' target this year, and whether this plan meets it. Null with no investors, or none due. */
  target: { amount: number; projected: number; met: boolean; strikes: number; wouldRemove: boolean } | null;
  bankrupt: boolean;

  /**
   * Next year's demand, for the capacity decision. Capacity ordered now opens
   * next year, so this — not this year's demand — is the number to size it to.
   */
  nextYearDemand: Forecast | null;
}

export interface ProjectionPair {
  /** With the table's filings only. */
  filed: Projection;
  /** With the viewer's draft on top. Identical to `filed` when there is no draft. */
  drafted: Projection;
  /** Which seats have filed and which are being covered by last year's plan. */
  absent: Role[];
}

function run(input: {
  world: World;
  company: Company;
  submitted: Partial<Record<Role, any>>;
  previous?: TeamDecisions;
  economy: Economy;
}): { projection: Projection; absent: Role[] } {
  const { world, company, submitted, previous, economy } = input;
  const { decisions, absent } = decisionsForYear({ company, niche: world.niche, submitted, previous });

  // Only this team's decisions: rival teams run the year as if doing nothing new.
  const result = resolveYear(world, [{ ...decisions, companyId: company.id }], economy, { withoutEvent: true });
  const report = result.reports.find((r) => r.companyId === company.id) as CompanyReport;
  const next = result.world.companies.find((c) => c.id === company.id)!;

  /*
   * The investors' review, run on this year's projected revenue rather than
   * read back from the engine — the engine has already moved the target on to
   * next year by the time it reports, and the screen wants this year's.
   */
  let target: Projection["target"] = null;
  const inv = company.investors;
  if (inv && inv.targetYear === world.year) {
    const review = reviewInvestors(inv, report.revenue, world.year);
    target = {
      amount: inv.target,
      projected: report.revenue,
      met: report.revenue >= inv.target,
      strikes: inv.strikes,
      wouldRemove: review.removed,
    };
  }

  const nextYearDemand = forecastDemand({
    world: { ...result.world, year: world.year + 1 },
    companyId: company.id,
    year: world.year + 1,
    economy: result.world.economy,
  });

  const emergencyDrawn = report.cashBridge?.lines
    .filter((l) => /emergency|drawn on credit/i.test(l.label))
    .reduce((sum, l) => sum + l.amount, 0) ?? 0;

  return {
    absent,
    projection: {
      year: world.year,
      customers: report.customers,
      turnedAway: report.turnedAway,
      capacityNow: Math.min(company.capacity, Math.max(0, Math.round(decisions.coo?.capacityTarget ?? company.capacity))),
      capacityNext: next.capacity,
      revenue: report.revenue,
      profit: report.profit,
      cashStart: report.cashBridge?.opening ?? company.cash,
      cashEnd: report.cash,
      lines: report.cashBridge?.lines ?? [],
      stats: {
        brand: { now: report.brand, coming: next.brandPipeline ?? 0 },
        quality: { now: report.quality, coming: next.pipeline ?? 0 },
        service: { now: report.service },
        reputation: { now: report.reputation },
      },
      credit: {
        score: report.credit?.score ?? 50,
        grade: report.credit?.grade ?? "BB",
        rate: report.credit?.rate ?? economy.interestRate,
        emergencyDrawn,
      },
      target,
      bankrupt: report.bankrupt,
      nextYearDemand,
    },
  };
}

/**
 * The year as filed, and the year with the viewer's draft on top.
 *
 * `filed` is what each seat has filed this year; `draft` is the viewer's
 * unfiled version of their own seat, which replaces theirs in the second run.
 */
export function projectYear(input: {
  world: World;
  companyId: string;
  economy: Economy;
  filed: Partial<Record<Role, any>>;
  previous?: TeamDecisions;
  draft?: { role: Role; decision: any };
}): ProjectionPair | null {
  const { world, companyId, economy, filed, previous, draft } = input;
  const company = world.companies.find((c) => c.id === companyId);
  if (!company) return null;

  const asFiled = run({ world, company, submitted: filed, previous, economy });
  const drafted = draft
    ? run({ world, company, submitted: { ...filed, [draft.role]: draft.decision }, previous, economy })
    : asFiled;

  return { filed: asFiled.projection, drafted: drafted.projection, absent: drafted.absent };
}
