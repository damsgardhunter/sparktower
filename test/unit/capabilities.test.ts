/**
 * The capability inventory is held to the digest: unknown areas dropped,
 * unseen files dropped, unsupported "built" downgraded, every area present.
 */
import { describe, it, expect } from "vitest";
import { sanitizeCapabilities, renderCapabilities, CAPABILITY_AREAS } from "@shared/capabilities";

const known = { files: new Set(["server/moderation.ts", "server/surfaces.ts", "server/routes.ts"]), routes: new Set(["POST /api/projects", "GET /api/surfaces"]) };

describe("sanitizeCapabilities", () => {
  it("keeps grounded claims, drops unseen files and routes, downgrades ungrounded built, fills every area", () => {
    const caps = sanitizeCapabilities([
      { area: "rateLimiting", status: "built", summary: "Durable limiter in moderation.ts", evidence: [{ file: "server/moderation.ts" }, { file: "server/src/lib/rateLimit.ts" }] },
      { area: "deploy", status: "built", summary: "Kill switches", evidence: [{ file: "server/surfaces.ts", route: "GET /api/surfaces" }, { file: "server/routes.ts", route: "GET /api/nope" }] },
      { area: "payments", status: "built", summary: "Stripe", evidence: ["server/stripe.ts"] },
      { area: "mobile", status: "missing", summary: "No app" },
      { area: "bogus", status: "built", summary: "x", evidence: [] },
      { area: "rateLimiting", status: "missing", summary: "duplicate, ignored" },
    ], known);
    expect(caps).toHaveLength(CAPABILITY_AREAS.length);
    const by = Object.fromEntries(caps.map((c) => [c.area, c]));
    expect(by.rateLimiting).toMatchObject({ status: "built", evidence: [{ file: "server/moderation.ts" }] });
    expect(by.rateLimiting.note).toMatch(/server\/src\/lib\/rateLimit\.ts/);
    expect(by.deploy.evidence).toEqual([{ file: "server/surfaces.ts", route: "GET /api/surfaces" }, { file: "server/routes.ts" }]);
    expect(by.payments).toMatchObject({ status: "partial" });
    expect(by.payments.note).toMatch(/Claimed built but cited no file/);
    expect(by.mobile).toMatchObject({ status: "missing", evidence: [] });
    expect(by.auth).toMatchObject({ status: "unreported" });
    expect(caps.some((c) => (c.area as string) === "bogus")).toBe(false);
  });

  it("renders built first and says what a plan must do with it", () => {
    const text = renderCapabilities(sanitizeCapabilities([
      { area: "tests", status: "missing", summary: "" },
      { area: "auth", status: "built", summary: "Passport + sessions", evidence: [{ file: "server/routes.ts", route: "POST /api/projects" }] },
    ], known))!;
    expect(text.indexOf("Auth & sessions: BUILT")).toBeLessThan(text.indexOf("Tests: MISSING"));
    expect(text).toContain("POST /api/projects in server/routes.ts");
    expect(text).toMatch(/proposes something marked BUILT from scratch is wrong/);
    expect(renderCapabilities([])).toBeNull();
  });
});
