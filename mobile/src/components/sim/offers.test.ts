/**
 * The acquisition screen's arithmetic, driven through the cases that would
 * cost somebody a company.
 *
 * Two groups matter more than the rest. `validateOffer` has to refuse exactly
 * what the server refuses and no more — a local rule the engine doesn't share
 * is a screen quietly playing the game for you, and a missing one is a promise
 * a team cannot pay landing on somebody else's table. And `offerStatusRead`
 * has to keep the two sides of a trade apart: "accepted" means "you bought it"
 * to one company and "you sold it" to the other, and a screen that mixed those
 * up would tell a team they had lost a company they had just bought.
 */
import { describe, it, expect } from "vitest";
import {
  KEEP_LINES, MONEY_IS_A_POSITION_NOT_AN_INCOME, NOT_AN_ELIMINATION, canTrade, isLive,
  liveOffers, offerStatusRead, outstandingOffer, purchaseRead, ratioRead, serviceGap,
  sortTargets, validateOffer, verdictRead,
  type MadeOffer, type OfferTarget, type YourValuation,
} from "./offers";

/** Your own company: big enough to serve what it holds, with room for more. */
const yours = (over: Partial<YourValuation> = {}): YourValuation => ({
  name: "Us",
  revenue: 2_000_000,
  assets: 0,
  debt: 0,
  fair: 2_400_000,
  notes: [],
  capacity: 200_000,
  customers: 60_000,
  ...over,
});

const target = (over: Partial<OfferTarget> = {}): OfferTarget => ({
  id: "t1",
  name: "Wren & Co",
  customers: 120_000,
  distress: "healthy",
  revenue: 4_000_000,
  assets: 500_000,
  debt: 1_000_000,
  fair: 4_300_000,
  notes: ["120,000 customers at 33 is 4,000,000 a year."],
  hollow: false,
  ...over,
});

describe("who can act", () => {
  it("is the chief executive, and nobody else", () => {
    expect(canTrade("ceo")).toBe(true);
    expect(canTrade("cfo")).toBe(false);
    expect(canTrade(null)).toBe(false);
    expect(canTrade(undefined)).toBe(false);
  });
});

describe("an amount against what the business is worth", () => {
  it("names the direction, because both sides read the same number", () => {
    expect(ratioRead(1.4)).toBe("40% above what the business is worth on paper.");
    expect(ratioRead(0.55)).toBe("45% below what the business is worth on paper.");
  });

  it("stops splitting hairs inside a couple of per cent", () => {
    expect(ratioRead(1)).toBe("About what the business is worth on paper.");
    expect(ratioRead(1.02)).toBe("About what the business is worth on paper.");
    expect(ratioRead(0.98)).toBe("About what the business is worth on paper.");
  });

  it("says something rather than NaN when there is nothing to compare to", () => {
    expect(ratioRead(Number.NaN)).toMatch(/Hard to compare/);
    expect(ratioRead(Number.POSITIVE_INFINITY)).toMatch(/Hard to compare/);
  });

  it("reads the server's four verdicts, and survives one it hasn't heard of", () => {
    expect(verdictRead("generous").label).toBe("Generous");
    expect(verdictRead("insulting").label).toBe("Insulting");
    expect(verdictRead("wildly generous").label).toBe("wildly generous");
  });
});

describe("what a status means, from the side you're sitting on", () => {
  it("reads an accepted offer as a purchase to the buyer and a sale to the seller", () => {
    expect(offerStatusRead("accepted", "made").line).toMatch(/come to you/);
    expect(offerStatusRead("accepted", "received").line).toMatch(/you keep the company, every seat/);
  });

  it("never describes being bought as leaving the season", () => {
    const seller = offerStatusRead("accepted", "received");
    expect(seller.line).not.toMatch(/out of the (game|season)|eliminated|knocked out/i);
    expect(NOT_AN_ELIMINATION).toMatch(/starting again, from in front/);
    expect(KEEP_LINES.length).toBe(3);
  });

  it("doesn't let 'you keep the money' turn into 'you'll be richer'", () => {
    // The proceeds land and then the year runs anyway: salaries go out, the
    // opening defaults get spent, and there are no customers to earn it back.
    // A team that sells ends the year down slightly, with no debt and more
    // cash than anybody else — a position, not an income.
    expect(MONEY_IS_A_POSITION_NOT_AN_INCOME).toMatch(/isn't a cushion that grows/);
    expect(MONEY_IS_A_POSITION_NOT_AN_INCOME).toMatch(/a little down on where you started/);
    expect(MONEY_IS_A_POSITION_NOT_AN_INCOME).not.toMatch(/richer|grow(s|ing)? (into|to)/i);
  });

  it("treats exactly one status as still actionable", () => {
    expect(isLive("pending")).toBe(true);
    for (const status of ["accepted", "declined", "lapsed", "withdrawn"] as const) {
      expect(isLive(status)).toBe(false);
      expect(offerStatusRead(status, "made").live).toBe(false);
    }
    expect(offerStatusRead("pending", "received").live).toBe(true);
  });

  it("says who did the withdrawing", () => {
    expect(offerStatusRead("withdrawn", "made").line).toMatch(/You took it back/);
    expect(offerStatusRead("withdrawn", "received").line).toMatch(/They took it back/);
  });

  it("explains a lapse as the year answering for them", () => {
    expect(offerStatusRead("lapsed", "received").line).toMatch(/year resolved/);
  });
});

describe("the offers on the table", () => {
  const made = (over: Partial<MadeOffer>): MadeOffer => ({
    id: "o1", to: "Wren & Co", toId: "t1", amount: 1_000, message: null, status: "pending", ...over,
  });

  it("finds the one live offer, since the server only allows one", () => {
    const list = [made({ id: "a", status: "declined" }), made({ id: "b", status: "pending" })];
    expect(outstandingOffer(list)?.id).toBe("b");
    expect(outstandingOffer([made({ status: "lapsed" })])).toBeNull();
    expect(outstandingOffer(undefined)).toBeNull();
  });

  it("counts an accepted offer as outstanding, as the server does", () => {
    // Nothing changes hands until the tick, so a yes does not free the money
    // up for a second purchase — the server counts pending and accepted.
    expect(outstandingOffer([made({ id: "a", status: "accepted" })])?.id).toBe("a");
    // The one still open to action wins if both are somehow there.
    expect(outstandingOffer([made({ id: "a", status: "accepted" }), made({ id: "b", status: "pending" })])?.id).toBe("b");
  });

  it("filters the live ones either way round", () => {
    expect(liveOffers([made({ status: "pending" }), made({ status: "withdrawn" })])).toHaveLength(1);
    expect(liveOffers(undefined)).toEqual([]);
  });
});

describe("whether an offer can be made", () => {
  const base = {
    amount: 4_000_000,
    reach: 9_000_000,
    target: target(),
    role: "ceo" as string | null,
    year: 3,
    totalYears: 10,
    you: yours(),
    status: "running",
  };

  it("allows a sensible offer the company can back", () => {
    expect(validateOffer(base)).toEqual({ ok: true, error: null, warning: null });
  });

  it("refuses anybody but the chair, which is what the route does", () => {
    const check = validateOffer({ ...base, role: "coo" });
    expect(check.ok).toBe(false);
    expect(check.error).toMatch(/chief executive/);
  });

  it("refuses more than the company can reach, counting credit", () => {
    const check = validateOffer({ ...base, amount: 9_000_001 });
    expect(check.ok).toBe(false);
    expect(check.error).toMatch(/9,000,000/);
  });

  it("allows an offer for exactly everything the company can reach", () => {
    expect(validateOffer({ ...base, amount: 9_000_000 }).ok).toBe(true);
  });

  it("refuses a second offer while one is on somebody else's table", () => {
    const check = validateOffer({
      ...base,
      pendingElsewhere: { id: "o1", to: "Halberd", toId: "t2", amount: 1, message: null, status: "pending" },
    });
    expect(check.ok).toBe(false);
    expect(check.error).toMatch(/Halberd/);
  });

  it("lets a revision through to the company the offer is already with", () => {
    // The screen passes `pendingElsewhere` only for *other* targets, so a
    // revision arrives here with nothing pending and must not be refused.
    expect(validateOffer({ ...base, pendingElsewhere: null }).ok).toBe(true);
  });

  it("refuses a purchase that could never trade a year", () => {
    const check = validateOffer({ ...base, year: 10, totalYears: 10 });
    expect(check.ok).toBe(false);
    expect(check.error).toMatch(/Too late in the season/);
  });

  it("refuses a company that has already sold the business, and says what's left", () => {
    const check = validateOffer({ ...base, target: target({ hollow: true }) });
    expect(check.ok).toBe(false);
    expect(check.error).toMatch(/already sold/);
    expect(check.error).toMatch(/the seats and the money are theirs/);
  });

  it("wants a number", () => {
    expect(validateOffer({ ...base, amount: "" }).error).toBe("How much?");
    expect(validateOffer({ ...base, amount: "lots" }).error).toBe("That isn't an amount.");
    expect(validateOffer({ ...base, amount: -1 }).error).toBe("That isn't an amount.");
  });

  it("warns about a cheeky number without ever refusing to send it", () => {
    const check = validateOffer({ ...base, amount: 1_000_000 });
    expect(check.ok).toBe(true);
    expect(check.warning).toMatch(/Well under what it is worth/);
  });

  it("warns about the customers it could not serve, with the arithmetic", () => {
    // The mistake this mechanic punishes hardest, and the one an asking price
    // says nothing about: 60,000 held plus 120,000 arriving against 100,000 of
    // capacity is 80,000 people turned away in public.
    const check = validateOffer({ ...base, you: yours({ capacity: 100_000 }) });
    expect(check.ok).toBe(true);
    expect(check.warning).toMatch(/180,000 customers and can serve 100,000/);
    expect(check.warning).toMatch(/80,000 of them get turned away/);
  });

  it("says nothing about capacity when everybody who arrives can be served", () => {
    expect(validateOffer(base).warning).toBeNull();
  });

  it("puts capacity ahead of price when both would have something to say", () => {
    // A cheap offer that gets refused costs a day; a purchase that leaves half
    // the market queuing costs the reputation the company is built on.
    const check = validateOffer({ ...base, amount: 1_000_000, you: yours({ capacity: 100_000 }) });
    expect(check.warning).toMatch(/turned away/);
  });

  it("refuses everything once the season is finished", () => {
    for (const status of ["finished", "abandoned"]) {
      const check = validateOffer({ ...base, status });
      expect(check.ok).toBe(false);
      expect(check.error).toMatch(/season is over/i);
    }
  });

  it("stays live for a season status it hasn't heard of", () => {
    expect(validateOffer({ ...base, status: "running" }).ok).toBe(true);
    expect(validateOffer({ ...base, status: undefined }).ok).toBe(true);
  });
});

describe("whether you could serve what you'd be buying", () => {
  it("adds the crowd to the one you already have, and measures it against capacity", () => {
    const gap = serviceGap({ you: yours({ capacity: 100_000, customers: 60_000 }), target: target() });
    expect(gap.held).toBe(180_000);
    expect(gap.capacity).toBe(100_000);
    expect(gap.short).toBe(80_000);
    expect(gap.over).toBe(true);
  });

  it("says so plainly when there is room for everyone", () => {
    const gap = serviceGap({ you: yours(), target: target() });
    expect(gap.over).toBe(false);
    expect(gap.line).toMatch(/Everybody who arrives gets served/);
  });

  it("reads a company exactly at capacity as not yet over it", () => {
    const gap = serviceGap({ you: yours({ capacity: 180_000, customers: 60_000 }), target: target() });
    expect(gap.short).toBe(0);
    expect(gap.over).toBe(false);
  });

  it("stays silent rather than reassuring when the server sent no capacity", () => {
    // A guess here would be a screen inventing comfort about the one number
    // that decides whether a purchase ruins the year.
    expect(serviceGap({ you: null, target: target() }).line).toBeNull();
    expect(serviceGap({ you: null, target: target() }).over).toBe(false);
  });
});

describe("what comes with the business", () => {
  it("names the customers and the debt, not just the price", () => {
    const lines = purchaseRead(target(), 4_300_000);
    expect(lines[0]).toMatch(/120,000 customers/);
    expect(lines.join(" ")).toMatch(/1,000,000 of their debt/);
    expect(lines.join(" ")).toMatch(/500,000/);
  });

  it("says nothing about debt a company doesn't have", () => {
    const lines = purchaseRead(target({ debt: 0, assets: 0 }), 1);
    expect(lines).toHaveLength(1);
  });
});

describe("the order to read targets in", () => {
  it("puts trouble first and whoever has already sold last", () => {
    const rows = sortTargets([
      target({ id: "healthy", distress: "healthy", customers: 10 }),
      target({ id: "sold", hollow: true, distress: "insolvent" }),
      target({ id: "insolvent", distress: "insolvent", customers: 10 }),
      target({ id: "strained", distress: "strained", customers: 10 }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["insolvent", "strained", "healthy", "sold"]);
  });

  it("breaks a tie on size, and leaves the caller's array alone", () => {
    const input = [target({ id: "small", customers: 10 }), target({ id: "big", customers: 900 })];
    expect(sortTargets(input).map((r) => r.id)).toEqual(["big", "small"]);
    expect(input[0].id).toBe("small");
  });

  it("copes with a target the server sent no distress for", () => {
    expect(sortTargets([target({ id: "x", distress: null })]).map((r) => r.id)).toEqual(["x"]);
  });
});
