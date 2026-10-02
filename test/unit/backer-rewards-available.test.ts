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

/** The two that do not exist. Named, so re-adding one has to be deliberate. */
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
