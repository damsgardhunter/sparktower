/**
 * The capital profile's rules, on their own: the fundability score and its
 * parts, route fit and the lines people draw, conditional questions, and what
 * a résumé can honestly say about owning a business.
 */
import { describe, it, expect } from "vitest";
import {
  capitalProfile, bandFor, businessHistoryFromResume, renderCapitalProfile, CAPITAL_ROUTE_IDS,
  BUSINESS_HISTORY_QUESTIONS, CAPITAL_GOAL_QUESTIONS,
} from "@shared/capital";
import { validateIntake, renderIntake, resolveTree, mainLineMilestones, allMilestoneIds, PATH_TREES } from "@shared/phase-trees";

const strong = {
  goal: { why: ["wealth", "legacy"], path: ["buy"], role: ["operator"], horizon: ["forever"] },
  money: { cash: ["100k_250k"], credit: ["740_799"], income: ["100k_200k"], debt: ["500_1500"], assets: ["home_equity", "retirement"] },
  experience: { industry_years: ["10_plus"], level: ["gm"], managed: ["20_plus"], pnl: ["yes"] },
  history: { owned: ["once"], idea: ["Commercial cleaning"], industry: ["services"], age: ["5_10"], revenue: ["250k_1m"], profit: ["50k_250k"], employees: ["6_20"], customers: ["50_500"], biz_assets: ["equipment"], outcome: ["sold"] },
  target: { amount: ["500k_1m"], uses: ["acquisition", "working_capital"], timeline: ["6_12"], equity: ["none"], debt_ok: ["guarantee"], ownership: ["100"] },
};
const fromZero = {
  goal: { why: ["income"], path: ["start"], role: ["operator"], horizon: ["unsure"] },
  money: { cash: ["0"], credit: ["lt580"], income: ["lt30k"], debt: ["500_1500"], assets: ["none"] },
  experience: { industry_years: ["0"], level: ["none"], managed: ["0"], pnl: ["no"] },
  history: { owned: ["never"] },
  target: { amount: ["unknown"], uses: ["equipment"], timeline: ["now"], equity: ["10_25"], debt_ok: ["guarantee"], ownership: ["75_plus"] },
};

describe("the fundability score", () => {
  it("adds seven parts to 100 and bands the result", () => {
    const p = capitalProfile(strong);
    expect(p.parts.map((x) => x.key)).toEqual(["cash", "credit", "income", "assets", "experience", "track_record", "clarity"]);
    expect(p.parts.reduce((n, x) => n + x.max, 0)).toBe(100);
    expect(p.score).toBe(p.parts.reduce((n, x) => n + x.score, 0));
    // $175k against $750k is 23% → 16; 740–799 → 19; $150k income, $1k/month debt → 12; home + retirement → 6;
    // 10+ years, GM, P&L → 15 (capped); owned once, profitable, 5–10 years, sold → 15; clear on all five → 5.
    expect(p.parts.map((x) => x.score)).toEqual([16, 19, 12, 6, 15, 15, 5]);
    expect(p.score).toBe(88);
    expect(p.band.label).toBe("Strong");
    expect(p.answered).toBe(5);
  });

  it("scores someone starting from zero honestly, and says what raises each part", () => {
    const p = capitalProfile(fromZero);
    // Debt payments of $1,000 against $1,667 monthly income is 60% — past 50%, so income scores 3 − 6 → 0.
    // A clear goal: why, how, what it buys and when are answered; the amount isn't — 4 of 5.
    expect(p.parts.map((x) => x.score)).toEqual([0, 2, 0, 0, 0, 0, 4]);
    expect(p.score).toBe(6);
    expect(p.band.label).toBe("Not fundable yet");
    expect(p.facts.debtToIncome).toBe(0.6);
    for (const part of p.parts.filter((x) => x.score < x.max)) expect(part.raise, part.key).toBeTruthy();
  });

  it("counts nothing that hasn't been answered, and unknown credit as unknown", () => {
    const p = capitalProfile({});
    expect(p.score).toBe(0);
    expect(p.answered).toBe(0);
    expect(capitalProfile({ money: { credit: ["unknown"] } }).parts.find((x) => x.key === "credit")!.score).toBe(4);
  });

  it("bands at its edges", () => {
    expect([39, 40, 59, 60, 74, 75, 89, 90].map((n) => bandFor(n).id)).toEqual(["not_yet", "early", "early", "with_work", "with_work", "strong", "strong", "very_strong"]);
  });
});

describe("route fit", () => {
  it("covers all five routes and respects the lines people draw", () => {
    const p = capitalProfile(strong);
    expect(p.routeFit.map((r) => r.route).sort()).toEqual([...CAPITAL_ROUTE_IDS].sort());
    const fit = Object.fromEntries(p.routeFit.map((r) => [r.route, r]));
    // Keeping 100% and no equity caps investors.
    expect(fit.investor).toMatchObject({ score: 15, why: "You'd rather keep all of it." });
    // Buying, experienced, with cash and credit: seller financing and debt fit well.
    expect(fit.seller.score).toBeGreaterThan(70);
    expect(fit.debt.score).toBeGreaterThan(70);
    expect(p.routeFit[0].score).toBeGreaterThanOrEqual(p.routeFit[4].score);
    // A hybrid is as good as its two best layers, never better than the best alone.
    const others = p.routeFit.filter((r) => r.route !== "hybrid").map((r) => r.score).sort((x, y) => y - x);
    expect(fit.hybrid.score).toBe(Math.round((others[0] + others[1]) / 2));
    expect(fit.hybrid.score).toBeLessThanOrEqual(others[0]);
  });

  it("caps seller financing to buyers, and debt to people who'd take it", () => {
    const starting = capitalProfile({ ...strong, goal: { ...strong.goal, path: ["start"] } });
    expect(starting.routeFit.find((r) => r.route === "seller")).toMatchObject({ score: 25, why: "Only if you buy an existing business." });
    const noDebt = capitalProfile({ ...strong, target: { ...strong.target, debt_ok: ["no"] } });
    expect(noDebt.routeFit.find((r) => r.route === "debt")).toMatchObject({ score: 15 });
  });

  it("reads as lines Nova builds from, with the exact score", () => {
    expect(renderCapitalProfile(capitalProfile(strong))).toMatch(/^Fundability score: 88\/100 \(Strong\), from 5 of 5 steps answered\./);
  });
});

describe("business history questions", () => {
  it("ask about the business only if there was one", () => {
    expect(validateIntake(BUSINESS_HISTORY_QUESTIONS, { owned: "never", revenue: "5m_plus" })).toEqual({
      ok: true, answers: { owned: ["never"], idea: [], industry: [], age: [], revenue: [], profit: [], employees: [], customers: [], biz_assets: [], outcome: [] },
    });
    expect(validateIntake(BUSINESS_HISTORY_QUESTIONS, { owned: "once" })).toMatchObject({ ok: false, field: "industry" });
    expect(renderIntake(BUSINESS_HISTORY_QUESTIONS, { owned: ["never"] })).toBe("Have you owned a business before? No, this is my first");
  });

  it("take a short line of text for what it did, trimmed and capped", () => {
    const full = { owned: "once", idea: `  ${"x".repeat(400)}  `, industry: "services", age: "3_5", revenue: "unsure", profit: "even", employees: "solo", customers: "lt50", outcome: "closed" };
    const r = validateIntake(BUSINESS_HISTORY_QUESTIONS, full) as any;
    expect(r.ok).toBe(true);
    expect(r.answers.idea[0]).toHaveLength(300);
  });

  it("put 'I don't know' first on the amount", () => {
    expect(CAPITAL_GOAL_QUESTIONS[0].options[0]).toEqual({ id: "unknown", label: "I don't know — work it out" });
  });
});

describe("a résumé", () => {
  const now = new Date("2026-09-14");
  it("shows ownership only where a title names it, with how long and whether it's still running", () => {
    const read = businessHistoryFromResume([
      { title: "Founder & CEO", company: "Brightside Cleaning", startDate: "2019-03", endDate: null, current: true, description: "Grew to 14 staff" },
      { title: "Operations Manager", company: "Acme Facilities", startDate: "2014", endDate: "2019" },
    ], now);
    expect(read).toEqual({
      answers: { owned: ["current"], idea: ["Brightside Cleaning — Grew to 14 staff"], age: ["5_10"], outcome: ["running"] },
      found: ["Founder & CEO, Brightside Cleaning"],
    });
  });

  it("never claims ownership from a manager or president title, and returns nothing without one", () => {
    expect(businessHistoryFromResume([{ title: "Store Manager", company: "Target" }, { title: "Regional Vice President", company: "Bank" }], now)).toBeNull();
    expect(businessHistoryFromResume([], now)).toBeNull();
    expect(businessHistoryFromResume([
      { title: "Owner", company: "A", startDate: "2010", endDate: "2012" },
      { title: "Co-founder", company: "B", startDate: "2015", endDate: "2016" },
    ], now)!.answers).toMatchObject({ owned: ["several"], age: ["1_3"] });
  });
});

describe("the funding path", () => {
  it("is the capital profile and map, then only the chosen route's four phases", () => {
    expect(mainLineMilestones(resolveTree("raise_funding", "other")).map((m) => m.id)).toEqual([
      "FUND.C1.1", "FUND.C1.2", "FUND.C1.3", "FUND.C1.4", "FUND.C1.5", "FUND.C1.6", "FUND.C2.1", "FUND.C2.2",
    ]);
    for (const route of CAPITAL_ROUTE_IDS) {
      const phases = resolveTree("raise_funding", "other", route).slice(2);
      expect(phases, route).toHaveLength(4);
      expect(phases.every((p) => p.route === route)).toBe(true);
      expect(phases.flatMap((p) => p.milestones).length, route).toBeGreaterThanOrEqual(12);
      expect(phases.flatMap((p) => p.milestones).some((m) => m.inMarket), `${route} has a moment it goes to market`).toBe(true);
    }
    const route = mainLineMilestones(resolveTree("raise_funding", "other")).find((m) => m.id === "FUND.C2.2")!;
    expect(route.routeQuestion).toBe("route");
    expect(mainLineMilestones(resolveTree("raise_funding", "other")).find((m) => m.id === "FUND.C1.4")!.prefill).toBe("resume");
  });

  it("knows every milestone it has authored, across routes", () => {
    const ids = allMilestoneIds("raise_funding");
    expect(ids.has("FUND.D4.3") && ids.has("FUND.F4.3") && ids.has("FUND.C1.1")).toBe(true);
    expect(ids.has("FUND.M1.1")).toBe(false);
    expect(ids.size).toBe(PATH_TREES.raise_funding.phases.flatMap((p) => p.milestones).length);
  });
});
