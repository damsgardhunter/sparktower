/**
 * A reward the platform cannot deliver must not be offerable.
 *
 * Two were. A wallpaper and a profile frame were both on the creator's menu,
 * both marked `fulfilledBy: "platform"` — meaning *we* generate them — and
 * nothing anywhere does. Nothing draws the ring, nothing renders the file,
 * nothing serves either. So a creator could promise them, a backer could pay for
 * a rung advertising them, and the person who looked like they broke the promise
 * would be the creator.
 *
 * Four of the five default tier templates shipped with the wallpaper on them, so
 * this was not a thing a creator had to go looking for — it was the suggestion.
 *
 * The keys stay defined on purpose. Eight tiers already name them, and a tier
 * referencing a key the catalogue has never heard of renders the raw string
 * ("wallpaper") to a backer; keeping the entry means the label still resolves
 * while nothing new can select it, and the entry itself records what is left to
 * build.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_TIER_TEMPLATE, DIGITAL_REWARDS, OFFERABLE_DIGITAL_REWARDS,
  deliverableRewards, isRewardAvailable,
} from "@shared/backing";

/**
 * The ones that do not exist. Named, so re-adding any has to be deliberate.
 *
 * Found by auditing every reward that claims the *platform* fulfils it, which is
 * a promise only we can keep:
 *
 *   backer_wall       — the project's own tab lists them. Built.
 *   believer_number   — assigned atomically on settlement from the campaign's
 *                       own counter, and printed beside the name. Built.
 *   digital_badge     — the row is written when the pledge settles, the backer
 *                       owns it, the first drawing is free, and the showcase on
 *                       their profile renders it. Built.
 *   founding_believer — a crown beside their name in the credits and the
 *                       showcase. Built.
 *   certificate       — drawn by `server/certificate-render.ts` and served by
 *                       GET /api/projects/:id/backing/certificate. Built after
 *                       this audit found it missing.
 *   wallpaper         — nothing generates the file.
 *   profile_frame     — nothing draws the ring.
 */
const UNBUILT = ["wallpaper", "profile_frame"];

describe("rewards the platform cannot deliver", () => {
  it("are still defined, so a saved tier does not render a raw key", () => {
    for (const key of UNBUILT) {
      const def = DIGITAL_REWARDS.find((r) => r.key === key);
      expect(def, `${key} must stay in the catalogue`).toBeTruthy();
      expect(def!.label, `${key} needs a human label`).toBeTruthy();
    }
  });

  it("are not offerable", () => {
    for (const key of UNBUILT) {
      expect(isRewardAvailable(key), key).toBe(false);
      expect(OFFERABLE_DIGITAL_REWARDS.map((r) => r.key), key).not.toContain(key);
    }
  });

  it("leaves everything else offerable", () => {
    const expected = DIGITAL_REWARDS.filter((r) => !UNBUILT.includes(r.key)).map((r) => r.key);
    expect(OFFERABLE_DIGITAL_REWARDS.map((r) => r.key)).toEqual(expected);
    expect(OFFERABLE_DIGITAL_REWARDS.length, "the menu should not be empty").toBeGreaterThan(3);
  });

  /* The suggestion mattered more than the menu: four of five templates had one. */
  it("is gone from every default template", () => {
    for (const template of DEFAULT_TIER_TEMPLATE) {
      for (const key of template.digitalRewards) {
        expect(isRewardAvailable(key), `template "${template.name}" offers ${key}`).toBe(true);
      }
    }
  });

  /*
   * And the filter a saved tier goes through before it is shown. This is the part
   * that matters for the eight tiers already in the database: the creator cannot
   * pick it again, but without this they would go on advertising it.
   */
  it("drops them from a tier saved before they were withdrawn", () => {
    const saved = ["backer_wall", "wallpaper", "digital_badge", "profile_frame", "certificate"];
    expect(deliverableRewards(saved)).toEqual(["backer_wall", "digital_badge", "certificate"]);
  });

  it("leaves a clean tier untouched, and tolerates nothing at all", () => {
    expect(deliverableRewards(["backer_wall", "believer_number"])).toEqual(["backer_wall", "believer_number"]);
    expect(deliverableRewards([])).toEqual([]);
    expect(deliverableRewards(null)).toEqual([]);
    expect(deliverableRewards(undefined)).toEqual([]);
  });

  /*
   * An unknown key survives the filter. It is not something the platform has
   * withdrawn — it is something it has never heard of, which means a tier from a
   * future version or a hand-edited row, and dropping it silently would hide a
   * promise rather than a broken one.
   */
  it("passes through a key it does not recognise rather than swallowing it", () => {
    expect(isRewardAvailable("something_new")).toBe(true);
    expect(deliverableRewards(["something_new"])).toEqual(["something_new"]);
  });
});

/**
 * The other half of the audit, and the part worth keeping.
 *
 * `fulfilledBy: "platform"` is a promise only we can keep, so every reward still
 * carrying it has to be something that actually reaches the backer. Four do, and
 * the test names where each is delivered — not because the assertion can check
 * that, but because the next person to add a platform reward should have to write
 * the same line, and will notice if they cannot.
 */
describe("every platform reward that is still offerable", () => {
  const DELIVERED_BY: Record<string, string> = {
    backer_wall: "client/src/components/backer-wall.tsx — the project's Backer wall tab",
    believer_number: "server/backing-routes.ts — assigned on settlement, shown beside the name",
    digital_badge: "server/backer-badges.ts + backer-badge-showcase.tsx — row on settlement, first drawing free",
    founding_believer: "backer-credits.tsx + backer-badge-showcase.tsx — the crown",
    certificate: "server/certificate-render.ts — GET /api/projects/:id/backing/certificate",
  };

  it("has somewhere it is actually delivered", () => {
    const platform = OFFERABLE_DIGITAL_REWARDS.filter((r) => r.fulfilledBy === "platform");
    for (const r of platform) {
      expect(
        DELIVERED_BY[r.key],
        `${r.key} says the platform fulfils it. Name where, or mark it available: false — `
        + "an offerable reward nothing delivers makes the creator look like they broke the promise.",
      ).toBeTruthy();
    }
  });

  /* Creator rewards are the creator's to keep, so they need no such proof. */
  it("leaves creator-fulfilled rewards alone", () => {
    const creator = OFFERABLE_DIGITAL_REWARDS.filter((r) => r.fulfilledBy === "creator").map((r) => r.key);
    expect(creator).toContain("early_access");
    expect(creator).toContain("video_thankyou");
  });
});
