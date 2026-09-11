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
        rateLimited: /\brateLimit\s*\(/.test(chunk) || /\benforceRateLimit\s*\(/.test(body) || credits,
        floor: write && underFloor(path),
        surface, credits,
        privileged: /\b(requireOwner|requireReviewer|requireAdmin|isAdmin)\b/.test(middleware + body.slice(0, 600)),
        guards,
        metering: analyzeMetering(body),
      });
      if (rows.length >= 400) break;
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
    surfacePrefixes: prefixes,
    unmountedFiles: [...new Set(rows.filter((r) => !r.mounted).map((r) => r.file))].sort(),
  };
}

/** The matrix as prompt text: the summary and the gaps, never four hundred rows. */
export function renderRouteCoverage(c: RouteCoverage | null | undefined, maxList = 25): string | null {
  if (!c || !c.rows.length) return null;
  const s = c.summary;
  const lst = (xs: string[]) => xs.length ? `${xs.slice(0, maxList).join(", ")}${xs.length > maxList ? ` … and ${xs.length - maxList} more` : ""}` : "none";
  return [
    `ROUTE COVERAGE (read from the source; exact): ${s.routes} routes, ${s.writes} writes, ${s.costly} costly.`,
    `- Writes behind auth: ${s.writesWithAuth}/${s.writes}. Unguarded writes: ${lst(c.unguardedWrites)}`,
    `- Writes with their own rate limit or credit metering: ${s.writesRateLimited}/${s.writes}; limited by the global write floor alone: ${s.writesFloorOnly ?? 0}${c.writeFloor?.mounted ? ` (limitWrites, every write under /api except ${c.writeFloor.exempt.join(", ") || "nothing"})` : " (no write floor found)"}. No limit at all: ${lst(c.unlimitedWrites)}`,
    `- Costly routes credit-metered: ${s.costlyMetered}/${s.costly}. Unmetered costly: ${lst(c.unmeteredCost)}`,
    `- Behind a surface kill switch: ${s.surfaceGated}/${s.routes}${c.surfacePrefixes.length ? ` (prefixes: ${c.surfacePrefixes.map((p) => `${p.prefix}→${p.surface}`).join(", ")})` : ""}`,
    c.unmountedFiles.length ? `- Not counted: routes in files nothing imports (dead code, not live endpoints): ${c.unmountedFiles.join(", ")}` : null,
  ].filter(Boolean).join("\n");
}
