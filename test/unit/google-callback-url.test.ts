/**
 * Where Google sends people back to.
 *
 * This is the kind of bug that produces no error anywhere: the callback lands
 * on a host that isn't the one the person is looking at, the session cookie is
 * set there (host-only, as session cookies should be), and they arrive back at
 * the site signed out. The server logs a successful sign-in. So the rule is
 * pinned here instead — the callback follows the address the site answers as.
 */
import { describe, it, expect } from "vitest";
import { googleCallbackUrl } from "../../server/replit_integrations/auth/replitAuth";

const env = (over: Record<string, string | undefined>) => over as NodeJS.ProcessEnv;

describe("the Google callback URL", () => {
  it("follows the custom domain once there is one", () => {
    expect(googleCallbackUrl(env({ PUBLIC_URL: "https://sparktower.app" })))
      .toBe("https://sparktower.app/api/auth/google/callback");
    // A trailing slash, or no scheme at all, is the same address.
    expect(googleCallbackUrl(env({ PUBLIC_URL: "https://sparktower.app/" })))
      .toBe("https://sparktower.app/api/auth/google/callback");
    expect(googleCallbackUrl(env({ PUBLIC_URL: "sparktower.app" })))
      .toBe("https://sparktower.app/api/auth/google/callback");
  });

  it("prefers the site's own address over the platform's hostname", () => {
    // The bug: both set, and the callback used to go to the deployment host.
    const both = env({ PUBLIC_URL: "https://sparktower.app", REPLIT_DOMAINS: "spark-abc.replit.app,other.replit.app" });
    expect(googleCallbackUrl(both)).toBe("https://sparktower.app/api/auth/google/callback");
    // With no custom domain, the platform's first hostname is still right.
    expect(googleCallbackUrl(env({ REPLIT_DOMAINS: "spark-abc.replit.app,other.replit.app" })))
      .toBe("https://spark-abc.replit.app/api/auth/google/callback");
  });

  it("still lets a LAN address win, for testing on a real phone", () => {
    const lan = env({ AUTH_HOST: "10.0.0.56:5001", PUBLIC_URL: "https://sparktower.app" });
    expect(googleCallbackUrl(lan)).toBe("http://10.0.0.56:5001/api/auth/google/callback");
  });

  it("is http on this machine and https on a real domain", () => {
    expect(googleCallbackUrl(env({}))).toBe("http://localhost:5001/api/auth/google/callback");
    expect(googleCallbackUrl(env({ PORT: "5050" }))).toBe("http://localhost:5050/api/auth/google/callback");
    expect(googleCallbackUrl(env({ AUTH_HOST: "192.168.1.20:5001" }))).toMatch(/^http:\/\//);
    expect(googleCallbackUrl(env({ PUBLIC_URL: "https://staging.sparktower.app" }))).toMatch(/^https:\/\//);
  });

  it("ignores a PUBLIC_URL that isn't a URL, rather than building a broken callback", () => {
    expect(googleCallbackUrl(env({ PUBLIC_URL: "   ", REPLIT_DOMAINS: "spark-abc.replit.app" })))
      .toBe("https://spark-abc.replit.app/api/auth/google/callback");
  });
});
