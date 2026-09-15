/**
 * Mobile access tokens are never signed with the web session secret itself:
 * a dedicated MOBILE_TOKEN_SECRET when set, otherwise a key derived from
 * SESSION_SECRET. A token signed with the raw session secret doesn't verify.
 */
import { describe, it, expect, afterEach } from "vitest";
import crypto from "crypto";
import { tokenSecret, verifyAccessToken, ACCESS_TOKEN_KEY_LABEL } from "../../server/mobile-auth";

const saved = { mobile: process.env.MOBILE_TOKEN_SECRET, session: process.env.SESSION_SECRET };
afterEach(() => {
  if (saved.mobile === undefined) delete process.env.MOBILE_TOKEN_SECRET; else process.env.MOBILE_TOKEN_SECRET = saved.mobile;
  process.env.SESSION_SECRET = saved.session;
});

function tokenSignedWith(key: string) {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "user-1", iat: now, iat_ms: Date.now(), exp: now + 600 })}`;
  return `${body}.${crypto.createHmac("sha256", key).update(body).digest("base64url")}`;
}

describe("the mobile access token key", () => {
  it("is derived from SESSION_SECRET, never equal to it, when there's no dedicated secret", () => {
    delete process.env.MOBILE_TOKEN_SECRET;
    process.env.SESSION_SECRET = "session-secret-for-this-test";
    const key = tokenSecret();
    expect(key).not.toBe("session-secret-for-this-test");
    expect(key).toBe(crypto.createHmac("sha256", "session-secret-for-this-test").update(ACCESS_TOKEN_KEY_LABEL).digest("base64url"));
    expect(verifyAccessToken(tokenSignedWith(key))?.userId).toBe("user-1");
    // Signed with the raw session secret (what a session-cookie key would be): refused.
    expect(verifyAccessToken(tokenSignedWith("session-secret-for-this-test"))).toBeNull();
  });

  it("uses MOBILE_TOKEN_SECRET as given when it's set", () => {
    process.env.MOBILE_TOKEN_SECRET = "dedicated-mobile-secret";
    process.env.SESSION_SECRET = "session-secret-for-this-test";
    expect(tokenSecret()).toBe("dedicated-mobile-secret");
    expect(verifyAccessToken(tokenSignedWith("dedicated-mobile-secret"))?.userId).toBe("user-1");
    expect(verifyAccessToken(tokenSignedWith("session-secret-for-this-test"))).toBeNull();
  });
});
