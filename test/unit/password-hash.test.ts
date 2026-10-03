/**
 * The passwords people already have must keep working.
 *
 * `server/password-hash.ts` swapped `bcryptjs` for the native `bcrypt` to get
 * hashing off the request thread (the numbers are in its header). That is only
 * safe because both libraries read and write the same format — and "both
 * libraries agree" is exactly the kind of claim that is true on the day it is
 * checked and silently false after a major version bump.
 *
 * So the fixtures below are frozen strings rather than hashes generated at
 * runtime. A hash produced here by the current library and immediately read
 * back would pass even if the format changed, because both halves changed
 * together; a stored hash from the old one is the only thing that actually
 * tests the promise. These are what `bcryptjs` wrote at cost 12, which is what
 * sits in the `password_hash` column for every account that existed before the
 * swap. If this file fails, those people cannot sign in.
 */
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, PASSWORD_COST } from "../../server/password-hash";

/** Written by bcryptjs at cost 12, for the password below. */
const LEGACY_2B = "$2b$12$Rq4/Lj1R33TNmUSUxmF4Xe9znubub.btFCmqIKg3ZGOYnEHuIlld2";
/*
 * And the older prefix, because the column has both.
 *
 * `bcryptjs` emitted `$2a$` for years before it moved to `$2b$`, so the oldest
 * rows in this database carry that prefix. They differ in how the two handle a
 * byte nobody's password contains, and a library may support one and not the
 * other — which would lock out precisely the longest-standing accounts, the
 * ones least likely to be forgiving about it.
 */
const LEGACY_2A = "$2a$12$5mQsigAYBQK1F59m0BX63OKdNHt/Qn6p5ibjvph7D.qK5uDqu894.";
const PASSWORD = "a-good-passphrase-here";

describe("passwords stored before the native hasher", () => {
  it("still lets somebody in with a $2b$ hash bcryptjs wrote", async () => {
    expect(await verifyPassword(PASSWORD, LEGACY_2B)).toBe(true);
  });

  it("still lets somebody in with an older $2a$ hash", async () => {
    expect(await verifyPassword(PASSWORD, LEGACY_2A)).toBe(true);
  });

  it("still refuses the wrong password against a stored hash", async () => {
    expect(await verifyPassword("not-the-password", LEGACY_2B)).toBe(false);
    expect(await verifyPassword("not-the-password", LEGACY_2A)).toBe(false);
  });
});

describe("hashing a new password", () => {
  it("round-trips, and only for the right password", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword(`${PASSWORD}x`, hash)).toBe(false);
  });

  it("does not cost less than it used to", () => {
    /*
     * The one number here that is a security property rather than a
     * performance one. The native module made hashing cheaper to *serve* by
     * moving it off the request thread; it must not have made it cheaper to
     * *attack*. Asserted as a floor, so raising it later is not a failure.
     */
    expect(PASSWORD_COST).toBeGreaterThanOrEqual(12);
  });

  it("writes a hash that says what it cost", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).toMatch(new RegExp(`^\\$2[aby]\\$${PASSWORD_COST}\\$`));
  });

  it("gives two people with the same password different hashes", async () => {
    // Which is the salt doing its job: equal hashes would mean a stolen table
    // tells you who shares a password.
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });
});

describe("a row with no usable password", () => {
  /*
   * An account created through an identity provider has no hash. A password
   * attempt against it has to answer "no" rather than throw: a 500 on these
   * rows and a 401 on the others tells an attacker which addresses have
   * passwords, which is a list worth having.
   */
  it("answers no, rather than crashing", async () => {
    expect(await verifyPassword(PASSWORD, null)).toBe(false);
    expect(await verifyPassword(PASSWORD, undefined)).toBe(false);
    expect(await verifyPassword(PASSWORD, "")).toBe(false);
    expect(await verifyPassword(PASSWORD, "not-a-hash")).toBe(false);
    expect(await verifyPassword("", LEGACY_2B)).toBe(false);
  });
});
