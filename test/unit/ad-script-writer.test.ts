/**
 * The retry loop, driven by a stand-in model.
 *
 * Every interesting case here is a specific bad answer: a line nine characters
 * too long, a fabricated claim, a model that fixes one problem and breaks
 * another, a model that returns a paragraph. Waiting for the real one to
 * produce each of those on cue is a coin toss with a bill attached, so `ask`
 * is injected and each test says exactly what came back.
 */
import { describe, it, expect } from "vitest";
import {
  writeAdScript, stubScript, ScriptUnusableError, SCRIPT_ATTEMPTS,
  type ScriptRequest, type AskModel,
} from "../../server/ad-script-writer";
import { lineLimit } from "@shared/ad-script";

const REQUEST: ScriptRequest = {
  brief: "We roast coffee in small batches and deliver it the week it is roasted.",
  style: { label: "Problem and solution", bestFor: "Works with nothing but a brief.", avoid: "No stock-footage clichés." },
  beats: [{ id: "hook", seconds: 2 }, { id: "product", seconds: 3 }, { id: "cta", seconds: 2 }],
  voice: { label: "Warm", how: "Write like a person talking to one other person." },
  businessName: "Ember Roast",
  callToAction: "Order at ember.test",
};

/** An answer the rules accept, so a test only has to describe what it changes. */
const good = (over: Partial<Record<string, unknown>> = {}) => JSON.stringify({
  lines: [
    { beat: "hook", onScreen: "Roasted this week", scene: "Steam rising off a cup on a wooden counter, early light from one window." },
    { beat: "product", onScreen: "Ember Roast", scene: "A clean wooden worktop by a window, empty, lit evenly from the side." },
    { beat: "cta", onScreen: "Order now", scene: "An open doorway onto a bright street, shot from inside, shallow focus." },
  ],
  callToAction: "Order at ember.test",
  ...over,
});

/** Hands back each scripted answer in turn, and records what it was asked. */
function scripted(...answers: string[]): AskModel & { asked: string[] } {
  const asked: string[] = [];
  const ask = (async ({ user }: { system: string; user: string }) => {
    asked.push(user);
    return answers[asked.length - 1] ?? answers[answers.length - 1];
  }) as AskModel & { asked: string[] };
  ask.asked = asked;
  return ask;
}

describe("writing an advert script", () => {
  it("takes a first answer that fits", async () => {
    const ask = scripted(good());
    const out = await writeAdScript(REQUEST, { ask });
    expect(out.attempts).toBe(1);
    expect(out.rejected).toEqual([]);
    expect(out.script.lines.map((l) => l.beat)).toEqual(["hook", "product", "cta"]);
  });

  it("asks again when a line does not fit, and names what was wrong", async () => {
    const tooLong = JSON.stringify({
      lines: [
        { beat: "hook", onScreen: "Coffee roasted in small batches every single week", scene: "Steam rising off a cup on a counter." },
        { beat: "product", onScreen: "Ember Roast", scene: "A clean worktop by a window." },
        { beat: "cta", onScreen: "Order now", scene: "An open doorway onto a bright street." },
      ],
      callToAction: "Order at ember.test",
    });
    const ask = scripted(tooLong, good());
    const out = await writeAdScript(REQUEST, { ask });

    expect(out.attempts).toBe(2);
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0][0].kind).toBe("too_long");
    // The retry has to carry the problem, or the second attempt is the first one again.
    expect(ask.asked[1]).toContain(`must be ${lineLimit("hook", 2)} or fewer`);
    expect(ask.asked[1]).toContain("Leave every other line as it was");
  });

  it("hands back every problem at once rather than one per round", async () => {
    const bad = JSON.stringify({
      lines: [
        { beat: "hook", onScreen: "Clinically proven coffee, roasted every single week of the year", scene: "Steam rising off a cup." },
        { beat: "cta", onScreen: "Order now", scene: "An open doorway onto a street." },
      ],
      callToAction: "Order at ember.test",
    });
    const ask = scripted(bad, good());
    await writeAdScript(REQUEST, { ask });

    const kinds = ask.asked[1];
    expect(kinds, "a too-long line").toContain("characters and must be");
    expect(kinds, "a claim nobody supported").toContain("clinically proven");
    expect(kinds, "a beat with no line").toContain("no line for the product beat");
  });

  it("gives up after the last attempt rather than rendering a broken script", async () => {
    const bad = JSON.stringify({ lines: [], callToAction: "Order at ember.test" });
    const ask = scripted(bad, bad, bad, good());

    await expect(writeAdScript(REQUEST, { ask })).rejects.toThrow(ScriptUnusableError);
    expect(ask.asked, "stopped at the limit instead of asking a fourth time").toHaveLength(SCRIPT_ATTEMPTS);
  });

  it("reports an unusable script as 422, not as the model being unreachable", async () => {
    const ask = scripted(JSON.stringify({ lines: [], callToAction: "Order at ember.test" }));
    const err = await writeAdScript(REQUEST, { ask, attempts: 1 }).catch((e) => e);
    expect(err.status, "502 would tell them to try again, which is what just happened").toBe(422);
    expect(err.code).toBe("script_unusable");
    expect(err.message).toContain("no line for the hook beat");
  });

  it("survives junk among the lines instead of throwing on it", async () => {
    /*
     * A model that half-loses the thread returns a mixture: one real line, a
     * bare string, a null. Reading those without checking their shape is a
     * TypeError on `l.onScreen.trim()` — a 500 from inside the writer, when
     * what happened is an answer with two unusable lines in it.
     */
    const mixed = JSON.stringify({
      lines: [{ beat: "hook", onScreen: "Roasted this week", scene: "Steam off a cup." }, "product line here", null, { beat: "cta" }],
      callToAction: "Order at ember.test",
    });
    const err = await writeAdScript(REQUEST, { ask: scripted(mixed), attempts: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(ScriptUnusableError);
    expect(err.message, "the two beats with no usable line").toContain("no line for the product beat");
  });

  it("refuses prose, and says it was unreadable rather than counting missing beats", async () => {
    const ask = scripted("Here's a lovely script for your coffee advert!");
    const err = await writeAdScript(REQUEST, { ask, attempts: 1 }).catch((e) => e);
    expect(err.code).toBe("model_unreadable");
  });
});

describe("the scene each beat is shot in", () => {
  it("is required, because without it every plate falls back to the style's generic direction", async () => {
    const noScene = JSON.stringify({
      lines: [
        { beat: "hook", onScreen: "Roasted this week" },
        { beat: "product", onScreen: "Ember Roast" },
        { beat: "cta", onScreen: "Order now" },
      ],
      callToAction: "Order at ember.test",
    });
    const ask = scripted(noScene, good());
    const out = await writeAdScript(REQUEST, { ask });
    expect(out.attempts).toBe(2);
    expect(ask.asked[1]).toContain("has no scene");
  });

  it("is refused when it asks for something that gets composited over the top", async () => {
    /*
     * A generated logo is drawn underneath the real one, and a generated word
     * is drawn underneath the typeset one. Asking for either in the scene is
     * the surest way to get both.
     */
    const overlay = JSON.stringify({
      lines: [
        { beat: "hook", onScreen: "Roasted this week", scene: "A shop front with the logo above the door and a price list in the window." },
        { beat: "product", onScreen: "Ember Roast", scene: "A clean worktop by a window." },
        { beat: "cta", onScreen: "Order now", scene: "An open doorway onto a street." },
      ],
      callToAction: "Order at ember.test",
    });
    const ask = scripted(overlay, good());
    await writeAdScript(REQUEST, { ask });
    expect(ask.asked[1]).toContain("added afterwards from the business's own files");
  });

  it("does not trip over a word that merely contains a forbidden one", async () => {
    /* "building" contains "ui"; "design" contains "sign". Neither is an overlay. */
    const fine = JSON.stringify({
      lines: [
        { beat: "hook", onScreen: "Roasted this week", scene: "A brick building seen from across a quiet street at dawn." },
        { beat: "product", onScreen: "Ember Roast", scene: "A designer's worktop, tools laid out, lit from the side." },
        { beat: "cta", onScreen: "Order now", scene: "An open doorway onto a bright street." },
      ],
      callToAction: "Order at ember.test",
    });
    const out = await writeAdScript(REQUEST, { ask: scripted(fine) });
    expect(out.attempts, "a false positive here costs a paid retry every time").toBe(1);
  });
});

describe("the call to action", () => {
  it("is put back to the business's own words without a second call", async () => {
    const ask = scripted(good({ callToAction: "Order today at Ember Roast!" }));
    const out = await writeAdScript(REQUEST, { ask });

    expect(ask.asked, "repairing it must not cost a paid round trip").toHaveLength(1);
    expect(out.script.callToAction).toBe("Order at ember.test");
  });

  it("records the repair, so nobody reads it as the model having complied", async () => {
    const ask = scripted(good({ callToAction: "Order today at Ember Roast!" }));
    const out = await writeAdScript(REQUEST, { ask });
    expect(out.repaired).toEqual([
      { kind: "cta_changed", expected: "Order at ember.test", was: "Order today at Ember Roast!" },
    ]);
  });

  it("is left alone when the business supplied none", async () => {
    const ask = scripted(good({ callToAction: "Try a bag" }));
    const out = await writeAdScript({ ...REQUEST, callToAction: null }, { ask });
    expect(out.script.callToAction).toBe("Try a bag");
    expect(out.repaired).toEqual([]);
  });
});

describe("the stub script", () => {
  it("passes the same checks a real answer has to", async () => {
    // No `ask`: this is the path a stubbed server takes.
    const out = await writeAdScript(REQUEST, { ask: async () => JSON.stringify(stubScript(REQUEST)) });
    expect(out.attempts, "a stub that needs retries is a stub that cannot be used").toBe(1);
  });

  it("fits every beat's limit", () => {
    const script = stubScript(REQUEST);
    for (const line of script.lines) {
      const beat = REQUEST.beats.find((b) => b.id === line.beat)!;
      expect(line.onScreen.length).toBeLessThanOrEqual(lineLimit(line.beat, beat.seconds));
    }
  });

  it("cuts a line down when the beat is short enough to need it", async () => {
    /*
     * A one-second hook has fifteen characters, and "This is Ember Roast" is
     * nineteen. The three-second beats in REQUEST all fit comfortably, so
     * without a beat this tight the stub's own limit is never exercised and a
     * stub that overran would ship looking fine.
     */
    const tight: ScriptRequest = { ...REQUEST, beats: [{ id: "hook", seconds: 1 }] };
    expect(lineLimit("hook", 1)).toBeLessThan("This is Ember Roast".length);

    const script = stubScript(tight);
    expect(script.lines[0].onScreen.length).toBeLessThanOrEqual(lineLimit("hook", 1));
    const out = await writeAdScript(tight, { ask: async () => JSON.stringify(script) });
    expect(out.attempts).toBe(1);
  });

  it("reproduces the supplied call to action exactly", () => {
    expect(stubScript(REQUEST).callToAction).toBe("Order at ember.test");
  });

  it("falls back to something with no letters in it when a word is banned", () => {
    // "Ember Roast" is the product line, and the business has banned its own name.
    const script = stubScript({ ...REQUEST, avoidWords: ["ember"] });
    const product = script.lines.find((l) => l.beat === "product")!;
    expect(product.onScreen).not.toMatch(/ember/i);
    expect(product.onScreen, "any English placeholder could contain a banned word").toMatch(/^[^a-z]*$/i);
  });
});
