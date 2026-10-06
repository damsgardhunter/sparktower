/**
 * The story formats, and the rules that stop them turning back into adverts.
 *
 * These exist because the commercial shape — hook, problem, product, proof,
 * call to action, brand throughout — produces films that are recognisably
 * adverts, and a film that is recognisably an advert is scrolled past. Every
 * assertion below is one of the properties that makes the difference, held
 * still so a later change cannot quietly undo it.
 */
import { describe, it, expect } from "vitest";
import {
  STORY_FORMATS, STORY_FORMAT_IDS, storyFormat, storyPlan, productBeat,
  planStoryShots, planStoryPlates, storyFitsIn, storyMinSeconds, OPENING_FREEZE_SECONDS, storyPrompt, type StoryFormat,
} from "@shared/ad-stories";
import { checkScript, type AdScript } from "@shared/ad-script";
import { AD_DURATIONS } from "@shared/ads";

/**
 * Every length a format is actually offered at, not a couple of convenient
 * ones. Testing 15 and 30 only is how a six-second fake-out with a
 * three-second borrowed opening — against a four-second floor — went unnoticed.
 */
const lengthsFor = (format: StoryFormat) => AD_DURATIONS.filter((d) => storyFitsIn(format, d));

describe("every format, at every length", () => {
  it("fills the runtime exactly", () => {
    for (const format of STORY_FORMATS) {
      for (const duration of lengthsFor(format)) {
        const plan = storyPlan(format, duration);
        expect(plan.reduce((n, b) => n + b.seconds, 0), `${format.id} at ${duration}s`).toBe(duration);
      }
    }
  });

  it("gives no beat less than it needs to land", () => {
    for (const format of STORY_FORMATS) {
      for (const duration of lengthsFor(format)) {
        for (const beat of storyPlan(format, duration)) {
          const def = format.beats.find((b) => b.id === beat.id)!;
          expect(beat.seconds, `${format.id} ${beat.id} at ${duration}s`).toBeGreaterThanOrEqual(def.minSeconds);
        }
      }
    }
  });

  it("plans shots whose seconds add up to the beats they came from", () => {
    for (const format of STORY_FORMATS) {
      for (const duration of lengthsFor(format)) {
        const plan = storyPlan(format, duration);
        const shots = planStoryShots(format, plan);
        expect(shots.reduce((n, s) => n + s.seconds, 0), `${format.id} at ${duration}s`).toBe(duration);
        expect(planStoryPlates(shots).length, `${format.id} generated nothing`).toBeGreaterThan(0);
      }
    }
  });
});

describe("the product arrives late, which is the whole point", () => {
  it("never appears in the first beat, except in the one format that is only the product", () => {
    for (const format of STORY_FORMATS) {
      const plan = storyPlan(format, 15);
      const at = plan.findIndex((b) => b.id === productBeat(format, plan));
      if (format.id === "impossible") {
        /* An ASMR film has nothing else to show, and nobody mistakes it for a post. */
        expect(at, format.id).toBe(0);
        continue;
      }
      expect(at, `${format.id} shows the product in its opening beat`).toBeGreaterThan(0);
    }
  });

  it("is refused in a scene before the beat it belongs to", () => {
    /*
     * A beat boundary rather than advice. "Show the product late" is a note
     * nobody can check; "not before this beat" is a rule, and this is the rule
     * that separates a film somebody watches from an advert they scroll past.
     */
    const beats = [{ id: "greet", seconds: 3 }, { id: "discover", seconds: 4 }];
    const script: AdScript = {
      lines: [
        { beat: "greet", onScreen: "Hi", scene: "She leans over a plywood bench and opens the Sparktower app on her phone under a window." },
        { beat: "discover", onScreen: "Found it", scene: "She holds the phone up to the lamp light and scrolls." },
      ],
      callToAction: "",
      character: "x".repeat(130),
      world: "y".repeat(320),
    };
    const problems = checkScript(script, beats, {
      needsCharacter: true, needsWorld: true,
      productNotBefore: { beat: "discover", words: ["Sparktower"] },
    });
    expect(problems.map((p) => p.kind)).toContain("product_too_early");
  });

  it("allows it from that beat onwards", () => {
    const beats = [{ id: "greet", seconds: 3 }, { id: "discover", seconds: 4 }];
    const script: AdScript = {
      lines: [
        { beat: "greet", onScreen: "Hi", scene: "She leans over a plywood bench under a window, sorting screws." },
        { beat: "discover", onScreen: "Found it", scene: "She opens the Sparktower app, lamp light on the glass." },
      ],
      callToAction: "",
      character: "x".repeat(130),
      world: "y".repeat(320),
    };
    expect(checkScript(script, beats, {
      needsCharacter: true, needsWorld: true,
      productNotBefore: { beat: "discover", words: ["Sparktower"] },
    }).map((p) => p.kind)).not.toContain("product_too_early");
  });
});

describe("the character, described once and drawn four times", () => {
  it("is asked for by every format that follows somebody", () => {
    /* Before-and-after is the one with no face in it at all. */
    expect(STORY_FORMATS.filter((f) => !f.character).map((f) => f.id)).toEqual(["before_after", "impossible"]);
  });

  it("is refused when it is too vague to draw the same way twice", () => {
    const beats = [{ id: "greet", seconds: 3 }];
    const base = {
      lines: [{ beat: "greet", onScreen: "Hi", scene: "She sorts screws on a plywood bench under a window." }],
      callToAction: "", world: "y".repeat(320),
    };
    const kinds = (character?: string) =>
      checkScript({ ...base, character } as AdScript, beats, { needsCharacter: true, needsWorld: true }).map((p) => p.kind);

    expect(kinds(), "no character at all").toContain("missing_character");
    expect(kinds("A young woman."), "a description that is two different people").toContain("thin_character");
    expect(kinds("x".repeat(130))).not.toContain("thin_character");
  });
});

describe("what makes them feel native rather than advertised", () => {
  it("sets captions with no brand colour, except where polish is the point", () => {
    for (const format of STORY_FORMATS) {
      const expected = format.id === "impossible" ? "bubble" : "native";
      expect(format.captions, format.id).toBe(expected);
    }
  });

  it("tells the camera how to behave in a way that is not cinematic", () => {
    /*
     * A selfie vlog described with a fast prime lens and shallow depth of
     * field is a perfume commercial. The vlog and the POV formats say outright
     * that the footage is the phone, because the first attempt produced a
     * camera watching somebody hold one.
     */
    for (const id of ["character_vlog", "pov"]) {
      const look = storyFormat(id)!.look.toLowerCase();
      expect(look, `${id} does not say it is phone footage`).toMatch(/phone|first person/);
      /*
       * The phrase may appear, but only as a refusal of it. Written as "every
       * mention is preceded by 'no'" rather than as a lookahead, because the
       * lookahead version passed on "no shallow depth of field" by accident
       * and would have passed on an outright request for one just as happily.
       */
      for (const at of [...look.matchAll(/shallow depth of field/g)].map((m) => m.index!)) {
        expect(look.slice(Math.max(0, at - 4), at), `${id} asks for a cinematic look`).toMatch(/no $/);
      }
    }
    expect(storyFormat("character_vlog")!.look).toMatch(/THIS FOOTAGE IS THE PHONE/);
  });

  it("draws its own first frames, so the character survives between shots", () => {
    for (const format of STORY_FORMATS) {
      expect(format.keyframes, format.id).toBe(true);
    }
  });
});

describe("a format that cannot fit the length", () => {
  it("knows the shortest cut it can carry", () => {
    for (const format of STORY_FORMATS) {
      /* The two longest beats always survive the drop, which stops at two. */
      const floors = format.beats.map((b) => b.minSeconds).sort((a, b) => b - a);
      expect(storyMinSeconds(format), format.id).toBe(floors[0] + floors[1]);
    }
  });

  it("is refused rather than squeezed", () => {
    /*
     * The squeeze is what happened before: the plan summed correctly with a
     * beat below the length at which it does its job, so a six-second fake-out
     * had three seconds of borrowed documentary — not long enough for anybody
     * to mistake it for one, which is the entire mechanism of the format.
     */
    const fakeOut = storyFormat("fake_out")!;
    expect(storyFitsIn(fakeOut, 6)).toBe(false);
    expect(storyFitsIn(fakeOut, 15)).toBe(true);
  });

  it("keeps its beats usable when asked for a length it cannot do, rather than breaking them", () => {
    /*
     * `storyPlan` is not the thing that refuses — `checkRequest` is — so it can
     * still be called with six seconds for a format that needs seven. What it
     * must not do is return a beat below the length at which it works: better
     * to overrun the ask, visibly, than to hand back a three-second borrowed
     * documentary that sums correctly and does nothing.
     */
    const fakeOut = storyFormat("fake_out")!;
    const plan = storyPlan(fakeOut, 6);
    for (const beat of plan) {
      const def = fakeOut.beats.find((b) => b.id === beat.id)!;
      expect(beat.seconds, `${beat.id} was squeezed below the length it needs`).toBeGreaterThanOrEqual(def.minSeconds);
    }
    expect(plan.reduce((n, b) => n + b.seconds, 0), "and it overruns rather than squeezing").toBeGreaterThan(6);
  });

  it("holds every beat's floor at every length it is offered at", () => {
    for (const format of STORY_FORMATS) {
      for (const duration of lengthsFor(format)) {
        for (const beat of storyPlan(format, duration)) {
          const def = format.beats.find((b) => b.id === beat.id)!;
          expect(beat.seconds, `${format.id} ${beat.id} at ${duration}s`).toBeGreaterThanOrEqual(def.minSeconds);
        }
      }
    }
  });
});

describe("what the formats were actually asked for", () => {
  it("wants a fictional character who could not plausibly be filming, not a realistic person", () => {
    /*
     * The examples in the brief are Bigfoot vlogging, a stormtrooper on his
     * break, a cat with a desk job, a delivery van complaining about its
     * owner. Asking instead for "a specific character drawn from who this
     * business is for" produced a realistic person in a garage — which is a
     * testimonial, and nobody shares a testimonial. The absurdity is the hook.
     */
    const vlog = storyFormat("character_vlog")!.character!;
    expect(vlog).toMatch(/fictional/i);
    expect(vlog, "the examples are what carry the register").toMatch(/bigfoot|stormtrooper|cat|van/i);
    expect(vlog).toMatch(/never a realistic person/i);
  });

  it("makes the POV format say POV in its first line, which is the premise", () => {
    expect(storyFormat("pov")!.character).toMatch(/POV: /);
  });

  it("ends on the turn rather than an address", () => {
    /*
     * A drill with a googly eye built three beats of comedy and then said
     * "Start at sparktower.app", because the line rule said the last line was
     * exactly the call to action. That replaces the reason a film gets shared
     * with the reason it gets scrolled past.
     */
    /*
     * Asserted on the instructions rather than on the beat descriptions. Two
     * attempts at matching words in the purposes both failed on sentences that
     * *refuse* a call to action — "a documentary does not do a call to action"
     * reads the same to a substring check as asking for one. The prompt is
     * where the rule actually lives, so it is where the rule is checked.
     */
    const format = storyFormat("character_vlog")!;
    const plan = storyPlan(format, 15);
    const prompt = storyPrompt({
      format, plan, brief: "A place to build things.",
      businessName: "SparkTower", callToAction: "Start at sparktower.app",
      limitFor: (_b, _s) => 32,
    });
    expect(prompt, "the last line is forced to be the address again").not.toMatch(/The last line is exactly/);
    expect(prompt).toMatch(/Do NOT put "Start at sparktower\.app" or any web address in any line/);
    expect(prompt, "and the last beat is named as the turn").toMatch(/THE TURN\./);
    /*
     * The rule that fixes "Hi. I live here now." — a first line that reads as
     * nonsense because nothing around it says who is speaking or where. Every
     * beat passed its own checks; the sequence was what failed.
     */
    expect(prompt, "nothing requires the lines to add up").toMatch(/THE STORY\./);
    expect(prompt).toMatch(/somebody who knows nothing about this business and will not rewind/);
    expect(prompt).toMatch(/the first line establishes who the character is/);
  });

  it("holds the opening frame still for long enough to register and not long enough to look broken", () => {
    expect(OPENING_FREEZE_SECONDS).toBeGreaterThan(0.2);
    expect(OPENING_FREEZE_SECONDS).toBeLessThan(1);
  });
});

describe("the catalogue", () => {
  it("answers for every id it lists, and nothing else", () => {
    for (const id of STORY_FORMAT_IDS) expect(storyFormat(id)?.id).toBe(id);
    expect(storyFormat("not_a_format")).toBeNull();
    expect(storyFormat(null)).toBeNull();
  });

  it("does not collide with a commercial duration or style name", () => {
    for (const id of STORY_FORMAT_IDS) {
      expect(AD_DURATIONS as readonly number[]).not.toContain(Number(id));
    }
    expect(new Set(STORY_FORMAT_IDS).size, "two formats share an id").toBe(STORY_FORMAT_IDS.length);
  });
});
