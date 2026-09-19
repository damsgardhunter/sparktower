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
import { shouldRetry, fallbackVerdict, RETRY_FOR_MS } from "../../server/startup-game-verdict";

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
