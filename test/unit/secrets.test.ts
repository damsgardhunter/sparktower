/**
 * No secret has a default. Missing throws in every environment; in production
 * a short or publicly known value throws too. What reads them — session
 * cookies, sealed values, mobile tokens, 2FA challenges — fails rather than
 * signing with something anyone could reproduce.
 */
import { describe, it, expect, afterEach } from "vitest";
import { assertSecretsAtBoot, mobileTokenKey, sessionSecret, MIN_PRODUCTION_SECRET_LENGTH } from "../../server/secrets";
import { signMfaChallenge } from "../../server/mfa";
import { getSession } from "../../server/replit_integrations/auth/replitAuth";

const saved = { ...process.env };
afterEach(() => {
  for (const k of ["SESSION_SECRET", "MOBILE_TOKEN_SECRET", "NODE_ENV"] as const) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});
const strong = "x".repeat(MIN_PRODUCTION_SECRET_LENGTH);

describe("server secrets", () => {
  it("throws when SESSION_SECRET is missing or blank, in development and test as much as production", () => {
    for (const env of ["development", "test", "production", undefined]) {
      if (env) process.env.NODE_ENV = env; else delete process.env.NODE_ENV;
      delete process.env.MOBILE_TOKEN_SECRET;
      delete process.env.SESSION_SECRET;
      expect(() => sessionSecret(), env).toThrow(/SESSION_SECRET must be set/);
      process.env.SESSION_SECRET = "   ";
      expect(() => assertSecretsAtBoot(), env).toThrow(/SESSION_SECRET must be set/);
    }
  });

  it("nothing that signs or encrypts falls back to a default key when it's missing", () => {
    delete process.env.SESSION_SECRET;
    delete process.env.MOBILE_TOKEN_SECRET;
    expect(() => mobileTokenKey()).toThrow(/SESSION_SECRET must be set/);
    expect(() => signMfaChallenge("user-1")).toThrow(/SESSION_SECRET must be set/);
    expect(() => getSession()).toThrow(/SESSION_SECRET must be set/);
  });

  it("refuses short and publicly known values in production only", () => {
    process.env.NODE_ENV = "production";
    for (const weak of ["dev-session-secret", "changeme", "short-but-random-9f3a"]) {
      process.env.SESSION_SECRET = weak;
      expect(() => assertSecretsAtBoot(), weak).toThrow(/refusing to start in production/);
    }
    process.env.SESSION_SECRET = strong;
    process.env.MOBILE_TOKEN_SECRET = "too-short";
    expect(() => assertSecretsAtBoot()).toThrow(/MOBILE_TOKEN_SECRET is shorter/);
    delete process.env.MOBILE_TOKEN_SECRET;
    expect(() => assertSecretsAtBoot()).not.toThrow();

    process.env.NODE_ENV = "development";
    process.env.SESSION_SECRET = "short-local-secret";
    expect(sessionSecret()).toBe("short-local-secret");
  });
});
