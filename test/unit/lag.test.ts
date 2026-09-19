/**
 * How long things take to work.
 *
 * Almost everything used to land in the year it was decided, which made a
 * fourteen-year season into fourteen one-year games. These pin the four lags
 * that make planning matter — each checked in the engine itself, not just in
 * the helper, because a helper nobody calls is a promise nobody keeps.
 */
import { describe, it, expect } from "vitest";
import { resolveYear } from "@shared/simulation/resolve";
import { startingCompany } from "@shared/simulation/season";
import { seedIncumbents } from "@shared/simulation/incumbents";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type Company, type World } from "@shared/simulation/types";
import { BRAND_NOW, brandLanding, capacityBuild, qualityLanding, staffing } from "@shared/simulation/lag";
import { SALARY } from "@shared/simulation/decisions";

const niche = nicheById("dating_apps")!;
const team = (over: Partial<Company> = {}): Company => ({
  ...startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] }),
  ...over,
});
const world = (c: Company, year = 1): World => ({
  seasonId: "s", niche, year,
  economy: { demand: 1, interestRate: 0.08, costIndex: 1, outlook: "steady" },
  companies: [...seedIncumbents(niche), c],
});
const quiet = (over: any = {}) => ({
  companyId: "t",
  cmo: { price: 22, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: [], ...over.cmo },
  cto: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0, ...over.cto },
  coo: { capacityTarget: 90_000, supportSpend: 0, efficiencySpend: 0, headcount: 0, ...over.coo },
  cfo: { borrow: 0, repay: 0, cashBuffer: 0, ...over.cfo },
  ceo: { focus: "growth", ...over.ceo },
});
const t = (r: any) => r.reports.find((x: any) => x.companyId === "t");
const carried = (r: any) => r.world.companies.find((x: any) => x.id === "t") as Company;

describe("brand takes two years to land", () => {
  it("splits a campaign across this year and next", () => {
    const b = brandLanding({ brandPipeline: 0 }, 10);
    expect(b.now).toBeCloseTo(10 * BRAND_NOW);
    expect(b.next).toBeCloseTo(10 * (1 - BRAND_NOW));
  });

  it("adds last year's second half on top of this year's first", () => {
    expect(brandLanding({ brandPipeline: 4 }, 10).now).toBeCloseTo(4 + 10 * BRAND_NOW);
  });

  it("carries the rest into next year in the engine", () => {
    const r = resolveYear(world(team()), [quiet({ cmo: { brandSpend: 800_000 } })]);
    expect(carried(r).brandPipeline, "half the campaign is still on its way").toBeGreaterThan(0);

    const idle = resolveYear(world(team()), [quiet()]);
    const lift = t(r).brand - t(idle).brand;
    const pending = carried(r).brandPipeline ?? 0;
    expect(lift, "this year sees about half").toBeCloseTo(pending, 0);
  });

  it("leaves performance marketing immediate — paying for clicks buys this year's clicks", () => {
    const r = resolveYear(world(team()), [quiet({ cmo: { performanceSpend: 800_000 } })]);
    expect(carried(r).brandPipeline ?? 0).toBe(0);
    expect(t(r).brand).toBeGreaterThan(t(resolveYear(world(team()), [quiet()])).brand);
  });
});

describe("quality is felt a year after it is built", () => {
  it("ships this year into next year's product", () => {
    const shipping = resolveYear(world(team()), [quiet({ cto: { featureSpend: 800_000 } })]);
    const idle = resolveYear(world(team()), [quiet()]);
    expect(t(shipping).quality, "no change this year").toBeCloseTo(t(idle).quality, 5);
    expect(carried(shipping).pipeline, "it is on its way").toBeGreaterThan(0);

    const next = resolveYear({ ...shipping.world, year: 2 }, [quiet()]);
    const nextIdle = resolveYear({ ...idle.world, year: 2 }, [quiet()]);
    expect(t(next).quality, "and arrives the year after").toBeGreaterThan(t(nextIdle).quality);
  });

  it("moves research one step closer each year", () => {
    const q = qualityLanding({ pipeline: 2, pipelineLater: 5 }, 3, 7);
    expect(q.landed).toBe(2);
    expect(q.pipeline, "this year's shipping plus last year's research").toBe(3 + 5);
    expect(q.pipelineLater).toBe(7);
  });
});

describe("capacity opens the year after it is built", () => {
  it("serves this year with what the company already had", () => {
    const b = capacityBuild({ capacity: 90_000 }, 400_000);
    expect(b.now).toBe(90_000);
    expect(b.next).toBe(400_000);
    expect(b.building).toBe(310_000);
  });

  it("makes a cut immediate — you can close a floor faster than you can fit one out", () => {
    const b = capacityBuild({ capacity: 90_000 }, 40_000);
    expect(b.now).toBe(40_000);
    expect(b.building).toBe(0);
  });

  it("opens the new room next year in the engine", () => {
    const start = team({ capacity: 90_000 });
    const r = resolveYear(world(start), [quiet({ coo: { capacityTarget: 400_000 } })]);
    expect(carried(r).capacity, "open for next year").toBe(400_000);
    expect(t(r).notes.join(" ")).toMatch(/opens next year/i);
  });

  /*
   * Idle capacity costs money, so building early is not free — but capacity
   * that is still being built is not idle yet, and must not be charged as if
   * it were.
   */
  it("does not charge this year for room that is not open yet", () => {
    const small = resolveYear(world(team({ capacity: 90_000 })), [quiet({ coo: { capacityTarget: 90_000 } })]);
    const building = resolveYear(world(team({ capacity: 90_000 })), [quiet({ coo: { capacityTarget: 900_000 } })]);
    expect(t(building).pnl!.idleCapacity).toBe(t(small).pnl!.idleCapacity);
  });
});

describe("a new hire is paid from day one and useful from year two", () => {
  it("counts only last year's staff as established", () => {
    const s = staffing({ staff: 3 }, 8);
    expect(s.established).toBe(3);
    expect(s.newHires).toBe(5);
    expect(s.next).toBe(8);
    expect(s.supportEquivalent).toBeGreaterThan(3 * SALARY);
  });

  it("adds nothing to service in the year somebody is hired", () => {
    const hiring = resolveYear(world(team({ staff: 0 })), [quiet({ coo: { headcount: 10 } })]);
    const none = resolveYear(world(team({ staff: 0 })), [quiet({ coo: { headcount: 0 } })]);
    expect(t(hiring).service).toBeCloseTo(t(none).service, 5);
    expect(t(hiring).pnl!.salaries, "but they are on the payroll").toBeGreaterThan(t(none).pnl!.salaries);
    expect(t(hiring).notes.join(" ")).toMatch(/new hires/i);
  });

  /*
   * The case for hiring at all: it used to buy nothing but a salary. Once
   * established, staff are service the company keeps rather than rents.
   */
  it("makes established staff worth having", () => {
    const staffed = resolveYear(world(team({ staff: 10 })), [quiet({ coo: { headcount: 10 } })]);
    const none = resolveYear(world(team({ staff: 0 })), [quiet({ coo: { headcount: 0 } })]);
    expect(t(staffed).service).toBeGreaterThan(t(none).service);
  });
});
