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
import { ageAssets, assetEffects, servingCapacity } from "./assets";
import type { TeamDecisions } from "./decisions";
import type { Company, Economy, Role, World } from "./types";
import { ROLES } from "./types";
import { personOf, SEVERANCE } from "./people";

/**
 * Next year, if the company holds this course.
 *
 * Half the levers on the desk pay later than they cost: research, recruiting,
 * training, efficiency, a programme, a feature bet, a cost review. Shown only
 * this year, every one of them reads as money lost — the forecast moved, but
 * only the wrong way, and the seat that chose it could not see why. So the
 * year after is played too, with the same plan held (less the decisions that
 * are made once), and every lever's payoff has somewhere to appear.
 */
export interface YearAhead {
  year: number;
  revenue: number;
  profit: number;
  customers: number;
  cashEnd: number;
  /** What one unit costs to deliver: where efficiency, automation and programmes land. */
  unitCost: number;
  brand: number;
  quality: number;
  service: number;
  reputation: number;
}

/** One seat at the table, and how loyal they will be once the year is over. */
export interface SeatMood {
  role: Role;
  loyaltyNow: number;
  loyaltyNext: number;
  /** How hard next year's objective is pushed — the chief executive's targets. */
  stretch: "easy" | "fair" | "aggressive";
}

/**
 * What one seat's saved decisions did to the forecast.
 *
 * Measured against the same year with that seat left on last year's plan —
 * which is exactly what the year does with a seat that never files — so every
 * seat, and every teammate, can see what each person's choices are worth.
 */
export interface SeatImpact {
  role: Role;
  revenue: number;
  profit: number;
  cashEnd: number;
  customers: number;
  /** And a year on: the part of a decision that only lands later. */
  next: { revenue: number; profit: number; customers: number; unitCost: number; quality: number; brand: number; service: number } | null;
}

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

  /** What one unit costs to deliver this year. */
  unitCost: number;
  /** How much of the company the founders own once the year is over: raising sells it, a buyback wins it back. */
  founderShare: number;
  /** The year after, holding this course. Null when the company does not survive this one. */
  nextYear: YearAhead | null;
  /** Each colleague's loyalty now and after the year — targets, overrules, pay, a profitable year. */
  team: SeatMood[];

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
  /**
   * This period's demand under the draft.
   *
   * The desk's forecast card was drawn from a demand curve worked out on the
   * server from filings alone, refreshed on an eight-second poll. So the
   * headline said "at $0 per seat" and the curve underneath it never moved
   * while somebody changed the price — the one decision it is most obviously
   * about. Returned here because this endpoint is the one that already knows
   * what the draft is.
   */
  demand: Forecast | null;
  /** What each seat's saved decisions moved, against leaving that seat on last year's plan. */
  impact: SeatImpact[];
}

/**
 * Decisions that are made once, and must not be made again when the year
 * after is played as "the same course".
 */
const ONE_SHOT = new Set([
  "deals", "dealVotes", "expand", "expandVote", "featureBet", "featureMode", "programme", "openNiche",
  "research", "shockAnswer", "overrule", "replaceSeat", "replaceBid", "rehire", "raiseAmount", "buyback",
  "refinance", "borrow", "repay", "bonusPool", "forecast", "celebritySpend",
]);

function holdCourse(decisions: TeamDecisions): TeamDecisions {
  const held: any = { companyId: decisions.companyId, steered: decisions.steered };
  for (const role of ROLES) {
    const d = (decisions as any)[role];
    if (!d) continue;
    held[role] = Object.fromEntries(Object.entries(d).filter(([k]) => !ONE_SHOT.has(k)));
  }
  return held;
}

function run(input: {
  world: World;
  company: Company;
  submitted: Partial<Record<Role, any>>;
  previous?: TeamDecisions;
  economy: Economy;
}): { projection: Projection; absent: Role[]; decisions: TeamDecisions } {
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
    const review = reviewInvestors(inv, report.revenue, world.year, { currency: world.currency });
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

  /*
   * The chief executive's people decisions, which are settled after the year
   * is marked rather than inside it (`closeYear` in people.ts) — so the engine
   * run above cannot see them, and a bonus pot or a replacement used to move
   * nothing on this screen at all. Shown as what they would cost: the pot in
   * full, because it is paid to every seat that meets its objective and the
   * plan is to meet them; a replacement at its bid plus severance.
   */
  const peopleLines: { label: string; amount: number }[] = [];
  const pot = Math.max(0, Number(decisions.ceo?.bonusPool) || 0);
  if (pot > 0) peopleLines.push({ label: "Bonus pot, if every seat meets its objective", amount: -pot });
  if (decisions.ceo?.replaceSeat) {
    peopleLines.push({ label: "Replacing a seat: the bid and severance", amount: -(Math.max(0, Number(decisions.ceo?.replaceBid) || 0) + SEVERANCE) });
  }
  const peopleCost = peopleLines.reduce((sum, l) => sum + l.amount, 0);

  let nextYear: YearAhead | null = null;
  if (!report.bankrupt && !next.bankruptSince) {
    try {
      const ahead = resolveYear(
        { ...result.world, year: world.year + 1 },
        [{ ...holdCourse(decisions), companyId: company.id }],
        result.world.economy ?? economy,
        { withoutEvent: true },
      );
      const r = ahead.reports.find((x) => x.companyId === company.id) as CompanyReport | undefined;
      const c = ahead.world.companies.find((x) => x.id === company.id);
      if (r && c) {
        nextYear = {
          year: world.year + 1,
          revenue: r.revenue, profit: r.profit, customers: r.customers,
          cashEnd: r.cash + peopleCost,
          unitCost: c.unitCost, brand: r.brand, quality: r.quality, service: r.service, reputation: r.reputation,
        };
      }
    } catch {
      /* The year after is a view of where this course leads, never a reason the screen fails. */
    }
  }

  const team: SeatMood[] = company.kind === "player"
    ? (company.seats ?? []).filter((r) => r !== "ceo").map((role) => {
        const before = personOf(company, role);
        const after = personOf(next, role);
        return {
          role,
          loyaltyNow: Math.round(before.loyalty),
          loyaltyNext: Math.round(after.loyalty),
          stretch: ((decisions.ceo?.targets as any)?.[role] ?? after.stretch ?? "fair") as SeatMood["stretch"],
        };
      })
    : [];

  const emergencyDrawn = report.cashBridge?.lines
    .filter((l) => /emergency|drawn on credit/i.test(l.label))
    .reduce((sum, l) => sum + l.amount, 0) ?? 0;

  return {
    decisions,
    absent,
    projection: {
      year: world.year,
      customers: report.customers,
      turnedAway: report.turnedAway,
      /*
       * Room, the way the engine serves from it: what was built (a cut lands
       * now, growth next year) plus what the company's assets add. Assets
       * lapse at the start of a year, so this year counts the ones that
       * survive it, and next year counts what is held once it is over —
       * including anything won at this year's market.
       */
      capacityNow: Math.min(company.capacity, Math.max(0, Math.round(decisions.coo?.capacityTarget ?? company.capacity)))
        + assetEffects(ageAssets(company.assets ?? []).assets).capacity,
      capacityNext: servingCapacity(next),
      revenue: report.revenue,
      profit: report.profit,
      cashStart: report.cashBridge?.opening ?? company.cash,
      cashEnd: report.cash + peopleCost,
      lines: [...(report.cashBridge?.lines ?? []), ...peopleLines],
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
      unitCost: next.unitCost,
      founderShare: next.founderShare ?? 1,
      nextYear,
      team,
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
  /**
   * The viewer's unfiled draft. `roles` is which desks it covers — one
   * normally, all five for a founder holding the whole table, whose single
   * form is five desks' worth of levers and whose projection was previously
   * built from the chief executive's fields alone.
   */
  draft?: {
    role: Role;
    decision: any;
    /** Which desks the draft covers, when it covers more than the seat's own. */
    roles?: Role[];
    /** That draft split per desk, cleaned against each one's own lever list. */
    byRole?: Partial<Record<Role, any>>;
  };
}): ProjectionPair | null {
  const { world, companyId, economy, filed, previous, draft } = input;
  const company = world.companies.find((c) => c.id === companyId);
  if (!company) return null;

  const asFiled = run({ world, company, submitted: filed, previous, economy });
  /*
   * Every desk the draft covers, not just the seat's own.
   *
   * `{ ...filed, [draft.role]: draft.decision }` is right for one seat at a
   * five-person table and wrong for a founder holding all five: their price,
   * their capacity and their spend all arrived under `roles` and only the
   * chief executive's half of it was ever applied. So the projection answered
   * the same number however the form was changed, which reads as a screen
   * that has stopped listening.
   */
  const covered = draft?.roles ?? (draft ? [draft.role] : []);
  const drafted = draft
    ? run({
        world, company, previous, economy,
        submitted: covered.reduce(
          (acc, r) => ({ ...acc, [r]: draft.byRole?.[r] ?? (r === draft.role ? draft.decision : (filed as any)[r]) }),
          { ...filed },
        ),
      })
    : asFiled;

  /* What this period's demand looks like with the draft applied, not just what was filed. */
  const demand = forecastDemand({
    world: { ...world, year: world.year },
    companyId,
    year: world.year,
    economy,
    draft: drafted.decisions,
  });

  /*
   * Each saved seat, taken out in turn.
   *
   * Without it the screen could say what the viewer's *unsaved* change would
   * do and nothing at all about what had been saved — so once a desk was
   * filed, by a teammate or by Nova, its effect vanished from view. This is
   * the year with that seat's filing removed (it then runs on last year's
   * plan, as an unfiled seat does), compared with the year as filed.
   */
  const impact: SeatImpact[] = [];
  for (const role of ROLES) {
    if (!(filed as any)[role] || asFiled.absent.includes(role)) continue;
    const { [role]: _left, ...without } = filed as any;
    const off = run({ world, company, submitted: without, previous, economy }).projection;
    const on = asFiled.projection;
    impact.push({
      role,
      revenue: on.revenue - off.revenue,
      profit: on.profit - off.profit,
      cashEnd: on.cashEnd - off.cashEnd,
      customers: on.customers - off.customers,
      next: on.nextYear && off.nextYear ? {
        revenue: on.nextYear.revenue - off.nextYear.revenue,
        profit: on.nextYear.profit - off.nextYear.profit,
        customers: on.nextYear.customers - off.nextYear.customers,
        unitCost: on.nextYear.unitCost - off.nextYear.unitCost,
        quality: on.nextYear.quality - off.nextYear.quality,
        brand: on.nextYear.brand - off.nextYear.brand,
        service: on.nextYear.service - off.nextYear.service,
      } : null,
    });
  }

  return { filed: asFiled.projection, drafted: drafted.projection, absent: drafted.absent, demand, impact };
}
