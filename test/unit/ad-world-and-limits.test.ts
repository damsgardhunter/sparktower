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
import { composeDissolve, CROSSFADE_SECONDS, CROSSFADE_SECONDS_CONTINUOUS } from "../../server/ad-compositor";
import { adStyle, AD_STYLES } from "@shared/ad-styles";
import { platePrompt, fitWorld, PROMPT_MAX_CHARS } from "@shared/ad-plate-prompt";
import { planShots, planPlates } from "@shared/ad-shots";
import { beatPlan, AD_DURATIONS } from "@shared/ads";
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

describe("what the world may and may not say", () => {
  const beats = [{ id: "hook" as const, seconds: 3 }];
  const lines = [{ beat: "hook" as const, onScreen: "Build here", scene: "Hands lifting a steel panel onto an oak bench in low side light." }];
  const check = (world: string) => checkScript({ lines, callToAction: "", world }, beats, { needsWorld: true }).map((p) => p.kind);
  const GOOD = "A four-storey workshop of pale yellow brick and worn oak floors, its ground floor open to the street through tall steel-framed doors. Late afternoon light comes in low from the west and lands in long bars across the boards. The palette is brick, oak, brass and painted green steel, and there are benches, tools and half-finished work everywhere.";

  it("accepts a world that describes the place", () => {
    expect(check(GOOD)).toEqual([]);
  });

  it("refuses one that is too thin to stop the camera inventing things", () => {
    expect(check("A workshop.")).toContain("thin_world");
    expect(check("")).toContain("missing_world");
  });

  it("refuses one that directs the camera instead of describing the place", () => {
    /*
     * The bug this is for: a world that said "every shot keeps the spire or
     * its reflection in frame" went to the image model with every frame, was
     * obeyed on every frame, and produced an interior containing a scale model
     * of the building standing on a plinth.
     */
    for (const directive of [
      "every shot keeps the spire in frame.",
      "The camera always stays low.",
      "The tower must appear in each frame.",
    ]) {
      expect(check(`${GOOD} ${directive}`), directive).toContain("world_directs");
    }
  });
});

describe("scenes that describe nothing", () => {
  const beats = [{ id: "hook" as const, seconds: 3 }];
  const kinds = (scene: string) =>
    checkScript({ lines: [{ beat: "hook", onScreen: "Hi", scene }], callToAction: "" }, beats, {}).map((p) => p.kind);

  it("refuses the words that sound like a specification and commit to nothing", () => {
    for (const word of ["modern", "sleek", "futuristic", "high-tech", "state-of-the-art"]) {
      expect(kinds(`A ${word} workspace with people in it.`), word).toContain("vague_scene");
    }
  });

  it("accepts a scene that names what things are made of", () => {
    expect(kinds("A pale brick wall behind an oak bench, lit low from the west.")).toEqual([]);
  });
});

describe("joining shots that were generated apart", () => {
  it("advances each offset by exactly the dissolve it asks the filter for", () => {
    /*
     * These were two numbers — the offset advanced by one value and the filter
     * given another — so every join where they differed put the next offset
     * past the end of its input. xfade does not complain, it truncates, and
     * across eight joins a thirty-second advert came out at eight seconds.
     */
    const args = composeDissolve(["a.mp4", "b.mp4", "c.mp4"], [5, 5, 5], "out.mp4");
    const chain = args[args.indexOf("-filter_complex") + 1];
    const steps = chain.split(";").map((s) => {
      const duration = Number(/duration=([\d.]+)/.exec(s)![1]);
      const offset = Number(/offset=([\d.]+)/.exec(s)![1]);
      return { duration, offset };
    });
    let expected = 0;
    for (const [i, step] of steps.entries()) {
      expected += 5 - step.duration;
      expect(step.offset, `join ${i} offset must match the durations before it`).toBeCloseTo(expected, 2);
    }
  });

  it("dissolves for longer when the clips were drawn from one another", () => {
    /* Independent clips share nothing, so a long mix of them is visibly two images. */
    expect(CROSSFADE_SECONDS_CONTINUOUS).toBeGreaterThan(CROSSFADE_SECONDS);
    const args = composeDissolve(["a.mp4", "b.mp4"], [5, 5], "out.mp4", undefined, CROSSFADE_SECONDS_CONTINUOUS);
    expect(args.join(" ")).toContain(`duration=${CROSSFADE_SECONDS_CONTINUOUS.toFixed(3)}`);
  });
});

describe("the prompt the provider will actually accept", () => {
  const world = "SparkTower is a colossal tower of dark basalt banded with brushed steel. ".repeat(20);

  it("never exceeds the provider's limit, whatever it is given", () => {
    /*
     * Kling answers 400 with "prompt: size must be between 0 and 2500" and
     * generates nothing. A dense world is a thousand characters on its own and
     * goes out with every clip, so a thirty-second advert refused all nine.
     */
    let worst = 0;
    for (const style of AD_STYLES) {
      for (const duration of AD_DURATIONS) {
        for (const plate of planPlates(planShots(beatPlan(duration, style.beatWeights)))) {
          for (const scenes of [[], ["A short scene"], ["A ".repeat(400)], ["A ".repeat(400), "B ".repeat(400)]]) {
            const out = platePrompt({ brief: "A business.", style, plate, brandMoment: true, scenes, world });
            worst = Math.max(worst, out.length);
            expect(out.length, `${style.id} ${duration}s`).toBeLessThanOrEqual(PROMPT_MAX_CHARS);
          }
        }
      }
    }
    expect(worst, "the budget is being used, not merely respected").toBeGreaterThan(PROMPT_MAX_CHARS / 2);
  });

  it("keeps the scene whole and trims the world, because the scene is what makes this shot", () => {
    const plate = planPlates(planShots(beatPlan(30)))[0];
    const scene = "Through the doorway into a cutaway atrium of steel stairs and grated catwalks under electric white light";
    const out = platePrompt({ brief: "A business.", style: adStyle("brand_world")!, plate, brandMoment: false, scenes: [scene], world });
    expect(out).toContain(scene);
    expect(out, "some of the world survives too").toContain("basalt");
  });

  it("cuts the world at a sentence rather than mid-clause", () => {
    const trimmed = fitWorld("Built from basalt. Lit from the west. Full of people.", 30);
    expect(trimmed).toBe("Built from basalt.");
  });

  it("falls back to characters when even the first sentence will not fit", () => {
    const trimmed = fitWorld("One enormously long opening sentence that will not fit at all.", 20);
    expect(trimmed.length).toBeLessThanOrEqual(20);
    expect(trimmed.length).toBeGreaterThan(0);
  });
});

describe("the style whose logo is a place", () => {
  const world = adStyle("brand_world")!;

  it("draws its own keyframes, and says where the logo lives", () => {
    expect(world.keyframes).toBe(true);
    expect(world.logoRole, "without this the logo is just drawn somewhere").toBeTruthy();
  });

  it("describes where the mark lives without making it the subject of every frame", () => {
    /*
     * `logoRole` reads as harmless prose and is sent to the image model with
     * every frame, so a phrase in it is applied to every frame. It said "the
     * scene is built around" the building — and nine clips came back as nine
     * centred portraits of the same tower, which somebody watching described
     * as everything centring too hard on it and each clip being one locked-off
     * scene. These are the phrasings that do that.
     */
    for (const directive of ["built around", "every frame", "every shot", "always", "in frame", "must appear"]) {
      expect(world.logoRole!.toLowerCase(), `logoRole says "${directive}", which applies to every frame`)
        .not.toContain(directive);
    }
    /* And it still has to say the mark is a physical thing, or it is not a role. */
    expect(world.logoRole!.toLowerCase()).toMatch(/structure|building|landmark/);
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
