/**
 * The phone's copy of the game's rules, checked against the original.
 *
 * Metro can't resolve the web app's `@shared` alias, so anything the mobile
 * screens compute between keystrokes lives in
 * `mobile/src/components/game/model.ts` rather than being imported from
 * `shared/sprints/*`. That is a duplicate, and duplicates rot silently — a
 * phone quietly playing a slightly different game from the one the server is
 * scoring is the kind of bug nobody reports because each screen looks fine on
 * its own.
 *
 * So this file is the thing that makes the duplicate safe. It fails the moment
 * the two drift.
 *
 * Note what is deliberately *not* duplicated and so not checked here: the card
 * decks and the fourteen ways to spend a million. Those come down the wire
 * from `/api/games/rules` and the deck endpoint, because they are the parts
 * most likely to change and a stale copy of them would be the worst version of
 * this problem.
 */
import { describe, it, expect } from "vitest";
import * as mobile from "../../mobile/src/components/game/model";
import { ROUNDS, PLAYABLE_ROUNDS, ROUND_COPY, SETTLE_REASONS } from "@shared/sprints/game";
import { BUDGET_TOTAL, money, summariseBudget } from "@shared/sprints/budget";
import { MAX_CLAIMS, MAX_CORE_CLAIMS } from "@shared/sprints/product";
import { MAX_CUSTOM_CARDS, SPEND_OPTIONS } from "@shared/sprints/cards";
import { SCORE_MAX, scoreBand } from "@shared/sprints/scoring";
import { ordinal } from "../../client/src/components/game/verdict";
import { SETTLE_COPY as webCopy } from "../../client/src/components/game/kit";

describe("the phone plays the same game as the server", () => {
  it("has the same rounds, in the same order", () => {
    expect(mobile.ROUNDS).toEqual(ROUNDS);
    expect(mobile.PLAYABLE_ROUNDS).toEqual(PLAYABLE_ROUNDS);
  });

  it("calls each round the same thing", () => {
    for (const [round, copy] of Object.entries(ROUND_COPY)) {
      expect(mobile.ROUND_COPY[round], `${round} title`).toEqual(copy);
    }
  });

  it("agrees on the caps a player runs into", () => {
    expect(mobile.BUDGET_TOTAL).toBe(BUDGET_TOTAL);
    expect(mobile.MAX_CLAIMS).toBe(MAX_CLAIMS);
    expect(mobile.MAX_CORE_CLAIMS).toBe(MAX_CORE_CLAIMS);
    expect(mobile.MAX_CUSTOM_CARDS).toBe(MAX_CUSTOM_CARDS);
    expect(mobile.SCORE_MAX).toBe(SCORE_MAX);
  });

  /*
   * A phone showing "$2.4B" where the web shows "$2,400,000,000" on the same
   * leaderboard is the kind of difference people screenshot.
   */
  it("writes money identically", () => {
    for (const n of [0, 999, 1_000, 150_000, 1_000_000, 2_400_000_000, 12_000_000_000, 9e11]) {
      expect(mobile.money(n), `${n}`).toBe(money(n));
    }
  });

  it("names a score identically", () => {
    for (let n = 0; n <= 1000; n += 25) expect(mobile.scoreBand(n), `${n}`).toBe(scoreBand(n));
  });

  it("writes a placing identically", () => {
    for (const n of [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111]) {
      expect(mobile.ordinal(n), `${n}`).toBe(ordinal(n));
    }
  });

  /*
   * The phone sums a budget locally so the bar moves without a round trip.
   * It only has to agree with the server about the totals — the server does
   * the authoritative cleaning, and the bar is redrawn from what it returns.
   */
  it("adds a budget up the same way", () => {
    const allocation = { marketing: 200_000, "first-engineer": 150_000, runway: 50_000 };
    const theirs = summariseBudget(allocation);
    const ours = mobile.summariseBudget(allocation, SPEND_OPTIONS as any);

    expect(ours.total).toBe(theirs.total);
    for (const group of ours.byGroup) {
      const match = theirs.byGroup.find((g) => g.group === group.group);
      expect(group.amount, group.group).toBe(match?.amount ?? 0);
    }
  });

  it("counts what is left the same way", () => {
    const allocation = { marketing: 300_000 };
    expect(mobile.unallocated(allocation)).toBe(BUDGET_TOTAL - 300_000);
    expect(mobile.allocated(allocation)).toBe(300_000);
  });

  /*
   * These are read off the server's `settledBy`. A reason with no copy renders
   * as nothing at all, so a player is shown an explanation on one platform and
   * silence on the other — and the version that says nothing is the one where
   * a pick appeared to vanish.
   *
   * Checked against the server's own list rather than a hardcoded one here,
   * because a hardcoded list is exactly what went stale when `merged` was
   * added.
   */
  it("has copy for every way a round can end, on both clients", () => {
    for (const reason of SETTLE_REASONS) {
      expect(mobile.SETTLE_COPY[reason], `mobile has no copy for "${reason}"`).toBeTruthy();
      expect(webCopy[reason], `web has no copy for "${reason}"`).toBeTruthy();
    }
  });

  it("uses the same words on both", () => {
    for (const reason of SETTLE_REASONS) {
      expect(mobile.SETTLE_COPY[reason], reason).toBe(webCopy[reason]);
    }
  });
});
