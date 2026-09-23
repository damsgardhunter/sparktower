/**
 * The words the reset flow says, and the one case where it must not say the
 * reassuring thing.
 *
 * The endpoint answers identically for an address with an account and without
 * one, on purpose — so the screen has almost nothing to branch on. The
 * exception is a rate limit: no mail went out, and showing "check your inbox"
 * over a 429 sends someone to wait for a message that will never arrive.
 */
import { describe, it, expect } from "vitest";
import { RESET_TTL_MINUTES, resetRefusal, resetWindowPhrase, waitPhrase } from "./passwordReset";

describe("resetWindowPhrase", () => {
  it("says hours as hours", () => {
    expect(resetWindowPhrase(60)).toBe("an hour");
    expect(resetWindowPhrase(120)).toBe("2 hours");
    expect(resetWindowPhrase(15)).toBe("15 minutes");
  });

  it("defaults to the server's window, so the copy can't outlive the constant", () => {
    expect(resetWindowPhrase()).toBe(resetWindowPhrase(RESET_TTL_MINUTES));
  });
});

describe("waitPhrase", () => {
  it("rounds to something a person would say, and never to zero", () => {
    // Rounding to the nearest five collapses to zero under three seconds, and
    // the `|| 1` catches it — the same arithmetic the web runs, kept identical
    // on purpose so the two screens never quote different waits.
    expect(waitPhrase(1)).toBe("about 1 seconds");
    expect(waitPhrase(0)).toBe("about 1 seconds");
    expect(waitPhrase(4)).toBe("about 5 seconds");
    expect(waitPhrase(32)).toBe("about 30 seconds");
    expect(waitPhrase(60)).toBe("about a minute");
    expect(waitPhrase(14 * 60)).toBe("about 14 minutes");
  });
});

describe("resetRefusal", () => {
  it("turns a rate limit into a wait, with the server's own number", () => {
    const r = resetRefusal({ body: { code: "rate_limited", retryAfterSeconds: 840, message: "Too many requests." } });
    expect(r.cooldown).toBe(840);
    expect(r.message).toContain("about 14 minutes");
  });

  it("handles a rate limit with no number attached", () => {
    const r = resetRefusal({ body: { code: "rate_limited" } });
    expect(r.cooldown).toBe(0);
    expect(r.message).toMatch(/give it a minute/i);
  });

  it("prefers the server's message for anything else, and never asks for a wait", () => {
    const r = resetRefusal({ body: { message: "That address isn't an address." } });
    expect(r).toEqual({ cooldown: 0, message: "That address isn't an address." });
  });

  it("falls back to its own words when there's nothing to quote", () => {
    expect(resetRefusal({}).message).toBe("Couldn't send that link. Try again in a moment.");
  });
});
