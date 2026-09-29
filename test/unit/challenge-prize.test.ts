/**
 * What a prize is allowed to be, and what the safe says about it.
 *
 * The amounts are the interesting part: a floor that makes a challenge worth
 * entering, and a ceiling whose job is not the number but refusing an amount
 * typed with a slipped decimal point before it leaves somebody's balance.
 */
import { describe, it, expect } from "vitest";
import {
  CHALLENGE_FEE_CENTS, MAX_PRIZE_CENTS, MIN_PRIZE_CENTS, PRIZE_STATES,
  formatPrize, prizeAssurance, readPrize, totalToPost,
} from "@shared/challenges-money";
import { OUTCOME_PRICE_CENTS } from "@shared/plans";

describe("the fee", () => {
  it("is $4.99, and is the price list's number rather than a second copy of it", () => {
    expect(CHALLENGE_FEE_CENTS).toBe(499);
    expect(CHALLENGE_FEE_CENTS).toBe(OUTCOME_PRICE_CENTS.challenge);
  });
});

describe("reading a prize", () => {
  it("takes a real amount", () => {
    expect(readPrize(50_000)).toEqual({ ok: true, cents: 50_000 });
    expect(readPrize(MIN_PRIZE_CENTS)).toEqual({ ok: true, cents: MIN_PRIZE_CENTS });
  });

  it("refuses a prize too small to be worth a fortnight of somebody's time", () => {
    const res = readPrize(100);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("free work");
  });

  it("refuses a slipped decimal point before it leaves anybody's balance", () => {
    // $50 meant, $50,000 typed.
    expect(readPrize(MAX_PRIZE_CENTS + 1).ok).toBe(false);
    expect(readPrize(1e12).ok).toBe(false);
  });

  it("refuses what isn't a number at all", () => {
    expect(readPrize("lots").ok).toBe(false);
    expect(readPrize(null).ok).toBe(false);
    expect(readPrize(undefined).ok).toBe(false);
    expect(readPrize(NaN).ok).toBe(false);
    expect(readPrize(-5_000).ok).toBe(false);
  });
});

describe("what it costs to post", () => {
  it("is the fee on top of the prize, and the two are never one number", () => {
    expect(totalToPost(50_000)).toBe(50_000 + CHALLENGE_FEE_CENTS);
  });
});

describe("saying it out loud", () => {
  it("writes whole prizes without trailing zeros and odd ones with them", () => {
    expect(formatPrize(50_000)).toBe("$500");
    expect(formatPrize(125_050)).toBe("$1,250.50");
    expect(formatPrize(499)).toBe("$4.99");
  });

  it("claims the money is real only while it is actually held", () => {
    expect(prizeAssurance("held", 50_000)).toContain("held by SparkTower");
    expect(prizeAssurance("held", 50_000)).toContain("not a promise");
    // Once it has gone, the page must stop claiming it is sitting there.
    for (const state of PRIZE_STATES.filter((s) => s !== "held")) {
      expect(prizeAssurance(state, 50_000)).not.toContain("not a promise");
    }
  });
});
