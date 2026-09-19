/**
 * The people in the five chairs, and the people who work for them.
 *
 * Phase one gave each seat money to argue over. This gives the seats a
 * relationship with each other: the chief executive can set how hard each of
 * the others is pushed, overrule one of them, or fire one; the others can be
 * loyal or not, and how loyal changes how well their decisions land. And
 * under the five of them, a workforce whose pay, hiring and training decide
 * how much every pound of product and service actually buys.
 *
 * ## Why loyalty changes results rather than just a number
 *
 * A seat that has been overruled twice and pushed to an aggressive target it
 * missed is not going to execute its plan as well as one that trusts the
 * room. That is true of people and it is the only reason loyalty is worth
 * having: a stat that changed nothing would be a mood ring. So it scales how
 * far a seat's spending goes — never what it costs, which is paid in full
 * either way — by up to a tenth better and a fifth worse.
 *
 * ## Why it applies to people as well as bots
 *
 * The desk is played by humans who cannot be made to try harder. What a
 * low-loyalty human seat stands for is the organisation under them: the team
 * a disaffected executive runs is a team that ships less. And a seat whose
 * loyalty runs out resigns — a bot is replaced by a new hire, a person moves
 * to another table in the same market, where somebody wants them.
 */
import type { Company, Role } from "./types";
import { saturate } from "./market";
import { rng } from "./random";

// ─── The people ──────────────────────────────────────────────────────────────

export type Stretch = "easy" | "fair" | "aggressive";

export interface Person {
  /** 0–100. How much this seat trusts the room it is in. */
  loyalty: number;
  /**
   * 0–100. How good they are. A person who sat down themselves is 60 — the
   * game does not grade its players — and a hire from the market is whatever
   * the market had and the company could win.
   */
  skill: number;
  /** How hard the chief executive has pushed this year's objective. */
  stretch?: Stretch;
  /** Overrules, and who turned out to be right. */
  record?: { year: number; right: "ceo" | "seat" }[];
}

export const LOYALTY_START = 70;
export const SKILL_DEFAULT = 60;
/** At or below this, the seat resigns when the year closes. */
export const RESIGN_AT = 15;
/** Below this, the desk warns that a seat is thinking about it. */
export const WARN_AT = 30;

export const personOf = (company: Pick<Company, "people">, role: Role): Person =>
  company.people?.[role] ?? { loyalty: LOYALTY_START, skill: SKILL_DEFAULT };

/** What a stretch does to effort: pushed harder, people work harder, for a while. */
export const STRETCH_EFFORT: Record<Stretch, number> = { easy: 0.97, fair: 1, aggressive: 1.07 };

/**
 * How far one seat's spending goes, as a multiplier.
 *
 * One at a seat of ordinary loyalty and skill on a fair target, so a company
 * that never touches any of this plays exactly as it always has.
 */
export function effort(person: Person): number {
  const loyalty = 1 + 0.3 * (Math.max(0, Math.min(100, person.loyalty)) - LOYALTY_START) / 100;
  const skill = 1 + 0.15 * (Math.max(0, Math.min(100, person.skill)) - SKILL_DEFAULT) / 100;
  return loyalty * skill * STRETCH_EFFORT[person.stretch ?? "fair"];
}

// ─── Targets ─────────────────────────────────────────────────────────────────

/**
 * How far a stretch moves the objective's goal: an aggressive target asks
 * about a tenth more, an easy one about a tenth less. Scores out of a hundred
 * never go past a hundred.
 */
export const STRETCH_GOAL: Record<Stretch, number> = { easy: 0.92, fair: 1, aggressive: 1.12 };

export function stretchGoal(goal: number, compare: "at_least" | "at_most", stretch: Stretch = "fair", outOfHundred = false): number {
  const k = STRETCH_GOAL[stretch];
  const moved = compare === "at_least" ? goal * k : goal / k;
  const rounded = Math.abs(moved) >= 100 ? Math.round(moved) : Math.round(moved * 10) / 10;
  return outOfHundred ? Math.min(100, rounded) : rounded;
}

/**
 * What an objective's outcome does to a seat's loyalty. Meeting one builds
 * trust; missing an easy one barely stings; missing an aggressive one that
 * the chief executive set is the fastest way to lose somebody.
 */
export const OUTCOME_LOYALTY: Record<Stretch, { met: number; partial: number; missed: number }> = {
  easy: { met: 4, partial: 0, missed: -1 },
  fair: { met: 6, partial: 1, missed: -4 },
  aggressive: { met: 9, partial: -3, missed: -12 },
};

/** A bonus, paid for a met objective, buys this much loyalty per executive salary's worth — up to a limit. */
export const BONUS_LOYALTY_PER_SALARY = 10;
export const BONUS_LOYALTY_MAX = 10;
/** One executive's salary, for measuring a bonus against. Matches EXECUTIVE in decisions.ts. */
const EXECUTIVE = 140_000;

export function bonusLoyalty(paid: number): number {
  return Math.min(BONUS_LOYALTY_MAX, Math.max(0, paid) / EXECUTIVE * BONUS_LOYALTY_PER_SALARY);
}

// ─── The year's drift ────────────────────────────────────────────────────────

/** Loyalty lost by a seat the chief executive overruled. */
export const OVERRULE_LOYALTY = 20;

/**
 * What a year does to everybody's loyalty, before objectives are marked.
 *
 * It drifts back towards ordinary on its own — grudges fade and honeymoons
 * end — a profitable year lifts everyone, being rescued by an emergency loan
 * lowers everyone, and the specific things done to specific seats land on
 * them: an overrule, a cost review felt a year late, engineering pay.
 */
export function yearLoyalty(input: {
  person: Person;
  role: Role;
  profitable: boolean;
  rescued: boolean;
  overruled: boolean;
  /** Last year's cost review, felt this year, as a percentage. */
  scar: number;
  /** Engineering pay against the market, 1 = market. Only the technology seat feels it. */
  pay: number;
}): number {
  const { person, role, profitable, rescued, overruled, scar, pay } = input;
  let l = person.loyalty + (LOYALTY_START - person.loyalty) * 0.1;
  if (profitable) l += 2;
  if (rescued) l -= 3;
  if (overruled) l -= OVERRULE_LOYALTY;
  l -= Math.max(0, scar) * 0.5;
  if (role === "cto") l += (pay - 1) * 30;
  return Math.max(0, Math.min(100, Math.round(l * 10) / 10));
}

// ─── Engineering pay ─────────────────────────────────────────────────────────

export const PAY_MIN = 80;
export const PAY_MAX = 130;

/**
 * What paying engineers above or below the market does.
 *
 * Product spending costs what it costs times the pay level — the same work at
 * a fifth over market is a fifth dearer — and buys more, but with diminishing
 * returns: at 120% of market it buys about 12% more. So paying above market
 * is faster and slightly worse value for money; paying below is cheaper per
 * point, until the market notices.
 */
export function payEffect(payPct: number | undefined): { cost: number; output: number; pay: number } {
  const pay = Math.max(PAY_MIN, Math.min(PAY_MAX, Number(payPct) || 100)) / 100;
  return { pay, cost: pay, output: Math.pow(pay, 0.6) };
}

/**
 * Whether the market takes some of your engineers this year. Only below
 * market, and more often the further below: at 80% of market, about two years
 * in five. What it takes is a share of what the product team has in flight.
 */
export function poached(pay: number, seed: string): { hit: boolean; share: number } {
  if (pay >= 1) return { hit: false, share: 0 };
  const chance = Math.min(0.9, (1 - pay) * 2);
  const hit = rng(seed)() < chance;
  return { hit, share: hit ? 0.25 : 0 };
}

// ─── Staff: recruiting and training ──────────────────────────────────────────

export const STAFF_QUALITY_START = 50;

/**
 * How good the staff are, next year.
 *
 * Recruiting decides who this year's hires are when they arrive; training
 * decides how much better the people already here get. Both land next year —
 * a new hire is useless for one, and a course takes a year to show. What the
 * staff are good at is service: their support counts for more, or less, by
 * how good they are.
 */
export function staffQualityNext(input: {
  quality: number;
  established: number;
  newHires: number;
  recruiting: number;
  training: number;
}): number {
  const { quality, established, newHires, recruiting, training } = input;
  const trained = Math.min(100, quality + saturate(Math.max(0, training), 150_000) * 14 - 1.5);
  const hired = 35 + saturate(Math.max(0, recruiting), 100_000) * 50;
  const total = Math.max(0, established) + Math.max(0, newHires);
  if (total <= 0) return Math.max(0, Math.min(100, trained));
  return Math.max(0, Math.min(100, (established * trained + newHires * hired) / total));
}

/** What staff quality does to their support: ordinary at 50, half again at 100. */
export const staffLeverage = (quality: number | undefined): number =>
  0.5 + Math.max(0, Math.min(100, quality ?? STAFF_QUALITY_START)) / 100;

// ─── The cost review ─────────────────────────────────────────────────────────

export const REVIEW_MAX = 20;

/**
 * Cutting overhead now: salaries this year fall by the percentage, and next
 * year service and every seat's loyalty find out. See `yearLoyalty`.
 */
export const reviewSaving = (pct: number | undefined): number =>
  Math.max(0, Math.min(REVIEW_MAX, Number(pct) || 0)) / 100;

/** Service lost, next year, per percentage point of last year's review. */
export const REVIEW_SERVICE = 0.3;

// ─── The executive market ────────────────────────────────────────────────────

export interface Candidate {
  id: string;
  skill: number;
}

/** What firing costs on top of whatever the replacement is bid: half a year's salary. */
export const SEVERANCE = EXECUTIVE / 2;

/**
 * Who is available to hire this year: three people, seeded by the season and
 * year, so every company firing in the same market is bidding for the same
 * three. Between 45 and 95.
 */
export function candidatesFor(seasonId: string, year: number): Candidate[] {
  const r = rng(`${seasonId}:${year}:executives`);
  return [0, 1, 2]
    .map((i) => ({ id: `c${year}-${i}`, skill: Math.round(45 + r() * 50) }))
    .sort((a, b) => b.skill - a.skill);
}

export interface Hire {
  companyId: string;
  role: Role;
  /** Null when the market was empty by the time this bid was reached. */
  candidate: Candidate | null;
  bid: number;
}

/**
 * The market settled: the highest bid takes the best candidate still there.
 *
 * Rivals bid too — every other company firing this year, and the incumbents,
 * who each year take the best candidate with a chance that grows with how
 * good that candidate is. Anyone left without a candidate gets a stopgap
 * appointment at 40: the seat is filled, not well.
 */
export function settleHires(input: {
  seasonId: string;
  year: number;
  bids: { companyId: string; role: Role; bid: number }[];
}): Hire[] {
  const pool = candidatesFor(input.seasonId, input.year);
  const r = rng(`${input.seasonId}:${input.year}:incumbent-poach`);
  if (pool.length && r() < (pool[0].skill - 45) / 80) pool.shift();

  const ordered = [...input.bids].sort((a, b) => b.bid - a.bid || a.companyId.localeCompare(b.companyId));
  return ordered.map((b) => {
    const candidate = pool.shift() ?? null;
    return { ...b, candidate };
  });
}

export const STOPGAP_SKILL = 40;

// ─── Overrules ───────────────────────────────────────────────────────────────

/** The seats a chief executive can overrule, or fire: every filled seat but their own. */
export const overrulable = (seats: Role[]): Role[] => seats.filter((r) => r !== "ceo");

/**
 * Whose call was better, measured on what the year left the founders owning.
 * Close calls go to the seat: overruling somebody ought to have to be right.
 */
export function whoWasRight(asOverruled: number, asFiled: number): "ceo" | "seat" {
  return asOverruled > asFiled * 1.005 ? "ceo" : "seat";
}

// ─── The year closed: objectives, bonuses, hires and resignations ────────────

/** What the tick has to do in the database because of how the year closed. */
export interface SeatMove {
  companyId: string;
  role: Role;
  /** Fired by the chief executive, or resigned because their loyalty ran out. */
  why: "fired" | "resigned";
  /** How good whoever now sits there is. */
  skill: number;
}

/** A met objective, and how loyal the replacement arrives. */
export const HIRED_LOYALTY = 75;

/**
 * Everything the people side of the year does once objectives are marked.
 *
 * Pure: it takes the resolved world, the year's decisions and each seat's
 * objective outcome, and returns the companies as they should be saved, the
 * notes each report should carry, and the seat moves the database has to
 * make. Nothing here touches a seat row, so it can be tested without one and
 * a retried year cannot move anybody twice.
 */
export function closeYear(input: {
  seasonId: string;
  year: number;
  companies: Company[];
  decisions: { companyId: string; ceo?: { bonusPool?: number; replaceSeat?: Role | ""; replaceBid?: number } }[];
  /** Each seat's objective outcome, by company. */
  outcomes: Map<string, { role: Role; outcome: "met" | "partial" | "missed" }[]>;
  /** Who was right about each overrule, where there was one. */
  verdicts?: Map<string, { role: Role; right: "ceo" | "seat" }>;
}): { companies: Company[]; notes: Map<string, string[]>; moves: SeatMove[] } {
  const notes = new Map<string, string[]>();
  const say = (id: string, line: string) => notes.set(id, [...(notes.get(id) ?? []), line]);
  const moves: SeatMove[] = [];
  const title = (r: Role) => ({ ceo: "chief executive", cmo: "marketing seat", cfo: "finance seat", cto: "technology seat", coo: "operations seat" })[r];

  let companies = input.companies.map((company) => {
    if (company.kind !== "player") return company;
    const d = input.decisions.find((x) => x.companyId === company.id);
    const people = { ...(company.people ?? {}) };
    let cash = company.cash;

    // Objectives: loyalty by how hard they were pushed, and the bonus pot to those who made it.
    const results = (input.outcomes.get(company.id) ?? []).filter((r) => r.role !== "ceo" && company.seats.includes(r.role));
    const eligible = company.seats.filter((r) => r !== "ceo").length || 1;
    const pot = Math.max(0, d?.ceo?.bonusPool ?? 0);
    const share = pot / eligible;
    const met = results.filter((r) => r.outcome === "met");
    for (const r of results) {
      const person = personOf({ people }, r.role);
      const stretch = person.stretch ?? "fair";
      let loyalty = person.loyalty + OUTCOME_LOYALTY[stretch][r.outcome];
      if (r.outcome === "met" && share > 0) loyalty += bonusLoyalty(share);
      people[r.role] = { ...person, loyalty: Math.max(0, Math.min(100, Math.round(loyalty * 10) / 10)) };
    }
    if (pot > 0) {
      const paid = share * met.length;
      cash -= paid;
      say(company.id, met.length > 0
        ? `The bonus pot paid ${Math.round(paid).toLocaleString()} to the ${met.map((r) => title(r.role)).join(", ")}, for meeting their objectives.`
        : "Nobody met their objective, so the bonus pot stayed in the bank.");
    }

    // The overrule, judged.
    const verdict = input.verdicts?.get(company.id);
    if (verdict) {
      const person = personOf({ people }, verdict.role);
      people[verdict.role] = { ...person, record: [...(person.record ?? []), { year: input.year, right: verdict.right }].slice(-10) };
      say(company.id, verdict.right === "ceo"
        ? `Run the other way, the ${title(verdict.role)}'s plan would have left the company worth less. The chief executive's overrule was right.`
        : `Run the other way, the ${title(verdict.role)}'s own plan would have done at least as well. The overrule was a mistake, and the record says so.`);
    }

    return { ...company, people, cash };
  });

  // The executive market: every firing this year, bidding for the same people.
  const bids = input.decisions
    .map((d) => ({ companyId: d.companyId, role: d.ceo?.replaceSeat as Role, bid: Math.max(0, d.ceo?.replaceBid ?? 0) }))
    .filter((b) => b.role && b.role !== "ceo" && companies.some((c) => c.id === b.companyId && c.kind === "player" && c.seats.includes(b.role)));
  const hires = settleHires({ seasonId: input.seasonId, year: input.year, bids });
  for (const hire of hires) {
    const skill = hire.candidate?.skill ?? STOPGAP_SKILL;
    companies = companies.map((c) => c.id !== hire.companyId ? c : {
      ...c,
      cash: c.cash - hire.bid - SEVERANCE,
      people: { ...(c.people ?? {}), [hire.role]: { loyalty: HIRED_LOYALTY, skill, stretch: "fair" } },
    });
    moves.push({ companyId: hire.companyId, role: hire.role, why: "fired", skill });
    say(hire.companyId, hire.candidate
      ? `The chief executive replaced the ${title(hire.role)}. The new one, bid for at ${Math.round(hire.bid).toLocaleString()} against the rest of the market, is rated ${skill}. Severance was ${SEVERANCE.toLocaleString()}.`
      : `The chief executive replaced the ${title(hire.role)}, but the market had nobody left by the time the bid was reached: a stopgap, rated ${skill}, is in the chair.`);
  }

  // Resignations: whoever's loyalty has run out, and was not just hired.
  companies = companies.map((c) => {
    if (c.kind !== "player") return c;
    const people = { ...(c.people ?? {}) };
    for (const role of c.seats) {
      if (role === "ceo" || moves.some((m) => m.companyId === c.id && m.role === role)) continue;
      const person = people[role];
      if (!person || person.loyalty > RESIGN_AT) continue;
      const skill = Math.round(45 + rng(`${input.seasonId}:${input.year}:${c.id}:${role}:resign`)() * 20);
      people[role] = { loyalty: LOYALTY_START, skill, stretch: "fair" };
      moves.push({ companyId: c.id, role, why: "resigned", skill });
      say(c.id, `The ${title(role)} resigned: loyalty had fallen to ${Math.round(person.loyalty)}. A replacement, rated ${skill}, starts now.`);
    }
    return { ...c, people };
  });

  return { companies, notes, moves };
}

/** An objective's goals moved by how hard the chief executive pushed it. */
export function stretchChallenge<T extends { title: string; targets: { goal: number; compare: "at_least" | "at_most"; metric: string; label: string }[] }>(challenge: T, stretch: Stretch | undefined): T {
  if (!stretch || stretch === "fair") return challenge;
  const outOfHundred = new Set(["reputation", "quality", "brand", "service"]);
  /*
   * The label carries the number ("Get capacity to 299,000"), so it is
   * rewritten with the new one — however the number was written in it.
   */
  const relabel = (label: string, from: number, to: number) => {
    for (const [a, b] of [[from.toLocaleString(), to.toLocaleString()], [String(from), String(to)], [String(Math.round(from)), String(Math.round(to))]]) {
      if (label.includes(a)) return label.replace(a, b);
    }
    return label;
  };
  return {
    ...challenge,
    title: `${challenge.title}${stretch === "aggressive" ? " (pushed hard)" : " (kept easy)"}`,
    targets: challenge.targets.map((t) => {
      const goal = stretchGoal(t.goal, t.compare, stretch, outOfHundred.has(t.metric));
      return { ...t, goal, label: relabel(t.label, t.goal, goal) };
    }),
  };
}
