/**
 * When you last looked at a builder or a project — the "since" in "3 new posts
 * since you last looked".
 *
 * Only what you interacted with: opening their page, following, connecting,
 * messaging. Everything merely scrolled past would turn every return into a
 * wall of badges, which is the named risk of this feature.
 *
 * The server keeps it (`/api/discover/seen`), so it's the same on every device
 * and the Discover badge works anywhere; follows, connections and messages are
 * remembered by their own endpoints. This browser keeps a copy too, which is
 * what a page reads on first render and what's handed over once to the server
 * from before it remembered anything.
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

const send = (body: unknown) => {
  try {
    void fetch("/api/discover/seen", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", keepalive: true,
      body: JSON.stringify(body),
    }).catch(() => { /* best-effort */ });
  } catch { /* never surfaces */ }
};

export function markSeen(kind: SeenKind, id: string) {
  try {
    const all = read();
    all[`${kind}.${id}`] = Date.now();
    const recent = Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(recent)));
  } catch { /* storage refused: the server still remembers */ }
  send({ kind, id });
}

const IMPORTED_KEY = "st_seen_imported_v1";

/** Hands what this browser remembered before the server did over to it, once. */
export function importSeenOnce() {
  try {
    if (localStorage.getItem(IMPORTED_KEY)) return;
    localStorage.setItem(IMPORTED_KEY, "1");
    const items = Object.entries(read())
      .map(([key, at]) => { const [k, ...rest] = key.split("."); return { kind: k, id: rest.join("."), at }; })
      .filter((x) => (x.kind === "builder" || x.kind === "project") && x.id && Number.isFinite(x.at));
    if (items.length) send({ items });
  } catch { /* storage refused: nothing to hand over */ }
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
