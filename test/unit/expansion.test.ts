/**
 * The decisions added to make this a business rather than a spreadsheet:
 * where you sell, who you are for, whose money you take, and work that lands
 * next year instead of this one.
 *
 * Each of these is here because the seat that owns it was thin. The tests that
 * matter are the ones proving each is a genuine trade — that there is no
 * setting a sensible player would always choose, because a lever with a right
 * answer is a lever nobody thinks about twice.
 */
import { describe, it, expect } from "vitest";
import { resolveYear } from "@shared/simulation/resolve";
import { reachOf, positioningFor } from "@shared/simulation/market";
import { fixedCosts, debtDrag, nextTechDebt } from "@shared/simulation/decisions";
import { startingCompany, buildWorld, economyFor } from "@shared/simulation/season";
import { seedIncumbents } from "@shared/simulation/incumbents";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type Company, type World } from "@shared/simulation/types";

const niche = nicheById("dating_apps")!;
const team = (over: Partial<Company> = {}): Company => ({
  ...startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] }),
  ...over,
});
const world = (c: Company): World => ({
  seasonId: "s", niche, year: 1,
  economy: { demand: 1, interestRate: 0.08, costIndex: 1, outlook: "steady" },
  companies: [...seedIncumbents(niche), c],
});

const spend = (over: any = {}) => ({
  companyId: "t",
  cmo: { price: 22, brandSpend: 600_000, performanceSpend: 600_000, celebritySpend: 0, targetCities: [], ...over.cmo },
  cto: { featureSpend: 400_000, reliabilitySpend: 400_000, techDebtPaydown: 0, ...over.cto },
  coo: { capacityTarget: 2_000_000, supportSpend: 300_000, efficiencySpend: 0, headcount: 5, ...over.coo },
  cfo: { borrow: 0, repay: 0, cashBuffer: 0, ...over.cfo },
  ceo: { focus: "growth", ...over.ceo },
});

describe("where you sell", () => {
  it("decides who can even consider you", () => {
    const one = team({ cities: ["leeds"] });
    const all = team({ cities: niche.cities.map((c) => c.id) });
    expect(reachOf(one, niche)).toBeLessThan(reachOf(all, niche));
    expect(reachOf(all, niche)).toBeCloseTo(1, 1);
  });

  it("treats a company from before cities existed as selling everywhere", () => {
    /*
     * Seasons already running have a world stored without this field. The
     * alternative to a default is a fortnight of somebody's game silently
     * collapsing to no reach at all because a feature shipped underneath them.
     */
    const legacy = { ...team(), cities: undefined } as unknown as Company;
    expect(reachOf(legacy, niche)).toBe(1);
  });

  it("wins more customers for the same money when you sell in more places", () => {
    const narrow = resolveYear(world(team({ cities: ["leeds"] })), [spend({ cmo: { targetCities: ["leeds"] } })]);
    const wide = resolveYear(
      world(team({ cities: niche.cities.map((c) => c.id) })),
      [spend({ cmo: { targetCities: niche.cities.map((c) => c.id) } })],
    );
    const of = (r: any) => r.reports.find((x: any) => x.companyId === "t").customers;
    expect(of(wide)).toBeGreaterThan(of(narrow));
  });

  it("charges for opening somewhere, once, in the year it happens", () => {
    const before = team({ cities: ["leeds"] });
    const out = resolveYear(world(before), [spend({ cmo: { targetCities: ["leeds", "london"] } })]);
    const after = out.world.companies.find((c) => c.id === "t")!;
    expect(after.cities).toContain("london");
    expect(out.reports.find((r) => r.companyId === "t")!.notes.join(" ")).toMatch(/Opened in London/i);
  });

  it("costs more to run the more of the country you are in", () => {
    /*
     * The half that makes this a trade rather than a button marked "better".
     * Reach without sales is a bill.
     */
    const c = team();
    const small = fixedCosts(c, 5, { costIndex: 1 } as any, 0.12);
    const national = fixedCosts(c, 5, { costIndex: 1 } as any, 1);
    expect(national).toBeGreaterThan(small * 1.5);
  });
});

describe("who the company is for", () => {
  it("helps where you aimed and costs you everywhere else", () => {
    const c = team({ positioning: "recently_single" });
    expect(positioningFor(c, "recently_single")).toBeGreaterThan(1);
    expect(positioningFor(c, "swipers")).toBeLessThan(1);
    // Declaring nothing is neutral, not a penalty.
    expect(positioningFor(team(), "recently_single")).toBe(1);
  });

  it("changes which segment a company actually wins", () => {
    const aimed = resolveYear(world(team()), [spend({ ceo: { focus: "growth", positioning: "long_haulers" } })]);
    const broad = resolveYear(world(team()), [spend()]);
    const coachedIn = (r: any) => r.world.companies.find((c: any) => c.id === "t").customers.long_haulers ?? 0;
    expect(coachedIn(aimed)).toBeGreaterThan(coachedIn(broad));
  });

  it("is a trade — aiming somewhere costs you the rest", () => {
    const aimed = resolveYear(world(team()), [spend({ ceo: { focus: "growth", positioning: "long_haulers" } })]);
    const broad = resolveYear(world(team()), [spend()]);
    const resolversIn = (r: any) => r.world.companies.find((c: any) => c.id === "t").customers.swipers ?? 0;
    expect(resolversIn(aimed)).toBeLessThan(resolversIn(broad));
  });
});

describe("taking investors' money", () => {
  it("arrives as cash and is paid for in ownership", () => {
    const out = resolveYear(world(team()), [spend({ cfo: { borrow: 0, repay: 0, cashBuffer: 0, raiseAmount: 4_000_000 } })]);
    const after = out.world.companies.find((c) => c.id === "t")!;
    expect(after.founderShare).toBeLessThan(1);
    expect(out.reports.find((r) => r.companyId === "t")!.notes.join(" ")).toMatch(/founders now hold/i);
  });

  it("costs most when the company is worth least", () => {
    /*
     * The trap worth making visible: money raised cheaply in year one, when
     * there is nothing to value, is the most expensive money in the game.
     */
    const poor = resolveYear(world(team({ customers: {} })), [spend({ cfo: { raiseAmount: 4_000_000 } })]);
    const rich = resolveYear(
      world(team({ customers: { recently_single: 400_000 } })),
      [spend({ cfo: { raiseAmount: 4_000_000 } })],
    );
    const share = (r: any) => r.world.companies.find((c: any) => c.id === "t").founderShare;
    expect(share(poor)).toBeLessThan(share(rich));
  });

  it("never takes the whole company", () => {
    const out = resolveYear(world(team({ customers: {} })), [spend({ cfo: { raiseAmount: 900_000_000 } })]);
    expect(out.world.companies.find((c) => c.id === "t")!.founderShare).toBeGreaterThan(0);
  });

  it("leaves a company that raises nothing whole", () => {
    const out = resolveYear(world(team()), [spend()]);
    expect(out.world.companies.find((c) => c.id === "t")!.founderShare).toBe(1);
  });
});

describe("research", () => {
  it("does nothing the year you spend it", () => {
    const researching = resolveYear(world(team()), [spend({ cto: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0, researchSpend: 800_000 } })]);
    const shipping = resolveYear(world(team()), [spend({ cto: { featureSpend: 800_000, reliabilitySpend: 0, techDebtPaydown: 0 } })]);
    const q = (r: any) => r.reports.find((x: any) => x.companyId === "t").quality;
    expect(q(researching)).toBeLessThan(q(shipping));
  });

  it("lands in full the year after, and is worth more for the wait", () => {
    const first = resolveYear(world(team()), [spend({ cto: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0, researchSpend: 800_000 } })]);
    const carried = first.world.companies.find((c) => c.id === "t")!;
    expect(carried.pipeline).toBeGreaterThan(0);

    const second = resolveYear({ ...first.world, year: 2 }, [spend({ cto: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0 } })]);
    expect(second.reports.find((r) => r.companyId === "t")!.notes.join(" ")).toMatch(/research shipped/i);
  });

  it("buys more quality per pound than shipping does", () => {
    /*
     * The direct claim, not a two-year strategy comparison — how a season
     * plays out is emergent and depends on what everyone else does, and a test
     * that asserts an emergent outcome is testing the strategy it happened to
     * pick. What the lever promises is simply this: the same money, delivered
     * a year late, is worth more when it lands.
     */
    const money = 800_000;
    const shipped = resolveYear(world(team()), [spend({ cto: { featureSpend: money, reliabilitySpend: 0, techDebtPaydown: 0 } })]);
    const researched = resolveYear(world(team()), [spend({ cto: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0, researchSpend: money } })]);

    const shippedGain = shipped.reports.find((r) => r.companyId === "t")!.quality - team().quality;
    const banked = researched.world.companies.find((c) => c.id === "t")!.pipeline ?? 0;

    expect(banked).toBeGreaterThan(shippedGain);
    // And the wait is real: nothing of it shows up this year.
    expect(researched.reports.find((r) => r.companyId === "t")!.quality)
      .toBeLessThan(shipped.reports.find((r) => r.companyId === "t")!.quality);
  });
});

describe("the year's news", () => {
  it("tells everybody when something happens to the market", () => {
    /*
     * A market event is applied to the weather rather than to anybody's stats,
     * so a check of "did this company change?" saw nothing and said nothing.
     * A supplier failing, a funding winter, a regulator arriving — none of them
     * were ever mentioned to a single player. The year just got harder for
     * reasons nobody was told.
     */
    let w = buildWorld({ seasonId: "news", niche, teams: [{ id: "t", name: "T", seats: [...ROLES] }] });
    const heard: string[] = [];
    for (let year = 1; year <= 8; year++) {
      const out = resolveYear({ ...w, year }, [spend()], economyFor("news", year));
      w = out.world;
      if (out.event) {
        const notes = out.reports.find((r) => r.companyId === "t")!.notes.join(" ");
        expect(notes, `year ${year}'s event went unmentioned`).toContain(out.event.headline);
        heard.push(out.event.headline);
      }
    }
    expect(heard.length, "nothing happened in eight years").toBeGreaterThan(0);
  });

  it("says nothing in year one, when nothing has been earned yet", () => {
    const w = buildWorld({ seasonId: "news", niche, teams: [{ id: "t", name: "T", seats: [...ROLES] }] });
    expect(resolveYear({ ...w, year: 1 }, [spend()], economyFor("news", 1)).event).toBeNull();
  });

  it("gives the same year the same news twice over", () => {
    // A tick can be re-run; the news must not change underneath a player who
    // has already read it.
    const w = buildWorld({ seasonId: "news", niche, teams: [{ id: "t", name: "T", seats: [...ROLES] }] });
    const once = resolveYear({ ...w, year: 5 }, [spend()], economyFor("news", 5)).event;
    const again = resolveYear({ ...w, year: 5 }, [spend()], economyFor("news", 5)).event;
    expect(once).toEqual(again);
  });

  it("always leaves something a team can do about it", () => {
    const w = buildWorld({ seasonId: "news", niche, teams: [{ id: "t", name: "T", seats: [...ROLES] }] });
    for (let year = 2; year <= 10; year++) {
      const event = resolveYear({ ...w, year }, [spend()], economyFor("news", year)).event;
      if (event) expect(event.advice.length, `${event.headline} offers no way to respond`).toBeGreaterThan(30);
    }
  });
});

describe("costs over a whole season", () => {
  it("does not run away with itself", () => {
    /*
     * `costIndex` is how far input costs have moved since year one — an index,
     * not a yearly rate. Applying the whole of it every year compounded it:
     * unit costs ended a season roughly seven times where they started, every
     * company crossed the line where each sale lost money, and teams died in
     * the last three years for no reason they could see.
     */
    let w = buildWorld({ seasonId: "drift", niche, teams: [{ id: "t", name: "T", seats: [...ROLES] }] });
    const started = w.companies.find((c) => c.id === "t")!.unitCost;
    // A neutral year, so this measures the index's drift and not a focus that
    // deliberately trades efficiency for growth every year it is chosen.
    for (let year = 1; year <= 14; year++) {
      w = resolveYear({ ...w, year }, [spend({ ceo: { focus: "quality" } })], economyFor("drift", year)).world;
    }
    const ended = w.companies.find((c) => c.id === "t")!.unitCost;
    expect(ended, "a season's drift should look like the index, not the index compounded").toBeLessThan(started * 1.5);
    expect(ended).toBeGreaterThan(started * 0.4);
  });
});

describe("what the product owes itself", () => {
  /*
   * Technical debt was a lever that took money and gave nothing back, ever —
   * strictly worse than not using it. These pin the mechanic that replaced it:
   * shipping fast runs up a bill, carrying it makes every pound buy less and
   * every unit cost more, and clearing it buys nothing you can see this year.
   */
  it("goes up when you ship and down when you pay", () => {
    const shipping = nextTechDebt({ current: 20, featureSpend: 1_500_000, paydown: 0 });
    expect(shipping).toBeGreaterThan(20);

    const paying = nextTechDebt({ current: 20, featureSpend: 0, paydown: 1_000_000 });
    expect(paying).toBeLessThan(20);
  });

  it("is not run up by doing the work properly", () => {
    // Reliability work is the work of not accruing it.
    const careful = nextTechDebt({ current: 30, featureSpend: 0, paydown: 0 });
    expect(careful).toBeLessThanOrEqual(30);
  });

  it("stays inside its bounds however hard you try", () => {
    expect(nextTechDebt({ current: 99, featureSpend: 50_000_000 })).toBeLessThanOrEqual(100);
    expect(nextTechDebt({ current: 1, paydown: 90_000_000 })).toBeGreaterThanOrEqual(0);
  });

  it("makes product work buy less and units cost more while you carry it", () => {
    const clean = debtDrag(0);
    const heavy = debtDrag(80);
    expect(heavy.product).toBeLessThan(clean.product);
    expect(heavy.unitCost).toBeGreaterThan(clean.unitCost);
  });

  it("actually slows a company down over a year", () => {
    const indebted = resolveYear(world(team({ techDebt: 85 })), [spend()]);
    const clean = resolveYear(world(team({ techDebt: 0 })), [spend()]);
    const q = (r: any) => r.reports.find((x: any) => x.companyId === "t").quality;
    expect(q(indebted)).toBeLessThan(q(clean));
  });

  it("buys nothing you can see in the year you clear it", () => {
    /*
     * The decision the lever exists for: the seat that clears it gets no
     * credit, and the seat that does not hands a slower company to whoever is
     * still playing in year twelve.
     */
    const paying = resolveYear(
      world(team({ techDebt: 60 })),
      [spend({ cto: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 1_500_000 } })],
    );
    const ignoring = resolveYear(
      world(team({ techDebt: 60 })),
      [spend({ cto: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0 } })],
    );

    const q = (r: any) => r.reports.find((x: any) => x.companyId === "t").quality;
    expect(q(paying), "nothing visible this year").toBeCloseTo(q(ignoring), 5);
    // But the company is in better shape for next year.
    const debtOf = (r: any) => r.world.companies.find((c: any) => c.id === "t").techDebt;
    expect(debtOf(paying)).toBeLessThan(debtOf(ignoring));
  });
});

describe("the money finance refuses to let go of", () => {
  it("actually holds", () => {
    /*
     * `cashBuffer` was read by the commitment preview and by nothing else: the
     * finance seat could ring-fence the company's last two million, watch the
     * number change on their own screen, and watch it be spent anyway.
     */
    const c = team({ cash: 5_000_000 });
    const lavish = {
      cmo: { price: 22, brandSpend: 4_000_000, performanceSpend: 0, celebritySpend: 0, targetCities: [] },
    };

    const unguarded = resolveYear(world(c), [spend({ ...lavish, cfo: { borrow: 0, repay: 0, cashBuffer: 0 } })]);
    const guarded = resolveYear(world(c), [spend({ ...lavish, cfo: { borrow: 0, repay: 0, cashBuffer: 4_500_000 } })]);

    const costs = (r: any) => r.reports.find((x: any) => x.companyId === "t").costs;
    expect(costs(guarded), "the buffer should have cut the spending").toBeLessThan(costs(unguarded));
  });

  it("says so, rather than quietly cutting everyone", () => {
    const c = team({ cash: 5_000_000 });
    const out = resolveYear(world(c), [spend({
      cmo: { price: 22, brandSpend: 4_000_000, performanceSpend: 0, celebritySpend: 0, targetCities: [] },
      cfo: { borrow: 0, repay: 0, cashBuffer: 4_500_000 },
    })]);
    expect(out.reports.find((r) => r.companyId === "t")!.notes.join(" ")).toMatch(/Finance held/i);
  });

  it("leaves a sensible buffer alone", () => {
    const c = team({ cash: 5_000_000 });
    const modest = spend({ cfo: { borrow: 0, repay: 0, cashBuffer: 200_000 } });
    const none = spend({ cfo: { borrow: 0, repay: 0, cashBuffer: 0 } });
    const costs = (r: any) => r.reports.find((x: any) => x.companyId === "t").costs;
    expect(costs(resolveYear(world(c), [modest]))).toBeCloseTo(costs(resolveYear(world(c), [none])), 0);
  });
});
