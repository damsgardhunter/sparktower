/**
 * Security before release is read off the code: the same files always get the
 * same verdicts, each with the files that decided it. A bare server fails what
 * it should; a hardened one passes; features a project doesn't have are n/a;
 * and dependency folders, type declarations and tests don't count.
 */
import { describe, it, expect } from "vitest";
import { scanSecurity, renderSecurityGaps } from "@shared/security-checks";

const verdicts = (r: ReturnType<typeof scanSecurity>) => Object.fromEntries(r.checks.map((c) => [c.id, c.status]));

const bare = [
  { path: "package.json", content: JSON.stringify({ dependencies: { express: "4" } }) },
  { path: "server/index.ts", content: `
import express from "express";
import cors from "cors";
import session from "express-session";
const app = express();
app.use(cors({ origin: "*", credentials: true }));
app.use(session({ secret: process.env.SESSION_SECRET || "keyboard cat", cookie: {} }));
app.post("/api/login", async (req, res) => { const user = await db.find(req.body.email); if (user.password !== req.body.password) return res.status(401).end(); });
app.post("/api/projects", async (req, res) => { await db.insert({ ...req.body }); });
app.get("/go", (req, res) => res.redirect(req.query.next));
app.post("/api/webhook", (req, res) => { handle(req.body); });
app.get("/api/admin/users", (req, res) => res.json([]));
app.use((err, req, res, next) => res.status(500).json(err));
app.listen(3000);` },
  { path: "client/src/Post.tsx", content: `export const Post = ({ html }) => <div dangerouslySetInnerHTML={{ __html: html }} />;` },
];

const hardened = [
  { path: "package.json", content: JSON.stringify({ dependencies: { express: "4", helmet: "7", zod: "3", bcrypt: "5" } }) },
  { path: "package-lock.json", content: "{}" },
  { path: ".env.example", content: "SESSION_SECRET=" },
  { path: "SECURITY.md", content: "Email security@example.com" },
  { path: ".github/dependabot.yml", content: "version: 2" },
  { path: ".github/workflows/ci.yml", content: "steps:\n  - run: npm audit --audit-level=high\n  - uses: gitleaks/gitleaks-action@v2" },
  { path: "server/index.ts", content: `
import express from "express";
import helmet from "helmet";
import { z } from "zod";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";
import session from "express-session";
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set");
}
const app = express();
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"] } } }));
app.use(session({ cookie: { httpOnly: true, secure: isProduction, sameSite: "lax" } }));
app.post("/api/login", rateLimit({ max: 8 }), async (req, res) => { await bcrypt.compare(req.body.password, hash); });
app.post("/api/projects/:id", requireOwner, async (req, res) => { const body = z.object({ title: z.string() }).parse(req.body); });
app.delete("/api/projects/:id", isProjectMember(req.user.id, id));
app.post("/api/stripe/webhook", (req, res) => { stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], secret); });
app.post("/api/admin/roles", requireAdmin, (req, res) => { logActivity({ action: "role changed" }); totp.verify({ token, secret }); });
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ message: "Something went wrong" }); });` },
  { path: "client/src/Chat.tsx", content: `const escapeHtml = (s) => s.replace(/</g, "&lt;"); export const Msg = ({ t }) => <p dangerouslySetInnerHTML={{ __html: escapeHtml(t) }} />;` },
  // Not the app's code: these must not satisfy or fail anything.
  { path: "node_modules/helmet/index.js", content: "module.exports = function helmet() {}" },
  { path: "types/express.d.ts", content: "export function rateLimit(): void;" },
];

describe("security before release", () => {
  it("fails a bare server where it should, with the files that decided it", () => {
    const r = scanSecurity(bare, { suspectedSecrets: [{ file: "server/index.ts", hint: "api key" }] });
    const v = verdicts(r);
    expect(v).toMatchObject({
      "security-headers": "missing", https: "missing", cors: "missing", "cookie-flags": "missing",
      "password-hashing": "missing", "login-throttling": "missing", "input-validation": "missing",
      "mass-assignment": "partial", xss: "missing", "open-redirect": "missing", "committed-secrets": "missing",
      "secret-config": "missing", "webhook-verification": "missing", "dependency-audit": "missing",
      lockfile: "missing", mfa: "missing", disclosure: "missing", "error-leakage": "partial",
    });
    expect(r.checks.find((c) => c.id === "cors")!.severity).toBe("high"); // any origin with credentials
    expect(r.checks.find((c) => c.id === "xss")!.evidence).toEqual(["client/src/Post.tsx"]);
    expect(r.blockers).toBeGreaterThanOrEqual(6);
    expect(r.score).toBeLessThan(25);
    // Gaps first, worst first.
    expect(r.checks[0].status).toBe("missing");
    expect(r.checks[0].severity).toBe("high");
    expect(renderSecurityGaps(r)).toMatch(/release blockers\) — gaps found:\n- \[/);
  });

  it("passes a hardened server, and doesn't count dependencies or type declarations", () => {
    const r = scanSecurity(hardened);
    const v = verdicts(r);
    for (const id of ["security-headers", "https", "cookie-flags", "password-hashing", "login-throttling", "authorization", "input-validation", "xss", "committed-secrets", "secret-config", "dependency-audit", "secret-scanning", "lockfile", "webhook-verification", "audit-log", "mfa", "disclosure", "error-leakage", "open-redirect", "mass-assignment"]) {
      expect(v[id], id).toBe("pass");
    }
    expect(v.cors).toBe("n/a");
    // sameSite=lax with no token or Origin check: most of the way, not all.
    expect(v.csrf).toBe("partial");
    expect(r.blockers).toBe(0);
    expect(r.score).toBeGreaterThanOrEqual(95);
    expect(r.checks.find((c) => c.id === "security-headers")!.evidence).toEqual(["server/index.ts", "server/index.ts"]);
    // The helmet in node_modules alone passes nothing.
    const onlyVendored = scanSecurity([...bare.filter((f) => f.path !== "client/src/Post.tsx"), hardened.find((f) => f.path.startsWith("node_modules"))!]);
    expect(verdicts(onlyVendored)["security-headers"]).toBe("missing");
  });

  it("says n/a for what a project doesn't have instead of failing it", () => {
    const r = scanSecurity([{ path: "index.html", content: "<h1>Hello</h1>" }, { path: "README.md", content: "A static page" }]);
    const v = verdicts(r);
    for (const id of ["security-headers", "https", "cookie-flags", "csrf", "cors", "password-hashing", "login-throttling", "input-validation", "webhook-verification", "upload-limits", "ssrf"]) expect(v[id], id).toBe("n/a");
    expect(r.blockers).toBe(0);
  });
});

describe("the lockfile check", () => {
  const manifest = { path: "package.json", content: "{}" };
  const ci = (run: string) => ({ path: ".github/workflows/ci.yml", content: `steps:\n  - run: ${run}` });
  const lockVerdict = (files: { path: string; content?: string }[]) => {
    const r = scanSecurity(files as any);
    return r.checks.find((c) => c.id === "lockfile")!;
  };

  it("passes a committed lockfile — present by path only, the way the ingest records it — installed with npm ci", () => {
    const c = lockVerdict([manifest, { path: "package-lock.json" }, { path: "mobile/package-lock.json" }, ci("npm ci")]);
    expect(c.status).toBe("pass");
    expect(c.detail).toMatch(/package-lock\.json, mobile\/package-lock\.json.*frozen install/);
    expect(c.evidence).toEqual(["package-lock.json", "mobile/package-lock.json", ".github/workflows/ci.yml"]);
  });

  it("is partial when CI installs without enforcing the lockfile, and missing without one — a vendored lockfile doesn't count", () => {
    expect(lockVerdict([manifest, { path: "package-lock.json" }, ci("npm install")]).status).toBe("partial");
    expect(lockVerdict([manifest, { path: "yarn.lock" }, ci("yarn install --frozen-lockfile")]).status).toBe("pass");
    expect(lockVerdict([manifest, { path: "node_modules/foo/package-lock.json" }, ci("npm ci")]).status).toBe("missing");
  });
});

describe("the repository ingest keeps lockfiles in the tree", () => {
  it("records a lockfile by path, never its contents, and still ignores node_modules", async () => {
    const { snapshotFromFiles } = await import("../../server/code-ingest");
    const snap = snapshotFromFiles([
      { path: "package.json", content: "{\"name\":\"x\"}" },
      { path: "package-lock.json", content: "{\"lockfileVersion\":3, \"packages\": {}}" },
      { path: "mobile/package-lock.json", content: "{}" },
      { path: "node_modules/a/package-lock.json", content: "{}" },
    ] as any, "test");
    const lock = snap.files.find((f) => f.path === "package-lock.json");
    expect(lock).toBeTruthy();
    expect(lock!.content).toBeUndefined();
    expect(snap.files.map((f) => f.path)).toEqual(expect.arrayContaining(["package-lock.json", "mobile/package-lock.json"]));
    expect(snap.files.some((f) => f.path.startsWith("node_modules/"))).toBe(false);
    const { lockfilesIn } = await import("../../server/code-digest");
    expect(lockfilesIn(snap.files)).toEqual(["package-lock.json", "mobile/package-lock.json"]);
  });
});
