/**
 * The three things the first end-to-end render got wrong.
 *
 * Each describe block below is a defect that reached a rendered file and was
 * only found by watching it: a fifteen-second advert that was a six-second
 * stare, a proof line clipped off both edges of the frame, and a plate prompt
 * that described an empty desk because nobody had told the model what the
 * business was.
 */
import { describe, it, expect } from "vitest";
import { AD_DURATIONS, AD_BEATS, AD_FORMATS, beatPlan, adFormat } from "@shared/ads";
import { AD_STYLES, adStyle } from "@shared/ad-styles";
import { fitLine, TYPE_SIZE, charsPerLine } from "@shared/ad-type";
import { safeBox, SAFE_AREAS } from "@shared/ad-safe-areas";
import { platePrompt, plateNegativePrompt, PLATE_NEGATIVE } from "@shared/ad-plate-prompt";
import { planShots, planPlates } from "@shared/ad-shots";
import { lineLimit } from "@shared/ad-script";

const minOf = (id: string) => AD_BEATS.find((b) => b.id === id)!.minSeconds;
const maxOf = (id: string) => (AD_BEATS.find((b) => b.id === id)! as { maxSeconds?: number }).maxSeconds;

describe("how an advert's seconds are shared out", () => {
  it("fills the runtime exactly, in every style at every length", () => {
    for (const style of AD_STYLES) {
      for (const duration of AD_DURATIONS) {
        const plan = beatPlan(duration, style.beatWeights);
        expect(plan.reduce((sum, b) => sum + b.seconds, 0), `${style.id} at ${duration}s`).toBe(duration);
      }
    }
  });

  it("gives no beat less than it needs to say anything", () => {
    for (const style of AD_STYLES) {
      for (const duration of AD_DURATIONS) {
        for (const beat of beatPlan(duration, style.beatWeights)) {
          expect(beat.seconds, `${style.id} ${beat.id} at ${duration}s`).toBeGreaterThanOrEqual(minOf(beat.id));
        }
      }
    }
  });

  it("never lets the hook become the advert", () => {
    /*
     * The bug this is here for: the hook's share was interpolated between a
     * half of six seconds and a tenth of thirty, and the rounding drift went
     * to the longest beat — which was the hook. A fifteen-second advert came
     * out with a six-second hook, and a hook is a punch.
     */
    for (const duration of AD_DURATIONS) {
      const hook = beatPlan(duration).find((b) => b.id === "hook")!;
      expect(hook.seconds, `${duration}s`).toBeLessThanOrEqual(maxOf("hook")!);
    }
  });

  it("carries the whole story at fifteen seconds, which is the length most ads are", () => {
    const ids = beatPlan(15).map((b) => b.id);
    for (const beat of ["hook", "problem", "product", "proof", "cta"]) {
      expect(ids, `fifteen seconds dropped the ${beat} beat`).toContain(beat);
    }
  });

  it("drops the beats a six-second cut has no room for, rather than flashing them", () => {
    /*
     * Problem and proof go; the product beat never does. An earlier version of
     * this allocation protected only the hook and the ask, and the product
     * beat's share at six seconds works out at 1.98 against a two-second
     * minimum — so it was dropped over two hundredths of a second, and a
     * six-second advert became a hook followed by a call to action with the
     * thing being sold never on screen.
     */
    expect(beatPlan(6).map((b) => b.id)).toEqual(["hook", "product", "cta"]);
  });

  it("keeps the hook and the ask whatever else goes", () => {
    for (const style of AD_STYLES) {
      for (const duration of AD_DURATIONS) {
        const ids = beatPlan(duration, style.beatWeights).map((b) => b.id);
        expect(ids[0], `${style.id} at ${duration}s`).toBe("hook");
        expect(ids[ids.length - 1], `${style.id} at ${duration}s`).toBe("cta");
      }
    }
  });

  it("still lets a style change what the advert spends its time on", () => {
    const at = (styleId: string, beat: string) =>
      beatPlan(30, adStyle(styleId)!.beatWeights).find((b) => b.id === beat)?.seconds ?? 0;
    expect(at("founder_story", "problem")).toBeGreaterThan(at("demonstration", "problem"));
    expect(at("demonstration", "product")).toBeGreaterThan(at("founder_story", "product"));
    /* Nobody opening a parcel needs telling they had a problem. */
    expect(beatPlan(30, adStyle("unboxing")!.beatWeights).map((b) => b.id)).not.toContain("problem");
  });
});

describe("a line set over footage", () => {
  const boxes = AD_FORMATS.map((f) => ({
    id: f.id,
    box: safeBox(f, SAFE_AREAS[f.id]),
    shortEdge: Math.min(f.width, f.height),
  }));

  it("never runs off the frame, at any length, in any format", () => {
    /*
     * The defect: `lineLimit` is a reading-speed budget and was being used as
     * a width one. A three-second proof beat may be forty-five characters, and
     * forty-five characters at the hook's size is about twice the width of a
     * vertical safe box. "Made by people who use it" rendered with the M and
     * the last word off the edges.
     */
    const lines = [
      "Go", "Take a look", "This is SparkTower", "Made by people who use it",
      "A very long proof line that nobody could possibly read in three seconds flat",
      "x".repeat(200),
    ];
    for (const { id, box, shortEdge } of boxes) {
      for (const text of lines) {
        const out = fitLine(text, box, shortEdge);
        const fits = charsPerLine(box.width, Math.round(shortEdge * out.sizeRatio));
        expect(out.text.length, `${id}: "${out.text}" at ${Math.round(shortEdge * out.sizeRatio)}px`).toBeLessThanOrEqual(fits);
      }
    }
  });

  it("shrinks the type before it cuts the words", () => {
    const { box, shortEdge } = boxes.find((b) => b.id === "vertical")!;
    const text = "Made by people who use it";
    const out = fitLine(text, box, shortEdge);
    expect(out.text, "the whole line smaller beats most of it large").toBe(text);
    expect(out.sizeRatio).toBeLessThan(TYPE_SIZE.max);
  });

  it("leaves a short line at full size", () => {
    const { box, shortEdge } = boxes.find((b) => b.id === "vertical")!;
    expect(fitLine("Take a look", box, shortEdge).sizeRatio).toBe(TYPE_SIZE.max);
  });

  it("stops shrinking at the size below which nobody reads it anyway", () => {
    const { box, shortEdge } = boxes.find((b) => b.id === "vertical")!;
    const out = fitLine("x".repeat(300), box, shortEdge);
    expect(out.sizeRatio).toBeGreaterThanOrEqual(TYPE_SIZE.min);
    expect(out.text, "and trims instead").toMatch(/…$/);
  });

  it("cuts on a word, not mid-word", () => {
    const { box, shortEdge } = boxes.find((b) => b.id === "vertical")!;
    const source = "A very long proof line that nobody could possibly read in three seconds flat";
    const out = fitLine(source, box, shortEdge);
    expect(out.text).toMatch(/…$/);
    /* Whatever survived is a run of whole words from the front of the line. */
    const kept = out.text.replace(/…$/, "");
    expect(source.startsWith(kept), `"${kept}" is not the start of the line`).toBe(true);
    expect(source[kept.length] === " " || kept.length === source.length, `"${kept}" stopped mid-word`).toBe(true);
  });

  it("is given lines the script writer thinks are fine, which is why this has to exist", () => {
    /* A proof beat's reading-speed budget, set large, does not fit a vertical frame. */
    const { box, shortEdge } = boxes.find((b) => b.id === "vertical")!;
    const budget = lineLimit("proof", 3);
    const atMaxSize = charsPerLine(box.width, Math.round(shortEdge * TYPE_SIZE.max));
    expect(budget, "the two limits disagree, and that is the bug this guards").toBeGreaterThan(atMaxSize);
  });
});

describe("what the video model is told", () => {
  const plate = planPlates(planShots(beatPlan(30)))[0];
  const prompt = platePrompt({
    brief: "We roast coffee in small batches and deliver it the week it is roasted.",
    style: adStyle("problem_solution")!,
    plate,
    brandMoment: true,
    businessName: "Ember Roast",
  });

  it("names the business before anything else", () => {
    /*
     * The first advert this product generated was "a zoom into a desk with
     * nothing on it". The model had been handed the style's plate direction
     * and nothing about the business, so it drew the direction.
     */
    const subject = prompt.indexOf("roast coffee in small batches");
    expect(subject, "the brief is not in the prompt at all").toBeGreaterThan(-1);
    expect(subject).toBeLessThan(prompt.indexOf("Setting:"));
  });

  it("puts the prohibitions last, and not in the prompt at all", () => {
    /* A model given "no text" before the scene spends the frame on text. */
    for (const banned of ["no text", "do not", "avoid"]) {
      expect(prompt.toLowerCase(), `"${banned}" belongs in the negative prompt`).not.toContain(banned);
    }
    expect(plateNegativePrompt()).toContain("text");
    expect(plateNegativePrompt()).toContain("logo");
  });

  it("never asks for the four things that are composited from the business's own files", () => {
    for (const thing of ["logo", "lettering", "watermark", "price tag"]) {
      expect(PLATE_NEGATIVE as readonly string[], thing).toContain(thing);
    }
  });

  it("asks for room rather than forbidding clutter", () => {
    expect(prompt).toContain("Composition:");
    expect(prompt).toContain("lower third");
  });

  it("asks for one continuous move, because the shots are cut out of it", () => {
    expect(prompt).toContain("one continuous move");
    expect(prompt).toContain(plate.camera);
  });

  it("asks for photography rather than for the word realistic", () => {
    expect(prompt).toMatch(/lens/);
    expect(prompt).not.toMatch(/\brealistic\b/i);
  });

  it("asks for a clear surface when the product will be composited onto it", () => {
    const productPlate = planPlates(planShots(beatPlan(30))).find((p) => p.beats.includes("product"))!;
    const withProduct = platePrompt({
      brief: "We roast coffee in small batches.", style: adStyle("demonstration")!,
      plate: productPlate, brandMoment: false,
    });
    expect(withProduct).toContain("nothing standing on it");
  });
});
