/**
 * A valuation that failed once is not a valuation that failed for good.
 *
 * The finished-game screen said "the valuation couldn't be reached this time",
 * and the placeholder it wrote was final — `valueGame` stopped at any stored
 * verdict — so "this time" was every time. These pin the rule that replaced it:
 * the outage placeholder is retried, paced, for a day; a real verdict and the
 * verdict for a game nobody played are never touched.
 */
import { describe, it, expect } from "vitest";
import { shouldRetry, fallbackVerdict, RETRY_FOR_MS, RETRY_MAX_ATTEMPTS, retryDelayMs } from "../../server/startup-game-verdict";

const now = Date.parse("2026-09-19T12:00:00Z");
const placeholder = (ageMs: number) => ({
  fromModel: false,
  summary: fallbackVerdict().summary,
  createdAt: new Date(now - ageMs),
});

describe("retrying a valuation", () => {
  it("asks again about an outage placeholder", () => {
    expect(shouldRetry(placeholder(5 * 60_000), now)).toBe(true);
  });

  it("recognises placeholders written before the wording changed", () => {
    // Games already sitting on the old sentence deserve their score too.
    expect(shouldRetry({ ...placeholder(60_000), summary: "The valuation couldn't be reached this time, so this game isn't scored. Everything you decided is still here." }, now)).toBe(true);
  });

  it("never touches a real verdict", () => {
    expect(shouldRetry({ ...placeholder(60_000), fromModel: true }, now)).toBe(false);
  });

  it("leaves a game nobody played unscored", () => {
    expect(shouldRetry({ ...placeholder(60_000), summary: "Neither of you got far enough to build anything, so there's nothing to value." }, now)).toBe(false);
  });

  it("gives up after a day", () => {
    expect(shouldRetry(placeholder(RETRY_FOR_MS + 1), now)).toBe(false);
    expect(shouldRetry(undefined, now)).toBe(false);
  });
});

/**
 * The retry budget, which used to be only a window.
 *
 * Once a minute for a day is 1,440 model calls for one game. Almost none of
 * that is an outage: a question answered badly fourteen times is usually a
 * question this game cannot answer, and it costs us either way. So the bound
 * is a number of attempts, and the wait between them lengthens.
 */
describe("how often a failing game is asked about", () => {
  const FALLBACK = "The valuation couldn't be reached this time, so this game isn't scored. Everything you decided is still here.";
  // `now` is fixed first so an age is exactly the age, not the age minus however
  // long the line above took.
  const now = Date.now();
  const placeholder = (ageMs: number, attempts: number) => ({
    fromModel: false, summary: FALLBACK, createdAt: new Date(now - ageMs), attempts,
  });

  it("gives up after a fixed number of attempts, whatever the window says", () => {
    // Well inside the day, and still done asking.
    expect(shouldRetry(placeholder(2 * 60 * 60_000, RETRY_MAX_ATTEMPTS - 1), now)).toBe(true);
    expect(shouldRetry(placeholder(2 * 60 * 60_000, RETRY_MAX_ATTEMPTS), now)).toBe(false);
    expect(shouldRetry(placeholder(2 * 60 * 60_000, RETRY_MAX_ATTEMPTS + 5), now)).toBe(false);
  });

  it("waits longer after each failure", () => {
    const waits = Array.from({ length: 5 }, (_, i) => retryDelayMs(i));
    expect(waits).toEqual([...waits].sort((a, b) => a - b));
    expect(new Set(waits).size, "each one is longer than the last").toBe(waits.length);
    // And it stops growing, so a late attempt is not scheduled past the window.
    expect(retryDelayMs(50)).toBe(retryDelayMs(40));
    expect(retryDelayMs(50)).toBeLessThanOrEqual(RETRY_FOR_MS);
  });

  it("does not ask again before this attempt's own wait is up", () => {
    // Two failures means a four-minute wait; at three minutes it is too soon.
    expect(shouldRetry(placeholder(3 * 60_000, 2), now)).toBe(false);
    expect(shouldRetry(placeholder(5 * 60_000, 2), now)).toBe(true);
  });

  it("still never asks about a game nobody played", () => {
    expect(shouldRetry({ ...placeholder(60_000, 0), summary: "Nothing was decided." }, now)).toBe(false);
  });

  it("costs at most a handful of calls, where it used to cost a day of them", () => {
    /*
     * The number this exists to hold down. A minute apart for a day is 1,440;
     * the budget is what makes that arithmetic impossible rather than merely
     * unlikely.
     */
    expect(RETRY_MAX_ATTEMPTS).toBeLessThanOrEqual(12);
    const worst = Math.min(RETRY_MAX_ATTEMPTS, RETRY_FOR_MS / retryDelayMs(0));
    expect(worst).toBeLessThanOrEqual(12);
  });
});
