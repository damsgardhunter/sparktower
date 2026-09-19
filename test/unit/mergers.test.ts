/**
 * Buying somebody's company, and what it leaves them with.
 *
 * The claim these tests exist to hold down is the one the whole feature turns
 * on: an acquisition must never be an elimination. Five people whose company
 * is bought on day ten have to still have something to open on day eleven, or
 * this mechanic costs more players than it entertains.
 */
import { describe, it, expect } from "vitest";
import { valuation, canOffer, assessOffer, applyAcquisition, alreadySold } from "@shared/simulation/mergers";
import { startingCompany } from "@shared/simulation/season";
import { seedIncumbents } from "@shared/simulation/incumbents";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type Company, type CompanyAsset } from "@shared/simulation/types";

const niche = nicheById("dating_apps")!;
const company = (id: string, over: Partial<Company> = {}): Company => ({
  ...startingCompany({ id, name: id.toUpperCase(), niche, seats: [...ROLES] }),
  ...over,
});

const patent: CompanyAsset = {
  id: "a1", kind: "patent", name: "Core process patent",
  effect: { quality: 9 }, bookValue: 2_000_000,
};

describe("what a company is worth", () => {
  it("prices it on what it earns, what it owns and what it owes", () => {
    const c = company("t", { customers: { recently_single: 100_000 }, price: 20, assets: [patent], debt: 1_000_000 });
    const v = valuation(c);
    expect(v.revenue).toBe(2_000_000);
    expect(v.assets).toBe(1_600_000);
    expect(v.debt).toBe(1_000_000);
    expect(v.fair).toBe(Math.round(2_000_000 * 1.2 + 1_600_000 - 1_000_000));
  });

  it("explains itself in the words both sides will argue in", () => {
    /*
     * Published to buyer and seller alike. A negotiation where only one side
     * can do the arithmetic is a trick played on whoever is newer to the game.
     */
    const v = valuation(company("t", { customers: { recently_single: 50_000 }, price: 22, debt: 500_000 }));
    expect(v.notes.join(" ")).toMatch(/50,000 customers/);
    expect(v.notes.join(" ")).toMatch(/owes/);
  });

  it("never goes below nothing, however bad the position", () => {
    const wreck = company("t", { customers: {}, debt: 90_000_000, assets: [] });
    expect(valuation(wreck).fair).toBe(0);
    expect(valuation(wreck).notes.join(" ")).toMatch(/no customers/i);
  });

  it("says out loud that a cheap insolvent company may not be a bargain", () => {
    const v = valuation(company("t", { bankruptSince: 4, customers: { recently_single: 1000 } }));
    expect(v.notes.join(" ")).toMatch(/insolvent/i);
  });
});

describe("whether an offer can be made", () => {
  const rich = company("a", { cash: 50_000_000 });
  const target = company("b", { customers: { recently_single: 10_000 } });
  const base = { pendingFrom: 0, year: 5, totalYears: 14 };

  it("allows a funded offer to another team", () => {
    expect(canOffer({ from: rich, to: target, amount: 5_000_000, ...base }).ok).toBe(true);
  });

  it("refuses an offer nobody could pay", () => {
    /*
     * A real refusal rather than a warning, unlike a sealed bid: an offer is a
     * promise made to another team who will spend a day deciding about it.
     */
    const poor = company("a", { cash: 100_000, creditLimit: 200_000, debt: 0 });
    const out = canOffer({ from: poor, to: target, amount: 10_000_000, ...base });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("cannot_afford");
      expect(out.message).toMatch(/day of somebody else's time/i);
    }
  });

  it("counts credit as reach, because a buyer would borrow for this", () => {
    const leveraged = company("a", { cash: 1_000_000, creditLimit: 9_000_000, debt: 0 });
    expect(canOffer({ from: leveraged, to: target, amount: 9_500_000, ...base }).ok).toBe(true);
  });

  it("refuses to sell an incumbent", () => {
    const incumbent = seedIncumbents(niche)[0];
    const out = canOffer({ from: rich, to: incumbent, amount: 99_000_000, ...base });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("not_a_team");
  });

  it("refuses a second offer while one is on the table", () => {
    const out = canOffer({ from: rich, to: target, amount: 1_000_000, ...base, pendingFrom: 1 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("already_pending");
  });

  it("refuses a purchase that would never trade a year", () => {
    // Money spent for a league-table number rather than for a company to run.
    const out = canOffer({ from: rich, to: target, amount: 1_000_000, pendingFrom: 0, year: 14, totalYears: 14 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("season_ending");
  });

  it("refuses to buy yourself", () => {
    expect(canOffer({ from: rich, to: rich, amount: 1, ...base }).ok).toBe(false);
  });
});

describe("how an offer reads to the team deciding", () => {
  const target = company("b", { customers: { recently_single: 100_000 }, price: 20 });
  const fair = valuation(target).fair;

  it("calls a strong offer strong and a derisory one derisory", () => {
    expect(assessOffer(Math.round(fair * 1.5), target).verdict).toBe("generous");
    expect(assessOffer(fair, target).verdict).toBe("fair");
    expect(assessOffer(Math.round(fair * 0.7), target).verdict).toBe("low");
    expect(assessOffer(Math.round(fair * 0.2), target).verdict).toBe("insulting");
  });

  it("frames it as a choice rather than a verdict", () => {
    // The question is whether you would rather have the money or the company,
    // and a screen that answered it for them would be playing the game for them.
    expect(assessOffer(fair, target).note).toMatch(/rather have the money or the company/i);
  });
});

describe("the acquisition itself", () => {
  const buyer = company("a", { cash: 20_000_000, customers: { recently_single: 50_000 }, capacity: 500_000 });
  const seller = company("b", {
    cash: 500_000, debt: 3_000_000, customers: { recently_single: 80_000, swipers: 20_000 },
    assets: [patent], reputation: 61,
  });

  it("moves the business across: customers, what it owned, what it owed", () => {
    const out = applyAcquisition({ buyer, seller, amount: 6_000_000 });
    expect(out.buyer.customers.recently_single).toBe(130_000);
    expect(out.buyer.customers.swipers).toBe(20_000);
    expect(out.buyer.assets.map((a) => a.id)).toContain("a1");
    // The debts come with the business, which is what stops a cheap company being cheap.
    expect(out.buyer.debt).toBe(buyer.debt + 3_000_000);
    expect(out.buyer.cash).toBe(20_000_000 - 6_000_000);
  });

  it("leaves the seller a company, not a crater", () => {
    /*
     * The claim the whole feature turns on. Five people whose company was
     * bought on day ten must still have something to open on day eleven.
     */
    const out = applyAcquisition({ buyer, seller, amount: 6_000_000 });

    expect(out.seller.cash).toBe(500_000 + 6_000_000);
    expect(out.seller.seats, "they keep every seat").toEqual(seller.seats);
    expect(out.seller.reputation, "and their reputation").toBe(61);
    expect(out.seller.capacity, "and the ability to serve people again").toBeGreaterThan(0);
    // What they gave up.
    expect(out.seller.customers).toEqual({});
    expect(out.seller.assets).toEqual([]);
    // And the debt went with the business.
    expect(out.seller.debt).toBe(0);
  });

  it("makes selling a way out of insolvency rather than the end of it", () => {
    const sinking = company("b", { cash: -1_000_000, debt: 5_000_000, bankruptSince: 6, customers: { recently_single: 30_000 } });
    const out = applyAcquisition({ buyer, seller: sinking, amount: 2_000_000 });
    expect(out.seller.bankruptSince).toBeUndefined();
    expect(out.seller.cash).toBeGreaterThan(0);
    expect(out.sellerNotes.join(" ")).toMatch(/starting again, from in front/i);
  });

  it("warns a buyer who has just bought more people than they can serve", () => {
    /*
     * This is what stops one team buying everybody. Customers bought are
     * customers who must be served, and turning them away costs reputation in
     * public at the moment everyone is watching.
     */
    const small = company("a", { cash: 20_000_000, capacity: 1_000 });
    const out = applyAcquisition({ buyer: small, seller, amount: 6_000_000 });
    expect(out.buyerNotes.join(" ")).toMatch(/more customers than you can serve/i);
  });

  it("tells both sides what happened, in their own terms", () => {
    const out = applyAcquisition({ buyer, seller, amount: 6_000_000 });
    expect(out.buyerNotes.join(" ")).toMatch(/Bought B/);
    expect(out.sellerNotes.join(" ")).toMatch(/Sold the business/);
    expect(out.sellerNotes.join(" ")).toMatch(/every seat/i);
  });
});

describe("a company with nothing left", () => {
  it("is not worth approaching again", () => {
    expect(alreadySold(company("b", { customers: {}, assets: [] }))).toBe(true);
    expect(alreadySold(company("b", { customers: { recently_single: 1 }, assets: [] }))).toBe(false);
  });
});
