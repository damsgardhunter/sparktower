/**
 * The keyframe path, and the three failures that cost real generations.
 *
 * Every assertion about retrying below is here because of a specific advert
 * that died: nine clips submitted at once and refused; five clips generated
 * and thrown away when the sixth was turned away; three generated before a
 * bare "fetch failed". None of those were anything to do with the advert.
 */
import { describe, it, expect } from "vitest";
import { isRateLimited, isTransient } from "../../server/kling-client";
import { keyframePrompt, keyframeSize } from "../../server/ad-keyframe";
import { sceneMoments, checkScript, type AdScript } from "@shared/ad-script";
import { adStyle, AD_STYLES } from "@shared/ad-styles";
import { AD_FORMATS } from "@shared/ads";

describe("telling a busy queue from a bad clip", () => {
  it("knows the queue is full, however the provider words it", () => {
    const limits = [
      Object.assign(new Error("Kling 429 on /v1/videos/image2video: parallel task over resource pack limit"), { status: 429 }),
      new Error("parallel task over resource pack limit"),
      new Error("Rate limit exceeded"),
      new Error("too many concurrent tasks"),
    ];
    for (const e of limits) expect(isRateLimited(e), e.message).toBe(true);
  });

  it("knows the network failed rather than the request", () => {
    /* undici's connection error: no status, no message worth showing anyone. */
    for (const e of [new Error("fetch failed"), new Error("socket hang up"), new Error("ECONNRESET"),
      Object.assign(new Error("Kling 502 on /v1/videos/image2video: bad gateway"), { status: 502 })]) {
      expect(isTransient(e), e.message).toBe(true);
    }
  });

  it("does not mistake a refusal for either, because a refusal must not be retried", () => {
    /*
     * The cost of getting this backwards is four more refusals and four more
     * minutes of somebody watching a progress bar that was never going to move.
     */
    const refusals = [
      Object.assign(new Error("Kling 400 on /v1/videos/image2video: prompt rejected by content policy"), { status: 400 }),
      new Error("Kling 400: invalid aspect_ratio"),
    ];
    for (const e of refusals) {
      expect(isRateLimited(e), e.message).toBe(false);
      expect(isTransient(e), e.message).toBe(false);
    }
  });
});

describe("a beat cut from several clips", () => {
  it("gives each clip its own moment", () => {
    const scene = "Outside the doors at dusk | Inside, looking up the core | Up past the spire";
    expect(sceneMoments(scene, 3)).toEqual([
      "Outside the doors at dusk", "Inside, looking up the core", "Up past the spire",
    ]);
  });

  it("pads rather than failing when the model wrote too few", () => {
    /*
     * A script that is good apart from a formatting miss is still a good
     * script, and failing the whole advert over the third moment would throw
     * it away along with every keyframe already drawn for it.
     */
    expect(sceneMoments("One | Two", 3)).toEqual(["One", "Two", "Two"]);
    expect(sceneMoments("Only one", 2)).toEqual(["Only one", "Only one"]);
  });

  it("gives empty moments rather than undefined when there is no scene at all", () => {
    expect(sceneMoments(undefined, 2)).toEqual(["", ""]);
  });

  it("leaves a single-clip beat exactly as written", () => {
    expect(sceneMoments("A kitchen table at night", 1)).toEqual(["A kitchen table at night"]);
  });
});

describe("the frame drawn before anything is animated", () => {
  const base = { scene: "Street level outside the doors at dusk", brief: "A place where people build things." };

  it("says what each reference is, because an unlabelled one is only a mood", () => {
    const p = keyframePrompt({ ...base, hasLogo: true, hasPrevious: true, logoRole: "the building itself." });
    expect(p).toContain("the company's actual logo");
    expect(p).toContain("last frame of the previous shot");
    expect(p, "continuity is the whole point of the second reference").toContain("the same place");
  });

  it("puts the logo in the world rather than on the frame", () => {
    const p = keyframePrompt({ ...base, hasLogo: true, hasPrevious: false, logoRole: "the building itself." });
    expect(p).toContain("belongs in the world of this frame, not on top of it");
    expect(p).toMatch(/not a flat overlay/i);
  });

  it("refuses lettering, because the real words are typeset over this afterwards", () => {
    const p = keyframePrompt({ ...base, hasLogo: true, hasPrevious: false });
    expect(p).toMatch(/no lettering/i);
    expect(p, "the line is set over the lower third").toContain("lower third");
  });

  it("asks for a shape the advert will not have to crop the subject out of", () => {
    expect(keyframeSize("vertical")).toBe("1024x1536");
    expect(keyframeSize("wide")).toBe("1536x1024");
    expect(keyframeSize("square")).toBe("1024x1024");
    for (const f of AD_FORMATS) {
      const [w, h] = keyframeSize(f.id).split("x").map(Number);
      /* Same orientation as the frame, or a third of the composition is cropped away. */
      expect(Math.sign(w - h), f.id).toBe(Math.sign(f.width - f.height));
    }
  });
});

describe("the style whose logo is a place", () => {
  const world = adStyle("brand_world")!;

  it("draws its own keyframes, and says where the logo lives", () => {
    expect(world.keyframes).toBe(true);
    expect(world.logoRole, "without this the logo is just drawn somewhere").toBeTruthy();
  });

  it("is the only one that pays for keyframes, since most adverts do not need them", () => {
    const keyframed = AD_STYLES.filter((s) => s.keyframes).map((s) => s.id);
    expect(keyframed).toEqual(["brand_world"]);
  });

  it("still passes the rule every style's plate direction has to", () => {
    /* No product, logo, price or text in the direction sent to the video model. */
    for (const banned of ["logo", "text", "price", "caption"]) {
      expect(world.plate.toLowerCase(), banned).not.toContain(banned);
    }
  });

  it("still produces a script the checks accept", () => {
    const beats = [{ id: "hook" as const, seconds: 2 }, { id: "cta" as const, seconds: 3 }];
    const script: AdScript = {
      lines: [
        { beat: "hook", onScreen: "Build here", scene: "Outside the doors at dusk, people walking in." },
        { beat: "cta", onScreen: "Start now", scene: "Up past the spire into open sky." },
      ],
      callToAction: "Start at example.test",
    };
    expect(checkScript(script, beats, { callToAction: "Start at example.test" })).toEqual([]);
  });
});
