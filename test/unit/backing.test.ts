/**
 * The money helpers, and the things derived from an amount.
 *
 * These are the only pure functions in the codebase that decide what someone is
 * owed. A wrong answer here doesn't throw — it just pays the wrong person the
 * wrong number, and the first report of it comes from a creator reconciling a
 * payout weeks later, by which point every pledge in between is also wrong.
 */
import { describe, it, expect } from "vitest";
import {
  platformFeeCents, creatorPayoutCents, PLATFORM_FEE_PERCENT,
  MIN_PLEDGE_CENTS, MAX_PLEDGE_CENTS,
  badgeLevelForAmount, badgeLevel, BADGE_LEVELS,
  formatBelieverNumber, tierForAmount, tierNeedsShipping, datestampLabel,
} from "@shared/backing";

describe("splitting a pledge", () => {
  it("takes the stated percentage", () => {
    expect(platformFeeCents(1000)).toBe(100);
    expect(creatorPayoutCents(1000)).toBe(900);
    expect(PLATFORM_FEE_PERCENT).toBe(10);
  });

  it("never creates or destroys a cent, at any amount", () => {
    /*
     * The invariant that matters, and the reason creatorPayoutCents subtracts
     * rather than computing its own percentage. Written as `amount * 0.9` it
     * would look identical and be right for round numbers: at 105 cents the
     * fee rounds to 11 and the payout to 95, which is 106 out of 105 — a cent
     * invented on every odd pledge, reconciling to nothing.
     */
    for (let amount = MIN_PLEDGE_CENTS; amount <= 5000; amount += 1) {
      expect(platformFeeCents(amount) + creatorPayoutCents(amount)).toBe(amount);
    }
    for (const amount of [7, 105, 999, 100_001, MAX_PLEDGE_CENTS]) {
      expect(platformFeeCents(amount) + creatorPayoutCents(amount)).toBe(amount);
    }
  });

  it("never pays out more than came in, or less than nothing", () => {
    for (const amount of [MIN_PLEDGE_CENTS, 250, 999, 10_000, MAX_PLEDGE_CENTS]) {
      const fee = platformFeeCents(amount);
      const payout = creatorPayoutCents(amount);
      expect(fee).toBeGreaterThanOrEqual(0);
      expect(payout).toBeGreaterThanOrEqual(0);
      expect(payout).toBeLessThanOrEqual(amount);
    }
  });

  it("returns whole cents, never a fraction", () => {
    for (const amount of [101, 105, 333, 1_667]) {
      expect(Number.isInteger(platformFeeCents(amount))).toBe(true);
      expect(Number.isInteger(creatorPayoutCents(amount))).toBe(true);
    }
  });
});

describe("badge level for an amount", () => {
  it("gives the highest level the amount clears", () => {
    expect(badgeLevelForAmount(500).key).toBe("bronze");
    expect(badgeLevelForAmount(1500).key).toBe("silver");
    expect(badgeLevelForAmount(3500).key).toBe("gold");
    expect(badgeLevelForAmount(7500).key).toBe("platinum");
  });

  it("treats each threshold as inclusive, and one cent below it as not", () => {
    expect(badgeLevelForAmount(1499).key).toBe("bronze");
    expect(badgeLevelForAmount(1500).key).toBe("silver");
    expect(badgeLevelForAmount(7499).key).toBe("gold");
  });

  it("keeps paying platinum however far above the top the amount goes", () => {
    expect(badgeLevelForAmount(1_000_000).key).toBe("platinum");
  });

  it("hands out bronze below the bronze threshold — deliberate, and worth knowing", () => {
    /*
     * A pledge between the $1 minimum and the $5 bronze threshold still gets a
     * bronze badge, because the function falls back to the first level rather
     * than returning null. That is the current behaviour and everything
     * downstream assumes a badge always exists, so this pins it rather than
     * calls it right: if badgeless small pledges are ever wanted, this test is
     * the one to change first, and the callers will need a null branch.
     */
    expect(badgeLevelForAmount(MIN_PLEDGE_CENTS).key).toBe("bronze");
    expect(badgeLevelForAmount(0).key).toBe("bronze");
  });

  it("keeps the levels ordered and their keys resolvable", () => {
    // The lookup walks the list in reverse, so an out-of-order entry would
    // silently award the wrong metal.
    for (let i = 1; i < BADGE_LEVELS.length; i++) {
      expect(BADGE_LEVELS[i].minCents).toBeGreaterThan(BADGE_LEVELS[i - 1].minCents);
    }
    for (const level of BADGE_LEVELS) {
      expect(badgeLevel(level.key)).toEqual(level);
    }
    expect(badgeLevel("titanium")).toBeUndefined();
  });
});

describe("which tier a pledge buys", () => {
  const tiers = [
    { amountCents: 500, name: "Sticker" },
    { amountCents: 3500, name: "Shirt" },
    { amountCents: 10_000, name: "Founder" },
  ];

  it("picks the most expensive rung the amount clears", () => {
    expect(tierForAmount(tiers, 3500)?.name).toBe("Shirt");
    // Someone typing a custom $40 still gets the $35 shirt, which is what
    // they expect and what they would otherwise write in about.
    expect(tierForAmount(tiers, 4000)?.name).toBe("Shirt");
    expect(tierForAmount(tiers, 99_999)?.name).toBe("Founder");
  });

  it("returns null when the amount clears nothing", () => {
    expect(tierForAmount(tiers, 100)).toBeNull();
    expect(tierForAmount([], 10_000)).toBeNull();
  });

  it("does not depend on the order the tiers arrive in", () => {
    const shuffled = [tiers[2], tiers[0], tiers[1]];
    expect(tierForAmount(shuffled, 4000)?.name).toBe("Shirt");
  });

  it("knows which tiers have to physically ship", () => {
    expect(tierNeedsShipping({ merchProducts: ["tee"] })).toBe(true);
    expect(tierNeedsShipping({ merchProducts: [] })).toBe(false);
    // Null is the common case for a digital-only tier and must not throw.
    expect(tierNeedsShipping({ merchProducts: null })).toBe(false);
  });
});

describe("labels printed on things people keep", () => {
  it("pads a believer number to four digits", () => {
    expect(formatBelieverNumber(1)).toBe("#0001");
    expect(formatBelieverNumber(47)).toBe("#0047");
    expect(formatBelieverNumber(9999)).toBe("#9999");
    // Beyond four digits it grows rather than truncating — losing a digit
    // would print two different backers the same number.
    expect(formatBelieverNumber(12345)).toBe("#12345");
  });

  it("datestamps in UTC so the same campaign prints the same month everywhere", () => {
    /*
     * This ends up printed on a garment. An instant just before midnight UTC
     * on the 1st is the previous month in Los Angeles, and the shirt is
     * permanent.
     */
    expect(datestampLabel("2026-03-01T00:30:00Z")).toBe("since March 2026");
    expect(datestampLabel(new Date("2026-12-31T23:59:59Z"))).toBe("since December 2026");
  });

  it("returns null for anything it can't date, rather than 'since Invalid Date'", () => {
    expect(datestampLabel(null)).toBeNull();
    expect(datestampLabel(undefined)).toBeNull();
    expect(datestampLabel("")).toBeNull();
    expect(datestampLabel("not a date")).toBeNull();
  });
});
