/**
 * The script writer's shape, and what it refuses.
 *
 * The model fills a structure it did not choose: the beats, their order, the
 * seconds each has and therefore the characters it may use are all settled
 * before anything is asked. That is the difference between "write me an
 * advert" — which produces a description of a product — and an advert.
 *
 * What is tested here is the structure and the refusals, not the prose. The
 * refusals are the part that protects somebody: a testimonial the model wrote
 * is a fabricated statement attributed to a customer, and a number it chose is
 * a claim the business has to defend.
 */
import { describe, it, expect } from "vitest";
import { beatPlan } from "@shared/ads";
import { adStyle } from "@shared/ad-styles";
import { brandVoice } from "@shared/ad-brand";
import { CLAIM_PHRASES, checkScript, describeProblem, lineLimit, scriptPrompt, type AdScript } from "@shared/ad-script";

const beats = beatPlan(30, adStyle("problem_solution")!.beatWeights);
const script = (over: Partial<AdScript> = {}): AdScript => ({
  lines: beats.map((b) => ({ beat: b.id, onScreen: "Short line" })),
  callToAction: "Order at acme.test",
  ...over,
});

describe("how much a line may say", () => {
  it("gives a two-second hook fewer characters than a longer beat", () => {
    expect(lineLimit("hook", 2)).toBeLessThan(lineLimit("proof", 6));
  });

  it("is bounded by reading speed, not just by size", () => {
    /*
     * Roughly fifteen characters a second is comfortable. A one-second line
     * of forty characters is a line nobody finishes, however well it fits.
     */
    expect(lineLimit("proof", 1)).toBeLessThanOrEqual(20);
    expect(lineLimit("proof", 10)).toBeGreaterThan(lineLimit("proof", 1));
  });

  it("never returns something unusable", () => {
    for (const beat of ["hook", "problem", "product", "proof", "cta"] as const) {
      for (const s of [1, 2, 5, 10]) {
        expect(lineLimit(beat, s), `${beat} ${s}s`).toBeGreaterThanOrEqual(12);
      }
    }
  });
});

describe("what a script is checked against", () => {
  it("passes a script that fits and claims nothing", () => {
    expect(checkScript(script(), beats, { callToAction: "Order at acme.test" })).toEqual([]);
  });

  it("catches a line that will be clipped mid-word", () => {
    const long = script();
    long.lines[0].onScreen = "x".repeat(200);
    const problems = checkScript(long, beats, {});
    expect(problems.some((p) => p.kind === "too_long")).toBe(true);
  });

  it("catches a word the business does not say", () => {
    const s = script();
    s.lines[1].onScreen = "Cheap and cheerful";
    const problems = checkScript(s, beats, { avoidWords: ["cheap"] });
    expect(problems.some((p) => p.kind === "banned_word")).toBe(true);
  });

  it("looks in the voiceover too, not only on screen", () => {
    const s = script();
    s.lines[1].voiceover = "The cheapest sauce around";
    expect(checkScript(s, beats, { avoidWords: ["cheapest"] }).some((p) => p.kind === "banned_word")).toBe(true);
  });

  it("refuses a claim the business has not supported", () => {
    /*
     * Each of these has legal weight a small business usually does not know
     * about. The model reaching for one is our problem; the business saying it
     * is theirs.
     */
    for (const phrase of ["clinically proven", "guaranteed", "FDA approved"]) {
      const s = script();
      s.lines[2].onScreen = `It is ${phrase}`;
      const problems = checkScript(s, beats, {});
      expect(problems.some((p) => p.kind === "unsupported_claim"), phrase).toBe(true);
    }
  });

  it("allows a claim the business made themselves", () => {
    const s = script();
    s.lines[2].onScreen = "Clinically proven";
    const problems = checkScript(s, beats, { supportedClaims: ["clinically proven by trial X"] });
    expect(problems.some((p) => p.kind === "unsupported_claim")).toBe(false);
  });

  it("refuses a reworded call to action", () => {
    /*
     * The one line nobody improves. A business that wrote "Order at acme.test"
     * means that address, and "Order today at Acme" changes where the money
     * goes.
     */
    const s = script({ callToAction: "Order today at Acme!" });
    const problems = checkScript(s, beats, { callToAction: "Order at acme.test" });
    expect(problems.some((p) => p.kind === "cta_changed")).toBe(true);
  });

  it("notices a beat with no line at all", () => {
    const s = script();
    s.lines = s.lines.slice(1);
    expect(checkScript(s, beats, {}).some((p) => p.kind === "missing_beat")).toBe(true);
  });

  it("returns every problem rather than the first", () => {
    /* A model handed one correction at a time takes several paid rounds. */
    const s = script({ callToAction: "Buy now" });
    s.lines[0].onScreen = "y".repeat(200);
    s.lines[1].onScreen = "guaranteed cheap";
    const problems = checkScript(s, beats, { avoidWords: ["cheap"], callToAction: "Order at acme.test" });
    expect(new Set(problems.map((p) => p.kind)).size).toBeGreaterThanOrEqual(3);
  });

  it("says each problem in a sentence a model can act on", () => {
    const s = script({ callToAction: "Buy" });
    s.lines[0].onScreen = "z".repeat(200);
    for (const p of checkScript(s, beats, { callToAction: "Order at acme.test" })) {
      const said = describeProblem(p);
      expect(said.length, p.kind).toBeGreaterThan(20);
      /* Naming the beat is what makes it actionable. */
      if ("beat" in p) expect(said).toContain(p.beat);
    }
  });
});

describe("the instructions the model gets", () => {
  const prompt = (over: Parameters<typeof scriptPrompt>[0] | null = null) => scriptPrompt(over ?? {
    brief: "we sell hot sauce made by my mum",
    style: adStyle("problem_solution")!,
    beats,
    voice: brandVoice("warm")!,
    businessName: "Acme Sauces",
    callToAction: "Order at acme.test",
    avoidWords: ["cheap"],
  });

  it("puts the business's own words first, as the subject", () => {
    /* A model given the rules before the brief writes to the rules. */
    const p = prompt();
    expect(p.indexOf("hot sauce made by my mum")).toBeLessThan(p.indexOf("Rules:"));
  });

  it("states the space each beat has, so it writes to it rather than being cropped", () => {
    const p = prompt();
    for (const b of beats) {
      expect(p, b.id).toContain(`${b.id}: ${b.seconds}s`);
      expect(p).toContain(`${lineLimit(b.id, b.seconds)} characters`);
    }
  });

  it("forbids inventing a customer, a number or a result", () => {
    expect(prompt()).toMatch(/Do not invent a customer, a review, a number, a price or a result/);
  });

  it("says plainly when there is no evidence for any claim", () => {
    const p = prompt({
      brief: "x", style: adStyle("problem_solution")!, beats, voice: brandVoice("plain")!,
    });
    expect(p).toMatch(/supplied no evidence for any claim, so make none/);
  });

  it("carries the style's own failure mode, not a generic warning", () => {
    /* A testimonial invents a customer; a transformation implies a result. */
    const testimonial = scriptPrompt({
      brief: "x", style: adStyle("social_proof")!, beats, voice: brandVoice("plain")!,
    });
    expect(testimonial).toContain(adStyle("social_proof")!.avoid);
    expect(testimonial).not.toContain(adStyle("unboxing")!.avoid);
  });

  it("demands the call to action verbatim when there is one", () => {
    expect(prompt()).toMatch(/exactly "Order at acme\.test".*character for character/s);
  });

  it("asks for an answer it can parse", () => {
    expect(prompt()).toMatch(/Answer as JSON/);
    expect(prompt()).toContain('"onScreen"');
  });
});

describe("the claim list", () => {
  it("holds phrases with legal weight rather than rude words", () => {
    for (const phrase of ["clinically proven", "FDA approved", "guaranteed"]) {
      expect(CLAIM_PHRASES).toContain(phrase);
    }
    expect(CLAIM_PHRASES.length).toBeGreaterThan(8);
  });
});
