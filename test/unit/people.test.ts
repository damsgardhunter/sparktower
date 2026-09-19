/**
 * The people responsibilities, held to the same promise as the money ones:
 * each has a setting where it helps and one where it hurts, and a company
 * that touches none of it plays exactly as before.
 */
import { describe, it, expect } from "vitest";
import { resolveYear as resolveWithNews } from "@shared/simulation/resolve";
import { startingCompany, decisionsForYear } from "@shared/simulation/season";
import { seedIncumbents } from "@shared/simulation/incumbents";
import { nicheById } from "@shared/simulation/niches";
import { validateDecision, cleanDecision } from "@shared/simulation/levers";
import {
  LOYALTY_START, OVERRULE_LOYALTY, RESIGN_AT, SEVERANCE, STOPGAP_SKILL, candidatesFor, closeYear, effort, payEffect,
  poached, settleHires, staffLeverage, staffQualityNext, stretchChallenge, stretchGoal, whoWasRight, yearLoyalty,
} from "@shared/simulation/people";
import { UNLOCKS } from "@shared/simulation/responsibilities";
import { ROLES, type Company, type World } from "@shared/simulation/types";

const niche = nicheById("dating_apps")!;
const team = (over: Partial<Company> = {}): Company => ({
  ...startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] }),
  cash: 20_000_000,
  customers: { swipers: 200_000, recently_single: 120_000, long_haulers: 40_000 },
  capacity: 900_000,
  ...over,
});
const world = (c: Company, year = 6): World => ({
  seasonId: "ppl", niche, year,
  economy: { demand: 1, interestRate: 0.06, costIndex: 1, outlook: "steady" },
  companies: [...seedIncumbents(niche), c],
});
const plain = (over: any = {}) => ({
  companyId: "t",
  cmo: { price: 55, brandSpend: 400_000, performanceSpend: 300_000, celebritySpend: 0, targetCities: [], ...over.cmo },
  cto: { featureSpend: 600_000, reliabilitySpend: 200_000, techDebtPaydown: 0, ...over.cto },
  coo: { capacityTarget: 900_000, supportSpend: 300_000, efficiencySpend: 0, headcount: 20, ...over.coo },
  cfo: { borrow: 0, repay: 0, cashBuffer: 0, ...over.cfo },
  ceo: { focus: "growth", ...over.ceo },
});
const resolveYear = (w: World, d: any[]) => resolveWithNews(w, d, undefined, { withoutEvent: true });
const report = (r: any) => r.reports.find((x: any) => x.companyId === "t");
const after = (r: any) => r.world.companies.find((x: any) => x.id === "t") as Company;

describe("a company that touches none of it", () => {
  it("has seats that work at exactly their usual rate", () => {
    expect(effort({ loyalty: LOYALTY_START, skill: 60 })).toBe(1);
    expect(payEffect(undefined)).toEqual({ pay: 1, cost: 1, output: 1 });
  });
});

describe("the schedule", () => {
  it("brings the people levers in from year three, and firing last", () => {
    const at = (role: string, field: string) => UNLOCKS.find((u) => u.role === role && u.field === field)?.year;
    expect(at("ceo", "targets")).toBe(3);
    expect(at("ceo", "overrule")).toBe(5);
    expect(at("ceo", "replaceSeat")).toBe(6);
    expect(at("cto", "engineerPay")).toBe(3);
    expect(at("coo", "trainingSpend")).toBe(4);
    expect(at("cfo", "costReview")).toBe(5);
  });
});

describe("loyalty", () => {
  it("changes what a seat's money buys, never what it costs", () => {
    const loyal = team({ people: { cmo: { loyalty: 95, skill: 60 } } });
    const bitter = team({ people: { cmo: { loyalty: 10, skill: 60 } } });
    const a = resolveYear(world(loyal), [plain()]);
    const b = resolveYear(world(bitter), [plain()]);
    expect(report(a).pnl.marketing).toBe(report(b).pnl.marketing);
    expect(after(a).brand).toBeGreaterThan(after(b).brand);
  });

  it("drifts back to ordinary, rises with a good year, and falls with an overrule", () => {
    const base = { person: { loyalty: 50, skill: 60 }, role: "cmo" as const, profitable: false, rescued: false, overruled: false, scar: 0, pay: 1 };
    expect(yearLoyalty(base)).toBeGreaterThan(50);
    expect(yearLoyalty({ ...base, profitable: true })).toBeGreaterThan(yearLoyalty(base));
    expect(yearLoyalty({ ...base, overruled: true })).toBeCloseTo(yearLoyalty(base) - OVERRULE_LOYALTY, 5);
    expect(yearLoyalty({ ...base, scar: 10 })).toBeLessThan(yearLoyalty(base));
  });

  it("warns before a seat goes", () => {
    const edgy = team({ people: { cfo: { loyalty: 31, skill: 60 } } });
    const r = resolveYear(world(edgy), [plain({ ceo: { overrule: "cfo" } })]);
    expect(report(r).notes.join(" ")).toMatch(/thinking about leaving/i);
  });
});

describe("targets", () => {
  it("move the goal a tenth either way, and never past a hundred on a score", () => {
    expect(stretchGoal(100_000, "at_least", "aggressive")).toBe(112_000);
    expect(stretchGoal(100_000, "at_least", "easy")).toBe(92_000);
    expect(stretchGoal(95, "at_least", "aggressive", true)).toBe(100);
    expect(stretchGoal(1_000, "at_most", "aggressive")).toBeLessThan(1_000);
  });

  it("rewrite the objective's own words with the new number", () => {
    const c = { title: "Grow", targets: [{ goal: 299_000, compare: "at_least" as const, metric: "capacity", label: "Get capacity to 299,000" }] };
    const hard = stretchChallenge(c, "aggressive");
    expect(hard.targets[0].label).toBe(`Get capacity to ${(334_880).toLocaleString()}`);
    expect(hard.title).toMatch(/pushed hard/);
    expect(stretchChallenge(c, "fair")).toBe(c);
  });

  /*
   * The trade: an aggressive target gets more out of a seat this year, and
   * missing it costs far more loyalty than missing a fair one.
   */
  it("get more effort out of people, and cost more when missed", () => {
    expect(effort({ loyalty: 70, skill: 60, stretch: "aggressive" })).toBeGreaterThan(1);
    const pushed = team({ people: { cmo: { loyalty: 70, skill: 60, stretch: "aggressive" } } });
    const fair = team({ people: { cmo: { loyalty: 70, skill: 60, stretch: "fair" } } });
    const close = (c: Company, outcome: "met" | "missed") => closeYear({
      seasonId: "s", year: 6, companies: [c], decisions: [{ companyId: "t" }],
      outcomes: new Map([["t", [{ role: "cmo", outcome }]]]),
    }).companies[0].people!.cmo!.loyalty;
    expect(close(pushed, "missed")).toBeLessThan(close(fair, "missed"));
    expect(close(pushed, "met")).toBeGreaterThan(close(fair, "met"));
  });

  it("are stored for next year's objectives, as the chief executive set them", () => {
    const r = resolveYear(world(team()), [plain({ ceo: { targets: { cto: "aggressive", cmo: "easy" } } })]);
    expect(after(r).people?.cto?.stretch).toBe("aggressive");
    expect(after(r).people?.cmo?.stretch).toBe("easy");
    expect(after(r).people?.coo?.stretch).toBe("fair");
  });

  it("accept only the three answers, and only for seats that exist", () => {
    expect(validateDecision("ceo", { focus: "growth", targets: { cmo: "brutal" } }, team()).ok).toBe(false);
    const clean = cleanDecision("ceo", { focus: "growth", targets: { cmo: "aggressive", ceo: "easy", nobody: "fair" } }, [], { year: 3 });
    expect(clean.targets).toEqual({ cmo: "aggressive" });
  });
});

describe("the bonus pot", () => {
  it("pays only the seats that met their objective, and buys loyalty with it", () => {
    const c = team();
    const out = closeYear({
      seasonId: "s", year: 6, companies: [c],
      decisions: [{ companyId: "t", ceo: { bonusPool: 400_000 } }],
      outcomes: new Map([["t", [{ role: "cmo", outcome: "met" }, { role: "cto", outcome: "missed" }]]]),
    });
    const paid = c.cash - out.companies[0].cash;
    expect(paid).toBeCloseTo(100_000, 0); // a quarter of the pot: one of four seats met theirs
    expect(out.companies[0].people!.cmo!.loyalty).toBeGreaterThan(out.companies[0].people!.cto!.loyalty);
  });
});

describe("the overrule", () => {
  it("runs last year's plan in that chair, and remembers what was filed", () => {
    const company = team();
    const previous: any = { companyId: "t", cmo: { price: 30, brandSpend: 100_000, performanceSpend: 0, celebritySpend: 0, targetCities: [] } };
    const submitted: any = {
      cmo: { price: 90, brandSpend: 900_000, performanceSpend: 0, celebritySpend: 0, targetCities: [] },
      ceo: { focus: "growth", overrule: "cmo" },
    };
    const out = decisionsForYear({ company, niche, submitted, previous });
    expect(out.decisions.cmo?.price).toBe(30);
    expect(out.overruled?.role).toBe("cmo");
    expect((out.overruled?.filed as any).price).toBe(90);
  });

  it("cannot overrule an empty chair or one with nothing to go back to", () => {
    const out = decisionsForYear({ company: team(), niche, submitted: { ceo: { focus: "growth", overrule: "cmo" } } as any });
    expect(out.overruled).toBeUndefined();
    expect((out.decisions.ceo as any).overrule).toBe("");
  });

  it("gives close calls to the seat", () => {
    expect(whoWasRight(100.1, 100)).toBe("seat");
    expect(whoWasRight(110, 100)).toBe("ceo");
  });
});

describe("the executive market", () => {
  it("offers the same people to everybody firing in the same year", () => {
    expect(candidatesFor("s", 6)).toEqual(candidatesFor("s", 6));
    expect(candidatesFor("s", 6)).not.toEqual(candidatesFor("s", 7));
  });

  it("gives the best candidate left to the highest bid, and a stopgap to whoever is last", () => {
    const hires = settleHires({ seasonId: "s", year: 6, bids: [
      { companyId: "a", role: "cmo", bid: 100 }, { companyId: "b", role: "cto", bid: 900 },
      { companyId: "c", role: "coo", bid: 500 }, { companyId: "d", role: "cfo", bid: 50 },
    ] });
    expect(hires.map((h) => h.companyId)).toEqual(["b", "c", "a", "d"]);
    const skills = hires.map((h) => h.candidate?.skill ?? STOPGAP_SKILL);
    expect(skills[0]).toBeGreaterThanOrEqual(skills[1]);
    expect(hires[3].candidate, "three people, four bids").toBeNull();
  });

  it("charges the bid and the severance, and seats the hire", () => {
    const c = team();
    const out = closeYear({
      seasonId: "s", year: 6, companies: [c],
      decisions: [{ companyId: "t", ceo: { replaceSeat: "coo", replaceBid: 300_000 } }],
      outcomes: new Map(),
    });
    expect(c.cash - out.companies[0].cash).toBeCloseTo(300_000 + SEVERANCE, 0);
    expect(out.moves).toEqual([{ companyId: "t", role: "coo", why: "fired", skill: expect.any(Number) }]);
  });
});

describe("resignations", () => {
  it("replace a seat whose loyalty has run out", () => {
    const c = team({ people: { cfo: { loyalty: RESIGN_AT - 1, skill: 60 } } });
    const out = closeYear({ seasonId: "s", year: 6, companies: [c], decisions: [{ companyId: "t" }], outcomes: new Map() });
    expect(out.moves.map((m) => [m.role, m.why])).toEqual([["cfo", "resigned"]]);
    expect(out.companies[0].people!.cfo!.loyalty).toBe(LOYALTY_START);
    expect(out.notes.get("t")!.join(" ")).toMatch(/resigned/);
  });
});

describe("engineer pay", () => {
  /*
   * The trade: above market, the product moves faster and each point costs
   * more; below it, each point is cheaper and some years the market takes a
   * quarter of the work in flight.
   */
  it("buys more quality above market, at a worse price per point", () => {
    const hi = payEffect(120);
    expect(hi.output).toBeGreaterThan(1);
    expect(hi.output / hi.cost).toBeLessThan(1);
    const lo = payEffect(80);
    expect(lo.output / lo.cost).toBeGreaterThan(1);
  });

  it("is charged on the product bill and reaches the pipeline", () => {
    const a = resolveYear(world(team()), [plain({ cto: { engineerPay: 100 } })]);
    const b = resolveYear(world(team()), [plain({ cto: { engineerPay: 125 } })]);
    expect(report(b).pnl.product).toBeCloseTo(report(a).pnl.product * 1.25, 0);
    expect(after(b).pipeline!).toBeGreaterThan(after(a).pipeline!);
  });

  it("gets engineers poached only below market, and more often the further below", () => {
    const hits = (pay: number) => Array.from({ length: 400 }, (_, i) => poached(pay, `p${i}`).hit).filter(Boolean).length;
    expect(hits(1)).toBe(0);
    expect(hits(0.8)).toBeGreaterThan(hits(0.9));
  });
});

describe("recruiting and training", () => {
  it("land next year, and good staff are worth more support", () => {
    expect(staffLeverage(50)).toBe(1);
    expect(staffLeverage(90)).toBeGreaterThan(1);
    const trained = staffQualityNext({ quality: 50, established: 20, newHires: 0, recruiting: 0, training: 300_000 });
    const neglected = staffQualityNext({ quality: 50, established: 20, newHires: 0, recruiting: 0, training: 0 });
    expect(trained).toBeGreaterThan(50);
    expect(neglected).toBeLessThan(50);
    const hiredWell = staffQualityNext({ quality: 50, established: 0, newHires: 10, recruiting: 400_000, training: 0 });
    const hiredBadly = staffQualityNext({ quality: 50, established: 0, newHires: 10, recruiting: 0, training: 0 });
    expect(hiredWell).toBeGreaterThan(hiredBadly);
  });

  it("are operations' money, and move staff quality through the engine", () => {
    const r = resolveYear(world(team()), [plain({ coo: { trainingSpend: 400_000, recruitingSpend: 200_000 } })]);
    const base = resolveYear(world(team()), [plain()]);
    expect(report(r).pnl.operations - report(base).pnl.operations).toBeCloseTo(600_000, 0);
    expect(after(r).staffQuality!).toBeGreaterThan(after(base).staffQuality!);
  });
});

describe("the cost review", () => {
  /*
   * The trade: margin now, service and morale next year.
   */
  it("cuts overhead this year and costs service and loyalty the next", () => {
    const cut = resolveYear(world(team()), [plain({ cfo: { costReview: 20 } })]);
    const none = resolveYear(world(team()), [plain()]);
    expect(report(cut).pnl.salaries).toBeLessThan(report(none).pnl.salaries);
    expect(after(cut).reviewScar).toBe(20);

    const next = resolveYear({ ...cut.world, year: 7 }, [plain()]);
    const nextNone = resolveYear({ ...none.world, year: 7 }, [plain()]);
    expect(after(next).service).toBeLessThan(after(nextNone).service);
    expect(after(next).people!.cmo!.loyalty).toBeLessThan(after(nextNone).people!.cmo!.loyalty);
  });
});
