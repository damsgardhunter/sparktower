/**
 * Featured tools in the feed, for the phone — the app's half of
 * shared/promotions.ts and client/src/hooks/use-feed-promotions.ts.
 *
 * The server decides which companies may be shown (GET /api/promotions);
 * where each one goes in the feed is decided here, per visit, exactly as the
 * website decides it — same seeded draw, same gaps, same memory of what was
 * shown last time — so a promotion sold against "the feed" reaches phones the
 * way it reaches browsers. The app builds from its own tsconfig and doesn't
 * import @shared, so the rules are restated; test/unit/mobile-promotions.test.ts
 * runs both copies and fails when they disagree. Nothing here touches the
 * network or the device, so that test can import it without an Expo runtime.
 */

/** A promotion as the feed shows it — the server's shape (shared FeedPromotion). */
export interface FeedPromotion {
  id: string;
  name: string;
  category: string;
  /** The company's own site. */
  url: string;
  tagline: string;
  headline: string | null;
  videoUrl: string | null;
  referralUrl: string | null;
  logoUrl: string | null;
  /** The perk, only when there's a referral link to claim it through. */
  offer: string | null;
}

export const PROMOTION_CATEGORIES: { id: string; label: string }[] = [
  { id: "ai_coding", label: "AI coding & app builders" },
  { id: "models", label: "Models & APIs" },
  { id: "hosting", label: "Hosting & infrastructure" },
  { id: "backend", label: "Backend & database" },
  { id: "auth_payments", label: "Auth, payments & email" },
  { id: "design", label: "Design & product" },
  { id: "analytics", label: "Analytics & feedback" },
  { id: "workflow", label: "Workflow & collaboration" },
  { id: "no_code", label: "No-code & automation" },
  { id: "launch", label: "Launch & distribution" },
  { id: "misc", label: "Domains & security" },
];

export const promotionCategoryLabel = (id: string) => PROMOTION_CATEGORIES.find((c) => c.id === id)?.label ?? id;

/** The categories that matter most to each goal: weighted up when choosing what to show. */
export const GOAL_AFFINITY: Record<string, string[]> = {
  ship_mvp: ["ai_coding", "models", "hosting", "backend", "auth_payments", "design", "launch"],
  systemize_business: ["workflow", "no_code", "analytics", "auth_payments", "misc"],
  run_company: ["workflow", "analytics", "no_code", "misc"],
};

// ─── Video links ─────────────────────────────────────────────────────────────

/**
 * A video link an admin pasted, as much of it as a phone can use.
 *
 * The app has no video player — nothing in package.json plays one — so a
 * promotion's video is a poster with a play badge that opens the video in the
 * browser, rather than an embed the web can inline. What matters is that the
 * same links are recognised as videos on both sides.
 */
export type PromoVideo =
  | { kind: "youtube"; id: string; posterUrl: string; watchUrl: string }
  | { kind: "vimeo"; id: string; posterUrl: null; watchUrl: string }
  | { kind: "file"; id: null; posterUrl: null; watchUrl: string };

export function parsePromoVideo(raw: string | null | undefined): PromoVideo | null {
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\.|^m\./, "");
  const yt = (id: string | null | undefined): PromoVideo | null => id && /^[A-Za-z0-9_-]{11}$/.test(id)
    ? { kind: "youtube", id, posterUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, watchUrl: `https://www.youtube.com/watch?v=${id}` }
    : null;
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") return yt(url.searchParams.get("v"));
    const m = /^\/(?:embed|shorts|live)\/([^/?#]+)/.exec(url.pathname);
    return yt(m?.[1]);
  }
  if (host === "youtu.be") return yt(url.pathname.slice(1).split("/")[0]);
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = /(\d{6,12})/.exec(url.pathname)?.[1];
    return id ? { kind: "vimeo", id, posterUrl: null, watchUrl: `https://vimeo.com/${id}` } : null;
  }
  if (/\.(mp4|webm)$/i.test(url.pathname)) return { kind: "file", id: null, posterUrl: null, watchUrl: url.toString() };
  return null;
}

// ─── Placement ───────────────────────────────────────────────────────────────

/** A small seeded random number generator (mulberry32): the same seed, the same feed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PROMO_FIRST_SLOT_CHANCE = 0.8;
/** Posts between promotions, at least and at most. */
export const PROMO_GAP = { min: 4, max: 6 } as const;
/** How many shown promotions a device remembers, to rotate past them. */
export const PROMO_SEEN_MEMORY = 24;

export interface PromotionPlacement<T extends { id: string; category: string }> {
  /** Where each promotion goes: before the post at this index (postCount means after the last). */
  slots: { beforeIndex: number; promotion: T }[];
}

/**
 * Where promotions go in a feed of `postCount` posts, and which. Usually one
 * at the very top (otherwise after the first post), then one every 4–6 posts.
 * Chosen by a weighted draw — the viewer's goals count double — skipping what
 * they've seen recently until nothing unseen is left, and never two from the
 * same category back to back.
 */
export function planFeedPromotions<T extends { id: string; category: string }>(opts: {
  promotions: T[];
  postCount: number;
  seed: number;
  goals?: string[];
  recentlySeen?: string[];
  hidden?: string[];
}): PromotionPlacement<T> {
  const rand = seededRandom(opts.seed);
  const hidden = new Set(opts.hidden ?? []);
  const pool = opts.promotions.filter((p) => !hidden.has(p.id));
  if (!pool.length || opts.postCount < 1) return { slots: [] };

  const favoured = new Set<string>((opts.goals ?? []).flatMap((g) => GOAL_AFFINITY[g] ?? []));
  const seen = new Set(opts.recentlySeen ?? []);
  // Weighted shuffle (Efraimidis–Spirakis): higher weight, earlier on average.
  const order = (items: T[]) => items
    .map((p) => ({ p, key: Math.pow(rand(), 1 / (favoured.has(p.category) ? 2 : 1)) }))
    .sort((a, b) => b.key - a.key)
    .map((x) => x.p);
  const queue = [...order(pool.filter((p) => !seen.has(p.id))), ...order(pool.filter((p) => seen.has(p.id)))];

  const positions: number[] = [];
  let at = rand() < PROMO_FIRST_SLOT_CHANCE ? 0 : 1;
  while (at <= opts.postCount) {
    positions.push(at);
    at += PROMO_GAP.min + Math.floor(rand() * (PROMO_GAP.max - PROMO_GAP.min + 1));
  }

  const slots: PromotionPlacement<T>["slots"] = [];
  let lastCategory: string | null = null;
  for (const beforeIndex of positions) {
    if (!queue.length) break;
    // The first in the queue from a different category than the last shown; any, if none is.
    const i = queue.findIndex((p) => p.category !== lastCategory);
    const [promotion] = queue.splice(i >= 0 ? i : 0, 1);
    slots.push({ beforeIndex, promotion });
    lastCategory = promotion.category;
  }
  return { slots };
}

/** The remembered list after showing `shown`: newest first, deduplicated, capped. */
export function rememberSeen(previous: string[], shown: string[]): string[] {
  return [...new Set([...shown, ...previous])].slice(0, PROMO_SEEN_MEMORY);
}

/** How many hidden promotions a device remembers. */
export const PROMO_HIDDEN_MEMORY = 200;

/** Where the seen and hidden lists live on the device — the web's localStorage keys. */
export const PROMO_STORAGE = { seen: "st_promos_seen", hidden: "st_promos_hidden" } as const;

/** A stored list, or an empty one: a forgotten list only means a promotion is shown again. */
export function parsePromoIds(raw: string | null): string[] {
  try {
    const value = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// ─── Events ──────────────────────────────────────────────────────────────────

/** What the app reports about featured tools: seen, visited, video played — the web's names. */
export const PROMO_EVENTS = {
  impression: "promo.impression",
  click: "promo.click",
  videoPlay: "promo.video_play",
} as const;

export type PromoEvent = (typeof PROMO_EVENTS)[keyof typeof PROMO_EVENTS];
