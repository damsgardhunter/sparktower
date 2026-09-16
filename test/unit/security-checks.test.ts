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
app.use(session({ cookie: { httpOnly: true, secure: isProduction, sameSite: "lax", maxAge: 604800000 } }));
app.post("/api/login", rateLimit({ max: 8 }), async (req, res) => { await bcrypt.compare(req.body.password, hash); req.session.regenerate(() => res.json({ ok: true })); });
app.post("/api/logout", (req, res) => req.logout(() => req.session.destroy(() => res.json({ ok: true }))));
app.post("/api/projects/:id", requireOwner, rateLimit({ max: 30 }), async (req, res) => { const body = z.object({ title: z.string() }).parse(req.body); });
app.delete("/api/projects/:id", rateLimit({ max: 30 }), isProjectMember(req.user.id, id));
app.post("/api/stripe/webhook", (req, res) => { stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], secret); });
app.post("/api/admin/roles", requireAdmin, requireMfa, rateLimit({ max: 10 }), (req, res) => { logActivity({ action: "role changed" }); totp.verify({ token, secret }); });
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
    // Two-factor that exists but guards nothing privileged is only partway; hand-written TOTP counts.
    const offeredOnly = hardened.map((f) => ({ ...f, content: (f.content ?? "").replace("requireMfa, ", "") }));
    expect(verdicts(scanSecurity(offeredOnly)).mfa).toBe("partial");
    const handRolled = [...bare, { path: "server/totp.ts", content: "export function verifyTotp(secret, code) { return otpauth(); } const url = `otpauth://totp/x`;" }, { path: "server/guard.ts", content: "export const requireAdmin = (req, res, next) => { if (!mfaGate(req, res)) return; next(); };" }];
    expect(verdicts(scanSecurity(handRolled)).mfa).toBe("pass");
    // ...and with a same-origin guard over every unsafe method, it's covered.
    const guard = { path: "server/csrf.ts", content: `const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export const check = (req) => { const site = req.headers["sec-fetch-site"]; const origin = req.headers.origin; return site || origin; };` };
    const withGuard = scanSecurity([...hardened, guard]).checks.find((c) => c.id === "csrf")!;
    expect(withGuard.status).toBe("pass");
    expect(withGuard.evidence[0]).toBe("server/csrf.ts");
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

describe("the secret-config check", () => {
  const verdict = (files: { path: string; content?: string }[]) => scanSecurity(files as any, {}).checks.find((c) => c.id === "secret-config")!;
  const server = (content: string) => ({ path: "server/auth.ts", content });

  it("flags a secret that falls back to anything written in the code — a string, an empty one, or a named default", () => {
    for (const read of [
      `const s = process.env.SESSION_SECRET || "keyboard cat";`,
      `const s = process.env.SESSION_SECRET ?? "dev";`,
      `const k = createHmac("sha256", process.env.MOBILE_TOKEN_SECRET || "");`,
      `const DEV_FALLBACK = "x"; const s = process.env.SESSION_SECRET || DEV_FALLBACK;`,
    ]) {
      const c = verdict([server(read)]);
      expect(c.status, read).toBe("missing");
      expect(c.detail).toMatch(/hard-coded default/);
    }
  });

  it("passes a required-secret helper with no default", () => {
    expect(verdict([server(`export const sessionSecret = () => requireSecret("SESSION_SECRET");`)]).status).toBe("pass");
    expect(verdict([server(`assertSecretsAtBoot();`)]).status).toBe("pass");
  });

  it("passes this server: no secret read anywhere has a default", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.ts$/.test(e.name) ? [`${dir}/${e.name}`] : []);
    const files = [...walk("server"), ...walk("shared")].map((path) => ({ path, content: readFileSync(path, "utf8") }));
    const c = verdict(files);
    expect(c.detail).not.toMatch(/hard-coded default/);
    expect(c.status).toBe("pass");
  });
});

describe("the checks added for reads, paths, commands and logs", () => {
  const verdict = (id: string, files: { path: string; content?: string }[]) => scanSecurity(files as any, {}).checks.find((c) => c.id === id)!;
  const srv = (content: string, path = "server/routes.ts") => ({ path, content });

  it("reads by id: flags one with no check on who is asking, passes ones that scope by owner or membership", () => {
    const open = verdict("read-authorization", [srv(`app.get("/api/invoices/:id", async (req, res) => res.json(await db.invoice(req.params.id)));`)]);
    expect(open.status).toBe("missing");
    expect(open.severity).toBe("high");
    const scoped = verdict("read-authorization", [srv(`
app.get("/api/invoices/:id", async (req, res) => { const row = await db.invoice(req.params.id); if (row.userId !== req.user.id) return res.status(404).end(); res.json(row); });
app.get("/api/projects/:id/tasks", async (req, res) => { if (!(await isProjectMember(req.user.id, req.params.id))) return res.status(403).end(); res.json([]); });`)]);
    expect(scoped.status).toBe("pass");
    // Nothing read by id at all: not a gap.
    expect(verdict("read-authorization", [srv(`app.get("/api/health", (req, res) => res.json({ ok: true }));`)]).status).toBe("n/a");
  });

  it("file paths: flags one built from a request value, passes a contained or strictly shaped one", () => {
    const loose = verdict("path-traversal", [srv(`
app.get("/files/*rest", (req, res) => { const name = req.path.slice(7); res.sendFile(path.join(ROOT, name)); });`)]);
    expect(loose.status).toBe("missing");
    expect(loose.evidence).toEqual(["server/routes.ts"]);
    const contained = verdict("path-traversal", [srv(`
app.get("/files/*rest", (req, res) => { const name = req.path.slice(7); const resolved = path.resolve(ROOT, name); if (path.relative(ROOT, resolved).startsWith("..")) return res.status(404).end(); res.sendFile(resolved); });`)]);
    expect(contained.status).toBe("pass");
    const strict = verdict("path-traversal", [srv(`
app.get("/files/:id", (req, res) => { const id = String(req.params.id); if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) return res.status(400).end(); res.sendFile(path.join(ROOT, id)); });`)]);
    expect(strict.status).toBe("pass");
    expect(verdict("path-traversal", [srv(`app.get("/api/health", (req, res) => res.json({ ok: true }));`)]).status).toBe("n/a");
  });

  it("commands: flags a shell or a command built by hand, passes arguments as a list", () => {
    const shell = verdict("command-injection", [srv(`import { execSync } from "child_process";\nexecSync(\`convert \${req.body.file} out.png\`);`)]);
    expect(shell.status).toBe("missing");
    expect(verdict("command-injection", [srv(`import { exec } from "child_process";\nexec("ls " + req.query.dir);`)]).status).toBe("missing");
    expect(verdict("command-injection", [srv(`import { spawn } from "child_process";\nspawn("ffmpeg", ["-i", input, output]);`)]).status).toBe("pass");
    expect(verdict("command-injection", [srv(`app.get("/api/health", (req, res) => res.json({ ok: true }));`)]).status).toBe("n/a");
  });

  it("logs: flags a logged body, token or password, and isn't fooled by a message that only names one", () => {
    expect(verdict("log-leakage", [srv(`import express from "express";\napp.post("/api/login", (req, res) => { console.log("login", req.body); });`)]).status).toBe("missing");
    expect(verdict("log-leakage", [srv(`import express from "express";\napp.listen(3000);\nconsole.error("refresh failed", refreshToken);`)]).status).toBe("missing");
    // The name in a message is not the value: this is the false positive the check must not raise.
    const messageOnly = verdict("log-leakage", [srv(`import express from "express";\nconsole.warn("[auth] MOBILE_TOKEN_SECRET is not set; set a password reset token in .env");\napp.listen(3000);`)]);
    expect(messageOnly.status).toBe("pass");
  });
});

describe("the checks added for limits, sessions, stored secrets and data rights", () => {
  const verdict = (id: string, files: { path: string; content?: string }[]) => scanSecurity(files as any, {}).checks.find((c) => c.id === id)!;
  const srv = (content: string, path = "server/routes.ts") => ({ path, content });

  it("limits beyond sign-in: counts the share of writes that carry one, and a whole-app limiter passes outright", () => {
    const only = `app.post("/api/login", rateLimit({ max: 8 }), login);\napp.post("/api/posts", create);\napp.post("/api/invites", invite);\napp.delete("/api/posts/:id", remove);`;
    expect(verdict("write-rate-limits", [srv(only)]).status).toBe("partial");
    expect(verdict("write-rate-limits", [srv(only)]).detail).toMatch(/1 of 4/);
    expect(verdict("write-rate-limits", [srv(`app.post("/api/posts", create);\napp.post("/api/invites", invite);`)]).status).toBe("missing");
    expect(verdict("write-rate-limits", [srv(`app.use(rateLimit({ max: 100 }));\napp.post("/api/posts", create);`)]).status).toBe("pass");
    expect(verdict("write-rate-limits", [srv(`app.get("/api/posts", list);`)]).status).toBe("n/a");
  });

  it("sessions: wants a new id at sign-in, an end at sign-out, and an expiry", () => {
    const all = srv(`app.use(session({ cookie: { maxAge: 604800000 } }));\napp.post("/login", (req, res) => req.session.regenerate(done));\napp.post("/logout", (req, res) => req.session.destroy(done));`);
    expect(verdict("session-lifecycle", [all]).status).toBe("pass");
    const some = verdict("session-lifecycle", [srv(`app.use(session({ cookie: { maxAge: 1000 } }));\nreq.session.userId = user.id;`)]);
    expect(some.status).toBe("partial");
    expect(some.detail).toMatch(/New id at sign-in ✗/);
    expect(verdict("session-lifecycle", [srv(`app.get("/api/me", jwtOnly);`)]).status).toBe("n/a");
  });

  it("stored credentials: a plainly named token column is a gap; hashed and sealed ones aren't", () => {
    const raw = [{ path: "shared/schema.ts", content: `export const invites = table("invites", { token: varchar("token").notNull(), apiKey: varchar("api_key") });` }];
    expect(verdict("secrets-at-rest", raw).status).toBe("missing");
    const hashedOnly = [{ path: "shared/schema.ts", content: `export const invites = table("invites", { tokenHash: varchar("token_hash").notNull(), passwordHash: varchar("password_hash") });` }];
    expect(verdict("secrets-at-rest", hashedOnly).status).toBe("pass");
    const sealed = [
      { path: "shared/schema.ts", content: `export const users = table("users", { mfaSecret: text("mfa_secret") });` },
      { path: "server/secret-box.ts", content: `export const seal = (plain) => createCipheriv("aes-256-gcm", key, iv);` },
    ];
    // A sealed value still reads as a gap by name alone — but with encryption present it's "partial", not "missing".
    expect(verdict("secrets-at-rest", sealed).status).toBe("partial");
    // SQL migrations count too, including a column added later — and a snake_case column is matched to the camelCase code that seals it.
    const sqlRaw = [{ path: "migrations/0003_keys.sql", content: `ALTER TABLE "users" ADD COLUMN "api_key" text;` }];
    expect(verdict("secrets-at-rest", sqlRaw).status).toBe("missing");
    const sqlSealed = [
      { path: "migrations/0003_keys.sql", content: `ALTER TABLE "users" ADD COLUMN "mfa_secret" text;` },
      { path: "server/mfa.ts", content: `await db.update(users).set({ mfaSecret: seal(secret) });\nconst seal = (p) => createCipheriv("aes-256-gcm", key, iv);` },
    ];
    expect(verdict("secrets-at-rest", sqlSealed).status).toBe("pass");
    expect(verdict("secrets-at-rest", [srv(`app.get("/x", h);`)]).status).toBe("n/a");
  });

  it("secret comparison: plain equality on a signature is a gap, a constant-time compare isn't", () => {
    expect(verdict("timing-safe-compare", [srv(`const ok = signature === expectedSignature;`)]).status).toBe("partial");
    expect(verdict("timing-safe-compare", [srv(`if (!crypto.timingSafeEqual(a, b)) return null;\nconst same = digest === expected;`)]).status).toBe("pass");
    expect(verdict("timing-safe-compare", [srv(`app.get("/x", h);`)]).status).toBe("n/a");
  });

  it("email verification: asked of a codebase that registers accounts, not of one that hands sign-up to a provider", () => {
    expect(verdict("email-verification", [srv(`app.post("/api/register", async (req, res) => { await db.insert(users).values({ email: req.body.email }); });`)]).status).toBe("missing");
    expect(verdict("email-verification", [srv(`app.post("/api/register", h);\nawait sendVerificationEmail(user, verificationToken);`)]).status).toBe("pass");
    expect(verdict("email-verification", [srv(`app.post("/api/posts", h);`)]).status).toBe("n/a");
  });

  it("data rights: wants both a way out and a copy of the data", () => {
    const users = `export const users = table("users", {});\napp.post("/api/register", h);`;
    expect(verdict("account-data-rights", [srv(users)]).status).toBe("missing");
    expect(verdict("account-data-rights", [srv(`${users}\napp.post("/api/account/delete-account", h);`)]).status).toBe("partial");
    expect(verdict("account-data-rights", [srv(`${users}\napp.post("/api/account/delete-account", h);\napp.get("/api/account/export", exportMyData);`)]).status).toBe("pass");
    expect(verdict("account-data-rights", [srv(`app.get("/api/status", h);`)]).status).toBe("n/a");
  });
});
