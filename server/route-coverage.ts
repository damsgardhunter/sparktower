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
  rateLimited: boolean;
  /** Behind a surface kill switch, by prefix. */
  surface: string | null;
  credits: boolean;
  /** Owner / reviewer / admin only. */
  privileged: boolean;
  /** Middleware names as written, for the reader. */
  guards: string[];
}

export interface RouteCoverage {
  rows: RouteCoverageRow[];
  summary: {
    routes: number; writes: number; costly: number;
    writesWithAuth: number; writesRateLimited: number; costlyMetered: number; surfaceGated: number;
  };
  /** Writes with no auth guard at all. */
  unguardedWrites: string[];
  /** Writes with neither a rate limit nor credit metering. */
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
  for (const f of files) if (/(^|\/)(index|server|app|main|routes)\.(ts|js)$/.test(f.path)) imported.add(strip(f.path));
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
  }
  const seen = new Set<string>();
  return out.filter((x) => { const k = `${x.prefix}|${x.surface}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function buildRouteCoverage(files: RepoFile[]): RouteCoverage {
  const prefixes = detectSurfacePrefixes(files);
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
      // The registration's text runs to the next registration in the file:
      // the middleware list, then the handler body.
      const start = m.index! + m[0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index! : Math.min(src.length, start + 12000);
      const chunk = src.slice(start, end);
      // Middleware list: everything before the handler's parameter list.
      const handlerAt = chunk.search(/(async\s*)?\(\s*(req|_req|request)\b/);
      const middleware = handlerAt >= 0 ? chunk.slice(0, handlerAt) : chunk.slice(0, 400);
      const body = handlerAt >= 0 ? chunk.slice(handlerAt) : chunk;
      const guards = [...middleware.matchAll(/\b([A-Za-z_]\w*)\s*(?:\(([^()]*)\))?/g)]
        .map((g) => (g[2] != null ? `${g[1]}(${g[2].trim()})` : g[1]))
        .filter((g) => /auth|limit|surface|owner|admin|reviewer|feature|premium|upload|verify|require|ensure|guard/i.test(g));
      const surface = prefixes.find((p) => path === p.prefix || path.startsWith(p.prefix.endsWith("/") ? p.prefix : p.prefix + "/") || path.startsWith(p.prefix + "?"))?.surface ?? null;
      const write = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
      const credits = /\brequireCredits\s*\(|\bdeductCredits\s*\(/.test(body);
      const cost = credits || /\b(openai|anthropic)\s*\.|completions\.create\(|\bgetOpenAI\(\)/.test(body);
      rows.push({
        method, path, file: file.path, mounted, write, cost,
        auth: /\b(isAuthenticated|requireAuth|withAuth|authMiddleware|ensureLoggedIn|requireUser|attachBearerUser)\b/.test(middleware) || /\brequireOwner\b|\brequireReviewer\b|\brequireAdmin\b/.test(middleware),
        rateLimited: /\brateLimit\s*\(/.test(middleware) || /\benforceRateLimit\s*\(/.test(body) || credits,
        surface, credits,
        privileged: /\b(requireOwner|requireReviewer|requireAdmin|isAdmin)\b/.test(middleware + body.slice(0, 600)),
        guards,
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
    },
    unguardedWrites: writes.filter((r) => !r.auth).map(label),
    unlimitedWrites: writes.filter((r) => !r.rateLimited).map(label),
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
    `- Writes rate-limited or credit-metered: ${s.writesRateLimited}/${s.writes}. Unlimited writes: ${lst(c.unlimitedWrites)}`,
    `- Costly routes credit-metered: ${s.costlyMetered}/${s.costly}. Unmetered costly: ${lst(c.unmeteredCost)}`,
    `- Behind a surface kill switch: ${s.surfaceGated}/${s.routes}${c.surfacePrefixes.length ? ` (prefixes: ${c.surfacePrefixes.map((p) => `${p.prefix}→${p.surface}`).join(", ")})` : ""}`,
    c.unmountedFiles.length ? `- Not counted: routes in files nothing imports (dead code, not live endpoints): ${c.unmountedFiles.join(", ")}` : null,
  ].filter(Boolean).join("\n");
}
