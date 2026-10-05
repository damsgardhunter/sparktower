/**
 * Writing the words, and refusing the ones that will not fit or are not true.
 *
 * The shape of a script is decided here and the model only fills it in. That
 * is the difference between "write me an advert", which produces a description
 * of a product, and an advert — the beats, their order, how many seconds each
 * has and therefore how many characters it may use are all settled before the
 * model is asked anything.
 *
 * ## Open-ended input, structured output
 *
 * Somebody typing "we sell hot sauce made by my mum" should get the same
 * quality as somebody who fills in twelve fields. That works by putting the
 * structure in the *instructions* rather than demanding it from the person:
 * the free text becomes the brief, and everything else — the style's beats,
 * the character budget per line, the brand's voice, the words they will not
 * say — is supplied around it.
 *
 * ## What the model is not allowed to invent
 *
 * The rules below are not about taste. A testimonial the model wrote is a
 * fabricated statement attributed to a customer; a number it chose is a claim
 * the business has to defend; a "clinically proven" is a legal category. The
 * model is given the business's own facts and told that anything else is out
 * of bounds, and the result is checked rather than trusted.
 */
import type { AdBeatId } from "./ads";

export interface ScriptLine {
  beat: AdBeatId;
  /** What appears on screen. Short — it is set large over footage. */
  onScreen: string;
  /** What is said, if there is a voice track. May be empty; many ads have none. */
  voiceover?: string;
  /**
   * What is actually in shot for this beat: one concrete scene.
   *
   * The thing that was missing, and the reason the first adverts looked
   * generic. Every plate was prompted with the *style's* scene direction —
   * "the situation the problem happens in, ordinary light, ordinary room" —
   * which is the same sentence for every beat of every advert for every
   * business. A video model handed that draws a room. A coffee roaster and a
   * software product got the same room.
   *
   * The model writing the words is the one that has just read what the
   * business does, so it is the one that can say that the problem beat is a
   * person refreshing a spreadsheet at a kitchen table at night. That is a
   * shot. "Ordinary room" is not.
   */
  scene?: string;
}

export interface AdScript {
  lines: ScriptLine[];
  /** The one action, repeated verbatim from the brand kit rather than reworded. */
  callToAction: string;
}

/**
 * How many characters a beat's on-screen line may use.
 *
 * Derived from the seconds it has and the size it will be set at, not chosen.
 * A hook is two seconds and set large, so it is a handful of words; a proof
 * line can be longer because it is smaller and on screen for longer. Reading
 * speed is the floor: roughly fifteen characters a second is comfortable, and
 * anything beyond that is a line nobody finishes.
 */
export function lineLimit(beat: AdBeatId, seconds: number): number {
  const bySize: Record<AdBeatId, number> = {
    hook: 28,
    problem: 40,
    product: 24,
    proof: 48,
    cta: 32,
  };
  /* Fifteen characters a second, comfortably read, capped by what fits at that size. */
  return Math.max(12, Math.min(bySize[beat] ?? 32, Math.round(seconds * 15)));
}

export type ScriptProblem =
  | { kind: "too_long"; beat: AdBeatId; limit: number; was: number }
  | { kind: "banned_word"; beat: AdBeatId; word: string }
  | { kind: "missing_beat"; beat: AdBeatId }
  | { kind: "unsupported_claim"; beat: AdBeatId; phrase: string }
  | { kind: "cta_changed"; expected: string; was: string }
  | { kind: "missing_scene"; beat: AdBeatId }
  | { kind: "scene_describes_overlay"; beat: AdBeatId; word: string };

/**
 * Phrases that turn a sentence into a claim somebody has to be able to
 * support.
 *
 * Not a profanity list — every one of these has a specific legal weight, and a
 * small business putting one in an advert usually does not know that. They are
 * refused unless the business supplied them, in which case they are the
 * business's own words and their own responsibility.
 */
/**
 * Things a scene must not ask the camera to show.
 *
 * All four are composited afterwards from the business's own files, and a
 * generated version of any of them is drawn *underneath* the real one — two
 * logos, two prices, a misspelt version of a word that is also set correctly
 * in type over the top. The negative prompt tells the model not to draw them;
 * this stops the scene direction asking for them in the first place, which no
 * negative prompt reliably survives.
 */
export const SCENE_FORBIDDEN = [
  "logo", "text", "lettering", "sign", "signage", "caption", "subtitle",
  "price", "label", "packaging", "watermark", "screen showing", "ui", "interface",
];

export const CLAIM_PHRASES = [
  "clinically proven", "doctor recommended", "FDA approved", "guaranteed",
  "best in the world", "number one", "#1", "cures", "treats", "prevents",
  "risk free", "100% effective", "miracle",
];

/**
 * Check a script against the space it has and the facts it was given.
 *
 * Returns every problem rather than the first, because a model handed one
 * correction at a time takes several rounds to produce something valid and
 * each round is a paid call.
 */
export function checkScript(
  script: AdScript,
  beats: { id: AdBeatId; seconds: number }[],
  context: { avoidWords?: string[]; callToAction?: string | null; supportedClaims?: string[] },
): ScriptProblem[] {
  const problems: ScriptProblem[] = [];
  const supported = (context.supportedClaims ?? []).map((s) => s.toLowerCase());

  for (const beat of beats) {
    const line = script.lines.find((l) => l.beat === beat.id);
    if (!line) {
      problems.push({ kind: "missing_beat", beat: beat.id });
      continue;
    }
    const limit = lineLimit(beat.id, beat.seconds);
    if (line.onScreen.length > limit) {
      problems.push({ kind: "too_long", beat: beat.id, limit, was: line.onScreen.length });
    }

    /*
     * A beat with no scene is a plate prompted from the style's generic
     * direction, which is the failure this field exists to stop.
     */
    const scene = line.scene?.trim() ?? "";
    if (!scene) {
      problems.push({ kind: "missing_scene", beat: beat.id });
    } else {
      for (const word of SCENE_FORBIDDEN) {
        /* Word boundaries: "ui" must not match "building", "sign" must not match "design". */
        if (new RegExp(`\\b${word}\\b`, "i").test(scene)) {
          problems.push({ kind: "scene_describes_overlay", beat: beat.id, word });
        }
      }
    }

    const haystack = `${line.onScreen} ${line.voiceover ?? ""}`.toLowerCase();
    for (const word of context.avoidWords ?? []) {
      if (word && haystack.includes(word.toLowerCase())) {
        problems.push({ kind: "banned_word", beat: beat.id, word });
      }
    }
    for (const phrase of CLAIM_PHRASES) {
      /*
       * Allowed only when the business said it themselves. Their own claim is
       * their own responsibility; one the model reached for is ours.
       */
      if (haystack.includes(phrase.toLowerCase()) && !supported.some((s) => s.includes(phrase.toLowerCase()))) {
        problems.push({ kind: "unsupported_claim", beat: beat.id, phrase });
      }
    }
  }

  if (context.callToAction && script.callToAction.trim() !== context.callToAction.trim()) {
    /*
     * The call to action is the one line nobody improves. A business that
     * wrote "Order at acme.test" means that address, and a model that makes it
     * "Order today at Acme" has changed where the money goes.
     */
    problems.push({ kind: "cta_changed", expected: context.callToAction, was: script.callToAction });
  }

  return problems;
}

/**
 * The moments of a beat's scene, as many as were asked for.
 *
 * Pads by repeating the last moment rather than leaving a plate with no scene:
 * a model that wrote two moments where three were wanted has still written
 * something usable, and failing the whole advert over the third would be
 * throwing away a good script for a formatting miss.
 */
export function sceneMoments(scene: string | undefined, wanted: number): string[] {
  const parts = (scene ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return Array.from({ length: wanted }, () => "");
  return Array.from({ length: wanted }, (_, i) => parts[Math.min(i, parts.length - 1)]);
}

/** One sentence per problem, for handing back to the model on a retry. */
export function describeProblem(p: ScriptProblem): string {
  switch (p.kind) {
    case "too_long": return `The ${p.beat} line is ${p.was} characters and must be ${p.limit} or fewer.`;
    case "banned_word": return `The ${p.beat} line uses "${p.word}", which this business does not say.`;
    case "missing_beat": return `There is no line for the ${p.beat} beat.`;
    case "unsupported_claim": return `The ${p.beat} line says "${p.phrase}", which is a claim the business has not supported. Remove it.`;
    case "cta_changed": return `The call to action must be exactly "${p.expected}" and was "${p.was}".`;
    case "missing_scene": return `The ${p.beat} beat has no scene. Describe what is in shot, in one sentence.`;
    case "scene_describes_overlay": return `The ${p.beat} scene asks for "${p.word}" to be in shot. That is added afterwards from the business's own files — describe only what the camera sees.`;
  }
}

/**
 * The instructions the model is given.
 *
 * Assembled rather than written, so the structure is the same every time and
 * only the facts change. The order matters: the business's own words first
 * because they are the subject, then the shape, then the limits, then the
 * prohibitions — a model given the rules before the brief writes to the rules.
 */
export function scriptPrompt(input: {
  brief: string;
  style: {
    label: string; bestFor: string; avoid: string;
    /**
     * Where the brand's mark lives in the world, when it lives in one.
     *
     * Set only for styles that draw their own keyframes. It changes what a
     * scene *is*: without it a scene is a place the camera happens to be, and
     * with it the places are all one place and the mark is part of it. The
     * beats stop being five separate shots and become five moments of a walk.
     */
    logoRole?: string | null;
  };
  /**
   * `moments` is how many separate clips this beat is cut from, when that is
   * more than one. A nineteen-second product beat is three generations, and
   * one scene for all three is the same room three times — which is a long
   * way from "each floor is somebody building something different". Known
   * here because the plates are planned before the script is written.
   */
  beats: { id: AdBeatId; seconds: number; moments?: number }[];
  voice: { label: string; how: string };
  businessName?: string | null;
  callToAction?: string | null;
  avoidWords?: string[];
  supportedClaims?: string[];
}): string {
  const beatLines = input.beats
    .map((b) => {
      const moments = Math.max(1, b.moments ?? 1);
      return `  - ${b.id}: ${b.seconds}s on screen, at most ${lineLimit(b.id, b.seconds)} characters`
        + (moments > 1 ? `, cut from ${moments} separate shots — so its scene needs ${moments} moments` : "");
    })
    .join("\n");

  const splitBeats = input.beats.filter((b) => (b.moments ?? 1) > 1);

  return [
    `The business, in their own words:`,
    input.brief.trim(),
    ``,
    input.businessName ? `They are called ${input.businessName}.` : ``,
    ``,
    `Write an advert in this shape — ${input.style.label}. ${input.style.bestFor}`,
    ``,
    `The beats, in order, with the space each one has:`,
    beatLines,
    ``,
    `Voice: ${input.voice.label}. ${input.voice.how}`,
    ``,
    `For each beat, write two things: the line that appears on screen, and the scene the camera is looking at while it does.`,
    ``,
    `Rules for the scene:`,
    input.style.logoRole
      ? `- These scenes are moments of ONE journey through ONE place, in order, and the company's mark is part of that place: ${input.style.logoRole} Each scene carries on from the last — further in, further up, further out — and the place stays recognisably the same throughout. Say where this moment is in the journey.`
      : ``,
    `- One sentence, concrete, and specific to this business. Name what is in shot: where it is, who is there, what they are doing, what the light is like.`,
    splitBeats.length
      ? `- Where a beat says it is cut from several shots, write that many moments in its scene, separated by " | ", in the order they play. Each moment is a different shot of its own — a different floor, a different angle, a different distance — not the same shot described twice.`
      : ``,
    `- It must be a real place a camera could be put. "An ordinary room" and "a modern workspace" are not scenes; "a kitchen table at night, laptop open, cold coffee beside it" is.`,
    /*
     * The four things composited afterwards. Said as "they are added later"
     * rather than "do not mention them", because a model told not to mention
     * a logo writes a scene that is conspicuously about not having a logo.
     */
    `- Never put words, lettering, signs, labels, prices, screens or logos in the scene. Those are added afterwards from the business's own files, over the top of this footage.`,
    `- No faces looking at the camera, and no recognisable person: a generated face is a real person's likeness being used to sell something.`,
    ``,
    `Rules for the line:`,
    `- The on-screen line for each beat must fit its character limit. It is set large over moving footage, so it is a few words, not a sentence.`,
    `- Write only what the business told you. Do not invent a customer, a review, a number, a price or a result.`,
    input.supportedClaims?.length
      ? `- These claims are the business's own and may be used: ${input.supportedClaims.join("; ")}.`
      : `- The business has supplied no evidence for any claim, so make none.`,
    input.avoidWords?.length ? `- Never use these words: ${input.avoidWords.join(", ")}.` : ``,
    input.callToAction
      ? `- The call to action is exactly "${input.callToAction}". Reproduce it character for character; do not improve it.`
      : `- There is no call to action supplied, so end on what the viewer should do in four words or fewer.`,
    `- ${input.style.avoid}`,
    ``,
    `Answer as JSON: { "lines": [ { "beat": "...", "onScreen": "...", "scene": "...", "voiceover": "..." } ], "callToAction": "..." }`,
  ].filter(Boolean).join("\n");
}
