/**
 * Owning things, losing things, and climbing back.
 *
 * The claims here are economic rather than arithmetic. A forced sale has to
 * hurt or distress costs nothing and nobody fears it; an asset has to actually
 * do something or the marketplace is a shop selling ornaments; a sealed bid
 * has to be decidable the same way twice or a re-run of the tick hands the
 * same patent to two different teams.
 */
import { describe, it, expect } from "vitest";
import {
  assetEffects, ageAssets, stillHeld, marketListings, resaleValue, resolveBids, ownListing, biddableFunds,
} from "@shared/simulation/assets";
import {
  distressOf, recoveryOptions, applyRecovery, reviewCovenant, climbing, COVENANT_YEARS,
} from "@shared/simulation/recovery";
import { startingCompany } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { seedIncumbents } from "@shared/simulation/incumbents";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type Company, type CompanyAsset } from "@shared/simulation/types";
import { INCUMBENT_BID_MAX, incumbentBids } from "@shared/simulation/assets";
import { seedIncumbents } from "@shared/simulation/incumbents";

const niche = nicheById("dating_apps")!;
const company = (over: Partial<Company> = {}): Company => ({
  ...startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] }),
  ...over,
});

const patent: CompanyAsset = {
  id: "a1", kind: "patent", name: "Core process patent",
  effect: { quality: 9, unitCost: 0.93 }, bookValue: 2_000_000,
};
const deal: CompanyAsset = {
  id: "a2", kind: "distribution", name: "Carrier bundle",
  effect: { capacity: 500_000, brand: 6 }, bookValue: 2_400_000, expiresIn: 3,
};

describe("what owning something does", () => {
  it("adds up across everything held", () => {
    const e = assetEffects([patent, deal]);
    expect(e.quality).toBe(9);
    expect(e.brand).toBe(6);
    expect(e.capacity).toBe(500_000);
    // Cost multipliers compound rather than sum.
    expect(e.unitCost).toBeCloseTo(0.93);
  });

  it("actually changes the year, which it never used to", () => {
    /*
     * Assets carried an `effect` the engine did not read for the whole of the
     * feature's life: owning a patent made a company no better at anything, it
     * only raised what a bank would lend against it.
     */
    const world = {
      seasonId: "s", niche, year: 1,
      economy: { demand: 1, interestRate: 0.08, costIndex: 1, outlook: "steady" as const },
      companies: [...seedIncumbents(niche), company()],
    };
    const withAssets = { ...world, companies: [...seedIncumbents(niche), company({ assets: [patent, deal] })] };
    const decisions = [{
      companyId: "t",
      cmo: { price: 22, brandSpend: 500_000, performanceSpend: 500_000, celebritySpend: 0, targetCities: [] },
      coo: { capacityTarget: 400_000, supportSpend: 200_000, efficiencySpend: 0, headcount: 5 },
    }];

    const plain = resolveYear(world, decisions).reports.find((r) => r.companyId === "t")!;
    const armed = resolveYear(withAssets, decisions).reports.find((r) => r.companyId === "t")!;
    expect(armed.customers).toBeGreaterThan(plain.customers);
  });

  it("does not let the benefit stick around after the thing is sold", () => {
    /*
     * The bonus is applied to what faces the market, never folded into the
     * company's own numbers. Otherwise it compounds every year it is held, and
     * a team could buy a patent, sell it back next year, and keep the quality.
     */
    const world = {
      seasonId: "s", niche, year: 1,
      economy: { demand: 1, interestRate: 0.08, costIndex: 1, outlook: "steady" as const },
      companies: [...seedIncumbents(niche), company({ assets: [patent] })],
    };
    const after = resolveYear(world, [{ companyId: "t" }]).world.companies.find((c) => c.id === "t")!;
    const without = resolveYear(
      { ...world, companies: [...seedIncumbents(niche), company()] },
      [{ companyId: "t" }],
    ).world.companies.find((c) => c.id === "t")!;

    expect(after.quality).toBe(without.quality);
    expect(after.unitCost).toBeCloseTo(without.unitCost, 5);
  });
});

describe("a year passing over what you own", () => {
  it("lets an asset work through its last year, says so, and drops it when the year is over", () => {
    const { assets, expired, notes } = ageAssets([{ ...deal, expiresIn: 1 }, patent]);
    expect(assets.map((a) => a.id).sort(), "both still work this year").toEqual(["a1", "a2"]);
    expect(expired).toEqual([]);
    expect(notes.join(" ")).toMatch(/last year/i);
    expect(stillHeld(assets).map((a) => a.id)).toEqual(["a1"]);
  });

  it("retires something already spent, and says so", () => {
    const { assets, expired, notes } = ageAssets([{ ...deal, expiresIn: 0 }]);
    expect(assets).toEqual([]);
    expect(expired.map((a) => a.id)).toEqual(["a2"]);
    expect(notes.join(" ")).toMatch(/run out/i);
  });

  it("gives a year's warning before it happens", () => {
    // A capability that vanishes unannounced reads as a bug, not as the
    // licence they agreed to three years ago ending.
    const { notes } = ageAssets([{ ...deal, expiresIn: 2 }]);
    expect(notes.join(" ")).toMatch(/expires at the end of next year/i);
  });

  /*
   * The bug this pins: "expires at the end of next year" was followed by the
   * asset doing nothing in that year. A three-year deal works three years.
   */
  it("works for exactly as many years as its life, through the engine", () => {
    let world: any = {
      seasonId: "s", niche, year: 1,
      economy: { demand: 1, interestRate: 0.08, costIndex: 1, outlook: "steady" as const },
      companies: [...seedIncumbents(niche), company({ assets: [{ ...deal, expiresIn: 3 }] })],
    };
    const capacityInYear: number[] = [];
    for (let y = 0; y < 4; y++) {
      const held = world.companies.find((c) => c.id === "t")!.assets;
      capacityInYear.push(assetEffects(ageAssets(held).assets).capacity);
      world = { ...resolveYear(world, [{ companyId: "t" }]).world, year: world.year + 1 };
    }
    expect(capacityInYear).toEqual([500_000, 500_000, 500_000, 0]);
    expect(world.companies.find((c) => c.id === "t")!.assets).toEqual([]);
  });

  it("leaves things that do not expire alone", () => {
    const { assets } = ageAssets([patent]);
    expect(assets[0].expiresIn).toBeUndefined();
  });
});

describe("selling", () => {
  it("never pays what you paid", () => {
    expect(resaleValue(patent, { forced: false })).toBeLessThan(patent.bookValue);
  });

  it("pays much less when the seller has no choice", () => {
    /*
     * The discount is the whole economic engine of the recovery arc: it is
     * what makes distress genuinely expensive, and what makes a rival's
     * collapse an opportunity rather than a spectacle.
     */
    const willing = resaleValue(deal, { forced: false });
    const forced = resaleValue(deal, { forced: true });
    expect(forced).toBeLessThan(willing * 0.75);
  });

  it("is worth less the closer it is to lapsing", () => {
    const fresh = resaleValue({ ...deal, expiresIn: 6 }, { forced: false });
    const nearly = resaleValue({ ...deal, expiresIn: 1 }, { forced: false });
    expect(nearly).toBeLessThan(fresh);
  });
});

describe("the market", () => {
  it("shows every team the same things, and a re-run the same things again", () => {
    // A tick can be re-run. If the market were drawn from real randomness the
    // retry would deal a different hand than the one players already saw.
    const a = marketListings({ seasonId: "s1", year: 4, niche });
    const b = marketListings({ seasonId: "s1", year: 4, niche });
    expect(a).toEqual(b);
    expect(marketListings({ seasonId: "s1", year: 5, niche })).not.toEqual(a);
  });

  it("never lists the same thing twice", () => {
    for (const year of [1, 2, 3, 4, 5, 6, 7]) {
      const names = marketListings({ seasonId: "s", year, niche }).map((l) => l.asset.name);
      expect(new Set(names).size, `year ${year} listed a duplicate`).toBe(names.length);
    }
  });
});

describe("the sealed bid", () => {
  const listings = marketListings({ seasonId: "s", year: 1, niche });
  const rich = { a: 99_000_000, b: 99_000_000, c: 99_000_000 };

  it("gives it to the highest bidder, who pays what they bid", () => {
    const target = listings[0];
    const awards = resolveBids([target], [
      { ventureId: "a", listingId: target.id, amount: target.reserve + 100_000 },
      { ventureId: "b", listingId: target.id, amount: target.reserve + 500_000 },
    ], rich);
    expect(awards[0].winnerId).toBe("b");
    expect(awards[0].price).toBe(target.reserve + 500_000);
  });

  it("sells nothing to a bid under the reserve", () => {
    const target = listings[0];
    const awards = resolveBids([target], [
      { ventureId: "a", listingId: target.id, amount: Math.round(target.reserve * 0.5) },
    ], rich);
    expect(awards[0].winnerId).toBeNull();
    expect(awards[0].note).toMatch(/unsold/i);
  });

  it("spends one pot of money once across the whole auction", () => {
    /*
     * The bug this exists for: each lot used to be settled independently
     * against the money the bidder started the auction with, so a team with a
     * million could bid a million on three lots, win all three, and pay three
     * million. Bids are sealed, so nothing on any screen warned them, and
     * nothing afterwards recorded a borrowing — the company simply came out of
     * the year two million overdrawn with no debt against its name.
     *
     * Bidding on more than you can afford is a reasonable thing to do against
     * sealed bids, because you do not know which you will win. So it is still
     * allowed. What it now costs you is the later lots, which is the decision
     * the marketplace is supposed to pose in the first place.
     */
    const three = listings.slice(0, 3);
    const pot = Math.max(...three.map((l) => l.reserve)) + 50_000;
    const awards = resolveBids(
      three,
      three.map((l) => ({ ventureId: "a", listingId: l.id, amount: pot })),
      { a: pot },
    );

    const won = awards.filter((a) => a.winnerId === "a");
    expect(won.length, "one pot buys one lot").toBe(1);
    expect(won[0].price).toBe(pot);
    expect(awards.reduce((sum, a) => sum + (a.winnerId === "a" ? a.price : 0), 0)).toBe(pot);

    // And the team is told why two good bids took nothing, by name.
    const explained = awards.filter((a) => a.couldNotAfford.includes("a"));
    expect(explained.length, "the dropped bids are accounted for").toBe(2);
  });

  it("still lets a team win two lots when it can afford two", () => {
    // The fix must not turn into a one-lot-per-team rule. The constraint is
    // the money, and a team with enough of it buys as much as it bid for.
    const two = listings.slice(0, 2);
    const each = Math.max(...two.map((l) => l.reserve)) + 10_000;
    const awards = resolveBids(
      two,
      two.map((l) => ({ ventureId: "a", listingId: l.id, amount: each })),
      { a: each * 2 },
    );
    expect(awards.filter((a) => a.winnerId === "a").length).toBe(2);
  });

  it("lets the next bidder have what the broke one could not pay for", () => {
    /*
     * A lot must not go unsold because the leading bidder had already spent
     * the money. Somebody else bid, over the reserve, with cash in hand — the
     * asset is theirs.
     */
    const two = listings.slice(0, 2);
    const big = Math.max(...two.map((l) => l.reserve)) + 200_000;
    const awards = resolveBids(
      two,
      [
        { ventureId: "a", listingId: two[0].id, amount: big },
        { ventureId: "a", listingId: two[1].id, amount: big },
        { ventureId: "b", listingId: two[1].id, amount: two[1].reserve + 1_000 },
      ],
      { a: big, b: 99_000_000 },
    );
    expect(awards[0].winnerId, "the first lot goes to the bigger bid").toBe("a");
    expect(awards[1].winnerId, "and the second to the one who can still pay").toBe("b");
  });

  it("ignores a bid the bidder cannot pay", () => {
    /*
     * Checked when the bids are resolved rather than when they were made: the
     * money may have gone somewhere else in the meantime, and a team should
     * not win an auction with money it spent on marketing.
     */
    const target = listings[0];
    const awards = resolveBids([target], [
      { ventureId: "a", listingId: target.id, amount: target.reserve + 1_000_000 },
      { ventureId: "b", listingId: target.id, amount: target.reserve },
    ], { a: 0, b: 99_000_000 });
    expect(awards[0].winnerId).toBe("b");
  });

  it("breaks a tie the same way every time", () => {
    const target = listings[0];
    const bids = [
      { ventureId: "zeta", listingId: target.id, amount: target.reserve },
      { ventureId: "alpha", listingId: target.id, amount: target.reserve },
    ];
    const once = resolveBids([target], bids, { zeta: 9e9, alpha: 9e9 });
    const again = resolveBids([target], [...bids].reverse(), { zeta: 9e9, alpha: 9e9 });
    expect(once[0].winnerId).toBe(again[0].winnerId);
  });

  it("lets a company put its own things up", () => {
    const c = company({ assets: [patent] });
    const listing = ownListing(c, "a1", 900_000)!;
    expect(listing.sellerId).toBe("t");
    expect(listing.reserve).toBe(900_000);
    expect(ownListing(c, "nope", 1)).toBeNull();
  });

  it("counts credit as money a team can bid with", () => {
    expect(biddableFunds(company({ cash: 1_000_000, creditLimit: 2_000_000, debt: 500_000 }))).toBe(2_500_000);
  });
});

describe("how much trouble a company is in", () => {
  it("warns before the wall rather than at it", () => {
    /*
     * The interesting moment is the one before insolvency. A team told they
     * are stretched in year five has a year to act; a team that finds out when
     * the engine marks them bankrupt has only the consequences.
     */
    expect(distressOf(company())).toBe("healthy");
    expect(distressOf(company({ cash: 1_400_000, creditLimit: 200_000 }))).toBe("strained");
    expect(distressOf(company({ cash: 300_000, creditLimit: 200_000 }))).toBe("distressed");
    expect(distressOf(company({ cash: 0, creditLimit: 0 }))).toBe("insolvent");
    expect(distressOf(company({ bankruptSince: 3 }))).toBe("insolvent");
  });

  it("offers a healthy company nothing, because it needs nothing", () => {
    expect(recoveryOptions(company(), 3)).toEqual([]);
  });

  it("offers more, and worse, the deeper the trouble", () => {
    const stretched = recoveryOptions(company({ cash: 1_400_000, creditLimit: 200_000, debt: 150_000, assets: [patent] }), 3);
    const sunk = recoveryOptions(company({ cash: 0, creditLimit: 0, debt: 3_000_000, assets: [patent] }), 3);

    // Rescue money and firing a colleague are not on the table until they have to be.
    expect(stretched.map((o) => o.kind)).not.toContain("rescue_raise");
    expect(sunk.map((o) => o.kind)).toContain("rescue_raise");
    expect(sunk.map((o) => o.kind)).toContain("dissolve_seat");
  });

  it("says what each one costs before it is chosen", () => {
    for (const option of recoveryOptions(company({ cash: 0, creditLimit: 0, debt: 2_000_000, assets: [patent] }), 3)) {
      expect(option.cost.length, `${option.kind} has no stated cost`).toBeGreaterThan(30);
    }
  });
});

describe("the moves themselves", () => {
  it("turns everything owned into cash, and hands the capability to whoever buys it", () => {
    const c = company({ cash: 0, creditLimit: 0, assets: [patent, deal] });
    const out = applyRecovery({ company: c, kind: "fire_sale", year: 4 });
    expect(out.company.assets).toEqual([]);
    expect(out.company.cash).toBeGreaterThan(0);
    // Released so the marketplace can put them in front of the rivals.
    expect(out.released).toHaveLength(2);
  });

  it("puts a cap on spending in exchange for easier terms, with a way out", () => {
    const c = company({ cash: 500_000, debt: 2_000_000 });
    const out = applyRecovery({ company: c, kind: "restructure", year: 5 });
    expect(out.company.covenant).toBeTruthy();
    expect(out.company.covenant!.spendCap).toBeGreaterThan(0);
    expect(out.company.reputation).toBeLessThan(c.reputation);
    // The exit is stated up front, which is what makes it an arc.
    expect(out.notes.join(" ")).toMatch(/2 years|two years/i);
  });

  it("stops the salary and the decisions together", () => {
    const c = company({ cash: 0, creditLimit: 0 });
    const out = applyRecovery({ company: c, kind: "dissolve_seat", year: 4, seat: "cto" });
    expect(out.company.seats).not.toContain("cto");
    expect(out.notes.join(" ")).toMatch(/nobody makes them/i);
  });

  it("takes rescue money that clears the hole and costs a third of the company", () => {
    const c = company({ cash: -500_000, creditLimit: 0, bankruptSince: 3 });
    const out = applyRecovery({ company: c, kind: "rescue_raise", year: 4 });
    expect(out.company.cash).toBeGreaterThan(0);
    expect(out.company.bankruptSince).toBeUndefined();
    expect(out.notes.join(" ")).toMatch(/third of the company/i);
  });
});

describe("the arc out of it", () => {
  it("lifts the cap after two clear years", () => {
    let covenant: any = { since: 3, spendCap: 500_000, met: 0, rateRelief: 0.03 };
    const first = reviewCovenant(covenant, 400_000);
    expect(first.covenant!.met).toBe(1);
    expect(first.note).toMatch(/one more/i);

    const second = reviewCovenant(first.covenant, 450_000);
    expect(second.covenant, "two clear years and it is gone").toBeUndefined();
    expect(second.note).toMatch(/lifted/i);
  });

  it("resets the clock when the cap is broken, and says by how much", () => {
    const covenant = { since: 3, spendCap: 500_000, met: 1, rateRelief: 0.03 };
    const out = reviewCovenant(covenant, 900_000);
    expect(out.covenant!.met).toBe(0);
    expect(out.note).toMatch(/900,000/);
  });

  it("knows the difference between climbing and merely still alive", () => {
    // Praise a team that is still sinking and they stop believing the screen.
    const before = company({ cash: 500_000, debt: 2_000_000, creditLimit: 2_000_000 });
    expect(climbing(before, company({ cash: 900_000, debt: 1_800_000, creditLimit: 2_000_000 }))).toBe(true);
    expect(climbing(before, company({ cash: 600_000, debt: 2_400_000, creditLimit: 2_000_000 }))).toBe(false);
  });
});

/**
 * Somebody else turns up to the auction.
 *
 * `fileBotBids` covers bot-run *player* companies, and a season built from
 * somebody's own project has none — so every lot in the first season anybody
 * played came back "nobody met the reserve", five lots a period, for the whole
 * season. An auction nobody else attends is not an auction; it is a shop with
 * a fixed price and a longer wait.
 */
describe("the rivals at the auction", () => {
  const niche = nicheById("dating_apps")!;
  const lots = (count = 5) => marketListings({ seasonId: "s1", year: 1, niche, count });
  const rivals = seedIncumbents(niche).map((c) => ({ id: c.id }));

  it("bids for some lots and not others", () => {
    /* Over many periods, so the sample is not one roll of the dice. */
    let contested = 0;
    let total = 0;
    for (let year = 1; year <= 40; year += 1) {
      const listings = marketListings({ seasonId: "s1", year, niche });
      const bids = incumbentBids({ seasonId: "s1", year, listings, incumbents: rivals });
      total += listings.length;
      contested += new Set(bids.map((b) => b.listingId)).size;
    }
    const rate = contested / total;
    expect(rate, "some lots are contested").toBeGreaterThan(0.1);
    expect(rate, "and most are still there for the taking").toBeLessThan(0.7);
  });

  it("bids a little over the reserve, never under it", () => {
    for (let year = 1; year <= 20; year += 1) {
      const listings = marketListings({ seasonId: "s1", year, niche });
      for (const b of incumbentBids({ seasonId: "s1", year, listings, incumbents: rivals })) {
        const lot = listings.find((l) => l.id === b.listingId)!;
        expect(b.amount, "over the reserve, or it buys nothing").toBeGreaterThan(lot.reserve);
        expect(b.amount, "and not a wild number").toBeLessThanOrEqual(Math.round(lot.reserve * INCUMBENT_BID_MAX));
      }
    }
  });

  /* Sealed means sealed: the same auction twice, and no reading of the table. */
  it("deals the same auction on a re-run", () => {
    const listings = lots();
    expect(incumbentBids({ seasonId: "s1", year: 3, listings, incumbents: rivals }))
      .toEqual(incumbentBids({ seasonId: "s1", year: 3, listings, incumbents: rivals }));
  });

  /*
   * Across a run of periods rather than one. At a tenth each, a single period
   * where neither season's rivals turn up is an ordinary outcome, not a
   * failure — and a test that reads it as one fails on the dice.
   */
  it("is a different auction in a different season", () => {
    const seasonRuns = (seasonId: string) =>
      JSON.stringify(Array.from({ length: 20 }, (_, i) => {
        const listings = marketListings({ seasonId, year: i + 1, niche });
        return incumbentBids({ seasonId, year: i + 1, listings, incumbents: rivals });
      }));
    expect(seasonRuns("s1")).not.toEqual(seasonRuns("s2"));
  });

  /* An incumbent selling a thing does not bid for it back. */
  it("never bids on its own lot", () => {
    const own = lots().map((l) => ({ ...l, sellerId: rivals[0].id }));
    const bids = incumbentBids({ seasonId: "s1", year: 1, listings: own, incumbents: rivals });
    expect(bids.some((b) => b.ventureId === rivals[0].id)).toBe(false);
  });

  /* And a player who bids properly still beats them. */
  it("loses to a player who bids above them", () => {
    const listings = lots(1);
    const lot = listings[0];
    const theirs = incumbentBids({ seasonId: "s1", year: 1, listings, incumbents: rivals });
    const high = Math.round(lot.reserve * (INCUMBENT_BID_MAX + 0.2));
    const awards = resolveBids(listings, [...theirs, { ventureId: "me", listingId: lot.id, amount: high }],
      { me: high * 2, ...Object.fromEntries(rivals.map((r) => [r.id, high * 2])) });
    expect(awards[0].winnerId).toBe("me");
  });
});
