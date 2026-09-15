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

/**
 * An Expo Router app's screens, as routes, each with the API paths its file
 * calls (string literals passed to api()/fetch(); template parts shown as :param).
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
  const calls = (content = "") => {
    const found = new Set<string>();
    for (const m of content.matchAll(/(?:api\s*(?:<[^>]*>)?|fetch)\s*\(\s*[`"']([^`"']+)[`"']/g)) {
      // A leading host variable (`${API_URL}/api/…`) isn't part of the path.
      const path = m[1].replace(/^\$\{[^}]*\}(?=\/api\/)/, "").replace(/\$\{[^}]*\}/g, ":param");
      if (path.startsWith("/api/")) found.add(path.split("?")[0]);
    }
    return [...found].sort();
  };
  const lines = screens.sort((a, b) => a.path.localeCompare(b.path)).slice(0, SCREEN_INVENTORY_MAX).map((f) => {
    const c = calls(f.content);
    return `${route(f.path)}  [${f.path}]${c.length ? `  calls: ${c.join(", ")}` : ""}`;
  });
  return `MOBILE SCREENS (${screens.length}, every route file in mobile/app; calls read off each file)\n${lines.join("\n")}${screens.length > SCREEN_INVENTORY_MAX ? `\n… ${screens.length - SCREEN_INVENTORY_MAX} more` : ""}`;
}
