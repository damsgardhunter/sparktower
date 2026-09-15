/** Featured tools: where they go in the feed, which ones, how they rotate, and what an admin may set. */
import { describe, it, expect } from "vitest";
import {
  PROMOTION_CATALOG, PROMOTION_CATEGORIES, GOAL_AFFINITY, PROMO_GAP, planFeedPromotions, rememberSeen, PROMO_SEEN_MEMORY,
  parsePromoVideo, validatePromotionSettings, sanitizePromoProps,
} from "@shared/promotions";

const plan = (seed: number, extra: Partial<Parameters<typeof planFeedPromotions>[0]> = {}) =>
  planFeedPromotions({ promotions: PROMOTION_CATALOG, postCount: 20, seed, ...extra });

describe("the catalog", () => {
  it("has every company once, a real category, and an https site", () => {
    const ids = PROMOTION_CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(99);
    for (const p of PROMOTION_CATALOG) {
      expect(PROMOTION_CATEGORIES.some((c) => c.id === p.category), p.id).toBe(true);
      expect(new URL(p.url).protocol).toBe("https:");
      expect(p.tagline.length).toBeLessThanOrEqual(120);
    }
    expect(PROMOTION_CATALOG.find((p) => p.id === "replit")?.perk).toBe("$10 in credits");
  });
});

describe("placing promotions in the feed", () => {
  it("usually leads with one, then spaces them 4–6 posts apart, never two of a category in a row", () => {
    let leads = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { slots } = plan(seed);
      expect(slots[0].beforeIndex).toBeLessThanOrEqual(1);
      if (slots[0].beforeIndex === 0) leads++;
      for (let i = 1; i < slots.length; i++) {
        const gap = slots[i].beforeIndex - slots[i - 1].beforeIndex;
        expect(gap).toBeGreaterThanOrEqual(PROMO_GAP.min);
        expect(gap).toBeLessThanOrEqual(PROMO_GAP.max);
        expect(slots[i].promotion.category).not.toBe(slots[i - 1].promotion.category);
      }
      expect(new Set(slots.map((s) => s.promotion.id)).size).toBe(slots.length);
    }
    expect(leads / 200).toBeGreaterThan(0.65);
  });

  it("changes with the seed — a new visit, a new set — and holds still for one", () => {
    expect(plan(42)).toEqual(plan(42));
    const firsts = new Set(Array.from({ length: 30 }, (_, i) => plan(i + 1).slots[0].promotion.id));
    expect(firsts.size).toBeGreaterThan(15);
  });

  it("skips what was seen recently, and what was hidden, until nothing else is left", () => {
    // One unseen company per category; everything else seen.
    const unseen = new Set(PROMOTION_CATEGORIES.map((c) => PROMOTION_CATALOG.find((p) => p.category === c.id)!.id));
    const seen = PROMOTION_CATALOG.filter((p) => !unseen.has(p.id)).map((p) => p.id);
    for (let seed = 1; seed <= 50; seed++) {
      const { slots } = plan(seed, { recentlySeen: seen });
      expect(slots.slice(0, 4).every((s) => unseen.has(s.promotion.id)), `seed ${seed}`).toBe(true);
    }
    const hidden = ["replit", "cursor"];
    for (let seed = 1; seed <= 50; seed++) expect(plan(seed, { hidden }).slots.some((s) => hidden.includes(s.promotion.id))).toBe(false);
    expect(plan(1, { promotions: [], postCount: 10 }).slots).toEqual([]);
    expect(plan(1, { postCount: 0 }).slots).toEqual([]);
  });

  it("favours the viewer's goals", () => {
    const shipCats = new Set<string>(GOAL_AFFINITY.ship_mvp);
    const share = (goals: string[]) => {
      let hit = 0, total = 0;
      for (let seed = 1; seed <= 300; seed++) for (const s of plan(seed, { goals, postCount: 6 }).slots) { total++; if (shipCats.has(s.promotion.category)) hit++; }
      return hit / total;
    };
    expect(share(["ship_mvp"])).toBeGreaterThan(share([]));
  });

  it("remembers what was seen, newest first, up to a limit", () => {
    expect(rememberSeen(["a", "b"], ["b", "c"])).toEqual(["b", "c", "a"]);
    expect(rememberSeen(Array.from({ length: 40 }, (_, i) => `p${i}`), ["new"])).toHaveLength(PROMO_SEEN_MEMORY);
  });
});

describe("what an admin can set", () => {
  it("plays YouTube, Vimeo and https video files, and nothing else", () => {
    expect(parsePromoVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toMatchObject({ kind: "youtube", id: "dQw4w9WgXcQ", embedUrl: expect.stringContaining("youtube-nocookie.com/embed/dQw4w9WgXcQ") });
    expect(parsePromoVideo("https://youtu.be/dQw4w9WgXcQ")).toMatchObject({ kind: "youtube" });
    expect(parsePromoVideo("https://youtube.com/shorts/dQw4w9WgXcQ")).toMatchObject({ kind: "youtube" });
    expect(parsePromoVideo("https://vimeo.com/123456789")).toMatchObject({ kind: "vimeo", id: "123456789" });
    expect(parsePromoVideo("https://cdn.example.com/launch.mp4")).toEqual({ kind: "file", src: "https://cdn.example.com/launch.mp4" });
    for (const bad of ["http://youtube.com/watch?v=dQw4w9WgXcQ", "javascript:alert(1)", "https://evil.test/page", "https://youtube.com/watch?v=<script>", ""]) expect(parsePromoVideo(bad)).toBeNull();
  });

  it("validates each field, and clears one set to empty", () => {
    expect(validatePromotionSettings({ videoUrl: "https://evil.test/x" })).toMatchObject({ ok: false, field: "videoUrl" });
    expect(validatePromotionSettings({ referralUrl: "javascript:alert(1)" })).toMatchObject({ ok: false, field: "referralUrl" });
    expect(validatePromotionSettings({ logoUrl: "http://x.test/l.png" })).toMatchObject({ ok: false, field: "logoUrl" });
    expect(validatePromotionSettings({ perk: "x".repeat(41) })).toMatchObject({ ok: false, field: "perk" });
    expect(validatePromotionSettings({ headline: " New agent mode ", referralUrl: "https://replit.com/refer/x", perk: "$10 in credits", videoUrl: "", active: false }))
      .toEqual({ ok: true, value: { headline: "New agent mode", videoUrl: null, referralUrl: "https://replit.com/refer/x", logoUrl: null, perk: "$10 in credits", youtubeChannelUrl: null, active: false } });
    expect(validatePromotionSettings({ youtubeChannelUrl: "https://www.youtube.com/@replit" })).toMatchObject({ ok: true, value: { youtubeChannelUrl: "https://www.youtube.com/@replit" } });
    expect(validatePromotionSettings({ youtubeChannelUrl: "https://evil.test/@replit" })).toMatchObject({ ok: false, field: "youtubeChannelUrl" });
  });

  it("keeps only the promotion, slot and referral flag on an event", () => {
    expect(sanitizePromoProps({ promotionId: "replit", slot: 2, referral: true, email: "x@y.z" })).toEqual({ promotionId: "replit", slot: 2, referral: true });
    expect(sanitizePromoProps({ promotionId: "not-a-company" })).toBeNull();
  });
});
