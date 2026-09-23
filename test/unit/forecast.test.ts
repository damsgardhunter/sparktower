/**
 * The three things a year now has to be learnable from: what each segment
 * weighs, how many people will want you, and an account of what happened that
 * adds up.
 *
 * These are mostly claims about *honesty* rather than about outcomes. A
 * forecast that is right on average and says so with a range; weights that are
 * the engine's own numbers and not a description of them; a P&L whose lines
 * sum to the profit, a cash bridge that lands on the bank balance, a customer
 * bridge that lands on the customer count. Every one of those is a thing a
 * player will check with a calculator the first time a year goes badly, and
 * the first one that does not add up is the last one they trust.
 */
import { describe, it, expect } from "vitest";
import { NICHES, nicheById } from "@shared/simulation/niches";
import { buildWorld, decisionsForYear, economyFor } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { forecastDemand, capacityRisk } from "@shared/simulation/forecast";
import { weightsOf, expectationsFor, shortfalls, expectationPenalty, describeWeights } from "@shared/simulation/criteria";
import { appealFor } from "@shared/simulation/market";
import { idleCapacityCost, marketPriceOf, taxOn } from "@shared/simulation/decisions";
import { ROLES, type Role, type World } from "@shared/simulation/types";
import type { TeamDecisions } from "@shared/simulation/decisions";

const dating = nicheById("dating_apps")!;
const seg = (niche: typeof dating, id: string) => niche.segments.find((s) => s.id === id)!;

function plan(world: World, id: string, year: number, most = 400_000): TeamDecisions {
  const c = world.companies.find((x) => x.id === id)!;
  /*
   * Within its means. This team used to spend 2.4m a year whatever it had, ran
   * out of money in year three, and only kept growing because a plan cut to
   * nothing still bought a full year of brand — the bug `fundYear` fixed. A
   * team that spends money it does not have is not a fair test of a forecast.
   */
  const spend = Math.min(most, Math.max(25_000, Math.round(c.cash * 0.06)));
  return {
    companyId: id,
    cmo: { price: c.price, brandSpend: spend, performanceSpend: spend, celebritySpend: 0, targetCities: [] },
    cto: { featureSpend: spend, reliabilitySpend: spend, techDebtPaydown: 0 },
    coo: { capacityTarget: c.capacity, supportSpend: spend, efficiencySpend: 0, headcount: 4 },
    cfo: { borrow: 0, repay: 0, cashBuffer: 0 },
    ceo: { focus: "growth" },
  };
}

/** A whole season for one team, capacity sized to the forecast, every report kept. */
function played(nicheId: string, headroom = 1.15) {
  const niche = nicheById(nicheId)!;
  let world = buildWorld({ seasonId: "fc", niche, teams: [{ id: "t", name: "T", seats: [...ROLES] as Role[] }] });
  const out = [];
  let previous: TeamDecisions | undefined;
  for (let year = 1; year <= 8; year++) {
    const d = plan({ ...world, year }, "t", year);
    const f = forecastDemand({ world: { ...world, year }, companyId: "t", year, economy: economyFor("fc", year), draft: d })!;
    /*
     * Capacity ordered now opens next year (see `lag.ts`), so a competent
     * operations seat sizes it to next year's demand, not this year's. Sizing
     * to this year's left the company permanently a year short — turning
     * people away, handing them to rivals, and making the forecast look wrong
     * when it was the capacity that was.
     */
    const next = forecastDemand({ world: { ...world, year: year + 1 }, companyId: "t", year: year + 1, economy: economyFor("fc", year + 1), draft: d })!;
    d.coo!.capacityTarget = Math.max(1_000, Math.round(next.likely * headroom));
    const company = world.companies.find((c) => c.id === "t")!;
    const { decisions } = decisionsForYear({ company, niche, submitted: d as any, previous });
    const result = resolveYear({ ...world, year }, [decisions], economyFor("fc", year));
    out.push({ forecast: f, report: result.reports.find((r) => r.companyId === "t")!, before: company });
    world = result.world;
    previous = d;
  }
  return out;
}

describe("what a segment weighs", () => {
  it("is the engine's own numbers, as percentages that add to a hundred", () => {
    for (const niche of NICHES) {
      for (const s of niche.segments) {
        const w = weightsOf(s);
        expect(w.price + w.quality + w.brand + w.service, `${niche.id}/${s.id}`).toBe(100);
        // The biggest weight is the biggest focus: the screen cannot describe a segment the maths does not.
        const biggest = Object.entries({ price: s.priceSensitivity, quality: s.qualityFocus, brand: s.brandFocus, service: s.serviceFocus })
          .sort((a, b) => b[1] - a[1])[0][0];
        expect(Object.entries(w).sort((a, b) => b[1] - a[1])[0][0], `${niche.id}/${s.id}`).toBe(biggest);
      }
    }
  });

  it("says the thing worth knowing about a premium segment: that it barely notices price", () => {
    expect(describeWeights(seg(dating, "long_haulers"))).toMatch(/barely notice price/i);
    expect(describeWeights(seg(dating, "swipers"))).toMatch(/price/i);
  });
});

describe("what a segment expects", () => {
  it("sets a floor only on what it weighs heavily, and never on brand", () => {
    const swipers = expectationsFor(seg(dating, "swipers"), 1);
    const longHaulers = expectationsFor(seg(dating, "long_haulers"), 1);
    // The door: the flighty segment asks nothing of a newcomer's product.
    expect(swipers.floors).toHaveLength(0);
    // The wall: the loyal one does.
    expect(longHaulers.floors.map((f) => f.axis).sort()).toEqual(["quality", "service"]);
    for (const niche of NICHES) for (const s of niche.segments) {
      expect(expectationsFor(s, 5).floors.some((f) => (f.axis as string) === "brand"), `${niche.id}/${s.id}`).toBe(false);
    }
  });

  it("rises every year, so standing still is falling behind", () => {
    const s = seg(dating, "long_haulers");
    const y1 = expectationsFor(s, 1).floors.find((f) => f.axis === "quality")!.atLeast;
    const y8 = expectationsFor(s, 8).floors.find((f) => f.axis === "quality")!.atLeast;
    expect(y8).toBeGreaterThan(y1);
  });

  it("costs appeal to fall short of, and nothing to meet", () => {
    const s = seg(dating, "long_haulers");
    const floor = expectationsFor(s, 3).floors.find((f) => f.axis === "quality")!.atLeast;
    const base = { price: 150, brand: 50, service: 80 };
    expect(expectationPenalty({ ...base, quality: floor + 5 }, s, 3)).toBe(1);
    expect(expectationPenalty({ ...base, quality: floor - 15 }, s, 3)).toBeLessThan(0.9);
    expect(shortfalls({ ...base, quality: floor - 15 }, s, 3)).toEqual([{ axis: "quality", by: 15 }]);
  });

  it("puts the price ceiling where the segment's liking for your price has halved", () => {
    /*
     * The ceiling describes the price curve rather than adding a second
     * penalty to it. Checked against `appealFor` directly: at the ceiling, a
     * company otherwise identical scores clearly worse than at the reference
     * price, and well above the floor the curve bottoms out at.
     */
    const s = seg(dating, "swipers");
    const { priceCeiling } = expectationsFor(s, 1);
    const world = buildWorld({ seasonId: "x", niche: dating, teams: [{ id: "t", name: "T", seats: [...ROLES] as Role[] }] });
    const c = world.companies.find((x) => x.id === "t")!;
    const atRef = appealFor({ ...c, price: s.referencePrice }, s);
    const atCeiling = appealFor({ ...c, price: priceCeiling }, s);
    expect(atCeiling).toBeLessThan(atRef);
    expect(priceCeiling).toBeGreaterThan(s.referencePrice);
  });
});

describe("the forecast", () => {
  it("brackets what actually happens most years", () => {
    /*
     * A range that contains the answer most of the time is the whole claim. It
     * cannot see what the rivals decide, so it will miss sometimes; a forecast
     * that missed most years would be teaching people to ignore it.
     */
    for (const nicheId of ["dating_apps", "restaurant_chain", "project_saas"]) {
      const years = played(nicheId);
      // Judged on demand, so a year that was capacity-bound counts what was turned away too.
      const hits = years.filter(({ forecast, report }) => {
        const wanted = report.customers + report.turnedAway;
        return wanted >= forecast.low * 0.9 && wanted <= forecast.high * 1.1;
      }).length;
      expect(hits, `${nicheId}: ${years.map((y) => `${y.forecast.low}-${y.forecast.high}→${y.report.customers}`).join(", ")}`)
        .toBeGreaterThanOrEqual(5);
    }
  });

  it("falls as the price rises", () => {
    const world = buildWorld({ seasonId: "fc", niche: dating, teams: [{ id: "t", name: "T", seats: [...ROLES] as Role[] }] });
    const f = forecastDemand({ world, companyId: "t", year: 1, economy: economyFor("fc", 1), draft: plan(world, "t", 1) })!;
    const first = f.curve[0].likely;
    const last = f.curve[f.curve.length - 1].likely;
    expect(first).toBeGreaterThan(last);
    expect(f.low).toBeLessThanOrEqual(f.likely);
    expect(f.high).toBeGreaterThanOrEqual(f.likely);
  });

  it("does not count a city left off the list as closed", () => {
    // The engine only ever adds cities; a forecast that read an empty list as
    // "sell nowhere" once predicted zero customers for every new team.
    const world = buildWorld({ seasonId: "fc", niche: dating, teams: [{ id: "t", name: "T", seats: [...ROLES] as Role[] }] });
    const d = plan(world, "t", 1);
    d.cmo!.targetCities = [];
    expect(forecastDemand({ world, companyId: "t", year: 1, economy: economyFor("fc", 1), draft: d })!.likely).toBeGreaterThan(0);
  });
});

describe("headroom is a mistake you can make both ways", () => {
  it("charges for capacity nobody used", () => {
    expect(idleCapacityCost(0, dating)).toBe(0);
    expect(idleCapacityCost(10_000, dating)).toBeCloseTo(10_000 * marketPriceOf(dating) * 0.08, 0);
  });

  it("sends the people you could not serve to a rival, not into thin air", () => {
    /*
     * Two teams: one that under-built, one with room and the same offer. In
     * year one the incumbents are near full themselves, so without a rival
     * with space the turned-away genuinely have nowhere to go — which is also
     * correct, and is why the test brings its own.
     */
    const built = buildWorld({ seasonId: "sp", niche: dating, teams: [
      { id: "t", name: "T", seats: [...ROLES] as Role[] },
      { id: "r", name: "Roomy", seats: [...ROLES] as Role[] },
    ] });
    /*
     * Roomy's room is capacity it already has, not capacity it orders now:
     * capacity ordered this year opens next year (see `lag.ts`), so a rival
     * that only placed the order would have no room to take anybody in.
     */
    const world = { ...built, companies: built.companies.map((c) => (c.id === "r" ? { ...c, capacity: 2_000_000 } : c)) };
    const d = plan(world, "t", 1, 1_500_000);
    d.coo!.capacityTarget = 500;
    const roomy = plan(world, "r", 1, 1_500_000);
    roomy.coo!.capacityTarget = 2_000_000;
    const { reports } = resolveYear(world, [d, roomy], economyFor("sp", 1));
    const r = reports.find((x) => x.companyId === "t")!;
    expect(r.turnedAway).toBeGreaterThan(0);
    const sent = r.segments!.reduce((sum, s) => sum + s.sentTo.reduce((a, f) => a + f.count, 0), 0);
    expect(sent, "the turned-away went somewhere").toBeGreaterThan(0);
    expect(r.notes.join(" ")).toMatch(/went straight to a rival/);
  });

  it("names the bet before it is placed", () => {
    const f = { likely: 10_000, low: 8_000, high: 12_000, band: 0.2, bySegment: [], curve: [], price: 40 };
    expect(capacityRisk({ capacity: 5_000, forecast: f, price: 40, idleCostPerUnit: 5 }).verdict).toBe("short");
    expect(capacityRisk({ capacity: 11_000, forecast: f, price: 40, idleCostPerUnit: 5 }).verdict).toBe("balanced");
    expect(capacityRisk({ capacity: 30_000, forecast: f, price: 40, idleCostPerUnit: 5 }).verdict).toBe("idle");
    const short = capacityRisk({ capacity: 5_000, forecast: f, price: 40, idleCostPerUnit: 5 });
    expect(short.revenueLostAtHigh).toBe(7_000 * 40);
  });
});

describe("tax", () => {
  it("is charged on profit after losses carried forward", () => {
    // Three hard years shelter the first good one.
    let carried = 0;
    for (const loss of [-2_000_000, -1_000_000]) carried = taxOn(loss, carried).carried;
    expect(carried).toBe(3_000_000);
    expect(taxOn(2_000_000, carried).tax).toBe(0);
    const later = taxOn(5_000_000, 1_000_000);
    expect(later.tax).toBeCloseTo(4_000_000 * 0.2);
    expect(later.carried).toBe(0);
  });
});

describe("the year-end report adds up", () => {
  const years = NICHES.flatMap((n) => played(n.id).map((y) => ({ niche: n.id, ...y })));

  it("has a P&L whose lines sum to the profit", () => {
    for (const { niche, report: r } of years) {
      const p = r.pnl!;
      // Building and leasing capacity are costs; a forecast's saving (or loss) is the other way round.
      const costs = p.costToServe + p.salaries + p.marketing + p.product + p.operations + p.idleCapacity + p.interest
        + (p.capacity ?? 0) + (p.incidents ?? 0) + (p.partners ?? 0) + (p.insurance ?? 0) - (p.planning ?? 0);
      expect(p.revenue - costs, `${niche} y${r.year} operating`).toBeCloseTo(p.operatingProfit, 0);
      expect(p.operatingProfit - p.tax, `${niche} y${r.year} after tax`).toBeCloseTo(p.profit, 0);
      expect(p.profit, `${niche} y${r.year}`).toBeCloseTo(r.profit, 0);
    }
  });

  it("has a cash bridge that lands on the bank balance", () => {
    for (const { niche, report: r, before } of years) {
      const b = r.cashBridge!;
      expect(b.opening, `${niche} y${r.year} opening`).toBeCloseTo(before.cash, 0);
      const moved = b.lines.reduce((sum, l) => sum + l.amount, 0);
      expect(b.opening + moved, `${niche} y${r.year}: ${JSON.stringify(b.lines)}`).toBeCloseTo(b.closing, 0);
      expect(b.closing).toBeCloseTo(r.cash, 0);
    }
  });

  it("has a customer bridge that lands on the customer count, segment by segment", () => {
    for (const { niche, report: r, before } of years) {
      let total = 0;
      for (const s of r.segments!) {
        const lost = s.lostTo.reduce((a, f) => a + f.count, 0);
        const won = s.wonFrom.reduce((a, f) => a + f.count, 0);
        expect(s.start - lost + won + s.fresh - s.turnedAway + s.pickedUp + s.other, `${niche} y${r.year} ${s.segmentId}`).toBe(s.end);
        expect(s.start).toBe(before.customers[s.segmentId] ?? 0);
        // Rounding across millions — never a real number of people hiding in the line.
        expect(Math.abs(s.other), `${niche} y${r.year} ${s.segmentId} rounding`).toBeLessThan(Math.max(60, s.end * 0.01));
        total += s.end;
      }
      expect(total).toBe(r.customers);
    }
  });

  it("explains the biggest loss, and names who took the customers", () => {
    const explained = years.flatMap(({ report }) => report.segments!.filter((s) => s.why));
    expect(explained.length, "some year somewhere lost customers to somebody").toBeGreaterThan(0);
    for (const s of explained) {
      expect(s.why).toContain(s.lostTo[0].name);
      expect(s.why).toMatch(/undercut|ahead on quality|better known|looked after|no better/);
    }
  });

  it("reports what every rival did, and never a rival's exact spending", () => {
    for (const { report } of years) {
      expect(report.rivals!.length).toBeGreaterThan(0);
      expect(report.rivals!.some((m) => m.id === report.companyId), "not yourself").toBe(false);
      for (const m of report.rivals!) expect(m.spent % 250_000).toBe(0);
    }
  });
});
