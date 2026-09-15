/**
 * Security before release: a fixed checklist read straight off the code.
 *
 * The audit's model is good at explaining a risk and bad at being exhaustive:
 * ask it "what security is missing?" and it lists whatever the excerpts it saw
 * happened to suggest. So the checklist is deterministic — every audit runs
 * every check against every file, the same repository always gets the same
 * verdicts, and each verdict carries the files that decided it. The model is
 * then handed the gaps and asked only to prioritise and explain the fixes for
 * this codebase.
 *
 * Checks are heuristics over source text (JS/TS stacks first, with the common
 * equivalents elsewhere). A check that can't apply — no cookies, no uploads,
 * no webhooks — says "n/a" rather than failing a project for a feature it
 * doesn't have. Pure: no filesystem, no network.
 */

export type SecuritySeverity = "high" | "medium" | "low";
export type SecurityStatus = "pass" | "partial" | "missing" | "n/a";
export type SecurityCategory = "transport" | "sessions" | "input" | "secrets" | "supply-chain" | "accounts" | "operations";

export interface SecurityCheckResult {
  id: string;
  label: string;
  category: SecurityCategory;
  severity: SecuritySeverity;
  status: SecurityStatus;
  /** One line: what was found (or not). */
  detail: string;
  /** Why it matters, in a sentence a builder acts on. */
  why: string;
  /** The concrete fix. */
  fix: string;
  /** Files that decided the verdict. */
  evidence: string[];
}

export interface SecurityReport {
  /** 0–100: weighted share of applicable checks passed (partial counts half). */
  score: number;
  /** High-severity checks that are missing: the ones to fix before release. */
  blockers: number;
  counts: { pass: number; partial: number; missing: number; na: number };
  checks: SecurityCheckResult[];
}

export const SECURITY_CATEGORY_LABEL: Record<SecurityCategory, string> = {
  transport: "Headers & transport",
  sessions: "Sessions & cookies",
  input: "Input & output",
  secrets: "Secrets",
  "supply-chain": "Dependencies & CI",
  accounts: "Accounts & access",
  operations: "Operations",
};

interface SourceFile { path: string; content?: string | null }

const VENDORED = /(^|\/)(node_modules|vendor|dist|build|coverage|\.next|\.git|\.cache|\.bun|\.yarn|\.pnpm-store|\.npm|\.local)\//;
const TEST = /(^|\/)(tests?|__tests__|e2e|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|php|java|kt|cs)$/;
/** Type declarations describe APIs; they don't use them. Detectors (this file and its kin) name every pattern they look for. */
const NOT_APP_CODE = /\.d\.ts$|(^|\/)security-checks\.[jt]s$|(^|\/)code-digest\.[jt]s$|(^|\/)route-coverage\.[jt]s$/;

/** Files whose content matches, as paths (at most `max`). */
function where(files: SourceFile[], re: RegExp, max = 4): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (f.content && re.test(f.content)) { out.push(f.path); if (out.length >= max) break; }
  }
  return out;
}

const WEIGHT: Record<SecuritySeverity, number> = { high: 3, medium: 2, low: 1 };

/** Runs every check. `extra` carries facts the digest already computed (committed-secret hits). */
export function scanSecurity(allFiles: SourceFile[], extra: { suspectedSecrets?: { file: string; hint: string }[] } = {}): SecurityReport {
  const files = allFiles.filter((f) => !VENDORED.test(f.path));
  const src = files.filter((f) => f.content && CODE.test(f.path) && !TEST.test(f.path) && !NOT_APP_CODE.test(f.path));
  const paths = new Set(files.map((f) => f.path));
  const ci = files.filter((f) => /^\.github\/workflows\/|(^|\/)\.gitlab-ci\.yml$|(^|\/)\.circleci\/|(^|\/)bitbucket-pipelines\.yml$/.test(f.path));
  const manifests = files.filter((f) => /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|Gemfile|go\.mod)$/.test(f.path));
  const results: SecurityCheckResult[] = [];
  const add = (r: SecurityCheckResult) => results.push(r);
  const has = (re: RegExp, set: SourceFile[] = src) => where(set, re);
  /** Server code only: browser and app code can mention a limiter or a role without enforcing anything. */
  const server = src.filter((f) => !/^(client|web|frontend|mobile|app\/\(|apps\/(web|mobile))\//.test(f.path) && !/\.(tsx|jsx)$/.test(f.path));
  const onServer = (re: RegExp) => where(server, re);

  const isServer = has(/\bexpress\s*\(|from ["']express["']|require\(["']express["']\)|fastify\s*\(|from ["']koa["']|from ["']hono["']|NextResponse|createServer\(|flask|django|app\.listen\(/).length > 0;
  const nextApp = paths.has("next.config.js") || paths.has("next.config.mjs") || paths.has("next.config.ts");

  // --- Headers & transport ------------------------------------------------
  {
    const helmet = has(/\bhelmet\s*\(/);
    const csp = has(/(setHeader|set|header)\(\s*["']Content-Security-Policy["']|contentSecurityPolicy\s*:/);
    const nextHeaders = nextApp ? has(/async\s+headers\s*\(|headers:\s*async/, files.filter((f) => /next\.config\./.test(f.path))) : [];
    const ok = helmet.length > 0 || nextHeaders.length > 0;
    add({
      id: "security-headers", label: "Security headers", category: "transport", severity: "high",
      status: !isServer && !nextApp ? "n/a" : ok && csp.length ? "pass" : ok || csp.length ? "partial" : "missing",
      detail: ok ? (csp.length ? "Security headers set, with a Content-Security-Policy." : "Security headers set, but no Content-Security-Policy.") : csp.length ? "A Content-Security-Policy is set, but not the other standard headers." : "No security headers middleware (e.g. helmet) and no Content-Security-Policy.",
      why: "Without X-Content-Type-Options, frame protection and a CSP, a single injected script or a framed page can take over sessions.",
      fix: isServer ? "Add helmet (app.use(helmet())) before your routes, then tighten its contentSecurityPolicy to the scripts, styles and hosts you actually load." : "Return security headers from next.config.js headers(), including a Content-Security-Policy.",
      evidence: [...helmet, ...csp, ...nextHeaders].slice(0, 4),
    });
  }
  {
    const hsts = has(/(setHeader|set|header)\(\s*["']Strict-Transport-Security["']|\bhsts\s*:|\bhelmet\s*\(/);
    const redirect = has(/x-forwarded-proto[^\n]{0,80}https|requireHTTPS|forceSSL|enforce-?https|secure:\s*(true|isProd\w*|process\.env\.NODE_ENV)/i);
    add({
      id: "https", label: "HTTPS enforced (HSTS)", category: "transport", severity: "medium",
      status: !isServer && !nextApp ? "n/a" : hsts.length ? "pass" : redirect.length ? "partial" : "missing",
      detail: hsts.length ? "Strict-Transport-Security is sent." : redirect.length ? "Secure cookies or an HTTPS redirect, but no HSTS header." : "Nothing forces HTTPS: no HSTS and no redirect.",
      why: "The first plain-HTTP request can be intercepted and its session cookie read; HSTS makes browsers refuse HTTP for your domain.",
      fix: "Send Strict-Transport-Security (helmet does by default) and redirect HTTP to HTTPS at the proxy or in middleware when x-forwarded-proto isn't https.",
      evidence: [...hsts, ...redirect].slice(0, 4),
    });
  }
  {
    const cors = has(/\bcors\s*\(|(setHeader|set|header)\(\s*["']Access-Control-Allow-Origin["']/);
    const wildcard = has(/origin:\s*["']\*["']|origin:\s*true\b|Access-Control-Allow-Origin["']?\s*,\s*["']\*["']/);
    const credentialsWild = wildcard.length ? has(/credentials:\s*true/, src.filter((f) => wildcard.includes(f.path))) : [];
    add({
      id: "cors", label: "CORS locked to your origins", category: "transport", severity: credentialsWild.length ? "high" : "medium",
      status: !cors.length ? "n/a" : wildcard.length ? "missing" : "pass",
      detail: !cors.length ? "No CORS configuration: the API only answers same-origin browsers." : wildcard.length ? `CORS allows any origin${credentialsWild.length ? ", with credentials" : ""}.` : "CORS is configured with specific origins.",
      why: "An API that answers every origin lets any website read responses from a signed-in visitor's browser.",
      fix: "Replace the wildcard with an allowlist of your own domains (cors({ origin: ['https://yourapp.com'] })) and never combine it with credentials.",
      evidence: [...wildcard, ...cors].slice(0, 4),
    });
  }

  // --- Sessions & cookies -----------------------------------------------
  {
    const cookieConfig = has(/cookie:\s*\{|res\.cookie\(|cookies\(\)\.set|Set-Cookie|express-session|cookie-session/);
    const httpOnly = has(/httpOnly:\s*true/);
    const secure = has(/secure:\s*(true|isProd|isProduction|process\.env\.NODE_ENV\s*===\s*["']production["'])/);
    const sameSite = has(/sameSite:\s*[^,}\n]{0,60}["'](lax|strict|none)["']/i);
    const flags = [httpOnly.length > 0, secure.length > 0, sameSite.length > 0].filter(Boolean).length;
    add({
      id: "cookie-flags", label: "Session cookie flags", category: "sessions", severity: "high",
      status: !cookieConfig.length ? "n/a" : flags === 3 ? "pass" : flags > 0 ? "partial" : "missing",
      detail: !cookieConfig.length ? "No cookies set by the server." : `httpOnly ${httpOnly.length ? "✓" : "✗"} · secure ${secure.length ? "✓" : "✗"} · sameSite ${sameSite.length ? "✓" : "✗"}`,
      why: "A session cookie without httpOnly can be stolen by any XSS; without secure it travels over plain HTTP; without sameSite it rides along on cross-site requests.",
      fix: "Set the session cookie with { httpOnly: true, secure: true (in production), sameSite: 'lax' }.",
      evidence: [...cookieConfig.slice(0, 1), ...httpOnly, ...secure, ...sameSite].slice(0, 4),
    });
  }
  {
    const cookieSessions = has(/express-session|cookie-session|cookies\(\)\.set|res\.cookie\(/);
    const csrf = has(/\bcsurf\s*\(|csrfProtection|doubleCsrf|lusca\.csrf\(|req\.csrfToken\(|["']x-csrf-token["']|CsrfViewMiddleware/i);
    const strictSite = has(/sameSite:\s*["']strict["']/i);
    const laxSite = has(/sameSite:\s*[^,}\n]{0,60}["']lax["']/i);
    const originCheck = has(/req\.headers\.origin|req\.get\(["']origin["']\)|sec-fetch-site/i);
    // An Origin / Sec-Fetch-Site check that covers every unsafe method (not one route) is enforcement, not a hint.
    const originGuard = server.filter((f) => /sec-fetch-site/i.test(f.content ?? "") && /headers\.origin|["']origin["']/i.test(f.content ?? "")
      && /["']PATCH["']/.test(f.content ?? "") && /["']DELETE["']/.test(f.content ?? "")).map((f) => f.path);
    const guarded = originGuard.length > 0 && (laxSite.length > 0 || strictSite.length > 0);
    add({
      id: "csrf", label: "CSRF protection", category: "sessions", severity: "medium",
      status: !cookieSessions.length ? "n/a" : csrf.length || strictSite.length || guarded ? "pass" : laxSite.length || originCheck.length ? "partial" : "missing",
      detail: !cookieSessions.length ? "No cookie sessions (token auth isn't sent automatically, so CSRF doesn't apply)." : csrf.length ? "CSRF tokens are checked." : guarded ? "sameSite cookies plus an Origin / Sec-Fetch-Site check on every state-changing request." : strictSite.length ? "sameSite=strict cookies block cross-site requests." : laxSite.length || originCheck.length ? "sameSite=lax or an Origin check covers most cases, but no CSRF token for state changes." : "Cookie sessions with no CSRF defence.",
      why: "With cookie sessions, another site can submit a form to your API as the signed-in visitor.",
      fix: "Keep sameSite=lax and accept writes only as JSON, and also reject state-changing requests whose Origin header isn't yours (or add a CSRF token).",
      evidence: [...csrf, ...originGuard, ...strictSite, ...laxSite, ...originCheck].slice(0, 4),
    });
  }

  // --- Accounts & access ----------------------------------------------------
  {
    const passwords = onServer(/password/i);
    const hashing = onServer(/\bbcrypt(js)?\.(hash|compare)|\bargon2\.(hash|verify)|\bscrypt(Sync)?\s*\(|pbkdf2(Sync)?\s*\(|passlib|password_hash\(|make_password\(/);
    const managed = has(/clerk|supabase\.auth|firebase\/auth|next-auth|@auth\/|auth0|cognito/i);
    add({
      id: "password-hashing", label: "Passwords hashed", category: "accounts", severity: "high",
      status: managed.length && !hashing.length ? "pass" : !passwords.length ? "n/a" : hashing.length ? "pass" : "missing",
      detail: hashing.length ? "Passwords are hashed with a slow hash." : managed.length ? "Sign-in is handled by a managed auth provider." : !passwords.length ? "No password sign-in." : "Passwords appear in the code but no bcrypt/argon2/scrypt hashing was found.",
      why: "A leaked table of plain or fast-hashed passwords becomes every user's password on every other site.",
      fix: "Hash with bcrypt (cost 12) or argon2id on sign-up and compare with the library's constant-time compare on sign-in.",
      evidence: [...hashing, ...managed].slice(0, 3),
    });
  }
  {
    const loginRoutes = onServer(/["'`]\/(api\/)?(auth\/)?(login|signin|sign-in|session)["'`]/);
    const limiter = onServer(/rateLimit\s*\(|from ["']express-rate-limit["']|enforceRateLimit\(|new RateLimiter|slowDown\(|@Throttle\(|limiter\.(consume|check)\(/i);
    add({
      id: "login-throttling", label: "Sign-in attempts throttled", category: "accounts", severity: "high",
      status: !loginRoutes.length ? "n/a" : limiter.length ? "pass" : "missing",
      detail: !loginRoutes.length ? "No sign-in route found." : limiter.length ? "A rate limiter exists in the server." : "Sign-in routes with no rate limiter anywhere.",
      why: "An unthrottled sign-in lets a script try thousands of passwords per account per minute.",
      fix: "Limit sign-in attempts per IP and per account (e.g. 8 per 15 minutes), stored in the database or Redis so it holds across instances.",
      evidence: [...loginRoutes.slice(0, 2), ...limiter.slice(0, 2)],
    });
  }
  {
    const admin = onServer(/\badmin\b|role\s*===|isAdmin|requireAdmin|requireOwner|requireReviewer/i);
    // A library, a passkey flow, or TOTP written out by hand (an otpauth:// URL, a verifyTotp over HMAC).
    const mfa = has(/from ["'](otplib|speakeasy|@simplewebauthn\/server|@otplib\/[\w-]+)["']|require\(["'](otplib|speakeasy)["']\)|verifyRegistrationResponse|verifyAuthenticationResponse|totp\.verify|authenticator\.(verify|check)\(|otpauth:\/\/|\b(verify|check)Totp\s*\(/i);
    // Offering it isn't the fix for admins: something has to refuse a privileged request without it.
    const enforced = onServer(/\bmfaGate\b|requireMfa|require2fa|requireTwoFactor|mfa_required|mfaRequiredFor|mfa_enrollment_required/i);
    const adminGap = admin.length > 0 && !enforced.length;
    add({
      id: "mfa", label: "Two-factor sign-in (at least for admins)", category: "accounts", severity: admin.length ? "medium" : "low",
      status: !mfa.length ? "missing" : adminGap ? "partial" : "pass",
      detail: !mfa.length
        ? admin.length ? "Admin or owner powers exist, and no second factor protects them." : "No two-factor or passkey sign-in."
        : adminGap ? "Two-factor sign-in exists, but nothing requires it for admin, owner or reviewer accounts."
        : admin.length ? "Two-factor sign-in exists and privileged accounts must use it." : "Two-factor or passkey sign-in exists.",
      why: "One phished or reused password is enough to take an account — and for an admin, the whole site.",
      fix: adminGap
        ? "Refuse admin, owner and reviewer routes until the session has passed a second factor (and block them for accounts that haven't enrolled)."
        : "Offer TOTP (otplib) or passkeys (WebAuthn), and require it for admin, owner and reviewer accounts before release.",
      evidence: [...enforced, ...mfa, ...admin].filter((f, i, all) => all.indexOf(f) === i).slice(0, 3),
    });
  }
  {
    const authzRe = /requireOwner\b|requireAdmin\b|requireRole\(|requireReviewer\b|isProjectMember\(|ownerId\s*!==\s*(req\.user|userId)|authorize\(|\.can\(\s*["']/gi;
    const authz = onServer(new RegExp(authzRe.source, "i"));
    // Checks, not files: one server file can guard every route it has.
    const authzUses = server.reduce((n, f) => n + ((f.content ?? "").match(authzRe)?.length ?? 0), 0);
    add({
      id: "authorization", label: "Ownership checks on writes", category: "accounts", severity: "high",
      status: authzUses >= 2 ? "pass" : authzUses === 1 ? "partial" : isServer ? "missing" : "n/a",
      detail: authzUses ? `${authzUses} ownership or role check${authzUses === 1 ? "" : "s"} on the server.` : "No ownership or role checks found on the server.",
      why: "Signed in isn't the same as allowed: without a check, anyone signed in can edit or delete another user's records by id.",
      fix: "On every route that changes a record by id, load it and confirm the caller owns it (or is on its team) before writing; return 404 otherwise.",
      evidence: authz.slice(0, 4),
    });
  }

  // --- Input & output ----------------------------------------------------------
  {
    const validation = onServer(/from ["'](zod|joi|yup|express-validator|class-validator|valibot|drizzle-zod)["']|require\(["'](zod|joi|yup)["']\)|from pydantic import|from marshmallow import/);
    const parsing = onServer(/\.(safe)?[pP]arse\(\s*(\{\s*\.\.\.)?req\.(body|query|params)|validationResult\(req\)|\.validate(Async)?\(\s*req\.body|Schema\.parse\(/);
    add({
      id: "input-validation", label: "Request validation", category: "input", severity: "medium",
      status: !isServer ? "n/a" : validation.length && parsing.length ? "pass" : validation.length ? "partial" : "missing",
      detail: validation.length && parsing.length ? "Request bodies are parsed with a schema validator." : validation.length ? "A schema validator is installed, but request bodies aren't parsed with it." : "No schema validation library on request bodies.",
      why: "Unvalidated bodies let unexpected types and extra fields reach the database (mass assignment, crashes, injection).",
      fix: "Parse every request body with a schema (zod) and pass only the parsed object to storage — never spread req.body into an insert.",
      evidence: validation.slice(0, 4),
    });
  }
  {
    // Spread in, merged in, or handed to a write whole.
    const spreadBody = onServer(/\.\.\.\s*req\.body|Object\.assign\([^)]*req\.body|\.(set|values)\(\s*req\.body\s*\)|(storage|repo|repository|model|db)\.\w+\([^;\n]*,\s*req\.body\s*\)|\.(create|update|insert|upsert)\w*\(\s*req\.body\s*\)/);
    add({
      id: "mass-assignment", label: "No raw request bodies written to the database", category: "input", severity: "medium",
      status: !isServer ? "n/a" : spreadBody.length ? "partial" : "pass",
      detail: spreadBody.length ? `Request bodies are spread into objects in ${spreadBody.length}${spreadBody.length >= 4 ? "+" : ""} file${spreadBody.length === 1 ? "" : "s"}.` : "No request bodies spread straight into writes.",
      why: "Spreading req.body lets a caller set fields you never meant to expose — ownerId, role, credits.",
      fix: "Pick the allowed fields (or parse with a schema) before writing, and set server-owned fields like ownerId from the session.",
      evidence: spreadBody.slice(0, 4),
    });
  }
  {
    const rawHtml = where(src, /dangerouslySetInnerHTML|\.innerHTML\s*=|v-html=|\{\{\{|\|safe\b/, 20);
    // A file that escapes or sanitises what it renders, or only injects a <style> block it builds itself, isn't the risk.
    const handled = (f: SourceFile) => /escapeHtml|escape\(|DOMPurify\.sanitize\(|sanitizeHtml\(|sanitize\(|\.replace\(\s*\/<\/g|&lt;/.test(f.content ?? "")
      || /<style[\s\S]{0,120}dangerouslySetInnerHTML/.test(f.content ?? "");
    const unhandled = src.filter((f) => rawHtml.includes(f.path) && !handled(f)).map((f) => f.path);
    add({
      id: "xss", label: "No unsanitised HTML rendering", category: "input", severity: "high",
      status: !rawHtml.length ? "pass" : unhandled.length ? "missing" : "pass",
      detail: !rawHtml.length ? "No raw HTML rendering." : unhandled.length ? `Raw HTML is rendered without escaping or a sanitiser in ${unhandled.length} file${unhandled.length === 1 ? "" : "s"}.` : "Raw HTML is rendered only after escaping or sanitising.",
      why: "Rendering user-supplied HTML runs whatever script it contains in every visitor's session.",
      fix: "Render text, not HTML; where HTML is truly needed, escape the text first or pass it through DOMPurify.",
      evidence: (unhandled.length ? unhandled : rawHtml).slice(0, 4),
    });
  }
  {
    const rawSql = onServer(/sql\.raw\(|\.query\(\s*`[^`]*\$\{|\.execute\(\s*`[^`]*\$\{|\$queryRawUnsafe|raw\(\s*`[^`]*\$\{|cursor\.execute\(\s*f["']/);
    add({
      id: "sql-injection", label: "Queries parameterised", category: "input", severity: "high",
      status: rawSql.length ? "partial" : "pass",
      detail: rawSql.length ? `String-built or raw SQL in ${rawSql.length}${rawSql.length >= 4 ? "+" : ""} file${rawSql.length === 1 ? "" : "s"} — safe only if nothing user-supplied reaches it.` : "No string-built SQL found.",
      why: "A request value concatenated into SQL can read or delete any table.",
      fix: "Use the query builder's bound parameters (sql`... ${value}`) and keep sql.raw for constants you wrote yourself.",
      evidence: rawSql.slice(0, 4),
    });
  }
  {
    const redirect = onServer(/res\.redirect\(\s*(req\.(query|body|params)|String\(req\.)|redirect\(\s*request\.(args|GET)/);
    add({
      id: "open-redirect", label: "No open redirects", category: "input", severity: "medium",
      status: redirect.length ? "missing" : "pass",
      detail: redirect.length ? "A redirect target comes straight from the request." : "No redirects to request-supplied URLs.",
      why: "A redirect that follows ?next= to any site makes your domain a trusted-looking phishing link.",
      fix: "Only redirect to relative paths you recognise (or an allowlist of your own hosts).",
      evidence: redirect.slice(0, 4),
    });
  }
  {
    const outbound = onServer(/fetch\(\s*(req\.(body|query|params)[.\w]*|targetUrl|liveUrl|webhookUrl|userUrl)\s*[,)]/);
    const guard = onServer(/isPrivate(Ip|Address|Host)\s*\(|allowedHosts\s*[.:=]|ALLOWED_HOSTS|169\.254\.169\.254|ipaddr\.(parse|process)\(|dns\.(lookup|promises)/i);
    add({
      id: "ssrf", label: "Server-side fetches of user URLs guarded", category: "input", severity: "medium",
      status: !outbound.length ? "n/a" : guard.length ? "pass" : "partial",
      detail: !outbound.length ? "The server doesn't fetch user-supplied URLs." : guard.length ? "User-supplied URLs are fetched, with host checks." : "The server fetches URLs users supply, with no private-address check found.",
      why: "Fetching a user's URL from your server can reach your cloud metadata endpoint or internal services.",
      fix: "Before fetching, resolve the host and refuse private, loopback and link-local addresses (and 169.254.169.254); allow only http(s).",
      evidence: [...outbound, ...guard].slice(0, 4),
    });
  }
  {
    const leak = onServer(/res\.(status\(\d+\)\.)?(json|send)\(\s*(err|error)(\.stack)?\s*\)|stack:\s*(err|error)\.stack/);
    add({
      id: "error-leakage", label: "Errors don't leak internals", category: "input", severity: "low",
      status: !isServer ? "n/a" : leak.length ? "partial" : "pass",
      detail: leak.length ? `Raw error objects or messages are returned to clients in ${leak.length}${leak.length >= 4 ? "+" : ""} file${leak.length === 1 ? "" : "s"}.` : "Clients get written messages, not raw errors.",
      why: "Stack traces and database errors tell an attacker your stack, file layout and schema.",
      fix: "Log the error server-side and return a short message; send stack traces only when NODE_ENV isn't production.",
      evidence: leak.slice(0, 4),
    });
  }
  {
    const uploads = has(/from ["'](multer|formidable|busboy)["']|getSignedUrl\(|createPresignedPost\(|["']\/api\/uploads|upload\/request-url|put\(["'][^"']*upload/i);
    const limits = has(/fileSize\s*:|maxFileSize|MAX_[A-Z_]*BYTES\s*=|limits:\s*\{\s*fileSize/i);
    const types = has(/fileFilter\s*[:(]|mimetype|imageType\(|magic bytes|contentType\.startsWith\(["']image/i);
    add({
      id: "upload-limits", label: "Uploads limited by size and type", category: "input", severity: "medium",
      status: !uploads.length ? "n/a" : limits.length && types.length ? "pass" : limits.length || types.length ? "partial" : "missing",
      detail: !uploads.length ? "No file uploads." : `Size limit ${limits.length ? "✓" : "✗"} · type check ${types.length ? "✓" : "✗"}`,
      why: "Unlimited uploads fill your disk or bill; unchecked types let someone host HTML or scripts on your domain.",
      fix: "Cap upload size on the server, check the file's real type (magic bytes), and serve uploads with Content-Disposition or from a separate domain.",
      evidence: [...uploads.slice(0, 1), ...limits.slice(0, 2), ...types.slice(0, 1)],
    });
  }

  // --- Secrets ------------------------------------------------------------------
  {
    const hits = extra.suspectedSecrets ?? [];
    add({
      id: "committed-secrets", label: "No secrets committed", category: "secrets", severity: "high",
      status: hits.length ? "missing" : "pass",
      detail: hits.length ? `${hits.length} place${hits.length === 1 ? "" : "s"} look like a committed credential.` : "No committed credentials found.",
      why: "A key in the repository is a key in every clone, fork and backup — and bots scan public repos within minutes.",
      fix: "Rotate each exposed credential now, move it to environment variables, and remove it from git history (git filter-repo).",
      evidence: hits.map((h) => h.file).slice(0, 4),
    });
  }
  {
    const envExample = [...paths].filter((p) => /(^|\/)\.env\.(example|sample|template)$/.test(p));
    // A throw near the read, or a helper that requires the secret (requireSecret("SESSION_SECRET"), assertSecretsAtBoot()).
    const enforced = onServer(/!\s*process\.env\.[A-Z_]*(SECRET|KEY)\b[^\n]{0,80}\)?\s*\{?\s*\n?\s*throw|process\.env\.[A-Z_]*SECRET\s*\|\|\s*\(\(\)\s*=>\s*\{\s*throw|NODE_ENV\s*===\s*["']production["'][\s\S]{0,200}(SECRET|KEY)[\s\S]{0,80}throw|\brequire(Secret|Env)\s*\(\s*["'][A-Z_]*(SECRET|KEY)["']|\bassertSecrets\w*\s*\(\s*\)/);
    // A literal after || or ?? (empty included), or a named FALLBACK / DEFAULT constant.
    const weakDefault = has(/process\.env\.[A-Z_]*SECRET\s*(\|\||\?\?)\s*(["'`][^"'`]{0,40}["'`]|[A-Z_]*(FALLBACK|DEFAULT)\b)/);
    add({
      id: "secret-config", label: "Secrets required in production", category: "secrets", severity: "medium",
      status: weakDefault.length ? "missing" : enforced.length ? "pass" : envExample.length ? "partial" : "missing",
      detail: weakDefault.length ? "A secret falls back to a hard-coded default." : enforced.length ? "The server refuses to start without its secrets." : envExample.length ? "An .env example documents the variables, but nothing stops a deploy without them." : "No .env example and no startup check for secrets.",
      why: "A session secret that silently defaults to a known string lets anyone forge sessions on a misconfigured deploy.",
      fix: "Throw at startup when SESSION_SECRET (and other signing keys) are missing in production, and keep an .env.example listing them.",
      evidence: [...weakDefault, ...enforced, ...envExample].slice(0, 4),
    });
  }

  // --- Dependencies & CI ---------------------------------------------------------
  {
    const audit = [...where(ci, /npm audit|pnpm audit|yarn (npm )?audit|snyk|osv-scanner|trivy|dependency-review|pip-audit|bundle-audit|govulncheck/i),
      ...[...paths].filter((p) => /(^|\/)\.github\/dependabot\.ya?ml$|(^|\/)renovate\.json$/.test(p))];
    add({
      id: "dependency-audit", label: "Vulnerable dependencies caught", category: "supply-chain", severity: "medium",
      status: audit.length ? "pass" : manifests.length ? "missing" : "n/a",
      detail: audit.length ? "Dependencies are scanned for known vulnerabilities." : "Nothing checks dependencies for known vulnerabilities.",
      why: "Most breaches of small apps come through a known-vulnerable package that was never updated.",
      fix: "Add npm audit --audit-level=high to CI and turn on Dependabot (a .github/dependabot.yml) for weekly update PRs.",
      evidence: audit.slice(0, 4),
    });
  }
  {
    const scan = where(ci, /gitleaks|trufflehog|detect-secrets|secret-?scan/i);
    add({
      id: "secret-scanning", label: "Secret scanning in CI", category: "supply-chain", severity: "low",
      status: scan.length ? "pass" : ci.length ? "missing" : "missing",
      detail: scan.length ? "CI scans for committed secrets." : ci.length ? "CI runs, but doesn't scan for secrets." : "No CI to scan for secrets.",
      why: "The check that catches a pasted API key is the one that runs before it's merged.",
      fix: "Add a gitleaks step to CI (and turn on GitHub secret scanning with push protection for the repository).",
      evidence: scan.slice(0, 4),
    });
  }
  {
    // Lockfiles are recorded by path (their contents are never read); a vendored one in node_modules doesn't count.
    const lockfile = [...paths].filter((p) => /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|poetry\.lock|uv\.lock|Pipfile\.lock|Gemfile\.lock|Cargo\.lock|composer\.lock|go\.sum)$/.test(p) && !p.split("/").includes("node_modules"))
      .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
    // A lockfile only pins what CI installs if CI installs *from* it: npm ci, a frozen/immutable install.
    const frozen = where(ci, /\bnpm ci\b|--frozen-lockfile|--immutable\b|pnpm install --frozen|bun install --frozen|poetry install|uv sync --locked|bundle install --frozen|\bbundle config.*frozen/);
    const loose = where(ci, /\bnpm (install|i)(\s|$)(?![^\n]*--package-lock-only)|\byarn install(?![^\n]*(--frozen-lockfile|--immutable))|\bpnpm install(?![^\n]*--frozen)/);
    add({
      id: "lockfile", label: "Dependencies pinned (lockfile)", category: "supply-chain", severity: "low",
      status: !manifests.length ? "n/a" : !lockfile.length ? "missing" : loose.length && !frozen.length ? "partial" : "pass",
      detail: !lockfile.length ? "No lockfile: every install can pull different (possibly compromised) versions."
        : loose.length && !frozen.length ? `Lockfile committed (${lockfile.slice(0, 3).join(", ")}), but CI installs without it being enforced.`
        : `Lockfile committed (${lockfile.slice(0, 3).join(", ")}${lockfile.length > 3 ? ` +${lockfile.length - 3}` : ""})${frozen.length ? ", and CI installs from it exactly (frozen install)" : ""}.`,
      why: "Without a lockfile a hijacked minor release reaches production on the next deploy.",
      fix: "Commit the lockfile and install with npm ci (or your package manager's frozen install) in CI and deploys.",
      evidence: [...lockfile.slice(0, 2), ...frozen.slice(0, 1), ...loose.slice(0, 1)],
    });
  }

  // --- Operations -------------------------------------------------------------------
  {
    const webhooks = onServer(/webhook/i);
    const verified = onServer(/constructEvent(Async)?\(|verifyWebhook\(|webhooks\.verify\(|["']stripe-signature["']|["']x-hub-signature(-256)?["']|new Webhook\(|processWebhook\(/);
    add({
      id: "webhook-verification", label: "Webhooks verify signatures", category: "operations", severity: "high",
      status: !webhooks.length ? "n/a" : verified.length ? "pass" : "missing",
      detail: !webhooks.length ? "No incoming webhooks." : verified.length ? "Webhook signatures are verified." : "Webhook handlers with no signature verification found.",
      why: "An unverified payment webhook lets anyone mark an order paid or a subscription active.",
      fix: "Verify every webhook against its provider's signature using the raw request body (stripe.webhooks.constructEvent) before acting on it.",
      evidence: [...verified, ...webhooks].slice(0, 4),
    });
  }
  {
    const log = onServer(/logActivity\(|moderationLog|moderation_log|auditLog\.|insert\(\s*(auditLog|adminActions|moderationLog)|security_events/i);
    add({
      id: "audit-log", label: "Sensitive actions logged", category: "operations", severity: "low",
      status: log.length ? "pass" : "missing",
      detail: log.length ? "Admin or account actions are recorded." : "No log of admin or account actions.",
      why: "Without a record of who changed roles, refunded or deleted what, you can't investigate an incident.",
      fix: "Write an append-only log row for sign-ins, role changes, deletions and admin actions (who, what, when, from where).",
      evidence: log.slice(0, 3),
    });
  }
  {
    const disclosure = [...paths].filter((p) => /(^|\/)SECURITY\.md$|(^|\/)\.well-known\/security\.txt$|security\.txt$/i.test(p));
    add({
      id: "disclosure", label: "Vulnerability disclosure policy", category: "operations", severity: "low",
      status: disclosure.length ? "pass" : "missing",
      detail: disclosure.length ? "There's a way to report a vulnerability." : "No SECURITY.md or security.txt telling researchers how to reach you.",
      why: "People who find a hole need a way to tell you before they tell everyone else.",
      fix: "Add SECURITY.md to the repo and serve /.well-known/security.txt with a contact email.",
      evidence: disclosure.slice(0, 2),
    });
  }

  // --- Score -------------------------------------------------------------------------
  const applicable = results.filter((r) => r.status !== "n/a");
  const possible = applicable.reduce((n, r) => n + WEIGHT[r.severity], 0);
  const earned = applicable.reduce((n, r) => n + WEIGHT[r.severity] * (r.status === "pass" ? 1 : r.status === "partial" ? 0.5 : 0), 0);
  const order: Record<SecurityStatus, number> = { missing: 0, partial: 1, pass: 2, "n/a": 3 };
  results.sort((a, b) => order[a.status] - order[b.status] || WEIGHT[b.severity] - WEIGHT[a.severity]);
  return {
    score: possible ? Math.round((earned / possible) * 100) : 100,
    blockers: results.filter((r) => r.status === "missing" && r.severity === "high").length,
    counts: {
      pass: results.filter((r) => r.status === "pass").length,
      partial: results.filter((r) => r.status === "partial").length,
      missing: results.filter((r) => r.status === "missing").length,
      na: results.filter((r) => r.status === "n/a").length,
    },
    checks: results,
  };
}

/** The gaps, as prompt lines, for the model to prioritise. */
export function renderSecurityGaps(report: SecurityReport): string {
  const gaps = report.checks.filter((c) => c.status === "missing" || c.status === "partial");
  if (!gaps.length) return `SECURITY CHECKS (deterministic, ${report.score}/100): every applicable check passes.`;
  return [
    `SECURITY CHECKS (deterministic, ${report.score}/100, ${report.blockers} release blocker${report.blockers === 1 ? "" : "s"}) — gaps found:`,
    ...gaps.map((c) => `- [${c.id}] ${c.status.toUpperCase()} (${c.severity}) ${c.label}: ${c.detail}${c.evidence.length ? ` [${c.evidence.join(", ")}]` : ""}`),
  ].join("\n");
}
