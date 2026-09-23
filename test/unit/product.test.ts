/**
 * The product bets, held to the same promise as the other responsibilities:
 * each has a setting where it helps and one where it hurts. Where a bet is a
 * matter of chance, it is checked over many seeded seasons rather than one,
 * because "about one in four flops" is a claim about many years.
 */
import { describe, it, expect } from "vitest";
import { resolveYear as resolveWithNews } from "@shared/simulation/resolve";
import { startingCompany } from "@shared/simulation/season";
import { seedIncumbents } from "@shared/simulation/incumbents";
import { NICHES, nicheById } from "@shared/simulation/niches";
import { forecastDemand } from "@shared/simulation/forecast";
import { forecastOutcome } from "@shared/simulation/responsibilities";
import {
  BUILD_LIFT, COPY_LIFT, FEATURES, breachChance, dataEffects, featureAppeal, featureCost, featureMenu, featuresOf,
  outageChance, placeBet, prOutcome, referralBrand,
} from "@shared/simulation/product";
import { ROLES, type Company, type World } from "@shared/simulation/types";

const niche = nicheById("dating_apps")!;
const team = (over: Partial<Company> = {}): Company => ({
  ...startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] }),
  cash: 20_000_000,
  customers: { swipers: 200_000, recently_single: 120_000, long_haulers: 40_000 },
  capacity: 900_000,
  ...over,
});
const world = (c: Company, year = 5, seasonId = "prod"): World => ({
  seasonId, niche, year,
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

describe("the feature menu", () => {
  it("has ideas for every segment in every market", () => {
    for (const n of NICHES) {
      const ideas = featuresOf(n);
      for (const s of n.segments) expect(ideas.some((f) => f.segment === s.id), `${n.id}/${s.id}`).toBe(true);
      if (FEATURES[n.id]) expect(new Set(ideas.map((f) => f.id)).size).toBe(ideas.length);
    }
  });

  it("offers the same three to every team in a season, one of them already a rival's", () => {
    const a = featureMenu(niche, "s", 4);
    expect(a).toEqual(featureMenu(niche, "s", 4));
    expect(a).toHaveLength(3);
    expect(a.filter((m) => m.rivalHas)).toHaveLength(1);
  });

  it("prices a feature against the size of the market, and a copy at 40%", () => {
    expect(featureCost(niche, "copy") / featureCost(niche, "build")).toBeCloseTo(0.4, 2);
    for (const n of NICHES) expect(featureCost(n)).toBeGreaterThan(100_000);
  });
});

describe("feature bets", () => {
  const idea = FEATURES.dating_apps.find((f) => f.id === "ai_matching")!;

  it("flop about one time in four when built, more when shipped fast, fewer when got right", () => {
    const flops = (pace: string) => Array.from({ length: 600 }, (_, i) => placeBet({ idea, mode: "build", pace, year: 4, seed: `f${i}` }))
      .filter((b) => b.flopped).length / 600;
    expect(flops("balanced")).toBeGreaterThan(0.18);
    expect(flops("balanced")).toBeLessThan(0.32);
    expect(flops("ship")).toBeGreaterThan(flops("balanced"));
    expect(flops("right")).toBeLessThan(flops("balanced"));
  });

  it("land next year when built, now when copied or shipped fast, and a copy is worth half and never flops", () => {
    const built = placeBet({ idea, mode: "build", year: 4, seed: "x" });
    expect(built.lands).toBe(5);
    expect(placeBet({ idea, mode: "build", pace: "ship", year: 4, seed: "x" }).lands).toBe(4);
    const copied = Array.from({ length: 50 }, (_, i) => placeBet({ idea, mode: "copy", year: 4, seed: `c${i}` }));
    expect(copied.every((c) => c.lands === 4 && !c.flopped && c.lift === COPY_LIFT)).toBe(true);
    expect(COPY_LIFT).toBe(BUILD_LIFT / 2);
  });

  it("make the company more appealing to the segment it was built for, and nobody else", () => {
    const c = { features: [{ id: "ai", name: "AI", segment: "long_haulers", lift: BUILD_LIFT, lands: 5, mode: "build" as const }] };
    expect(featureAppeal(c, "long_haulers", 4), "not before it lands").toBe(1);
    expect(featureAppeal(c, "long_haulers", 5)).toBeCloseTo(1 + BUILD_LIFT, 6);
    expect(featureAppeal(c, "swipers", 5)).toBe(1);
  });

  it("are charged when placed, and win customers once they land", () => {
    const menu = featureMenu(niche, "prod", 5);
    const pick = menu.find((m) => m.rivalHas)!;
    const withBet = resolveYear(world(team()), [plain({ cto: { featureBet: pick.id, featureMode: "copy" } })]);
    const without = resolveYear(world(team()), [plain()]);
    expect(report(withBet).pnl.product - report(without).pnl.product).toBeCloseTo(featureCost(niche, "copy"), 0);
    const seg = pick.segment;
    expect(after(withBet).customers[seg], "a copy is live the year it is copied").toBeGreaterThan(after(without).customers[seg]);
  });

  it("cannot copy what nobody has: it is built instead, and the report says so", () => {
    const menu = featureMenu(niche, "prod", 5);
    const fresh = menu.find((m) => !m.rivalHas)!;
    const r = resolveYear(world(team()), [plain({ cto: { featureBet: fresh.id, featureMode: "copy" } })]);
    expect(after(r).features![0].mode).toBe("build");
    expect(report(r).notes.join(" ")).toMatch(/Nobody had .* to copy/);
  });

  it("ignore an idea that is not on this year's menu", () => {
    const r = resolveYear(world(team()), [plain({ cto: { featureBet: "made_up" } })]);
    expect(after(r).features ?? []).toEqual([]);
  });
});

describe("pace", () => {
  it("ships some quality now and leaves more debt; getting it right leaves less", () => {
    const ship = resolveYear(world(team({ quality: 40 })), [plain({ ceo: { pace: "ship" } })]);
    const right = resolveYear(world(team({ quality: 40 })), [plain({ ceo: { pace: "right" } })]);
    const balanced = resolveYear(world(team({ quality: 40 })), [plain({ ceo: { pace: "balanced" } })]);
    expect(after(ship).quality, "part of it lands now").toBeGreaterThan(after(balanced).quality);
    expect(after(ship).techDebt!).toBeGreaterThan(after(balanced).techDebt!);
    expect(after(right).techDebt!).toBeLessThan(after(balanced).techDebt!);
    expect(report(ship).notes.join(" ")).toMatch(/Shipped fast/);
  });
});

describe("security, breaches and outages", () => {
  it("makes a breach less likely, debt makes it more likely", () => {
    expect(breachChance(80, 0)).toBeLessThan(breachChance(0, 0));
    expect(breachChance(0, 80)).toBeGreaterThan(breachChance(0, 0));
  });

  it("happen through the engine to companies without security, more often than with it", () => {
    const breaches = (security: number) => Array.from({ length: 200 }, (_, i) =>
      resolveYear(world(team({ security, techDebt: 40 }), 5, `b${i}`), [plain()]))
      .filter((r) => /data breach/i.test(report(r).notes.join(" "))).length;
    const none = breaches(0);
    expect(none).toBeGreaterThan(5);
    expect(breaches(90)).toBeLessThan(none);
  });

  it("never before the security lever exists", () => {
    const year1 = Array.from({ length: 200 }, (_, i) => resolveYear(world(team({ techDebt: 90 }), 1, `y${i}`), [plain()]))
      .filter((r) => /data breach/i.test(report(r).notes.join(" "))).length;
    expect(year1).toBe(0);
  });

  it("outages come from debt, and reliability work makes them rarer", () => {
    expect(outageChance(20, 0)).toBe(0);
    expect(outageChance(80, 0)).toBeGreaterThan(0.2);
    expect(outageChance(80, 600_000)).toBeLessThan(outageChance(80, 0));
  });
});

describe("data", () => {
  it("is a gift to the other seats: a narrower forecast, more room to be right, better-aimed spending", () => {
    const e = dataEffects(100);
    expect(e.band).toBeLessThan(1);
    expect(e.tolerance).toBeGreaterThan(0);
    expect(e.aim).toBeGreaterThan(1);
    expect(forecastOutcome(100, 116, 1_000_000, e.tolerance)!.verdict, "16% off, and still counted as right").toBe("good");
    expect(forecastOutcome(100, 116, 1_000_000)!.verdict).toBe("fine");

    const w = world(team({ data: 100 }));
    const withData = forecastDemand({ world: w, companyId: "t", year: 5, economy: w.economy })!;
    const w2 = world(team({ data: 0 }));
    const without = forecastDemand({ world: w2, companyId: "t", year: 5, economy: w2.economy })!;
    expect(withData.band).toBeLessThan(without.band);
  });

  it("builds up through the engine and is charged to the product bill", () => {
    const r = resolveYear(world(team()), [plain({ cto: { dataSpend: 300_000 } })]);
    const base = resolveYear(world(team()), [plain()]);
    expect(after(r).data!).toBeGreaterThan(0);
    expect(report(r).pnl.product - report(base).pnl.product).toBeCloseTo(300_000, 0);
  });
});

describe("channels", () => {
  it("PR lands a little more than half the time, and sometimes backfires", () => {
    const outcomes = Array.from({ length: 1000 }, (_, i) => prOutcome(200_000, `pr${i}`).landed);
    const hits = outcomes.filter((o) => o === "hit").length / 1000;
    expect(hits).toBeGreaterThan(0.48);
    expect(hits).toBeLessThan(0.62);
    expect(outcomes.filter((o) => o === "backfire").length).toBeGreaterThan(50);
    expect(prOutcome(0, "x").landed).toBeNull();
  });

  it("a referral programme is worth nothing for a poor product and a lot for a great one", () => {
    expect(referralBrand(300_000, 35)).toBe(0);
    expect(referralBrand(300_000, 95)).toBeGreaterThan(referralBrand(300_000, 60));
  });

  it("both are marketing money", () => {
    const r = resolveYear(world(team()), [plain({ cmo: { prSpend: 100_000, referralSpend: 150_000 } })]);
    const base = resolveYear(world(team()), [plain()]);
    expect(report(r).pnl.marketing - report(base).pnl.marketing).toBeCloseTo(250_000, 0);
  });
});
