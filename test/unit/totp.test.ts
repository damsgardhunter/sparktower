/** The authenticator code algorithm, against RFC 6238's own test vectors, and the rules around it. */
import { describe, it, expect } from "vitest";
import { base32Decode, base32Encode, newTotpSecret, otpauthUrl, timeStep, totpAt, verifyTotp } from "../../server/totp";
import { readMfaChallenge, signMfaChallenge, MFA_CHALLENGE_TTL_MS } from "../../server/mfa";

const RFC_SECRET = Buffer.from("12345678901234567890"); // RFC 6238 Appendix B, SHA-1

describe("TOTP", () => {
  it("matches RFC 6238's SHA-1 test vectors", () => {
    for (const [seconds, code] of [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]] as const) {
      expect(totpAt(RFC_SECRET, Math.floor(seconds / 30), 8), String(seconds)).toBe(code);
    }
  });

  it("round-trips base32 and makes 160-bit secrets", () => {
    const s = newTotpSecret();
    expect(base32Decode(s)).toHaveLength(20);
    expect(base32Encode(base32Decode(s))).toBe(s);
    expect(otpauthUrl(s, "a@b.test")).toMatch(/^otpauth:\/\/totp\/SparkTower%3Aa%40b\.test\?secret=[A-Z2-7]{32}&issuer=SparkTower/);
  });

  it("accepts a code from now or one step either side, never the same step twice, never junk", () => {
    const secret = newTotpSecret();
    const at = Date.now();
    const now = timeStep(at);
    expect(verifyTotp(secret, totpAt(secret, now), { at })).toBe(now);
    expect(verifyTotp(secret, totpAt(secret, now - 1), { at })).toBe(now - 1);
    expect(verifyTotp(secret, totpAt(secret, now + 2), { at })).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, now), { at, lastUsedStep: now })).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, now - 1), { at, lastUsedStep: now })).toBeNull();
    for (const bad of ["", "12345", "1234567", "abcdef"]) expect(verifyTotp(secret, bad, { at })).toBeNull();
  });

  it("signs mobile challenges that expire and can't be forged", () => {
    const t = signMfaChallenge("user-1", 1_000);
    expect(readMfaChallenge(t, 1_000 + MFA_CHALLENGE_TTL_MS - 1)).toBe("user-1");
    expect(readMfaChallenge(t, 1_000 + MFA_CHALLENGE_TTL_MS + 1)).toBeNull();
    const [payload] = t.split(".");
    const forged = `${Buffer.from(JSON.stringify({ sub: "admin", exp: Date.now() + 60_000, p: "mfa" })).toString("base64url")}.${t.split(".")[1]}`;
    expect(readMfaChallenge(forged)).toBeNull();
    expect(readMfaChallenge(`${payload}.x`)).toBeNull();
  });
});
