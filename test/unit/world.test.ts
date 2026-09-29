/**
 * The world arriving: offers, shocks, promotions, insurance, dividends,
 * programmes and expansion. Same promise as the rest — every one of them has
 * a setting where it helps and one where it hurts — and every one of them
 * reaches the year through `resolveYear` rather than only being true on paper.
 */
import { describe, it, expect } from "vitest";
import { resolveYear as resolveWithNews } from "@shared/simulation/resolve";
import { startingCompany } from "@shared/simulation/season";
import { seedIncumbents } from "@shared/simulation/incumbents";
import { nicheById } from "@shared/simulation/niches";
import { RESIGN_AT } from "@shared/simulation/people";
import {
  DEAL_CHASERS_LEAVE, PATIENT_INVESTORS, PREMIUM, PROGRAMMES, announcedRegion, answerShock, dealOutcome, dealsFor,
  expansionOutcome,
  dividend, firstYearReach, lawsuitOf, programmeYield, promoAppeal, winBack,
} from "@shared/simulation/world";
import { reviewInvestors } from "@shared/simulation/finance";
import { ROLES, type Company, type World } from "@shared/simulation/types";

const niche = nicheById("dating_apps")!;
const held = { swipers: 200_000, recently_single: 120_000, long_haulers: 40_000 };
const team = (over: Partial<Company> = {}): Company => ({
  ...startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] }),
  cash: 20_000_000, customers: held, capacity: 900_000,
  ...over,
});
const world = (c: Company, year = 6, seasonId = "wld"): World => ({
  seasonId, niche, year,
  economy: { demand: 1, interestRate: 0.06, costIndex: 1, outlook: "steady" },
  companies: [...seedIncumbents(niche), c],
});
const plain = (over: any = {}) => ({
  companyId: "t",
  cmo: { price: 55, brandSpend: 400_000, performanceSpend: 300_000, celebritySpend: 0, targetCities: [], ...over.cmo },
  cto: { featureSpend: 400_000, reliabilitySpend: 200_000, techDebtPaydown: 0, ...over.cto },
  coo: { capacityTarget: 900_000, supportSpend: 300_000, efficiencySpend: 0, headcount: 20, ...over.coo },
  cfo: { borrow: 0, repay: 0, cashBuffer: 0, ...over.cfo },
  ceo: { focus: "growth", ...over.ceo },
});
const resolveYear = (w: World, d: any[]) => resolveWithNews(w, d, undefined, { withoutEvent: true });
const report = (r: any) => r.reports.find((x: any) => x.companyId === "t");
const after = (r: any) => r.world.companies.find((x: any) => x.id === "t") as Company;
const offersFor = (c: Company, year = 6, seasonId = "wld") => dealsFor({
  seasonId, year, company: c, niche, incumbents: seedIncumbents(niche), worth: 10_000_000,
});

describe("the offers that arrive", () => {
  it("are the same every time for the same company and year, and never a buyout too early", () => {
    const c = team();
    expect(offersFor(c)).toEqual(offersFor(c));
    for (let y = 1; y < 5; y++) {
      expect(offersFor(c, y).some((o) => o.kind === "buyout"), `year ${y}`).toBe(false);
    }
  });

  it("are decided by the chief executive, or by the table when they send it there", () => {
    expect(dealOutcome("accept", [])).toEqual({ accepted: true, byVote: false });
    expect(dealOutcome("decline", ["yes", "yes"])).toEqual({ accepted: false, byVote: false });
    expect(dealOutcome("vote", ["yes", "yes", "no"]).accepted).toBe(true);
    expect(dealOutcome("vote", ["yes", "no"]).accepted, "a tie turns it down").toBe(false);
    expect(dealOutcome("vote", []).accepted, "and so does silence").toBe(false);
    expect(dealOutcome(undefined, ["yes", "yes"]).accepted, "an unanswered offer is not taken").toBe(false);
  });

  /*
   * The trade on a distribution deal: room and brand now, a slice of every
   * pound for three years.
   */
  it("a distribution deal buys room and brand, and costs a share of revenue", () => {
    const c = team({ capacity: 250_000 });
    const deal = offersFor(c).find((o) => o.kind === "distribution");
    if (!deal) return;
    const took = resolveYear(world(c), [plain({ ceo: { deals: { [deal.id]: "accept" } }, coo: { capacityTarget: 250_000 } })]);
    const without = resolveYear(world(c), [plain({ coo: { capacityTarget: 250_000 } })]);
    expect(after(took).assets.some((a) => a.id === `deal-${deal.id}`)).toBe(true);
    expect(report(took).customers, "the room is real").toBeGreaterThan(report(without).customers);
    expect(report(took).pnl.partners, "and so is the share").toBeGreaterThan(0);
    expect(after(took).revenueShares!.length).toBe(1);
  });

  it("a buyout hands the business over and leaves the team the money", () => {
    const c = team();
    const offers = dealsFor({ seasonId: "buy", year: 8, company: c, niche, incumbents: seedIncumbents(niche), worth: 10_000_000 });
    const buyout = offers.find((o) => o.kind === "buyout");
    if (!buyout) return;
    const r = resolveYear(world(c, 8, "buy"), [plain({ ceo: { deals: { [buyout.id]: "accept" } } })]);
    const sold = after(r);
    expect(Object.values(sold.customers).reduce((a, n) => a + n, 0)).toBe(0);
    expect(sold.soldBusinessIn).toBe(8);
    expect(sold.cash).toBeGreaterThan(c.cash);
    expect(sold.seats).toEqual(c.seats);
  });
});

describe("answering a shock", () => {
  const shock = { kind: "breach" as const, year: 5, reputation: 12, headline: "A data breach" };

  it("wins back half with a statement, most by blaming somebody, and nothing with silence", () => {
    expect(answerShock(shock, "statement").reputation).toBeCloseTo(6, 6);
    expect(answerShock(shock, "blame_cto")).toMatchObject({ blamed: "cto", loyalty: -25 });
    expect(answerShock(shock, "silence").reputation).toBeLessThan(0);
    expect(answerShock(shock, undefined).reputation, "no answer is silence").toBeLessThan(0);
  });

  it("reaches reputation and loyalty through the year, and clears the shock either way", () => {
    const c = team({ shock });
    const spoke = resolveYear(world(c), [plain({ ceo: { shockAnswer: "statement" } })]);
    const blamed = resolveYear(world(c), [plain({ ceo: { shockAnswer: "blame_cto" } })]);
    const silent = resolveYear(world(c), [plain()]);
    expect(report(spoke).reputation).toBeGreaterThan(report(silent).reputation);
    expect(report(blamed).reputation).toBeGreaterThan(report(spoke).reputation);
    expect(after(blamed).people!.cto!.loyalty).toBeLessThan(after(spoke).people!.cto!.loyalty);
    expect(after(spoke).shock, "answered or not, it is last year's news now").toBeUndefined();
    expect(after(silent).shock).toBeUndefined();
    expect(report(spoke).pnl.marketing).toBeGreaterThan(report(silent).pnl.marketing);
  });

  it("is set by a breach, for the chief executive to answer next year", () => {
    const breached = Array.from({ length: 80 }, (_, i) => resolveYear(world(team({ security: 0, techDebt: 70 }), 6, `s${i}`), [plain()]))
      .map(after).find((c) => c.shock);
    expect(breached?.shock?.kind).toBe("breach");
  });
});

describe("a lawsuit", () => {
  it("cannot happen before year three, and is likelier with poor service", () => {
    expect(lawsuitOf({ service: 20, seed: "x", year: 2 })).toBeNull();
    const hits = (service: number) => Array.from({ length: 800 }, (_, i) => lawsuitOf({ service, seed: `l${i}`, year: 5 })).filter(Boolean).length;
    expect(hits(20)).toBeGreaterThan(hits(90));
  });
});

describe("insurance", () => {
  it("costs a premium every year and pays most of a covered loss", () => {
    expect(PREMIUM.all).toBeGreaterThan(PREMIUM.breach);
    const c = team();
    const insured = resolveYear(world(c), [plain({ cfo: { insurance: "all" } })]);
    const not = resolveYear(world(c), [plain()]);
    expect(report(insured).pnl.insurance).toBeGreaterThan(0);
    expect(report(insured).profit, "in a quiet year it is money for nothing").toBeLessThan(report(not).profit);
  });

  it("pays for the breach it was bought for", () => {
    const seeds = Array.from({ length: 80 }, (_, i) => `ins${i}`);
    const breached = seeds.find((s) => /data breach/i.test(report(resolveYear(world(team({ security: 0, techDebt: 70 }), 6, s), [plain()])).notes.join(" ")));
    expect(breached, "a breach to insure against").toBeTruthy();
    const c = team({ security: 0, techDebt: 70 });
    const covered = resolveYear(world(c, 6, breached!), [plain({ cfo: { insurance: "breach" } })]);
    const bare = resolveYear(world(c, 6, breached!), [plain()]);
    expect(report(covered).pnl.incidents).toBeLessThan(report(bare).pnl.incidents);
    expect(report(covered).notes.join(" ")).toMatch(/breach was insured/i);
  });
});

describe("dividends", () => {
  it("pay out of profit, bank the founders' share, and cost the company the cash", () => {
    expect(dividend({ profit: 1_000_000, payoutPct: 50, founderShare: 0.6 })).toEqual({ paid: 500_000, founders: 300_000, investors: 200_000 });
    expect(dividend({ profit: -1_000_000, payoutPct: 50, founderShare: 1 }).paid).toBe(0);

    const c = team();
    const paid = resolveYear(world(c), [plain({ cfo: { dividendPct: 50 } })]);
    const kept = resolveYear(world(c), [plain()]);
    expect(after(paid).cash).toBeLessThan(after(kept).cash);
    expect(after(paid).banked!).toBeGreaterThan(0);
    // Banked money is the founders', whatever happens to the company after.
    expect(report(paid).founderValue - report(kept).founderValue).toBeGreaterThan(-1);
  });

  it("keep investors patient through a missed target", () => {
    const investors = { since: 1, raised: 4_000_000, target: 9_000_000, targetYear: 6, strikes: 1, inCharge: false };
    const struck = reviewInvestors(investors, 1_000_000, 6);
    const forgiven = reviewInvestors(investors, 1_000_000, 6, { patient: true });
    expect(struck.removed).toBe(true);
    expect(forgiven.removed).toBe(false);
    expect(forgiven.investors.strikes).toBe(1);
    expect(PATIENT_INVESTORS).toBeGreaterThan(0);
  });
});

describe("the offer", () => {
  it("is worth most to the people who watch the price", () => {
    const swipers = niche.segments.find((s) => s.id === "swipers")!;
    const loyal = niche.segments.find((s) => s.id === "long_haulers")!;
    expect(promoAppeal("free_month", swipers)).toBeGreaterThan(promoAppeal("free_month", loyal));
    expect(promoAppeal("none", swipers)).toBe(1);
  });

  /*
   * The trade: more customers, less revenue per customer, and the ones it
   * brought leave faster next year.
   */
  it("wins customers, costs margin, and the deal-chasers leave the year after", () => {
    const c = team({ capacity: 2_000_000 });
    const promoted = resolveYear(world(c), [plain({ coo: { capacityTarget: 2_000_000 }, cmo: { promo: "free_month" } })]);
    const plainYear = resolveYear(world(c), [plain({ coo: { capacityTarget: 2_000_000 } })]);
    expect(report(promoted).customers).toBeGreaterThan(report(plainYear).customers);
    expect(report(promoted).revenue / report(promoted).customers).toBeLessThan(report(plainYear).revenue / report(plainYear).customers);
    expect(after(promoted).dealChasers, "who they were, for next year").toBeTruthy();
    expect(DEAL_CHASERS_LEAVE).toBeGreaterThan(0);

    const next = resolveYear({ ...promoted.world, year: 7 }, [plain({ coo: { capacityTarget: 2_000_000 } })]);
    const nextPlain = resolveYear({ ...plainYear.world, year: 7 }, [plain({ coo: { capacityTarget: 2_000_000 } })]);
    const kept = (r: any, base: any) => report(r).customers / report(base).customers;
    expect(kept(next, promoted)).toBeLessThan(kept(nextPlain, plainYear));
  });
});

describe("win-back", () => {
  it("buys back leavers cheaply, and hardly any if nothing was fixed", () => {
    const base = { spend: 300_000, left: 50_000, referencePrice: 60 };
    expect(winBack({ ...base, fixed: true })).toBeGreaterThan(winBack({ ...base, fixed: false }));
    expect(winBack({ ...base, left: 0, fixed: true })).toBe(0);
    expect(winBack({ ...base, spend: 0, fixed: true })).toBe(0);
  });

  it("brings people back through the year, from whoever took them", () => {
    const c = team({
      leftLastYear: { swipers: 60_000 },
      lastStats: { quality: 20, service: 20, price: 80 },
      quality: 60, service: 60,
    });
    const back = resolveYear(world(c), [plain({ cmo: { winbackSpend: 600_000 } })]);
    const without = resolveYear(world(c), [plain()]);
    expect(after(back).customers.swipers).toBeGreaterThan(after(without).customers.swipers);
    expect(report(back).notes.join(" ")).toMatch(/Won back/);
  });
});

describe("improvement programmes", () => {
  it("pay out a third a year for three years, and nothing in the year they start", () => {
    const p = [{ id: "quality" as const, started: 5 }];
    expect(programmeYield(p, 5).quality, "nothing in the first year").toBe(0);
    expect(programmeYield(p, 6).quality).toBeCloseTo(PROGRAMMES.quality.quality! / 3, 6);
    expect(programmeYield(p, 9).quality, "and it is over").toBe(0);
  });

  it("cost money now and arrive later, through the year", () => {
    const c = team();
    const started = resolveYear(world(c), [plain({ coo: { programme: "quality" } })]);
    const none = resolveYear(world(c), [plain()]);
    expect(report(started).pnl.operations).toBeGreaterThan(report(none).pnl.operations);
    expect(after(started).quality, "not this year").toBeCloseTo(after(none).quality, 6);
    expect(after(started).programmes).toHaveLength(1);

    const later = resolveYear({ ...started.world, year: 7 }, [plain()]);
    const laterNone = resolveYear({ ...none.world, year: 7 }, [plain()]);
    expect(after(later).quality).toBeGreaterThan(after(laterNone).quality);
  });
});

describe("expansion", () => {
  it("announces a region the company does not sell in, the same one for the whole market", () => {
    const a = announcedRegion({ niche, seasonId: "x", year: 6, open: ["london"] });
    expect(a).toBeTruthy();
    expect(a!.id).not.toBe("london");
    expect(announcedRegion({ niche, seasonId: "x", year: 6, open: ["london"] })).toEqual(a);
  });

  it("is committed to now, opens next year, and reaches as far as the brand does", () => {
    expect(firstYearReach(0)).toBeLessThan(firstYearReach(60));
    expect(firstYearReach(90)).toBe(1);

    const c = team({ cities: ["london"], brand: 30 });
    const announced = announcedRegion({ niche, seasonId: "wld", year: 6, open: ["london"] })!;
    const committed = resolveYear(world(c), [plain({ coo: { expand: announced.id } })]);
    expect(after(committed).expanding).toEqual({ cityId: announced.id, opensYear: 7 });
    expect(after(committed).cities, "not yet").not.toContain(announced.id);

    const opened = resolveYear({ ...committed.world, year: 7 }, [plain()]);
    expect(after(opened).cities).toContain(announced.id);
    expect(report(opened).notes.join(" ")).toMatch(/as far as the brand/);
  });

  it("counts the table's votes, a tie and silence meaning different things", () => {
    // Operations putting it up is the first vote for, which is why one vote carries.
    expect(expansionOutcome(["yes"])).toEqual({ carried: true, yes: 1, no: 0 });
    expect(expansionOutcome(["yes", "yes", "no"]).carried).toBe(true);
    expect(expansionOutcome(["yes", "no"]).carried, "a tie leaves the region shut").toBe(false);
    expect(expansionOutcome(["yes", "no", "no"]).carried).toBe(false);
    expect(expansionOutcome([]).carried, "nobody proposed it").toBe(false);
  });

  it("does not open a region the table voted down, and says who wanted it", () => {
    const c = team({ cities: ["london"], brand: 30 });
    const announced = announcedRegion({ niche, seasonId: "wld", year: 6, open: ["london"] })!;
    const against = { expandVote: { [announced.id]: "no" as const } };

    const voted = resolveYear(world(c), [plain({
      coo: { expand: announced.id },
      cmo: against, cfo: against, cto: against,
    })]);
    expect(after(voted).expanding, "three against one").toBeUndefined();
    expect(report(voted).notes.join(" ")).toMatch(/1 for and 3 against/);

    // And the money stays in the bank: a region not opened is not paid for.
    const alone = resolveYear(world(c), [plain({ coo: { expand: announced.id } })]);
    expect(after(voted).cash).toBeGreaterThan(after(alone).cash);
  });

  it("opens it when the table agrees, silence counting as silence rather than opposition", () => {
    const c = team({ cities: ["london"], brand: 30 });
    const announced = announcedRegion({ niche, seasonId: "wld", year: 6, open: ["london"] })!;
    const r = resolveYear(world(c), [plain({
      coo: { expand: announced.id },
      ceo: { expandVote: { [announced.id]: "yes" } },
      cfo: { expandVote: { [announced.id]: "no" } },
    })]);
    expect(after(r).expanding).toEqual({ cityId: announced.id, opensYear: 7 });
    expect(report(r).notes.join(" ")).toMatch(/2 for and 1 against/);
  });

  it("ignores a vote on a region nobody put up", () => {
    const c = team({ cities: ["london"], brand: 30 });
    const announced = announcedRegion({ niche, seasonId: "wld", year: 6, open: ["london"] })!;
    const yes = { expandVote: { [announced.id]: "yes" as const } };
    const r = resolveYear(world(c), [plain({ ceo: yes, cmo: yes, cfo: yes, cto: yes })]);
    expect(after(r).expanding, "four for and no proposal is not a decision").toBeUndefined();
  });
});

describe("a company that answers none of it", () => {
  it("is not forced into any of it: no offers taken, no promotion, no payout", () => {
    const r = resolveYear(world(team()), [plain()]);
    const c = after(r);
    expect(c.revenueShares ?? []).toEqual([]);
    expect(c.promo).toBeUndefined();
    expect(c.banked ?? 0).toBe(0);
    expect(c.programmes ?? []).toEqual([]);
    expect(c.people!.cmo!.loyalty).toBeGreaterThan(RESIGN_AT);
  });
});
