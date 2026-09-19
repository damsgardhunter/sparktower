/**
 * Promotions reach the app the same way they reach the browser.
 *
 * The phone plans its own placement — it builds from its own tsconfig and
 * doesn't import @shared — so the rules in mobile/src/components/feed/promotions.ts
 * are a hand copy of shared/promotions.ts. A copy that drifts is a promotion
 * that was sold against "the feed" and quietly runs somewhere else, or not at
 * all, on half the audience. This runs both and fails when they disagree.
 */
import { describe, it, expect } from "vitest";
import {
  PROMOTION_CATEGORIES, PROMO_EVENTS, PROMO_FIRST_SLOT_CHANCE, PROMO_GAP, PROMO_SEEN_MEMORY,
  GOAL_AFFINITY, parsePromoVideo, planFeedPromotions, rememberSeen,
} from "@shared/promotions";
import * as mobile from "../../mobile/src/components/feed/promotions";

const CATEGORY_IDS = PROMOTION_CATEGORIES.map((c) => c.id);
const promo = (i: number) => ({ id: `p${i}`, category: CATEGORY_IDS[i % CATEGORY_IDS.length] });
const pool = Array.from({ length: 30 }, (_, i) => promo(i));

describe("the constants both sides plan with", () => {
  it("names the same categories, with the same labels", () => {
    expect(mobile.PROMOTION_CATEGORIES).toEqual(PROMOTION_CATEGORIES.map((c) => ({ id: c.id, label: c.label })));
    for (const c of PROMOTION_CATEGORIES) expect(mobile.promotionCategoryLabel(c.id)).toBe(c.label);
  });

  it("weights the same categories for each goal", () => {
    expect(mobile.GOAL_AFFINITY).toEqual(GOAL_AFFINITY);
  });

  it("spaces and remembers promotions the same way", () => {
    expect(mobile.PROMO_FIRST_SLOT_CHANCE).toBe(PROMO_FIRST_SLOT_CHANCE);
    expect(mobile.PROMO_GAP).toEqual(PROMO_GAP);
    expect(mobile.PROMO_SEEN_MEMORY).toBe(PROMO_SEEN_MEMORY);
    expect(mobile.rememberSeen(["a", "b"], ["b", "c"])).toEqual(rememberSeen(["a", "b"], ["b", "c"]));
  });

  it("reports the event names the server keeps", () => {
    expect(mobile.PROMO_EVENTS).toEqual(PROMO_EVENTS);
  });
});

describe("where the promotions land", () => {
  it("puts the same ones in the same places, for any seed and any feed length", () => {
    for (const seed of [1, 7, 12345, 2 ** 31, 4_294_967_295]) {
      for (const postCount of [0, 1, 3, 12, 40]) {
        const opts = { promotions: pool, postCount, seed, goals: ["ship_mvp"], recentlySeen: ["p3", "p4"], hidden: ["p0"] };
        expect(mobile.planFeedPromotions(opts), `seed ${seed}, ${postCount} posts`).toEqual(planFeedPromotions(opts));
      }
    }
  });

  it("agrees with no goals, nothing seen and nothing hidden", () => {
    const opts = { promotions: pool, postCount: 20, seed: 99 };
    expect(mobile.planFeedPromotions(opts)).toEqual(planFeedPromotions(opts));
  });
});

describe("which video links are recognised", () => {
  const links = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://vimeo.com/123456789",
    "https://example.com/clip.mp4",
    "https://example.com/about",
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "not a url",
    null,
  ];

  it("recognises the same links, as the same kind of video", () => {
    for (const link of links) {
      const web = parsePromoVideo(link);
      const app = mobile.parsePromoVideo(link);
      expect(app === null, `${link} should be a video on both or neither`).toBe(web === null);
      if (web && app) {
        expect(app.kind).toBe(web.kind);
        if (web.kind === "youtube" && app.kind === "youtube") expect(app.id).toBe(web.id);
      }
    }
  });

  it("uses YouTube's own still for the poster the phone taps to play", () => {
    const video = mobile.parsePromoVideo("https://youtu.be/dQw4w9WgXcQ");
    expect(video).toMatchObject({
      kind: "youtube",
      posterUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      watchUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
  });
});

describe("what the device remembers", () => {
  it("survives a list that isn't one", () => {
    expect(mobile.parsePromoIds(null)).toEqual([]);
    expect(mobile.parsePromoIds("not json")).toEqual([]);
    expect(mobile.parsePromoIds('{"a":1}')).toEqual([]);
    expect(mobile.parsePromoIds('["a",2,"b"]')).toEqual(["a", "b"]);
  });
});
