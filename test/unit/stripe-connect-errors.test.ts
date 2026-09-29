/**
 * Telling somebody why the bank setup wouldn't open.
 *
 * All three Connect routes used to answer a bare 500 whatever the reason, so
 * the one cause that actually happens — Connect never switched on for the
 * platform's Stripe account — reached the person as "Couldn't open the bank
 * setup" with nothing to do about it.
 */
import { describe, it, expect } from "vitest";
import { connectFailure, isConnectNotEnabled } from "../../server/stripe-connect-errors";

/** Shaped like the errors the Stripe SDK throws. */
const stripeError = (message: string, type = "invalid_request_error") => ({ type, message });

describe("isConnectNotEnabled", () => {
  it("recognises a platform that never switched Connect on", () => {
    expect(isConnectNotEnabled(stripeError(
      "Only Stripe Connect platforms can work with other accounts. If you need to set up a platform, you can sign up for Connect.",
    ))).toBe(true);
    expect(isConnectNotEnabled(stripeError(
      "You can only create new accounts if you've signed up for Connect.",
    ))).toBe(true);
  });

  it("does not claim it for unrelated refusals", () => {
    expect(isConnectNotEnabled(stripeError("No such account: 'acct_123'"))).toBe(false);
    expect(isConnectNotEnabled(stripeError("Invalid API Key provided"))).toBe(false);
    expect(isConnectNotEnabled(new Error("socket hang up"))).toBe(false);
    expect(isConnectNotEnabled(null)).toBe(false);
  });
});

describe("connectFailure", () => {
  it("names the setup step, and keeps Stripe's wording as the detail", () => {
    const out = connectFailure(stripeError("Only Stripe Connect platforms can work with other accounts."), "Couldn't open the bank setup");
    expect(out.status).toBe(503);
    expect(out.body.code).toBe("connect_not_enabled");
    expect(out.body.message).toMatch(/Stripe Connect has to be switched on/);
    expect(out.body.detail).toMatch(/Only Stripe Connect platforms/);
  });

  it("passes a Stripe refusal through, because its message is the useful part", () => {
    const out = connectFailure(stripeError("No such account: 'acct_123'"), "Couldn't open the bank setup");
    expect(out.status).toBe(502);
    expect(out.body.message).toBe("Couldn't open the bank setup: No such account: 'acct_123'");
  });

  /*
   * A failure that isn't Stripe's could be anything — a database error, a
   * stack trace — and none of that belongs in a browser.
   */
  it("says nothing specific about a failure that isn't Stripe's", () => {
    const out = connectFailure(new Error('relation "users" does not exist'), "Couldn't open the bank setup");
    expect(out.status).toBe(502);
    expect(out.body.message).not.toMatch(/relation/);
    expect(out.body.message).toMatch(/server log/);
  });
});
