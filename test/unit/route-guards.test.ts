/**
 * The guard on every abuse-prone endpoint, checked against the real source
 * on every run. This is the regression test for kill switches and rate
 * limits: a new write under a sensitive family with no limit, a costly
 * route with no metering, or a surface whose prefixes no longer cover its
 * routes fails here, before it fails in production.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { buildRouteCoverage } from "../../server/route-coverage";
import { SURFACES, SURFACE_API_PREFIXES } from "@shared/surfaces";

const root = join(__dirname, "..", "..");
const walk = (d: string, out: string[] = []): string[] => {
  for (const n of readdirSync(d)) {
    if (["node_modules", ".git", "dist", "test-results", ".cache", ".local", "local_objects", "client", "mobile", "test", "e2e"].includes(n)) continue;
    const p = join(d, n);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};
const files = walk(root).filter((p) => /\.(ts|js)$/.test(p)).map((p) => ({ path: p.slice(root.length + 1), size: 0, content: readFileSync(p, "utf8") }));
const cov = buildRouteCoverage(files);
const live = cov.rows.filter((r) => r.mounted);
const label = (r: { method: string; path: string }) => `${r.method} ${r.path}`;

/**
 * Writes that rely on the write floor alone, each with the reason. Adding a
 * new write to a sensitive family means adding a limit — or, with a reason,
 * a line here. Removing a line here when the route gains its own limit.
 */
const FLOOR_ONLY_ALLOWED: Record<string, string> = {
  "POST /api/auth/mobile/logout": "ends a session; nothing to abuse",
  "POST /api/auth/logout-all": "ends every session; signed-in only",
  "PATCH /api/check-ins/:id": "author-only edit of an existing row",
  "DELETE /api/check-ins/:id": "author-only delete",
  "PATCH /api/documents/:docId": "member-only edit of an existing row",
  "POST /api/documents/:docId/publish": "member-only flag flip",
  "DELETE /api/documents/:docId": "member-only delete",
  "DELETE /api/feed/:id": "author-only delete",
  "DELETE /api/feed/comments/:commentId": "author-only delete",
  "DELETE /api/project-comments/:commentId": "author-only delete",
  "PUT /internal-local-upload/:id": "development only; the issued id is the credential",
  "POST /api/projects/:id/nova-guide/complete-onboarding": "flag flip",
  "DELETE /api/projects/:id/waitlist/:entryId": "member-only delete",
  "PATCH /api/projects/:id/interviews/:itemId": "member-only edit",
  "DELETE /api/projects/:id/interviews/:itemId": "member-only delete",
  "PUT /api/projects/:id/nova-notes": "member-only note, one per project",
  "DELETE /api/storyboards/:id": "owner-only delete",
  "DELETE /api/health-findings/feedback/:feedbackId": "author-only delete",
  "POST /api/messages/:userId/read": "marks read; no content",
  "POST /api/sprints": "creates a sprint; project-scoped and rare",
  "PATCH /api/sprints/:id/tasks/:taskId": "member-only edit",
  "POST /api/sprints/:id/convert": "one-off conversion",
  "POST /api/sprints/queue": "joins a queue; one entry per user",
  "DELETE /api/sprints/queue": "leaves the queue",
  "PATCH /api/projects/:id/backing": "owner-only settings edit",
  "POST /api/projects/:id/path/mark": "member-only flag on the project's own milestones",
  "POST /api/projects/:id/path/work/:workId/choose": "member-only pick of an existing answer",
  "POST /api/projects/:id/path/branch": "member-only phase choice",
  "POST /api/projects/:id/path/switch": "owner-only, one per project at a time",
  "DELETE /api/projects/:id/path/loops/:taskId": "member-only delete",
  "DELETE /api/mcp-tokens/:id": "owner-only revoke of one's own token; refusing it is the harm",
};

const SENSITIVE = /^\/api\/(auth|feed|projects\/:id\/comments|project-comments|uploads|objects\/upload|messages|conversations|chat|projects\/:id\/nova|projects\/:id\/tasks\/nova-assist|projects\/:id\/path|reports|check-ins|projects\/:id\/check-ins|documents|projects\/:id\/documents|generate-image|sprints|mock-interviews|storyboards|projects\/:id\/(live-chat|waitlist|interviews|health-findings)|me\/badges|projects\/:id\/backing|mcp|mcp-tokens)/;

describe("rate limits on the abuse-prone surface", () => {
  it("every write under a sensitive family has its own limit or metering, or a written reason for the floor alone", () => {
    const offenders = live
      .filter((r) => r.write && SENSITIVE.test(r.path) && !r.rateLimited && !r.credits)
      .map(label)
      .filter((l) => !(l in FLOOR_ONLY_ALLOWED));
    expect(offenders, `add rateLimit(...) or requireCredits to these, or a reason in FLOOR_ONLY_ALLOWED:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("every costly route is credit-metered or on the AI limit", () => {
    const unmetered = live.filter((r) => r.cost && !r.credits && !r.rateLimited).map(label);
    expect(unmetered, `unmetered costly routes: ${unmetered.join(", ")}`).toEqual([]);
  });

  it("auth attempts, uploads and beacons are limited without a user", () => {
    for (const p of ["POST /api/auth/login", "POST /api/auth/register", "POST /api/auth/mobile/login", "POST /api/auth/mobile/register", "POST /api/auth/mobile/refresh", "POST /api/uploads/request-url", "POST /api/track", "POST /api/loop-events"]) {
      const row = live.find((r) => label(r) === p);
      expect(row, p).toBeTruthy();
      expect(row!.rateLimited, `${p} has no limit`).toBe(true);
    }
  });

  it("the allowlist only names routes that exist and still lack a limit", () => {
    for (const l of Object.keys(FLOOR_ONLY_ALLOWED)) {
      const row = live.find((r) => label(r) === l);
      expect(row, `${l} is in the allowlist but not in the code — remove the line`).toBeTruthy();
      expect(row!.rateLimited || row!.credits, `${l} now has its own limit — remove it from the allowlist`).toBe(false);
    }
  });
});

describe("authentication on the write surface", () => {
  it("every MCP route is behind the token guard mounted on its prefix", () => {
    const mcp = live.filter((r) => r.path.startsWith("/api/mcp/"));
    expect(mcp.length).toBeGreaterThan(10);
    const open = mcp.filter((r) => !r.auth).map(label);
    expect(open, `MCP routes the scan reads as unauthenticated: ${open.join(", ")}`).toEqual([]);
    expect(mcp.every((r) => r.guards.some((g) => g.startsWith("requireMcpToken")))).toBe(true);
  });

  it("reviewer actions and the money routes have limits of their own, not just the floor", () => {
    for (const p of [
      "POST /api/admin/content/:type/:id/hide", "POST /api/admin/content/:type/:id/restore",
      "POST /api/admin/reports/:id/act", "PATCH /api/admin/reports/:id", "POST /api/admin/users/:id/suspend",
      "POST /api/admin/backing/:projectId/decision", "POST /api/admin/backing/:projectId/release",
    ]) {
      const row = live.find((r) => label(r) === p);
      expect(row, p).toBeTruthy();
      expect(row!.rateLimited, `${p} relies on the floor alone`).toBe(true);
    }
  });

  it("the coverage knows the write floor, so floor-limited writes don't read as unlimited", () => {
    expect(cov.writeFloor.mounted).toBe(true);
    expect(cov.writeFloor.exempt).toEqual(["/api/stripe/webhook"]);
    expect(live.find((r) => label(r) === "POST /api/logout")!.floor).toBe(true);
    expect(live.find((r) => label(r) === "POST /api/stripe/webhook")!.floor).toBe(false);
    // Under /api, the only write with no limit at all is the signed webhook.
    expect(cov.unlimitedWrites.filter((l) => l.includes(" /api/"))).toEqual(["POST /api/stripe/webhook"]);
  });

  it("the only inbound webhook is Stripe's (its signature is checked in stripe-webhook.test.ts)", () => {
    expect(live.filter((r) => /webhook/i.test(r.path)).map(label)).toEqual(["POST /api/stripe/webhook"]);
  });

  it("the demo-data seed route doesn't exist", () => {
    expect(cov.rows.find((r) => r.path === "/api/seed")).toBeUndefined();
  });

  /*
   * Every write reachable without signing in, each with the reason it has to
   * be. A new one — or a seed route coming back — fails here until someone
   * writes down why it's safe; a line whose route gained auth or went away
   * fails too, so the list can't rot.
   */
  const PUBLIC_WRITES: Record<string, string> = {
    "POST /api/auth/login": "signing in; limited per address",
    "POST /api/auth/register": "signing up; limited per address",
    "POST /api/auth/mobile/login": "signing in; limited per address",
    "POST /api/auth/mobile/register": "signing up; limited per address",
    "POST /api/auth/mobile/google": "signing in with a Google ID token the server verifies",
    "POST /api/auth/mobile/refresh": "the refresh token is the credential; single-use, hashed, limited",
    "POST /api/auth/mobile/logout": "revokes the refresh token it's given; nothing else",
    "POST /api/logout": "must work with an expired session; refuses cross-site requests",
    "POST /api/stripe/webhook": "Stripe's signature is the credential",
    "POST /api/track": "anonymous analytics beacons; limited per address",
    "POST /api/loop-events": "anonymous loop beacons; limited per address",
    "PUT /internal-local-upload/:id": "development only; the issued, single-use id is the credential, size-capped",
  };

  it("every write without sign-in is on a written list, with its reason", () => {
    const open = live.filter((r) => r.write && !r.auth).map(label);
    const unexplained = open.filter((l) => !(l in PUBLIC_WRITES));
    expect(unexplained, `writes reachable without sign-in — guard them, or say why in PUBLIC_WRITES:\n  ${unexplained.join("\n  ")}`).toEqual([]);
    const stale = Object.keys(PUBLIC_WRITES).filter((l) => !open.includes(l));
    expect(stale, `in PUBLIC_WRITES but now guarded or gone — remove the line:\n  ${stale.join("\n  ")}`).toEqual([]);
  });
});

describe("kill switches", () => {
  it("every surface that owns API routes has prefixes, and every prefix is mounted", () => {
    const mounted = new Set(cov.surfacePrefixes.map((p) => `${p.surface}|${p.prefix}`));
    for (const [id, prefixes] of Object.entries(SURFACE_API_PREFIXES)) {
      expect(SURFACES.some((s) => s.id === id), `${id} is not a registered surface`).toBe(true);
      expect(prefixes.length, `${id} has no prefixes`).toBeGreaterThan(0);
      for (const p of prefixes) expect(mounted.has(`${id}|${p}`), `${id} ${p} is not mounted`).toBe(true);
    }
  });

  it("the sensitive families are each behind a switch", () => {
    const gated = (path: string) => live.find((r) => r.path === path)?.surface ?? null;
    expect(gated("/api/auth/register")).toBe("signup");
    expect(gated("/api/auth/mobile/register")).toBe("signup");
    expect(gated("/api/uploads/request-url")).toBe("uploads");
    expect(gated("/api/feed")).toBe("feed");
    expect(gated("/api/projects/:id/comments")).toBe("feed");
    expect(gated("/api/messages/:userId")).toBe("messages");
    expect(gated("/api/chat")).toBe("nova");
    expect(gated("/api/projects/:id/path/work")).toBe("nova");
    expect(gated("/api/projects/:id/tasks/nova-assist")).toBe("nova");
    expect(gated("/api/projects/:id/code-audit")).toBe("codeAudit");
    expect(gated("/api/projects/:id/documents/plan")).toBe("documents");
    expect(gated("/api/mock-interviews/:id/finish")).toBe("investor");
    expect(gated("/api/sprints")).toBe("sprints");
    expect(gated("/api/projects/:id/check-ins")).toBe("checkIns");
    expect(gated("/api/projects/:id/backing/checkout")).toBe("backing");
    // Sign-in is never behind a switch: nobody gets locked out by an incident elsewhere.
    expect(gated("/api/auth/login")).toBeNull();
    expect(gated("/api/logout")).toBeNull();
  });

  it("covers most of the write surface, and says how much", () => {
    const writes = live.filter((r) => r.write);
    const gatedWrites = writes.filter((r) => r.surface).length;
    // Not every write belongs to a feature switch (projects, tasks, milestones are the product itself).
    expect(gatedWrites / writes.length, `only ${gatedWrites}/${writes.length} writes behind a switch`).toBeGreaterThan(0.5);
  });
});
