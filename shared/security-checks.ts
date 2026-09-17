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
export type SecurityCategory = "transport" | "sessions" | "input" | "secrets" | "supply-chain" | "accounts" | "operations" | "privacy";

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
  privacy: "Privacy & data rights",
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

/**
 * The same file with every string literal emptied, so a pattern can ask what
 * the code *does* with a value rather than what a message happens to mention.
 * Without it, `console.warn("set MOBILE_TOKEN_SECRET")` reads as a logged secret.
 */
const withoutStrings = (files: SourceFile[]): SourceFile[] => files.map((f) => ({
  path: f.path,
  content: (f.content ?? "").replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""'),
}));

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
  {
    // Three things a session has to do: change id at sign-in, end at sign-out, and expire on its own.
    const sessions = onServer(/express-session|cookie-session|req\.session\b|flask\.session|django\.contrib\.sessions|iron-session/);
    const rotates = onServer(/session\.regenerate\s*\(|regenerateSession|rotateSession|session\.cycle_key\(|reset_session/);
    const ends = onServer(/session\.destroy\s*\(|req\.logout\s*\(|session\.clear\(|clearCookie\(|session\.pop\(|logout_user\(/);
    const expires = onServer(/maxAge\s*:|expires\s*:|\bttl\s*[:=]|SESSION_COOKIE_AGE|PERMANENT_SESSION_LIFETIME|max_age\s*=/);
    const have = [rotates.length, ends.length, expires.length].filter(Boolean).length;
    add({
      id: "session-lifecycle", label: "Sessions rotate, end and expire", category: "sessions", severity: "medium",
      status: !sessions.length ? "n/a" : have === 3 ? "pass" : have ? "partial" : "missing",
      detail: !sessions.length ? "No server-side sessions." : `New id at sign-in ${rotates.length ? "✓" : "✗"} · ended at sign-out ${ends.length ? "✓" : "✗"} · expires ${expires.length ? "✓" : "✗"}`,
      why: "A session id that survives sign-in lets an attacker who planted it ride the session afterwards (session fixation); one that isn't destroyed at sign-out, or never expires, stays usable from any device it leaked to.",
      fix: "Regenerate the session on successful sign-in, destroy it (and clear the cookie) on sign-out, and give the cookie a maxAge so an abandoned session dies by itself.",
      evidence: [...rotates, ...ends, ...expires].filter((f, i2, all) => all.indexOf(f) === i2).slice(0, 4),
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
    /*
     * Per address is the limit people write first, and it stops one machine
     * guessing. It does nothing about the attack that actually happens: a
     * password list tried across many addresses, a handful of guesses from
     * each. Counting failures per account is what closes that, and the two
     * limits are complementary rather than alternatives.
     */
    const loginRoutes = onServer(/["'`]\/(api\/)?(auth\/)?(login|signin|sign-in|session)["'`]/);
    const byAddress = onServer(/enforceRateLimit\s*\(\s*[^,]+,\s*ipKey\s*\(|rateLimit\s*\(\s*["'`](login|signin|auth)["'`]|keyGenerator[\s\S]{0,60}(ip|address)/i);
    // A limit that keys on who is being signed in to: the email or the account id, not the caller's address.
    /*
     * Only where sign-in happens. Asking the whole server finds the 2FA code's
     * per-account limit and the mobile refresh limiter and calls the password
     * step protected — which is how this check first passed a codebase whose
     * sign-in counts nothing but addresses.
     */
    const signInFiles = server.filter((f) => /["'`]\/(api\/)?(auth\/)?(login|signin|sign-in)["'`]/.test(f.content ?? ""));
    const byAccount = where(signInFiles, /(enforceRateLimit|enforceRejectionLimit|countRejection|withinRateLimit|consume|check)\s*\([^)]{0,80}(accountKey|email|user\.id|userId|account)[^)]{0,60}["'`](login\w*|signin|password|auth)["'`]|["'`]loginAccount["'`]|failedLogins?|loginAttempts?|lockoutUntil|lockedUntil/i);
    add({
      id: "credential-stuffing", label: "Sign-in limited per account, not only per address", category: "accounts", severity: "high",
      status: !loginRoutes.length ? "n/a" : byAccount.length ? "pass" : byAddress.length ? "partial" : "missing",
      detail: !loginRoutes.length ? "No sign-in route found."
        : byAccount.length ? "Failed sign-ins are counted against the account as well as the address."
        : byAddress.length ? "Sign-in is limited per address only: a list of passwords tried from many addresses meets no limit at all."
        : "Nothing counts failed sign-ins.",
      why: "Credential stuffing doesn't come from one address. It comes from thousands, a few guesses each, against accounts whose passwords leaked somewhere else — which a per-address limit never sees.",
      fix: "Count failed sign-ins against the account being attempted (10 per 15 minutes is generous), alongside the per-address limit. Answer the same way whether the account exists or not, so the limit doesn't become an account-enumeration oracle.",
      // The sign-in files first: they're where the fix goes.
      evidence: [...byAccount, ...loginRoutes, ...byAddress].filter((f, i, all) => all.indexOf(f) === i).slice(0, 3),
    });
  }
  {
    const signup = onServer(/["'`]\/(api\/)?(auth\/)?(register|signup|sign-up)["'`]/);
    // A length floor, written as a number: 8 or more passes, 6 doesn't.
    /*
     * Written as a comparison (`password.length < 8`), as a schema minimum, or
     * as a named constant in a policy module — the last is what a codebase
     * looks like once the rule is shared between web and mobile, and reading
     * only the first called such a codebase ruleless.
     */
    const floor = [...(src.map((f) => f.content ?? "").join("\n").matchAll(/password[\w.]*\.length\s*<\s*(\d+)|PASSWORD_MIN(?:IMUM)?(?:_LENGTH)?\s*=\s*(\d+)|min\s*\(\s*(\d+)[^)]*\)[^\n]{0,40}password|password[^\n]{0,40}min\s*\(\s*(\d+)/gi))]
      .map((m) => Number(m[1] ?? m[2] ?? m[3] ?? m[4])).filter((n) => Number.isFinite(n) && n > 0);
    const shortest = floor.length ? Math.min(...floor) : null;
    // A breach API, a strength library, or a blocklist of the passwords guessed first.
    const breachChecked = has(/haveibeenpwned|pwnedpasswords|zxcvbn|common-?passwords?|passwordBlocklist|weakPasswords|\bCOMMON\b\s*=\s*new Set|checkPassword\s*\(/i);
    const managed = has(/@clerk\/|next-auth|@auth0\/|@supabase\/supabase-js|firebase\/auth|@workos-inc\//);
    add({
      id: "password-policy", label: "Passwords long enough to be worth hashing", category: "accounts", severity: "medium",
      status: !signup.length || managed.length ? "n/a"
        : shortest == null ? "missing"
        : shortest >= 8 && breachChecked.length ? "pass"
        : shortest >= 8 ? "partial"
        : "missing",
      detail: !signup.length ? "This codebase doesn't register accounts itself."
        : managed.length ? "A hosted auth provider sets the password rules."
        : shortest == null ? "No minimum length found on sign-up."
        : `Minimum length ${shortest}${breachChecked.length ? ", and common or breached passwords are refused" : ", with no check against common or breached passwords"}.`,
      why: "Six characters is a few seconds of offline guessing once a dump leaks, however well it was hashed — and the most common passwords are guessed first, at any length.",
      fix: "Ask for at least 8 characters and refuse the common ones (a small blocklist, or the k-anonymity range API at api.pwnedpasswords.com, which never sends the password). Don't force composition rules or rotation: they produce worse passwords.",
      evidence: [...signup.slice(0, 2), ...breachChecked.slice(0, 1)],
    });
  }
  {
    const passwords = onServer(/passwordHash|password_hash|bcrypt|argon2/);
    const changeRoute = onServer(/["'`][^"'`]*(change-password|password\/change|update-password|reset-password)["'`]|changePassword|updatePassword/i);
    // Changing it has to end the sessions it was protecting, or the person who knew the old one keeps their seat.
    const revokes = onServer(/(changePassword|updatePassword|resetPassword|password)[\s\S]{0,400}(accessTokensRevokedAt|revokeAll|destroyAllSessions|session\.destroy|deleteFrom\s*\(\s*sessions|DELETE FROM sessions|logoutAll)/i);
    add({
      id: "password-change", label: "Passwords can be changed, and changing one ends the old sessions", category: "accounts", severity: "medium",
      status: !passwords.length ? "n/a" : changeRoute.length && revokes.length ? "pass" : changeRoute.length ? "partial" : "missing",
      detail: !passwords.length ? "No password sign-in."
        : !changeRoute.length ? "No route changes a password, so somebody whose password leaked can't take it back."
        : revokes.length ? "Changing a password signs the other sessions out."
        : "A password can be changed, but the sessions opened with the old one stay signed in.",
      why: "Changing a password is what someone does when they think it's known. If the sessions and tokens issued under it keep working, the change has bought nothing — and there's no route at all, they can only ask you to do it by hand.",
      fix: "Add a change route that asks for the current password, then revoke every session and refresh token for the account (this codebase already has accessTokensRevokedAt and per-account session rows). Offer a reset by emailed single-use link for the password nobody remembers.",
      evidence: [...changeRoute.slice(0, 2), ...revokes.slice(0, 1)],
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
  {
    /*
     * The read side of the same question. A GET by id that never asks who is
     * asking hands any signed-in (or signed-out) caller someone else's record —
     * the most common real-world leak, and invisible in the UI because nothing
     * links to it.
     */
    const readsById = onServer(/\b(app|router)\.get\(\s*["'][^"']*:(\w*[iI]d|\w*[sS]lug|token)\b/);
    const scopedReadRe = /\b(app|router)\.get\(\s*["'][^"']*:[\s\S]{0,600}?(isProjectMember|projectTeam|requireOwner|requireAdmin|requireReviewer|canRead|canView|assertCan|authorize\(|\.can\(|(userId|ownerId|authorId|createdBy)\s*(,|!==|===|!=|==)\s*(userId|req\.user|\(req\.user)|forUser\(|scopedTo|\bwhere\b[^;]{0,120}(userId|ownerId|authorId))/g;
    const scopedReads = server.reduce((n, f) => n + ((f.content ?? "").match(scopedReadRe)?.length ?? 0), 0);
    const publicByDesign = onServer(/public[-\w]*(artifact|profile|page|feed)|isPublic\b|visibility\s*[=:]\s*["']public/i);
    add({
      id: "read-authorization", label: "Ownership checks on reads", category: "accounts", severity: "high",
      status: !readsById.length ? "n/a" : scopedReads >= 2 ? "pass" : scopedReads === 1 ? "partial" : "missing",
      detail: !readsById.length
        ? "No routes read a record by id."
        : scopedReads
          ? `${scopedReads} read${scopedReads === 1 ? "" : "s"} by id check who is asking${publicByDesign.length ? " (some pages are public by design)" : ""}.`
          : "Records are read by id with no owner, member or role check found.",
      why: "A record read by id is readable by anyone who can guess or iterate the id — sequential ids make that trivial, and a leak through a read is as bad as one through a write.",
      fix: "On every route that returns a record by id, load it and confirm the caller may see it (owner, team member, or an explicit public flag) before responding; return 404 otherwise.",
      evidence: readsById.slice(0, 4),
    });
  }
  {
    // Only asked of sign-ups this codebase owns: an OAuth-only or hosted-auth app has its provider do this.
    const localSignup = onServer(/\b(app|router)\.post\(\s*["'][^"']*(register|signup|sign-up|users)["']|def (register|signup)\b/i);
    const hostedAuth = has(/@clerk\/|next-auth|@auth0\/|@supabase\/supabase-js|firebase\/auth|@workos-inc\//);
    // A column that records it, or a flow that sends it — not the word "verification" in a comment, and not an OAuth provider's own email_verified claim.
    const verifies = has(/email_?[vV]erified\w*\s*:\s*(boolean|timestamp|integer|varchar)|boolean\(\s*["']email_verified|email_verified\s+(boolean|timestamp)|verification_?[tT]oken|sendVerificationEmail|["'`][^"'`]*verify-email|confirmation_?[tT]oken|magic[_ -]?link/);
    add({
      id: "email-verification", label: "Email addresses verified", category: "accounts", severity: "medium",
      status: !localSignup.length ? "n/a" : verifies.length || hostedAuth.length ? "pass" : "missing",
      detail: !localSignup.length
        ? "This codebase doesn't register accounts itself."
        : hostedAuth.length && !verifies.length ? "A hosted auth provider handles sign-up and verification."
        : verifies.length ? "Sign-up verifies the address before the account is used."
        : "Anyone can sign up with an address they don't own, and nothing confirms it.",
      why: "Unverified addresses let someone hold an account under your user's email, collect mail meant for them, and turn any 'email a link' feature into spam sent from your domain.",
      fix: "Email a single-use, expiring verification link at sign-up; hold back anything that emails other people (invites, notifications) until the address is confirmed.",
      evidence: [...verifies, ...localSignup].slice(0, 4),
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
    /*
     * Concatenating a table or column name the driver has quoted for you is
     * the one safe way to build SQL from a string: pg's escapeIdentifier
     * exists precisely because identifiers can't be bound as parameters.
     * server/data-shape.ts does this legitimately, and a checker that cries
     * wolf there teaches people to ignore it.
     */
    /*
     * Concatenation inside a query call, read operand by operand.
     *
     * A regex can't express the rule that matters — "every piece being glued
     * on is already safe" — because the answer depends on all of them. The
     * first attempt used a negative lookahead for escapeIdentifier and was
     * worse than nothing: it exempted `"FROM " + escapeIdentifier(t)` and, in
     * doing so, stopped looking, so the `+ userValue` at the end of the same
     * call sailed through.
     *
     * Two operands are safe to concatenate: a quoted literal the developer
     * wrote, and an identifier the driver has quoted (pg's escapeIdentifier /
     * escapeLiteral, which exist because an identifier can't be a bound
     * parameter). Anything else is a value that belongs in a parameter.
     */
    const SAFE_OPERAND = /^(?:"[^"]*"|'[^']*'|`[^`$]*`|(?:\w+\.)?escape(?:Identifier|Literal)\s*\()/;
    const concatsUnsafely = (content: string): boolean => {
      for (const call of content.matchAll(/\.(?:query|execute)\(([\s\S]{0,600}?)\)\s*[;,)]/g)) {
        const args = call[1];
        if (!args.includes("+")) continue;
        if (args.split("+").slice(1).some((operand) => !SAFE_OPERAND.test(operand.trim()))) return true;
      }
      return false;
    };

    const rawSql = Array.from(new Set([
      ...onServer(new RegExp([
        String.raw`sql\.raw\(`,
        String.raw`\$queryRawUnsafe`,
        String.raw`cursor\.execute\(\s*f["']`,
        // Interpolated right at the call.
        String.raw`\.(?:query|execute)\(\s*\`[^\`]*\$\{`,
        String.raw`raw\(\s*\`[^\`]*\$\{`,
        // Built into a variable first, then handed to the driver. The SQL
        // keyword is what separates a query from any other string with a ${}
        // in it; without it this matches half the codebase.
        String.raw`(?:const|let|var)\s+\w+\s*=\s*\`[^\`]*\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b[^\`]*\$\{`,
        String.raw`(?:const|let|var)\s+\w+\s*=\s*(?:"|')[^"']*\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b[\s\S]*?(?:"|')\s*\+\s*(?!(?:\w+\.)?escape(?:Identifier|Literal)\s*\()`,
      ].join("|"))),
      ...server.filter((f) => f.content && concatsUnsafely(f.content)).map((f) => f.path),
    ]));
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
    /*
     * A file path built from a value that isn't a literal. `path.join(root, id)`
     * looks contained and isn't: "../" in the value walks out of the root, and
     * the router hands the value over undecoded. Judged per file — the check
     * that contains it has to be where the path is built, not elsewhere in the
     * repository.
     */
    const buildsPath = /path\.(join|resolve)\s*\(\s*[^,)]+,\s*(?!["'`])[^)]+\)|(sendFile|download|createReadStream|createWriteStream|readFile(Sync)?|writeFile(Sync)?|unlink(Sync)?)\s*\([^)]{0,160}\breq\.(params|query|body|path|url)|open\s*\(\s*os\.path\.join\([^)]*request\./;
    // The value came from the request (here, or through this file's own parameters).
    const fromRequest = /\breq\.(params|query|body|path|url)|\brequest\.(args|GET|path)|\(\s*\w*[pP]ath\s*:\s*string|objectPath|entityId|fileName|filename|\bkey\s*:\s*string/;
    // Contained: resolve then prove it's still under the root, reduce to a basename, or accept only a strict shape.
    const containedRe = /path\.relative\([^)]*\)[\s\S]{0,80}startsWith\(\s*["'`]\.\.|\b(resolved|resolvedPath|fullPath|absolute\w*|abs|candidate|target(Path)?|filePath|localPath|finalPath)\s*\.startsWith\(|path\.basename\s*\(|\/\^\[[^\]]*\]\{?[\d,]*\}?\$\/\.test\(|includes\(\s*["'`]\.\.["'`]\s*\)|realpathSync|is_safe_path|commonpath/;
    const risky = server.filter((f) => {
      const c = f.content ?? "";
      return buildsPath.test(c) && fromRequest.test(c) && !containedRe.test(c);
    }).map((f) => f.path);
    const anyPathFromRequest = server.filter((f) => buildsPath.test(f.content ?? "") && fromRequest.test(f.content ?? "")).map((f) => f.path);
    add({
      id: "path-traversal", label: "File paths can't escape their folder", category: "input", severity: "high",
      status: !anyPathFromRequest.length ? "n/a" : risky.length ? "missing" : "pass",
      detail: !anyPathFromRequest.length
        ? "No file paths are built from request values."
        : risky.length
          ? `A file path is built from a request value with no check that it stays inside its folder, in ${risky.length} file${risky.length === 1 ? "" : "s"}.`
          : "Request-supplied file paths are constrained where they're built.",
      why: "\"../\" in a filename reads or writes files outside the folder you meant — other users' uploads, .env, your keys.",
      fix: "Where the path is built, resolve it and refuse it unless it is still inside the root (path.relative(root, full) must not start with \"..\"), or accept only a strict id shape (^[A-Za-z0-9_-]+$) and build the path yourself.",
      evidence: (risky.length ? risky : anyPathFromRequest).slice(0, 4),
    });
  }
  {
    const runsCommands = onServer(/child_process|from ["']node:child_process["']|\bsubprocess\b|os\.system\(|Runtime\.getRuntime\(\)\.exec/);
    // A shell, or a command line built by hand: both let a user's value become part of the command.
    const unsafe = onServer(/\bexec(Sync)?\s*\(\s*[`"'][^`"']*\$\{|\bexec(Sync)?\s*\([^,)]*\+|shell\s*:\s*true|os\.system\(|subprocess\.(run|call|Popen|check_output)\([^)]*shell\s*=\s*True/);
    add({
      id: "command-injection", label: "No shell commands built from input", category: "input", severity: "high",
      status: !runsCommands.length ? "n/a" : unsafe.length ? "missing" : "pass",
      detail: !runsCommands.length
        ? "The server doesn't run external commands."
        : unsafe.length
          ? "A command is run through a shell or built by string concatenation."
          : "External commands are run with arguments as a list, no shell.",
      why: "One \"; rm -rf\" (or a filename with a backtick in it) in a value that reaches a shell runs as your server user.",
      fix: "Use spawn/execFile with the arguments as an array and no shell, and allow only values you recognise; never build a command string.",
      evidence: [...unsafe, ...runsCommands].slice(0, 4),
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
  {
    /*
     * Logged with the strings emptied out, so this is about values that reach
     * the log — not messages that name a variable ("set MOBILE_TOKEN_SECRET").
     */
    const bare = withoutStrings(server);
    const logged = where(bare, /(console\.(log|info|warn|error|debug)|logger?\.(log|info|warn|error|debug)|print)\s*\([^)]*\b(req\.(body|headers|cookies)|password\w*|passwordHash|\w*[sS]ecret|\w*[tT]oken|apiKey|api_key|authorization|sessionID|creditCard|ssn)\b/);
    add({
      id: "log-leakage", label: "Secrets and personal data stay out of logs", category: "secrets", severity: "medium",
      status: !isServer ? "n/a" : logged.length ? "missing" : "pass",
      detail: logged.length
        ? `Passwords, tokens or whole request bodies are logged in ${logged.length}${logged.length >= 4 ? "+" : ""} file${logged.length === 1 ? "" : "s"}.`
        : "No passwords, tokens or raw request bodies written to logs.",
      why: "Logs are copied, shipped to third parties and kept for months: a token in a log line is a credential in every one of those places, and personal data there outlives the account.",
      fix: "Log an id and an outcome, never the body, headers or a credential; redact known-sensitive fields in one place so new call sites are covered.",
      evidence: logged.slice(0, 4),
    });
  }
  {
    /*
     * Credentials the database holds. A column that stores a password, token or
     * key is only safe if what's in it is a hash (it only ever has to be
     * compared) or sealed (it has to be read back).
     */
    const schema = files.filter((f) => f.content && /(^|\/)(schema|models?)\b|(^|\/)(migrations|prisma)\//.test(f.path) && /\.(ts|js|py|rb|sql|prisma)$/.test(f.path));
    const sensitiveRe = /(password|secret|token|api_?key|access_?key|private_?key|credential)/i;
    // A name that already says what's stored (…Hash, sealed…, …_encrypted), or a column about a credential rather than the credential itself (revokedAt, expiresAt, mfaEnabledAt).
    const safeNameRe = /(hash|hashed|digest|sealed|encrypted|_enc\b|revoked|expires|_at\b|Required|Enabled|Count|Id\b)/i;
    /** The field's own name, so the check can ask whether the code seals *this* column. */
    const fieldOf = (line: string) =>
      /(?:^|[\s{,])([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line)?.[1]
      ?? /\bADD COLUMN\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/i.exec(line)?.[1]
      ?? /^\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s+\w/.exec(line)?.[1]
      ?? "";
    // A SQL column is snake_case where the code that seals it is camelCase.
    const camel = (v: string) => v.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
    const sealedElsewhere = (field: string) => field.length > 2 && [...new Set([field, camel(field)])].some((name) => src.some((f) =>
      new RegExp(`\\b${name}\\b`).test(f.content ?? "") && /\bseal\s*\(|createCipheriv|encrypt\s*\(|pgp_sym_encrypt|bcrypt|argon2|scrypt|createHash\(/.test(f.content ?? "")));
    const raw: string[] = [];
    for (const f of schema) {
      for (const line of (f.content ?? "").split("\n")) {
        // A column definition — a typed column in an ORM schema, a SQL column, or a Prisma field — not a comment, a table declaration or an import.
        if (/^\s*(\/\/|\*|#|--)/.test(line)) continue;
        const isColumn = /:\s*(varchar|text|char|uuid|jsonb|json|integer|bigint|boolean|timestamp|date|numeric|real|bytea|serial)\s*\(/i.test(line)
          || /^\s*"?[a-z0-9_]+"?\s+(varchar|text|char|uuid|jsonb|json|integer|bigint|boolean|timestamp|date|numeric|real|bytea)\b/i.test(line)
          || /\bADD COLUMN\s+"?[a-z0-9_]+"?\s+(varchar|text|char|uuid|jsonb|json|integer|bigint|boolean|timestamp|date|numeric|real|bytea)\b/i.test(line)
          || /^\s*\w+\s+(String|Bytes|Json)\b/.test(line);
        if (!isColumn) continue;
        if (!sensitiveRe.test(line) || safeNameRe.test(line)) continue;
        if (sealedElsewhere(fieldOf(line))) continue;
        raw.push(f.path);
        break;
      }
    }
    const protects = has(/bcrypt|argon2|scrypt|createHash\(\s*["']sha256|pgp_sym_encrypt|createCipheriv|\bseal\s*\(|encrypt\s*\(|KMS|vault/i);
    add({
      id: "secrets-at-rest", label: "Stored credentials hashed or sealed", category: "secrets", severity: "high",
      status: !schema.length ? "n/a" : raw.length && !protects.length ? "missing" : raw.length ? "partial" : "pass",
      detail: !schema.length ? "No schema or model files found."
        : !raw.length ? "Credential columns are stored as hashes or sealed values."
        : protects.length ? `Hashing or encryption exists, but ${raw.length} schema file${raw.length === 1 ? " keeps" : "s keep"} a credential column whose name doesn't say it's hashed or sealed.`
        : "Credential columns are stored with no hashing or encryption anywhere in the codebase.",
      why: "One database dump — a backup, a support export, a leaked read-only replica — hands over every password, token and key it holds in plain text.",
      fix: "Hash what you only compare (passwords with bcrypt/argon2, tokens with SHA-256); seal what you must read back (AES-GCM under a key from the environment); name the column so it says which.",
      evidence: raw.slice(0, 4),
    });
  }
  {
    /*
     * Comparing a secret with === leaks it a character at a time: the compare
     * returns sooner on a wrong first byte than a wrong last one, and that
     * difference is measurable over enough requests.
     */
    const compareRe = /\b(signature|sig|expected|digest|hmac|mac|token|hash|secret|otp|code)\w*\s*(===|!==|==|!=)\s*\w*(signature|sig|expected|digest|hmac|mac|token|hash|secret|otp|code)\w*\b/i;
    const safeCompare = /timingSafeEqual|timing_safe|compare_digest|SecurityUtils\.secure_compare|subtle\.timingSafe|hash_equals|ConstantTime/i;
    const risky = server.filter((f) => compareRe.test(f.content ?? "") && !safeCompare.test(f.content ?? "")).map((f) => f.path);
    const anyCompare = server.filter((f) => compareRe.test(f.content ?? "") || safeCompare.test(f.content ?? "")).map((f) => f.path);
    add({
      id: "timing-safe-compare", label: "Secrets compared in constant time", category: "secrets", severity: "medium",
      status: !anyCompare.length ? "n/a" : risky.length ? "partial" : "pass",
      detail: !anyCompare.length ? "Nothing compares a signature, token or hash."
        : risky.length ? `${risky.length} file${risky.length === 1 ? "" : "s"} compare a signature, token or code with a plain equality check.`
        : "Signatures, tokens and codes are compared in constant time.",
      why: "A plain equality check returns faster the earlier it finds a difference, which lets an attacker who can time your responses guess a signature or a one-time code byte by byte.",
      fix: "Compare secrets with crypto.timingSafeEqual (or your language's constant-time compare) on equal-length buffers; better still, look the value up by its hash so there's nothing to compare.",
      evidence: (risky.length ? risky : anyCompare).slice(0, 4),
    });
  }

  // --- Privacy -------------------------------------------------------------------
  {
    const accounts = onServer(/\busers?\b[\s\S]{0,40}(table|model|schema|collection)|createUser|registerUser|\b(app|router)\.post\(\s*["'][^"']*(register|signup)/i);
    const deletes = onServer(/delete[-_]?account|deleteUser\b|close[-_]?account|["'][^"']*\/account["'][\s\S]{0,80}delete|\bapp\.delete\(\s*["'][^"']*\/(me|account|users?\/:?\w*)["']|erase_user|anonymi[sz]eUser/i);
    const exports_ = onServer(/data[-_]?export|export[-_]?(my[-_]?)?data|downloadMyData|\/account\/export|takeout|gdpr/i);
    const have = [deletes.length, exports_.length].filter(Boolean).length;
    add({
      id: "account-data-rights", label: "Accounts can be deleted and exported", category: "privacy", severity: "medium",
      status: !accounts.length ? "n/a" : have === 2 ? "pass" : have ? "partial" : "missing",
      detail: !accounts.length ? "No user accounts."
        : `Delete my account ${deletes.length ? "✓" : "✗"} · export my data ${exports_.length ? "✓" : "✗"}`,
      why: "People in the UK and EU can demand both, with a month to comply; doing it by hand against production is where mistakes delete the wrong rows. Keeping data for accounts nobody can close also makes every future breach bigger.",
      fix: "Add a route that deletes or anonymises the account and everything keyed to it (sessions, tokens, uploads) after confirming the password or a second factor, and one that returns the account's own data as JSON.",
      evidence: [...deletes, ...exports_].slice(0, 4),
    });
  }

  {
    /*
     * A tag is a moving pointer. Whoever controls the action's repository can
     * move v4 to whatever they like, and it runs in CI with the repository's
     * token — the supply-chain attack that has actually happened, more than
     * once. A commit SHA can't be moved.
     */
    const steps = [...ci.flatMap((f) => [...(f.content ?? "").matchAll(/uses:\s*([^\s#]+)/g)].map((m) => ({ ref: m[1], file: f.path })))];
    const external = steps.filter((s2) => !s2.ref.startsWith(".") && s2.ref.includes("/"));
    const unpinned = external.filter((s2) => !/@[0-9a-f]{40}$/.test(s2.ref));
    add({
      id: "ci-action-pinning", label: "CI actions pinned to a commit", category: "supply-chain", severity: "medium",
      status: !external.length ? "n/a" : unpinned.length ? "missing" : "pass",
      detail: !external.length ? "No third-party actions in CI."
        : unpinned.length ? `${unpinned.length} of ${external.length} third-party action${external.length === 1 ? " is" : "s are"} pinned to a moving tag: ${[...new Set(unpinned.map((u) => u.ref))].slice(0, 4).join(", ")}.`
        : `All ${external.length} third-party actions are pinned to a commit.`,
      why: "A tag can be repointed by whoever owns the action, and CI then runs their new code with your repository token and any secret the job can see.",
      fix: "Pin each third-party action to a full commit SHA with the version in a trailing comment (uses: actions/checkout@<sha> # v4), and let Dependabot raise the updates.",
      evidence: [...new Set(unpinned.map((u) => u.file))].slice(0, 3),
    });
  }
  {
    // A scanner that can't fail the build is a scanner nobody reads.
    const auditStep = where(ci, /npm audit|pnpm audit|yarn (npm )?audit|snyk|osv-scanner|trivy|pip-audit|govulncheck/i);
    const defanged = ci.filter((f) => /(npm|pnpm|yarn) audit[^\n]*(\|\|\s*true|continue-on-error)|continue-on-error:\s*true[\s\S]{0,200}audit/i.test(f.content ?? "")).map((f) => f.path);
    add({
      id: "dependency-audit-blocking", label: "The dependency scan can fail the build", category: "supply-chain", severity: "medium",
      status: !auditStep.length ? "n/a" : defanged.length ? "partial" : "pass",
      detail: !auditStep.length ? "No dependency scan in CI to begin with (see the dependency-audit check)."
        : defanged.length ? "The scan runs but can't fail the build: its result is swallowed." : "A failing scan fails the build.",
      why: "An advisory nobody is forced to read is an advisory nobody reads. `|| true` turns a gate into a log line.",
      fix: "Let the audit step decide the job's fate, with a threshold you can live with (npm audit --audit-level=high). If something must be tolerated, record it as an explicit exception rather than swallowing every result.",
      evidence: [...defanged, ...auditStep].slice(0, 3),
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
    /*
     * Sign-in throttling is its own check; this is everything else. Counted as
     * a share of write routes, because a limiter on one route and none on the
     * other ninety is the usual shape.
     */
    const writeRe = /\b(app|router)\.(post|put|patch|delete)\s*\(/g;
    const limiterRe = /rateLimit\(|rate_limit|limiter|enforceRateLimit|throttle|slowDown|Ratelimit|@limits?\(|RateLimiter/i;
    const limitedWriteRe = /\b(app|router)\.(post|put|patch|delete)\s*\([^;]{0,240}?(rateLimit\(|limiter|enforceRateLimit|throttle|slowDown|Ratelimit|RateLimiter)/g;
    const writes = server.reduce((n, f) => n + ((f.content ?? "").match(writeRe)?.length ?? 0), 0);
    const limited = server.reduce((n, f) => n + ((f.content ?? "").match(limitedWriteRe)?.length ?? 0), 0);
    const global = onServer(/app\.use\(\s*(rateLimit|limiter|slowDown|rateLimiter)/i);
    const anyLimiter = onServer(limiterRe);
    const share = writes ? limited / writes : 0;
    add({
      id: "write-rate-limits", label: "Limits beyond sign-in", category: "operations", severity: "medium",
      status: !writes ? "n/a" : global.length || share >= 0.5 ? "pass" : limited || anyLimiter.length ? "partial" : "missing",
      detail: !writes ? "No write routes." : global.length ? "A limiter is applied to the whole app." : `${limited} of ${writes} write routes carry a limit.`,
      why: "Sign-in isn't the only route worth abusing: posting, inviting, uploading and anything that calls a paid API can be run in a loop to spam your users, fill your storage or spend your budget.",
      fix: "Put a limit on every write, and a tighter one on the expensive routes (email, uploads, AI calls) — keyed by account as well as by address, and stored somewhere every instance shares.",
      evidence: [...global, ...anyLimiter].slice(0, 4),
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
  {
    // Named where a dependency is named, so a CSS class like "overflow-x-auto [scrollbar-width:none]" isn't read as Rollbar.
    const monitoring = has(/from ["'`][^"'`]*(@sentry\/|bugsnag|rollbar|dd-trace|@datadog\/|@opentelemetry\/|logtail|newrelic)|require\(["'`][^"'`]*(bugsnag|rollbar|dd-trace|newrelic)|\bSentry\.init\s*\(|\bbugsnag\.start\s*\(|\bRollbar\s*\(/i);
    /*
     * An SDK is one way and not the only way. A project that turns its errors
     * into structured records and posts them at a configured endpoint has the
     * thing the SDK was for — so this reads the shape as well as the name, and
     * asks for the two properties that make either version worth having: the
     * handler is wired to something that outlives the terminal, and the process
     * itself is watched (an unhandled rejection is the error you most want and
     * least see).
     */
    const homegrown = has(/\breportError\s*\(|\bwatchProcessErrors\s*\(|ERROR_WEBHOOK_URL/);
    const watchesProcess = has(/process\.on\(\s*["'`](unhandledRejection|uncaughtException)/);
    const reported = monitoring.length ? monitoring : homegrown;
    add({
      id: "error-monitoring", label: "Errors are reported somewhere", category: "operations", severity: "low",
      status: !isServer ? "n/a" : reported.length && (monitoring.length || watchesProcess.length) ? "pass" : reported.length ? "partial" : "missing",
      detail: monitoring.length ? "Errors are sent to a monitoring service."
        : homegrown.length && watchesProcess.length ? "Errors become structured records with a drain, and unhandled rejections and uncaught exceptions are reported too."
        : homegrown.length ? "Errors are collected, but nothing reports an unhandled rejection or an uncaught exception."
        : "Nothing collects errors: a 500 is visible only to whoever is reading the logs at the time.",
      why: "The failures that matter are the ones nobody reports — a checkout that 500s for one card type, a job throwing every night. Without collection you hear about them from users, late.",
      fix: "Report errors to something that outlives the terminal — an SDK, or structured records posted to a collector — scrub the body, headers and message before sending, watch unhandledRejection and uncaughtException, and alert on a rate rather than on every event.",
      evidence: [...reported, ...watchesProcess].slice(0, 3),
    });
  }
  {
    /*
     * Process, not code — so this asks for the written commitment, which is
     * the only thing a repository can hold. A check that can't see the DNS or
     * the backup bucket says what it can see, and says which it is.
     */
    const backups = [...paths].filter((p2) => /(^|\/)(docs|ops|runbook)/i.test(p2) && /\.(md|mdx)$/.test(p2))
      .filter((p2) => /backup|restore|disaster/i.test(files.find((f) => f.path === p2)?.content ?? ""));
    /*
     * The difference between writing down that backups exist and knowing they
     * work is a date: a row in a restore log saying somebody did it. A document
     * with an empty log (the row that says "no restore has been rehearsed yet")
     * has no date on it, so it reads as partial, which is what it is.
     */
    const rehearsed = backups.filter((p2) => {
      const lines = (files.find((f) => f.path === p2)?.content ?? "").split("\n");
      return lines.some((line) => /^\s*\|/.test(line) && /\b20\d\d-\d\d-\d\d\b/.test(line));
    });
    add({
      id: "backups", label: "Backups, and a restore someone has actually done", category: "operations", severity: "medium",
      status: rehearsed.length ? "pass" : backups.length ? "partial" : "missing",
      detail: rehearsed.length ? "Backups are written down and a restore has been rehearsed and dated."
        : backups.length ? "Backups and restoring are written down, and no rehearsed restore is recorded — the log is still empty."
        : "Nothing in the repository mentions backups or restoring.",
      why: "The backup you have never restored is a belief, not a backup — and the morning you need it is the worst time to find out which.",
      fix: "Write down what is backed up, how often, and where; then restore it into a scratch database and record the date you did. Repeat after any schema change big enough to worry you.",
      // The document with the log first: it's the one to open.
      evidence: [...rehearsed, ...backups.filter((p2) => !rehearsed.includes(p2))].slice(0, 2),
    });
  }
  {
    const sendsEmail = has(/@sendgrid\/|resend|nodemailer|postmark|mailgun|ses\.send|sendEmail\s*\(/i);
    // This file names every pattern it looks for, so it would otherwise be its own evidence.
    const authenticated = files
      .filter((f) => !NOT_APP_CODE.test(f.path) && /\b(spf|dkim|dmarc)\b/i.test(f.content ?? ""))
      .map((f) => f.path);
    /*
     * The records live in DNS, so writing them down is all a repository can
     * normally show — which is why this check used to stop at "partial" and
     * say so. But a *checked* result can be written down too: a dated row in
     * an evidence table, from a script that asked the real DNS. When one
     * exists, read it, and believe what it says in both directions. A row
     * recording that nothing is published is worth more than the document
     * that describes what ought to be.
     */
    const rows = authenticated.flatMap((p2) =>
      (files.find((f) => f.path === p2)?.content ?? "").split("\n")
        .filter((line) => /^\s*\|/.test(line) && /\b20\d\d-\d\d-\d\d\b/.test(line)));
    const checkedMissing = rows.some((line) => /\bMISSING\b/i.test(line));
    const checkedPublished = rows.some((line) => /\bp=(none|quarantine|reject)\b/i.test(line) && !/\bMISSING\b/i.test(line));
    add({
      id: "email-authentication", label: "The sending domain is authenticated (SPF, DKIM, DMARC)", category: "operations", severity: "medium",
      status: !sendsEmail.length ? "n/a" : checkedPublished ? "pass" : checkedMissing ? "missing" : authenticated.length ? "partial" : "missing",
      detail: !sendsEmail.length ? "This codebase doesn't send email."
        : checkedPublished ? "SPF, DKIM and DMARC were checked against DNS and are published; the dated result is in the repository."
        : checkedMissing ? "Somebody checked DNS and recorded the result: the records are NOT published. Mail from this domain is unauthenticated."
        : authenticated.length ? "SPF/DKIM/DMARC are written down; whether they're published in DNS hasn't been checked and recorded."
        : "The app sends email and nothing records SPF, DKIM or DMARC for the sending domain.",
      why: "Unauthenticated mail lands in spam — including the verification and invite links people are waiting for — and leaves the domain open to anyone sending as you.",
      fix: "Publish SPF and DKIM for the sending domain, then DMARC at p=none until the reports are clean and p=quarantine after. Then check them against DNS and record the dated result: node scripts/check-email-auth.mjs, pasted into docs/ops/email-authentication.md.",
      evidence: authenticated.slice(0, 2),
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
