/**
 * When you last looked at a builder or a project — the "since" in "3 new posts
 * since you last looked".
 *
 * Only what you interacted with: opening their page, following, connecting,
 * messaging. Everything merely scrolled past would turn every return into a
 * wall of badges, which is the named risk of this feature. Kept in the
 * browser, capped to the most recent few dozen, and never sent anywhere except
 * as the short list of ids and times the updates check needs.
 */
const KEY = "st_seen_v1";
const MAX = 30;

export type SeenKind = "builder" | "project";

function read(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function markSeen(kind: SeenKind, id: string) {
  try {
    const all = read();
    all[`${kind}.${id}`] = Date.now();
    const recent = Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(recent)));
  } catch { /* storage refused: nothing is remembered, nothing breaks */ }
}

export function isSeen(kind: SeenKind, id: string): boolean {
  return Number.isFinite(read()[`${kind}.${id}`]);
}

/** The most recently seen, as `kind.id.ms` tokens for `/api/discover/updates`. */
export function seenTokens(limit = 8): string[] {
  return Object.entries(read())
    .filter(([key, at]) => /^(builder|project)\.[A-Za-z0-9_-]{1,64}$/.test(key) && Number.isFinite(at))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, at]) => `${key}.${Math.floor(at)}`);
}
