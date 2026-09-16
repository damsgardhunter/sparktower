/**
 * What a close read of one area can see besides the files whose full text
 * fits in the prompt: the repository's test inventory, by path.
 *
 * A read handed ten files will truthfully report "no other test file is in
 * the files provided" about a repository with a hundred. Paths are cheap, so
 * every test file's path goes in — grouped by folder, and filtered to the
 * ones named for the area when the area isn't testing itself.
 */
export { isTest } from "./code-digest";
import { isTest } from "./code-digest";

/** Most test paths one read lists before summarising the rest by folder. */
export const TEST_INVENTORY_MAX_PATHS = 400;

export function summarizeTestInventory(paths: string[], onlyMatching: RegExp | null): string | null {
  // Tests, not the harness around them: setup, helpers and fixtures live under test/ too.
  const tests = paths.filter(isTest)
    .filter((p) => !/(^|\/)(node_modules|dist|build|coverage|test-results|playwright-report)\//.test(p))
    .filter((p) => !/(^|\/)(setup|helpers|fixtures|__fixtures__|__mocks__)\//.test(p));
  const relevant = onlyMatching ? tests.filter((p) => onlyMatching.test(p.split("/").pop() ?? p)) : tests;
  if (!relevant.length) return onlyMatching ? null : "TEST FILES (0)\nThere are no test files in the repository.";
  const byFolder = new Map<string, string[]>();
  for (const p of relevant.sort()) {
    const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "(root)";
    byFolder.set(dir, [...(byFolder.get(dir) ?? []), p.slice(p.lastIndexOf("/") + 1)]);
  }
  let listed = 0;
  const lines: string[] = [];
  for (const [dir, names] of [...byFolder.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (listed >= TEST_INVENTORY_MAX_PATHS) { lines.push(`${dir}/ (${names.length} more files)`); continue; }
    const shown = names.slice(0, TEST_INVENTORY_MAX_PATHS - listed);
    listed += shown.length;
    lines.push(`${dir}/ (${names.length}): ${shown.join(", ")}${shown.length < names.length ? `, … ${names.length - shown.length} more` : ""}`);
  }
  const heading = onlyMatching
    ? `TEST FILES NAMED FOR THIS AREA (${relevant.length} of ${tests.length} in the repository)`
    : `TEST FILES (${relevant.length}, every one in the repository)`;
  return `${heading}\n${lines.join("\n")}`;
}

/** Most screens one read lists with their calls. */
export const SCREEN_INVENTORY_MAX = 200;
/** How far into a screen's own imports to follow its data calls: the component it renders, and that component's parts. */
const IMPORT_DEPTH = 3;
/** Shared plumbing (the API client, the auth context): its endpoints belong to every screen, so listing them per screen says nothing. */
const INFRASTRUCTURE = /\/(api|auth)\/[^/]+$/;
/** Calls listed per screen through its components before the line is trimmed. */
const VIA_MAX = 12;

/**
 * An Expo Router app's screens, as routes, each with the API paths it calls
 * (string literals passed to api()/fetch(); template parts shown as :param).
 *
 * Calls are followed through the local modules a screen imports, because most
 * screens are a few lines that render a component — `app/(tabs)/profile.tsx`
 * renders `src/components/ProfileView`, which is what fetches. Reading the
 * route file alone made a third of the app look like it had no data, and
 * "its data dependencies can't be evidenced" is a conclusion about the
 * evidence, not the app. A screen with genuinely none is marked as such.
 *
 * Paths come from the file tree, so a screen whose full text isn't in the
 * read still exists in it — "no Notifications screen file is present" can't
 * be the answer when app/(tabs)/notifications.tsx is right there.
 */
export function summarizeMobileScreens(files: { path: string; content?: string }[]): string | null {
  const screens = files.filter((f) => /^mobile\/app\/.+\.[jt]sx?$/.test(f.path) && !/(^|\/)_layout\.|\+not-found|\.test\./.test(f.path));
  if (!screens.length) return null;
  const route = (p: string) => {
    const r = p.replace(/^mobile\/app/, "").replace(/\.[jt]sx?$/, "").replace(/\/index$/, "").replace(/\/\([^)]+\)/g, "") || "/";
    return r.startsWith("/") ? r : `/${r}`;
  };
  const callsIn = (content = "") => {
    const found = new Set<string>();
    // Backticks separately from quotes: a template can hold quotes of its own (`/x/${ok ? "a" : "b"}`).
    const literals = [
      ...[...content.matchAll(/(?:api\s*(?:<[^>]*>)?|fetch)\s*\(\s*`([^`]*)`/g)].map((m) => m[1]),
      ...[...content.matchAll(/(?:api\s*(?:<[^>]*>)?|fetch)\s*\(\s*["']([^"']+)["']/g)].map((m) => m[1]),
    ];
    for (const literal of literals) {
      // A leading host variable (`${API_URL}/api/…`) isn't part of the path.
      const path = literal.replace(/^\$\{[^}]*\}(?=\/api\/)/, "").replace(/\$\{[^}]*\}/g, ":param");
      if (path.startsWith("/api/")) found.add(path.split("?")[0]);
    }
    return found;
  };

  const byPath = new Map(files.filter((f) => f.content).map((f) => [f.path, f.content!]));
  /** A relative import as a repository path: `../../src/components/ProfileView` → `mobile/src/components/ProfileView.tsx`. */
  const resolve = (from: string, spec: string): string | null => {
    if (!spec.startsWith(".")) return null;
    const parts = from.split("/").slice(0, -1);
    for (const piece of spec.split("/")) {
      if (piece === "." || piece === "") continue;
      if (piece === "..") parts.pop();
      else parts.push(piece);
    }
    const base = parts.join("/");
    for (const candidate of [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
      if (byPath.has(candidate)) return candidate;
    }
    return null;
  };
  /** Every API path a screen reaches, through the components and hooks it pulls in. */
  const reachableCalls = (file: { path: string; content?: string }) => {
    const found = new Set<string>();
    const seen = new Set<string>([file.path]);
    const queue: { path: string; depth: number }[] = [{ path: file.path, depth: 0 }];
    while (queue.length) {
      const here = queue.shift()!;
      const content = here.path === file.path ? file.content ?? "" : byPath.get(here.path) ?? "";
      for (const c of callsIn(content)) found.add(c);
      if (here.depth >= IMPORT_DEPTH) continue;
      for (const m of content.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
        const target = resolve(here.path, m[1]);
        // The session layer counts when a screen imports it itself — the sign-in screen's whole job — and the session
        // layer may reach its own transport. It doesn't count from components deep in a screen, where the auth
        // endpoints would attach to every screen in the app.
        if (target && INFRASTRUCTURE.test(target) && here.depth > 0 && !INFRASTRUCTURE.test(here.path)) continue;
        if (target && !seen.has(target)) { seen.add(target); queue.push({ path: target, depth: here.depth + 1 }); }
      }
    }
    return [...found].sort();
  };

  const lines = screens.sort((a, b) => a.path.localeCompare(b.path)).slice(0, SCREEN_INVENTORY_MAX).map((f) => {
    const direct = callsIn(f.content);
    const all = reachableCalls(f);
    const viaOnly = all.filter((c) => !direct.has(c));
    const parts = [
      direct.size ? `calls: ${[...direct].sort().join(", ")}` : null,
      viaOnly.length ? `via components: ${viaOnly.slice(0, VIA_MAX).join(", ")}${viaOnly.length > VIA_MAX ? ` +${viaOnly.length - VIA_MAX} more` : ""}` : null,
    ].filter(Boolean);
    return `${route(f.path)}  [${f.path}]${parts.length ? `  ${parts.join("; ")}` : "  no API calls (navigation or static screen)"}`;
  });
  return `MOBILE SCREENS (${screens.length}, every route file in mobile/app; calls read off each screen and the local modules it imports, ${IMPORT_DEPTH} deep)\n${lines.join("\n")}${screens.length > SCREEN_INVENTORY_MAX ? `\n… ${screens.length - SCREEN_INVENTORY_MAX} more` : ""}`;
}

/**
 * The server's own sign-in surface, for reading the mobile app against.
 *
 * The app's auth is only comparable to the web's if both ends are in the same
 * read: otherwise "equivalent to web" is a claim from a comment, and the honest
 * verdict is that it can't be checked. These are the routes as mounted.
 */
export function summarizeAuthEndpoints(rows: { method: string; path: string; file: string; auth: boolean; mounted?: boolean }[]): string | null {
  const pick = rows.filter((r) => r.mounted !== false && /\/(auth|login|logout|register|session|token|mfa|oauth|callback)\b/i.test(r.path));
  if (!pick.length) return null;
  const line = (r: typeof pick[number]) => `${r.method} ${r.path}  guarded:${r.auth ? "y" : "n"}  [${r.file}]`;
  return `AUTH ENDPOINTS THE APP AND THE WEB SHARE (${pick.length}; read off the source, exact — web session routes and mobile token routes together)\n${pick.map(line).join("\n")}`;
}

/**
 * Where moderated content is kept out of reads.
 *
 * The last step of the chain — report, queue, action, *enforcement*, undo —
 * lives in whichever query builders filter hidden rows and suspended accounts,
 * usually a storage file far too large to fit in a read. Without this the
 * honest verdict is "referenced in docs, not verifiable here", which says
 * nothing about whether hidden comments actually disappear.
 */
export function summarizeEnforcementFilters(files: { path: string; content?: string }[]): string | null {
  const pattern = /\b(hiddenAt|hidden_at|hiddenMode|suspendedAt|suspended_at|shadowHidden|isHidden)\b/;
  const rows: { path: string; hits: number; sample: string }[] = [];
  for (const f of files) {
    if (!f.content || /^(client|mobile)\//.test(f.path) || !/\.(ts|js)$/.test(f.path) || isTest(f.path)) continue;
    const lines = f.content.split("\n");
    const matched = lines.filter((l) => pattern.test(l));
    // Filtering, not just carrying the column: a query that mentions it in a where/select/join.
    const filtering = matched.filter((l) => /\b(where|and|or|isNull|isNotNull|filter|eq|ne|sql`)/i.test(l));
    if (filtering.length) rows.push({ path: f.path, hits: filtering.length, sample: filtering[0].trim().slice(0, 140) });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => b.hits - a.hits || a.path.localeCompare(b.path));
  const lines = rows.slice(0, ENFORCEMENT_MAX).map((r) => `${r.path}  (${r.hits} line${r.hits === 1 ? "" : "s"})  e.g. ${r.sample}`);
  return `HIDDEN-CONTENT ENFORCEMENT IN READS (${rows.length} file${rows.length === 1 ? "" : "s"} filter on hidden or suspended, read off the source)\n${lines.join("\n")}${rows.length > ENFORCEMENT_MAX ? `\n… ${rows.length - ENFORCEMENT_MAX} more` : ""}`;
}
/** Path segments too common to identify a route on their own. */
const COMMON_SEGMENTS = new Set(["api", "projects", "project", "me", "admin", "auth", "v1"]);

/** Files listed before the enforcement summary is trimmed. */
const ENFORCEMENT_MAX = 15;

/**
 * Which API paths no test so much as mentions.
 *
 * "Are the important paths tested?" is answerable from the repository — every
 * route is known, and so is every test — but only if someone does the crossing.
 * Without it a read of the testing area counts test files and says coverage
 * "cannot be enumerated", which tells a builder nothing about where the holes
 * are. A mention is a weak signal on its own (a test may name a route and
 * assert nothing), but its absence is a strong one: a route no test names is
 * certainly untested.
 *
 * Grouped by path — a test that names a path has named it, whichever method it
 * used — and writes and privileged paths lead: an untested GET is a bug someone
 * sees, an untested write is a bug that changes data.
 */
export function summarizeUntestedRoutes(
  files: { path: string; content?: string }[],
  rows: { method: string; path: string; file: string; write?: boolean; privileged?: boolean; mounted?: boolean }[],
  max = 40,
): string | null {
  const live = rows.filter((r) => r.mounted !== false && r.path.startsWith("/api/"));
  if (!live.length) return null;
  const tests = files.filter((f) => isTest(f.path) && f.content).map((f) => f.content!);
  if (!tests.length) return null;

  /*
   * Some tests drive routes they never name: a sweep that reads the route scan
   * and calls every admin path proves more about those paths than any literal
   * string, and mentions nothing. Such a test says so with a line of its own —
   *
   *   // covers-routes: ^/api/admin/
   *
   * — and the paths it matches count as covered, credited to that file. The
   * declaration is only as good as the test making it, which is the same trust
   * a mention asks for.
   */
  const sweeps: { pattern: RegExp; file: string }[] = [];
  for (const f of files) {
    if (!isTest(f.path) || !f.content) continue;
    for (const m of f.content.matchAll(/\/\/\s*covers-routes:\s*(\S+)/g)) {
      try { sweeps.push({ pattern: new RegExp(m[1]), file: f.path }); } catch { /* an unusable pattern covers nothing */ }
    }
  }
  const sweptBy = (path: string) => sweeps.find((s) => s.pattern.test(path))?.file ?? null;

  /*
   * Two ways a test can name a route, and both count.
   *
   * Written out, with its parameters filled in: `/api/projects/${id}/invites`.
   * Or built from parts — a table of resources looped over, `/api/projects/${id}/${seg}/${item.id}` —
   * where the path never appears whole. The second is still a test of that
   * route, and calling it untested is a claim about this check rather than the
   * suite, so a file that carries all of a path's own words counts too.
   */
  const mentions = (path: string): "named" | "in parts" | "no" => {
    const segments = path.split("/").filter((s) => s && !s.startsWith(":"));
    const pattern = path.split("/").map((seg) => (seg.startsWith(":") ? "[^/`\'\"]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/");
    const whole = new RegExp(pattern);
    // The distinctive words of the path: "api" and "projects" say nothing on their own.
    const distinctive = segments.filter((s) => !COMMON_SEGMENTS.has(s));
    const eachWord = distinctive.length
      ? distinctive.map((s) => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}\\b`))
      : null;
    if (tests.some((content) => whole.test(content))) return "named";
    // Every word of the path in one test file, but never the path itself: a table-driven test building
    // it from variables. Likely covered — not provably, so it's reported apart from the untested.
    if (eachWord && tests.some((content) => eachWord.every((re) => re.test(content)))) return "in parts";
    return "no";
  };

  // By path, not by method: a test that names `/api/feed` has named it, and claiming its POST
  // is untested because the test used GET would be a finding about this check, not the code.
  const paths = new Map<string, { methods: Set<string>; file: string; write: boolean; privileged: boolean }>();
  for (const r of live) {
    const at = paths.get(r.path) ?? { methods: new Set<string>(), file: r.file, write: false, privileged: false };
    at.methods.add(r.method);
    at.write ||= !!r.write;
    at.privileged ||= !!r.privileged;
    paths.set(r.path, at);
  }
  const untested = [...paths.entries()].filter(([path]) => mentions(path) === "no" && !sweptBy(path));
  const inParts = [...paths.entries()].filter(([path]) => mentions(path) === "in parts" && !sweptBy(path));
  const swept = [...paths.keys()].filter((path) => mentions(path) !== "named" && sweptBy(path));
  const rank = ([, at]: typeof untested[number]) => (at.privileged ? 0 : at.write ? 1 : 2);
  untested.sort((a, b) => rank(a) - rank(b) || a[0].localeCompare(b[0]));
  const writes = untested.filter(([, at]) => at.write).length;
  const sweepNote = swept.length
    ? ` ${swept.length} more are driven by a sweep that names no paths (${[...new Set(sweeps.map((s) => s.file))].join(", ")}) and are not counted as untested.`
    : "";
  const head = `PATHS NO TEST MENTIONS (${untested.length} of ${paths.size}; ${writes} of them write. A mention isn't a test, but a path no test names is untested.${sweepNote})`;
  const line = ([path, at]: typeof untested[number]) => `${[...at.methods].sort().join(", ")} ${path}${at.privileged ? "  privileged" : at.write ? "  write" : ""}  [${at.file}]`;
  const clip = (list: typeof untested) => `${list.slice(0, max).map(line).join("\n")}${list.length > max ? `\n… ${list.length - max} more` : ""}`;
  const first = untested.length ? `${head}\n${clip(untested)}` : `${head}\n(every path is named by at least one test)`;
  const second = inParts.length
    ? `\n\nPATHS NAMED ONLY IN PARTS (${inParts.length}; a test file carries every word of the path but never the path itself — usually a table-driven test building it from variables. Check before calling these untested.)\n${clip(inParts.sort((a, b) => rank(a) - rank(b) || a[0].localeCompare(b[0])))}`
    : "";
  return first + second;
}
