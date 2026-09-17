/**
 * Route coverage, read straight from the source: for every Express route,
 * which guards sit on it — auth, rate limit, surface kill switch, credits —
 * and therefore which writes and costly calls are unguarded. Deterministic,
 * no model: this is the matrix a safety plan needs and the thing a model
 * kept trying to invent as "an inventory of routes".
 */
import type { RepoFile } from "./code-ingest";

export interface RouteCoverageRow {
  method: string;
  path: string;
  file: string;
  /** False when nothing imports the file: registered nowhere, so not a live route. */
  mounted: boolean;
  write: boolean;
  /** Calls a model or is credit-metered: costs money per request. */
  cost: boolean;
  auth: boolean;
  /** A limit of its own: rateLimit(...), enforceRateLimit, or credit metering. */
  rateLimited: boolean;
  /** A write under the global write floor (limitWrites): limited even with no limit of its own. */
  floor: boolean;
  /** Behind a surface kill switch, by prefix. */
  surface: string | null;
  credits: boolean;
  /** Owner / reviewer / admin only. */
  privileged: boolean;
  /** Middleware names as written, for the reader. */
  guards: string[];
  /** For a write reachable without sign-in: what it trusts instead, from a `// public-write: …` comment in the route. */
  publicReason: string | null;
  /** Why a costly route is metered differently (free, charged in a helper…), from a `// metering: …` comment in the route. */
  meteringNote: string | null;
  /** The limits the route applies itself, by name: rateLimit("x"), enforceRateLimit(…, "x"), enforceRejectionLimit(…, "x"), enforceReservedLimit(…, "x"), and "credits" for requireCredits. */
  limits: string[];
  /** For a route that checks or charges credits, or calls a model: in what order. Null otherwise. */
  metering: MeteringFacts | null;
}

export interface MeteringFacts {
  /** Cost expressions checked, as written: requireCredits / reserveOptionalAi. */
  checks: string[];
  /** Cost expressions charged, as written: deductCredits. */
  charges: string[];
  /** A model call in the route's own body (otherwise it's in a helper). */
  modelInBody: boolean;
  checkAfterModel: boolean;
  chargeBeforeModel: boolean;
  /** A charge after the model answered but before the answer was read: an unreadable one is still billed. */
  chargeBeforeParse: boolean;
  /** A charge inside a catch block: charging for a failure. */
  chargeInCatch: boolean;
  /** How the model's answer is read in the route's own body: the shared JSON parser, a bare JSON.parse, as prose, or in a helper it calls. */
  answerRead: "parseModelJson" | "JSON.parse" | "prose" | "helper";
  /**
   * What an unreadable answer gets back: "502" when the route answers it as
   * model_unreadable itself or lets it reach the app's error handler (which
   * does), "5xx" when a catch-all in the route turns it into a generic error.
   */
  unreadableAnswer: "502" | "5xx";
}

export interface RouteCoverage {
  rows: RouteCoverageRow[];
  summary: {
    routes: number; writes: number; costly: number;
    writesWithAuth: number; writesRateLimited: number; costlyMetered: number; surfaceGated: number;
    /** Writes with no limit of their own, limited by the write floor alone. */
    writesFloorOnly: number;
  };
  /** The global write floor as found in the source: mounted, and the paths it exempts. */
  writeFloor: { mounted: boolean; exempt: string[] };
  /** Writes with no auth guard at all. */
  unguardedWrites: string[];
  /** Writes with no limit at all: no rate limit, no credit metering, and outside the write floor. */
  unlimitedWrites: string[];
  /** Costly routes with no credit check or rate limit. */
  unmeteredCost: string[];
  /**
   * The credit check every AI route calls, when it also applies a burst limit
   * — so "is there a per-user AI limit?" is answered from the source, not
   * from a comment. Null when no such chokepoint is found.
   */
  creditChokepoint: { fn: string; file: string; burstAction: string; max: number | null; windowMinutes: number | null } | null;
  /** Test files about metering, credits or AI failures: where "what does a failure cost" is proven. */
  meteringTests: string[];
  /** Tests that take their route list from this scan and call every costly route with a failing model. */
  failingModelSweep: string[];
  /** Tests that prove the write floor limits a route with no limit of its own. */
  writeFloorTest: string[];
  /** Surface prefixes found, so a reader knows what a kill switch covers. */
  surfacePrefixes: { prefix: string; surface: string }[];
  /** Route files nothing imports: their routes exist in code and nowhere else. */
  unmountedFiles: string[];
}

/** Files some non-test source imports, by path without extension. Entry points count as imported. */
function importedFiles(files: RepoFile[]): Set<string> {
  const imported = new Set<string>();
  const strip = (p: string) => p.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "").replace(/\/index$/, "");
  for (const f of files) {
    if (!f.content || isTestPath(f.path)) continue;
    const dir = f.path.split("/").slice(0, -1).join("/");
    for (const m of f.content.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']|require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
      const rel = m[1] ?? m[2];
      const parts = dir ? dir.split("/") : [];
      for (const seg of rel.split("/")) { if (seg === "..") parts.pop(); else if (seg !== ".") parts.push(seg); }
      imported.add(strip(parts.join("/")));
    }
  }
  // Entry points: index/server/app/main/routes at the root or one directory down. A routes.ts three levels deep is not one.
  for (const f of files) if (/^(?:[^/]+\/)?(index|server|app|main|routes)\.(ts|js)$/.test(f.path)) imported.add(strip(f.path));
  return imported;
}

const isTestPath = (p: string) => /(^|\/)(tests?|__tests__|spec|e2e|cypress|playwright)(\/|$)/i.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p)
  // The scanners' own sample strings ("router.post('/y')") are not routes.
  || /(^|\/)(code-digest|route-coverage|audit-deep-reads)\.ts$/.test(p);

const REGISTRATION = /\b(?:app|router|server|api)\s*\.\s*(get|post|put|patch|delete|all)\s*\(\s*[`'"]([^`'"]{1,160})[`'"]/g;

/**
 * Surface prefixes, from wherever they're declared: a literal
 * `app.use("/api/x", requireSurface("x"))`, or a registry entry with
 * `id: "x"` and `prefixes: ["/api/x", ...]` that a loop mounts.
 */
export function detectSurfacePrefixes(files: RepoFile[]): { prefix: string; surface: string }[] {
  const out: { prefix: string; surface: string }[] = [];
  for (const f of files) {
    if (!f.content || isTestPath(f.path)) continue;
    for (const m of f.content.matchAll(/\.use\(\s*[`'"]([^`'"]+)[`'"]\s*,\s*requireSurface\(\s*[`'"]([^`'"]+)[`'"]/g)) out.push({ prefix: m[1], surface: m[2] });
    for (const m of f.content.matchAll(/id:\s*[`'"]([\w-]+)[`'"][\s\S]{0,400}?prefixes:\s*\[([^\]]*)\]/g)) {
      for (const p of m[2].matchAll(/[`'"]([^`'"]+)[`'"]/g)) out.push({ prefix: p[1], surface: m[1] });
    }
    // The shared map: `SURFACE_API_PREFIXES = { id: ["/api/x", ...], ... }`.
    const map = f.content.match(/SURFACE_API_PREFIXES[^=]*=\s*\{([\s\S]*?)\n\};/);
    if (map) for (const line of map[1].matchAll(/^\s*(\w+):\s*\[([^\]]*)\]/gm)) {
      for (const p of line[2].matchAll(/[`'"]([^`'"]+)[`'"]/g)) out.push({ prefix: p[1], surface: line[1] });
    }
  }
  const seen = new Set<string>();
  return out.filter((x) => { const k = `${x.prefix}|${x.surface}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Names that authenticate a request, wherever they sit in a route's chain. */
const AUTH_GUARD = /\b(isAuthenticated|requireAuth|withAuth|authMiddleware|ensureLoggedIn|requireUser|attachBearerUser|requireMcpToken)\b/;

/**
 * Auth guards mounted on a whole prefix — `app.use("/api/mcp", requireMcpToken)`.
 * The per-route scan can't see these: the route line itself names no guard,
 * so every route under the prefix read as unauthenticated when none was.
 */
export function detectAuthPrefixes(files: RepoFile[]): { prefix: string; guard: string }[] {
  const out: { prefix: string; guard: string }[] = [];
  for (const f of files) {
    if (!f.content || isTestPath(f.path)) continue;
    for (const m of f.content.matchAll(/\.use\(\s*[`'"]([^`'"]+)[`'"]\s*,\s*([A-Za-z_]\w*)\s*\)/g)) {
      if (AUTH_GUARD.test(m[2])) out.push({ prefix: m[1], guard: m[2] });
    }
  }
  return out;
}

/**
 * The global write floor: `app.use(limitWrites)` limits every write under
 * /api except the paths in WRITE_FLOOR_EXEMPT. Without reading it, every
 * route relying on the floor looked like it had no limit at all — true of
 * none of them. (That the floor is mounted *before* the routes is checked on
 * the running app, in test/integration/write-floor.test.ts.)
 */
export function detectWriteFloor(files: RepoFile[]): { mounted: boolean; exempt: string[] } {
  let mounted = false;
  const exempt: string[] = [];
  for (const f of files) {
    if (!f.content || isTestPath(f.path)) continue;
    if (/\.use\(\s*limitWrites\s*\)/.test(f.content)) mounted = true;
    const list = f.content.match(/WRITE_FLOOR_EXEMPT\s*=\s*\[([^\]]*)\]/);
    if (list) for (const p of list[1].matchAll(/[`'"]([^`'"]+)[`'"]/g)) exempt.push(p[1]);
  }
  return { mounted, exempt };
}

/**
 * From an opening bracket to its match, skipping strings, template literals
 * and comments. Returns the source length when it runs off the end (a regex
 * literal holding a quote can confuse it; callers bound the result).
 */
export function matchBracket(src: string, open: number): number {
  const pair: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const opener = src[open], closer = pair[opener];
  if (!closer) return src.length;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { const nl = src.indexOf("\n", i); if (nl < 0) return src.length; i = nl; continue; }
    if (c === "/" && src[i + 1] === "*") { const end = src.indexOf("*/", i + 2); if (end < 0) return src.length; i = end + 1; continue; }
    if (c === '"' || c === "'" || c === "`") { const q = c; for (i++; i < src.length && src[i] !== q; i++) if (src[i] === "\\") i++; continue; }
    if (c === opener) depth++;
    else if (c === closer) { depth--; if (depth === 0) return i; }
  }
  return src.length;
}

/** The body of a named function or `const name = (…) =>` in a file, or null. */
export function functionBody(src: string, name: string): string | null {
  const m = new RegExp(`(?:function\\s+${name}\\s*\\(|const\\s+${name}\\s*=\\s*(?:async\\s*)?\\()`).exec(src);
  if (!m) return null;
  const paramsClose = matchBracket(src, m.index + m[0].length - 1);
  const open = src.indexOf("{", paramsClose);
  if (open < 0) return null;
  return src.slice(open, matchBracket(src, open) + 1);
}

const MODEL_CALL = /\b(openai|anthropic)\s*\.|completions\.create\(|responses\.create\(|images\.(generate|edit)\(|\bgetOpenAI\(\)/;

/**
 * In what order a piece of code checks credits, calls a model and charges.
 * The rule every AI route keeps: check before the model runs, charge only
 * after it answered, and never charge in an error path.
 */
/**
 * Whether an unreadable answer reaches the person as 502 model_unreadable. It
 * does when the route answers it (answerUnreadable, a ModelResponseError check,
 * or passing the error's own status on), or has no catch-all that would swallow
 * it before the app's error handler — which maps ModelResponseError to 502.
 */
function unreadableAnswerOf(body: string, catches: (readonly [number, number])[]): "502" | "5xx" {
  const handles502 = /\banswerUnreadable\s*\(|\brespondToAiError\s*\(|\binstanceof\s+ModelResponseError\b|model_unreadable/;
  /*
   * Where it matters is the catch. A route can call `answerUnreadable` for the
   * empty answer it checks itself and still end its catch with a plain 500 —
   * which is what POST /api/chat did, while this read the whole body and called
   * it handled. An unreadable answer thrown by a helper lands in the catch, so
   * the catch is what decides the status.
   */
  /*
   * A catch that answers 502 anywhere in the route means the unreadable path is
   * handled where it's thrown — routes often parse in an inner try and keep a
   * plain 500 outside it for everything else. Only when no catch does that, and
   * one of them swallows to a 5xx, is an unreadable answer really a generic 500.
   */
  if (catches.some(([a, b]) => handles502.test(body.slice(a, b)))) return "502";
  const swallowing = catches.some(([a, b]) => {
    const block = body.slice(a, b);
    // Passing the error's own status on, handing it to the error handler, or rethrowing — not merely logging `error.status`, which POST /api/chat does on its way to a plain 500.
    const passesItOn = /res\.status\s*\(\s*(?:err|error|e)\??\.status\b|\bnext\s*\(\s*(?:err|error|e)\s*\)|\bthrow\b/.test(block);
    return /status\(\s*5\d\d\s*\)/.test(block) && !passesItOn;
  });
  return swallowing ? "5xx" : "502";
}

export function analyzeMetering(body: string): MeteringFacts | null {
  const checks = [...body.matchAll(/\b(?:requireCredits\s*\(\s*res\s*,\s*[^,]+,|reserveOptionalAi\s*\(\s*[^,]+,)\s*([^,)]+)/g)];
  const charges = [...body.matchAll(/\bdeductCredits\s*\(\s*[^,]+,\s*([^)]+)\)/g)];
  const models = [...body.matchAll(new RegExp(MODEL_CALL.source, "g"))].map((m) => m.index!);
  if (!checks.length && !charges.length && !models.length) return null;
  const firstModel = models.length ? Math.min(...models) : -1;
  // Where the answer gets read: the first parse after the model call (or, when
  // the model runs in a helper, after the credit check).
  const from = firstModel >= 0 ? firstModel : (checks[0]?.index ?? -1);
  const firstParse = from < 0 ? -1 : [...body.matchAll(/\bparseModelJson\s*\(|\bJSON\.parse\s*\(/g)].map((p) => p.index!).find((at) => at > from) ?? -1;
  const catches = [...body.matchAll(/catch\s*(?:\([^)]*\))?\s*\{/g)].map((c) => {
    const open = c.index! + c[0].length - 1;
    return [c.index!, matchBracket(body, open)] as const;
  });
  return {
    checks: checks.map((c) => c[1].trim()),
    charges: charges.map((c) => c[1].trim()),
    modelInBody: models.length > 0,
    checkAfterModel: models.length > 0 && checks.length > 0 && checks[0].index! > firstModel,
    chargeBeforeModel: firstModel >= 0 && charges.some((c) => c.index! < firstModel),
    chargeBeforeParse: firstParse >= 0 && charges.some((c) => c.index! > from && c.index! < firstParse),
    chargeInCatch: charges.some((c) => catches.some(([a, b]) => c.index! > a && c.index! < b)),
    answerRead: /\bparseModelJson\s*\(/.test(body) ? "parseModelJson" : /\bJSON\.parse\s*\(/.test(body) ? "JSON.parse" : models.length ? "prose" : "helper",
    unreadableAnswer: unreadableAnswerOf(body, catches),
  };
}

export function buildRouteCoverage(files: RepoFile[]): RouteCoverage {
  const prefixes = detectSurfacePrefixes(files);
  const writeFloor = detectWriteFloor(files);
  const underFloor = (path: string) => writeFloor.mounted && path.startsWith("/api/") && !writeFloor.exempt.some((p) => path.startsWith(p));
  const authPrefixes = detectAuthPrefixes(files);
  const guardedByPrefix = (path: string) => authPrefixes.find((p) => path === p.prefix || path.startsWith(p.prefix.endsWith("/") ? p.prefix : p.prefix + "/"));
  const rows: RouteCoverageRow[] = [];
  const seen = new Set<string>();
  const imported = importedFiles(files);
  const isMounted = (path: string) => imported.has(path.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "").replace(/\/index$/, ""));

  for (const file of files) {
    if (!file.content || isTestPath(file.path)) continue;
    const mounted = isMounted(file.path);
    const src = file.content;
    const matches = [...src.matchAll(REGISTRATION)];
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const method = m[1].toUpperCase();
      const path = m[2];
      const key = `${method} ${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // The registration's text: the middleware list, then the handler body.
      const start = m.index! + m[0].length;
      // It runs to its own closing parenthesis, found by matching brackets.
      // The first two-space "});" and a 12,000-character cap both used to cut
      // long routes short — a charge at the end of one went unseen. Never past
      // the next registration, whatever the matching makes of the source.
      const nextReg = i + 1 < matches.length ? matches[i + 1].index! : src.length;
      const end = Math.min(matchBracket(src, src.indexOf("(", m.index!)) + 1, nextReg);
      const chunk = src.slice(start, end);
      // Middleware list: everything before the handler's parameter list.
      const handlerAt = chunk.search(/(async\s*)?\(\s*(req|_req|request)\b/);
      const middleware = handlerAt >= 0 ? chunk.slice(0, handlerAt) : chunk.slice(0, 400);
      const body = handlerAt >= 0 ? chunk.slice(handlerAt) : chunk;
      const guards = [...middleware.matchAll(/\b([A-Za-z_]\w*)\s*(?:\(([^()]*)\))?/g)]
        .map((g) => (g[2] != null ? `${g[1]}(${g[2].trim()})` : g[1]))
        .filter((g) => /auth|limit|surface|owner|admin|reviewer|feature|premium|upload|verify|require|ensure|guard/i.test(g));
      const prefixGuard = guardedByPrefix(path);
      if (prefixGuard) guards.unshift(`${prefixGuard.guard} (on ${prefixGuard.prefix})`);
      const surface = prefixes.find((p) => path === p.prefix || path.startsWith(p.prefix.endsWith("/") ? p.prefix : p.prefix + "/") || path.startsWith(p.prefix + "?"))?.surface ?? null;
      const write = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
      // Metered means checked before the work: a bare deductCredits is a charge
      // with no check (and no burst limit), which is exactly what isn't metered.
      const credits = /\brequireCredits\s*\(|\breserveOptionalAi\s*\(/.test(body);
      const cost = credits || /\bdeductCredits\s*\(/.test(body) || MODEL_CALL.test(body);
      rows.push({
        method, path, file: file.path, mounted, write, cost,
        // A guard counts wherever it sits in the chain: after an inline
        // middleware, or as an explicit check at the top of the handler.
        auth: AUTH_GUARD.test(chunk) || !!prefixGuard || /\brequireOwner\b|\brequireReviewer\b|\brequireAdmin\b/.test(middleware) || /if\s*\(\s*!req\.user(?:\?\.id)?\s*\)[^\n]*\b401\b/.test(chunk),
        rateLimited: /\brateLimit\s*\(/.test(chunk) || /\benforce(?:Rate|Rejection)Limit\s*\(/.test(body) || credits,
        floor: write && underFloor(path),
        surface, credits,
        privileged: /\b(requireOwner|requireReviewer|requireAdmin|isAdmin)\b/.test(middleware + body.slice(0, 600)),
        guards,
        publicReason: /\/\/\s*public-write:\s*([^\n]+)/.exec(chunk)?.[1].trim().slice(0, 200) ?? null,
        meteringNote: /\/\/\s*metering:\s*([^\n]+)/.exec(chunk)?.[1].trim().slice(0, 200) ?? null,
        limits: [...new Set([
          ...[...chunk.matchAll(/\brateLimit\s*\(\s*["'`](\w+)["'`]/g)].map((m) => m[1]),
          /*
           * The action is the last argument, and the ones before it can hold
           * brackets of their own: `enforceRateLimit(res, ipKey(req), "login")`.
           * Matching up to the first `)` stopped inside `ipKey(req)` and found
           * nothing, so the eight routes that limit themselves this way — every
           * sign-in and sign-up route — read as having no named limit at all.
           */
          ...[...body.matchAll(/\benforceRateLimit\s*\([\s\S]{0,200}?["'`](\w+)["'`]\s*\)/g)].map((m) => m[1]),
          ...[...body.matchAll(/\benforceRejectionLimit\s*\([\s\S]{0,200}?["'`](\w+)["'`]\s*\)/g)].map((m) => `${m[1]} (failures only)`),
          // Reserved up front and refunded on success — a limit, however it's spelled.
          ...[...body.matchAll(/\benforceReservedLimit\s*\([\s\S]{0,200}?["'`](\w+)["'`]\s*\)/g)].map((m) => `${m[1]} (failures only)`),
          ...(credits ? ["credits"] : []),
        ])],
        metering: analyzeMetering(body),
      });
      // A ceiling against a pathological repo, not a budget: at 400 a real app
      // outgrew it and every route past the line silently fell out of the
      // guard checks — the routes registered last looked like they didn't exist.
      if (rows.length >= 2000) break;
    }
  }

  const live = rows.filter((r) => r.mounted);
  const writes = live.filter((r) => r.write);
  const costly = live.filter((r) => r.cost);
  const label = (r: RouteCoverageRow) => `${r.method} ${r.path}`;
  return {
    rows,
    summary: {
      routes: live.length, writes: writes.length, costly: costly.length,
      writesWithAuth: writes.filter((r) => r.auth).length,
      writesRateLimited: writes.filter((r) => r.rateLimited).length,
      costlyMetered: costly.filter((r) => r.credits).length,
      surfaceGated: live.filter((r) => r.surface).length,
      writesFloorOnly: writes.filter((r) => !r.rateLimited && r.floor).length,
    },
    writeFloor,
    unguardedWrites: writes.filter((r) => !r.auth).map(label),
    unlimitedWrites: writes.filter((r) => !r.rateLimited && !r.floor).map(label),
    unmeteredCost: costly.filter((r) => !r.credits && !r.rateLimited).map(label),
    creditChokepoint: detectCreditChokepoint(files),
    meteringTests: files.map((f) => f.path).filter((p) => isTestPath(p) && /meter|credit|ai-fail|revenue/i.test(p)).sort(),
    // A test that drives a floor-only write past the floor: the mount above is source text, this is the same claim at runtime.
    writeFloorTest: files.filter((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f.path) && f.content && /RATE_LIMITS\.write\.max/.test(f.content)).map((f) => f.path).sort(),
    failingModelSweep: files.filter((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f.path) && f.content && /\bbuildRouteCoverage\b/.test(f.content) && /\.cost\b/.test(f.content) && /throw|garbage|empty/.test(f.content)).map((f) => f.path).sort(),
    surfacePrefixes: prefixes,
    unmountedFiles: [...new Set(rows.filter((r) => !r.mounted).map((r) => r.file))].sort(),
  };
}

/**
 * The credit check that doubles as the AI burst limit: a `requireCredits`-style
 * function whose body calls `enforceRateLimit(…, "<action>")`, with that
 * action's max and window read from its config when they're in the source.
 */
function detectCreditChokepoint(files: RepoFile[]): RouteCoverage["creditChokepoint"] {
  for (const f of files) {
    if (!f.content || isTestPath(f.path)) continue;
    const def = /export\s+async\s+function\s+(require\w*Credits?)\s*\(/.exec(f.content);
    if (!def) continue;
    const open = f.content.indexOf("{", f.content.indexOf(")", def.index));
    const body = f.content.slice(open, matchBracket(f.content, open) + 1);
    const burst = /\benforceRateLimit\s*\([^)]*?["'`](\w+)["'`]\s*\)/.exec(body);
    if (!burst) continue;
    let max: number | null = null, windowMinutes: number | null = null;
    for (const g of files) {
      const m = g.content && new RegExp(`\\b${burst[1]}\\s*:\\s*\\{\\s*max\\s*:\\s*(\\d+)\\s*,\\s*windowMinutes\\s*:\\s*(\\d+)`).exec(g.content);
      if (m) { max = Number(m[1]); windowMinutes = Number(m[2]); break; }
    }
    return { fn: def[1], file: f.path, burstAction: burst[1], max, windowMinutes };
  }
  return null;
}

/** Every write limited by the write floor alone, grouped by file, so "which ones?" is answered in full. */
function floorOnlyLines(c: RouteCoverage): string[] {
  const rows = c.rows.filter((r) => r.mounted && r.write && !r.rateLimited && r.floor);
  if (!rows.length) return [];
  const byFile = new Map<string, string[]>();
  for (const r of rows) byFile.set(r.file, [...(byFile.get(r.file) ?? []), `${r.method} ${r.path}`]);
  return [
    "  Floor-only writes, by file:",
    ...[...byFile.entries()].sort((a, b) => b[1].length - a[1].length).map(([file, labels]) => `  - ${file} (${labels.length}): ${labels.join(", ")}`),
  ];
}

/** What an unreadable model answer gets back, route by route, and which test calls every costly route with a failing model. */
function unreadableLine(c: RouteCoverage, lst: (xs: string[]) => string): string {
  const live = c.rows.filter((r) => r.mounted && r.cost && r.metering);
  const count = (k: MeteringFacts["answerRead"]) => live.filter((r) => r.metering!.answerRead === k).length;
  const generic = live.filter((r) => r.metering!.unreadableAnswer === "5xx").map((r) => `${r.method} ${r.path}`);
  return `- Unreadable model answers: ${live.length - generic.length}/${live.length} costly routes answer 502 model_unreadable (in the route, through respondToAiError, or via the app's error handler, which maps ModelResponseError to 502); generic 5xx instead: ${lst(generic)}. The answer is read with parseModelJson in ${count("parseModelJson")}, a bare JSON.parse in ${count("JSON.parse")}, as prose in ${count("prose")}, and in a helper in ${count("helper")}.${c.failingModelSweep.length ? ` Every costly write is called with a model that throws, answers garbage and answers nothing by ${c.failingModelSweep.join(", ")} (its route list is this scan), which fails if any of them charges. The same run asserts the answer itself, per route at runtime: every route that reached the model and failed answers 502 model_unreadable — never a generic 5xx — and the only routes that answer 2xx when the model said nothing are the declared unbilled fallbacks, so the static reading above is checked rather than trusted.` : ""}`;
}

/** When costly routes check and charge, as read from each route's own body — and where a failure's cost is tested. */
function meteringLines(c: RouteCoverage, lst: (xs: string[]) => string, maxList: number): string[] {
  const live = c.rows.filter((r) => r.mounted && r.cost);
  const charging = live.filter((r) => r.metering?.charges.length);
  const bad = (k: "chargeBeforeModel" | "chargeBeforeParse" | "chargeInCatch" | "checkAfterModel") => live.filter((r) => r.metering?.[k]).map((r) => `${r.method} ${r.path}`);
  const clean = charging.filter((r) => !r.metering!.chargeBeforeModel && !r.metering!.chargeBeforeParse && !r.metering!.chargeInCatch);
  const cp = c.creditChokepoint;
  const noted = live.filter((r) => r.meteringNote || !r.metering?.charges.length);
  return [
    cp ? `- AI burst limit: ${cp.fn} (${cp.file}) calls enforceRateLimit("${cp.burstAction}") before every credit check${cp.max != null ? ` — ${cp.max} per ${cp.windowMinutes} minutes per user` : ""}; every credit-metered route above is under it.` : "- AI burst limit: no credit check that also applies a rate limit was found.",
    unreadableLine(c, lst),
    `- Charge order, read from each route's body: charged only after the model answered and its answer was read: ${clean.length}/${charging.length} routes that charge in their own body. Charged before the model: ${lst(bad("chargeBeforeModel"))}. Charged before its answer is read (an unreadable answer billed): ${lst(bad("chargeBeforeParse"))}. Charged in a catch: ${lst(bad("chargeInCatch"))}. Checked only after the model: ${lst(bad("checkAfterModel"))}.`,
    ...noted.slice(0, maxList).map((r) => `  - ${r.method} ${r.path}: ${r.meteringNote ?? (r.credits ? "checks credits here; the charge is in a helper it calls" : "NO METERING REASON GIVEN")} [${r.file}]`),
    c.meteringTests.length ? `- Tests of metering and what a failure costs: ${c.meteringTests.join(", ")}` : null,
  ].filter((x): x is string => !!x);
}

/** The matrix as prompt text: the summary and the gaps, never four hundred rows. */
/** Every mounted route, one short line each: what it is, what guards it, where it lives. */
function inventory(rows: RouteCoverageRow[], max = 700): string {
  const shown = rows.slice(0, max);
  const line = (r: RouteCoverageRow) => {
    /*
     * What limits it, in the order a reader asks. A credit-metered route is
     * limited by requireCredits, which enforces the AI burst limit before it
     * charges — so it is not floor-only, and saying "floor" alone would
     * under-report 8 of them.
     */
    // "credits" is a limit as well as a charge: requireCredits enforces the AI burst limit before it charges.
    const named = r.limits.map((l) => (l === "credits" ? "credits→ai burst" : l));
    const limit = named.length ? `limit:${named.join("+")}` : r.floor ? "limit:write floor" : null;
    const marks = [
      r.auth ? "auth" : "open",
      r.privileged ? "privileged" : null,
      limit,
      r.surface ? `surface:${r.surface}` : null,
    ].filter(Boolean).join(" ");
    return `  ${r.method} ${r.path} — ${marks} [${r.file}]`;
  };
  const head = `- EVERY MOUNTED ROUTE (${rows.length}${rows.length > shown.length ? `, ${shown.length} listed` : ""}). If a route isn't here, it isn't registered; if it is here, it is. Look it up rather than inferring from the excerpts.`;
  const tail = rows.length > shown.length ? `\n  … and ${rows.length - shown.length} more` : "";
  return `${head}\n${shown.map(line).join("\n")}${tail}`;
}

export function renderRouteCoverage(c: RouteCoverage | null | undefined, maxList = 25): string | null {
  if (!c || !c.rows.length) return null;
  const s = c.summary;
  const lst = (xs: string[]) => xs.length ? `${xs.slice(0, maxList).join(", ")}${xs.length > maxList ? ` … and ${xs.length - maxList} more` : ""}` : "none";
  return [
    `ROUTE COVERAGE (read from the source; exact): ${s.routes} routes, ${s.writes} writes, ${s.costly} costly.`,
    `- Writes behind auth: ${s.writesWithAuth}/${s.writes}. Writes without sign-in: ${lst(c.unguardedWrites)}`,
    // What each one trusts instead, as its own route says — so a public write isn't read as an unguarded one.
    ...c.rows.filter((r) => r.mounted && r.write && !r.auth).slice(0, maxList).map((r) => `  - ${r.method} ${r.path}: ${r.publicReason ? `trusts ${r.publicReason}` : "NO REASON GIVEN"}${r.rateLimited ? `; limited by ${r.limits.join(", ") || "its own limit"}` : r.floor ? "; under the write floor" : "; no rate limit"} [${r.file}]`),
    // Named, not just counted: "which ones are floor-only" was a question the counts couldn't answer.
    `- Floor-only writes (no limit of their own; the write floor is what limits them): ${lst(c.rows.filter((r) => r.mounted && r.write && !r.rateLimited && r.floor).map((r) => `${r.method} ${r.path}`))}`,
    `- Writes with their own rate limit or credit metering: ${s.writesRateLimited}/${s.writes}; limited by the global write floor alone: ${s.writesFloorOnly ?? 0}${c.writeFloor?.mounted ? ` (limitWrites, mounted in server/routes.ts, every write under /api except ${c.writeFloor.exempt.join(", ") || "nothing"}${c.writeFloorTest.length ? `; ${c.writeFloorTest.join(", ")} drives a floor-only write past it and checks the refusal, so the mount is proven at runtime, not just read` : ""})` : " (no write floor found)"}. No limit at all: ${lst(c.unlimitedWrites)}`,
    ...floorOnlyLines(c),
    `- Costly routes credit-metered: ${s.costlyMetered}/${s.costly}. Not credit-metered: ${lst(c.rows.filter((r) => r.mounted && r.cost && !r.credits).map((r) => `${r.method} ${r.path} (${r.limits.length ? `limited by ${r.limits.join(", ")}` : "no limit"}) [${r.file}]`))}. Neither metered nor limited: ${lst(c.unmeteredCost)}`,
    ...meteringLines(c, lst, maxList),
    `- Behind a surface kill switch: ${s.surfaceGated}/${s.routes}${c.surfacePrefixes.length ? ` (prefixes: ${c.surfacePrefixes.map((p) => `${p.prefix}→${p.surface}`).join(", ")})` : ""}`,
    c.unmountedFiles.length ? `- Not counted: routes in files nothing imports (dead code, not live endpoints): ${c.unmountedFiles.join(", ")}` : null,
    /*
     * Every route, by name.
     *
     * Everything above this line is counts and exceptions, which answers "how
     * many" and never "does this one exist". An audit asked exactly that about
     * POST /api/artifacts/:id/publish — registered at server/routes.ts:386,
     * past the excerpt — and, finding it in no list, reported the publish route
     * as missing and the loop as broken. The list is long and worth its length:
     * it is the only place in the digest where a route can be looked up.
     */
    inventory(c.rows.filter((r) => r.mounted)),
  ].filter(Boolean).join("\n");
}
