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
  /** The beat this line belongs to. A commercial beat id, or a story format's own. */
  beat: string;
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
  /**
   * The world every shot of this advert happens in, established once.
   *
   * Written before the scenes and sent with every single generation — into
   * each plate prompt and each keyframe. Without it the model is handed one
   * sentence per clip and invents everything the sentence does not mention,
   * which is a different building, a different time of day and a different
   * palette each time. It takes the shortest path from the words it is given
   * to something plausible, and the way to stop that is to leave it less to
   * invent rather than to ask it to try harder.
   *
   * So this is deliberately dense: materials, scale, light, colour, the time
   * of day, what the place is made of and what is always in it. Repetition
   * across clips is the point. It is the only thing in the advert that does
   * not change.
   */
  world?: string;
  /**
   * Who the film follows, described once.
   *
   * The same job as `world` and for the same reason: each clip is generated
   * alone, so a character mentioned only in passing is a different person in
   * every shot. Described here in full — age, build, hair, clothes, what they
   * are holding — and sent with every keyframe, which is what makes shot four
   * the same person as shot one.
   *
   * Only the formats that have a character ask for one. A before-and-after has
   * no face in it at all.
   */
  character?: string;
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
export function lineLimit(beat: string, seconds: number): number {
  /*
   * Takes a string rather than the commercial beat ids, because the story
   * formats in `shared/ad-stories.ts` name their own beats — "greet",
   * "breaking", "punchline" — and they are read in exactly the same way: by
   * somebody with a few seconds and a phone. A beat this does not recognise
   * gets the middle size, which is the right answer for an unknown.
   */
  const bySize: Record<string, number> = {
    hook: 28,
    problem: 40,
    product: 24,
    proof: 48,
    cta: 32,
  };
  /* Fifteen characters a second, comfortably read, capped by what fits at that size. */
  return Math.max(12, Math.min(bySize[beat] ?? 32, Math.round(seconds * 15)));
}

/**
 * How many characters a caption may use, as against a headline.
 *
 * `lineLimit` answers a different question: how much copy fits on one line set
 * large over footage, which comes out at about thirty characters and is right
 * for an advert. Applied to dialogue it produced "Yo—forklift vlogging in
 * vents." — a sentence crushed until the grammar fell out, which reads exactly
 * as badly as it sounds.
 *
 * This is reading speed at caption size over two lines: about seventeen
 * characters a second, which is what somebody comfortably reads while also
 * watching the picture, capped at what two lines actually hold. A four-second
 * beat gets about sixty-eight characters, which is a sentence.
 */
export function captionLimit(seconds: number): number {
  const CHARS_PER_SECOND = 17;
  /* Two lines at caption size on the narrowest frame this sells. */
  const TWO_LINES = 70;
  return Math.max(24, Math.min(TWO_LINES, Math.round(seconds * CHARS_PER_SECOND)));
}

export type ScriptProblem =
  | { kind: "too_long"; beat: string; limit: number; was: number }
  | { kind: "banned_word"; beat: string; word: string }
  | { kind: "missing_beat"; beat: string }
  | { kind: "unsupported_claim"; beat: string; phrase: string }
  | { kind: "cta_changed"; expected: string; was: string }
  | { kind: "missing_scene"; beat: string }
  | { kind: "missing_world" }
  | { kind: "thin_world"; was: number; want: number }
  | { kind: "world_directs"; phrase: string }
  | { kind: "missing_character" }
  | { kind: "thin_character"; was: number; want: number }
  | { kind: "product_too_early"; beat: string; notBefore: string }
  | { kind: "vague_scene"; beat: string; word: string }
  | { kind: "scene_describes_overlay"; beat: string; word: string };

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
/**
 * How much the world has to say before it is worth sending.
 *
 * A sentence is not a world. The number is in characters because that is what
 * can be checked: anything shorter than this has not named the materials, the
 * light and the scale, and those three are what the model otherwise invents
 * differently in every clip.
 */
export const WORLD_MIN_CHARS = 300;

/**
 * How much the character has to say before they can be drawn twice.
 *
 * Shorter than the world, because a person is a smaller thing to specify than
 * a place — but long enough to rule out "a young woman", which is a
 * description that produces a different young woman in every shot.
 */
export const CHARACTER_MIN_CHARS = 120;

/**
 * Phrases that turn the world from a description into a shot list.
 *
 * The world is sent to an image model with every single frame, and an
 * instruction in it is obeyed on every single frame — literally, and in the
 * cheapest way that satisfies the words. A world that said "every shot keeps
 * the spire or its reflection in frame" produced an interior scene with a
 * scale model of the tower standing on a plinth in the room, being filmed.
 * The rule was followed exactly and the advert was wrong.
 *
 * Continuity between shots is this code's job and it is handled in the prompt
 * scaffolding. The world's job is to say what the place is made of, so that
 * when a shot does show it, it is the same place.
 */
export const WORLD_DIRECTIVES = [
  "every shot", "each shot", "every frame", "each frame", "in frame",
  "the camera", "camera always", "always keep", "must appear", "always show",
  "never cut", "always include",
];

/**
 * Words that describe nothing.
 *
 * Every one of these is the model — or the writer — reaching for a shortcut:
 * they sound like a specification and leave the frame entirely to chance.
 * "A modern workspace" is not a place, and six clips of it are six different
 * places. Refused in a scene, so the retry has to name something instead.
 */
export const VAGUE_WORDS = [
  "modern", "sleek", "stylish", "beautiful", "vibrant", "dynamic", "futuristic",
  "generic", "various", "something", "some kind", "etc", "and so on",
  "high-tech", "state-of-the-art", "cutting-edge", "innovative",
];

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
  beats: { id: string; seconds: number }[],
  context: {
    avoidWords?: string[]; callToAction?: string | null; supportedClaims?: string[];
    /** Styles that draw their own keyframes must establish the world first. */
    needsWorld?: boolean;
    /** Formats that follow somebody must describe them before any scene does. */
    needsCharacter?: boolean;
    /**
     * How long a line may be, when it is not a headline.
     *
     * Must be the same function the prompt quoted. Defaults to `lineLimit`,
     * which is right for an advert.
     */
    limitFor?: (beat: string, seconds: number) => number;
    /**
     * The beat before which the product may not appear, and the words that
     * would mean it has. Checked because "show the product late" is advice and
     * a beat boundary is a rule — and it is the one rule that separates a film
     * somebody watches from an advert they scroll past.
     */
    productNotBefore?: { beat: string; words: string[] } | null;
  },
): ScriptProblem[] {
  const problems: ScriptProblem[] = [];

  if (context.needsWorld) {
    const world = script.world?.trim() ?? "";
    if (!world) problems.push({ kind: "missing_world" });
    else if (world.length < WORLD_MIN_CHARS) {
      problems.push({ kind: "thin_world", was: world.length, want: WORLD_MIN_CHARS });
    } else {
      for (const phrase of WORLD_DIRECTIVES) {
        if (world.toLowerCase().includes(phrase)) {
          problems.push({ kind: "world_directs", phrase });
          break;
        }
      }
    }
  }
  const supported = (context.supportedClaims ?? []).map((s) => s.toLowerCase());

  if (context.needsCharacter) {
    const who = script.character?.trim() ?? "";
    if (!who) problems.push({ kind: "missing_character" });
    else if (who.length < CHARACTER_MIN_CHARS) {
      problems.push({ kind: "thin_character", was: who.length, want: CHARACTER_MIN_CHARS });
    }
  }

  const earlyUntil = context.productNotBefore
    ? beats.findIndex((b) => b.id === context.productNotBefore!.beat)
    : -1;

  for (const [index, beat] of beats.entries()) {
    const line = script.lines.find((l) => l.beat === beat.id);
    if (!line) {
      problems.push({ kind: "missing_beat", beat: beat.id });
      continue;
    }
    /*
     * The same budget the writer was quoted, not a second opinion.
     *
     * This read `lineLimit` while the story prompt quoted `captionLimit`, so
     * the model was asked for sixty-eight characters and refused at
     * thirty-three. It wrote a sentence, was told it was too long, shrank, and
     * every line in every story landed at about thirty characters — which is
     * precisely the fragmentary dialogue the caption budget was meant to fix.
     * A check that disagrees with the instructions is worse than either on its
     * own: it silently enforces the one nobody was told about.
     */
    const limit = (context.limitFor ?? lineLimit)(beat.id, beat.seconds);
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
      /*
       * The product, arriving before it was earned. Word-matched against the
       * business's own words for it, which is the only handle there is — a
       * scene that says "she picks up the tracker" when the tracker is the
       * product is the product on screen, whatever beat it is in.
       */
      if (earlyUntil > 0 && index < earlyUntil) {
        for (const word of context.productNotBefore!.words) {
          if (word.length > 2 && new RegExp(`\\b${word}`, "i").test(scene)) {
            problems.push({ kind: "product_too_early", beat: beat.id, notBefore: context.productNotBefore!.beat });
            break;
          }
        }
      }
      for (const word of VAGUE_WORDS) {
        if (new RegExp(`\\b${word.replace(/[-\s]/g, "[-\\s]")}\\b`, "i").test(scene)) {
          problems.push({ kind: "vague_scene", beat: beat.id, word });
        }
      }
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
    case "too_long": {
      /*
       * A target with room in it, not the limit.
       *
       * Told "must be 32 or fewer" against a 33-character line, a model shaves
       * one word ending and comes back at 33 again — it is aiming at the edge
       * and missing by the same margin every time. Three attempts went that
       * way and the advert failed without a clip being generated. Asking for
       * about a tenth under gives it somewhere to land, and a line a few
       * characters shorter than the maximum is not a worse line.
       */
      const target = Math.max(8, Math.floor(p.limit * 0.9));
      return `The ${p.beat} line is ${p.was} characters and must be ${p.limit} or fewer. Rewrite it to about ${target} characters — aim well under the limit rather than at it, or you will land on it again.`;
    }
    case "banned_word": return `The ${p.beat} line uses "${p.word}", which this business does not say.`;
    case "missing_beat": return `There is no line for the ${p.beat} beat.`;
    case "unsupported_claim": return `The ${p.beat} line says "${p.phrase}", which is a claim the business has not supported. Remove it.`;
    case "cta_changed": return `The call to action must be exactly "${p.expected}" and was "${p.was}".`;
    case "missing_scene": return `The ${p.beat} beat has no scene. Describe what is in shot, in one sentence.`;
    case "missing_world": return `There is no "world" field. Describe the place every shot happens in — materials, scale, light, colour, time of day, what is always in it — before writing any scene.`;
    case "missing_character": return `There is no "character" field. Describe the one person this film follows — age, build, hair, clothes, what they are holding, how they carry themselves — before writing any scene.`;
    case "thin_character": return `The "character" is ${p.was} characters and needs at least ${p.want}. "A young woman" is a different young woman in every shot; name what they are wearing and what they are holding.`;
    case "product_too_early": return `The ${p.beat} scene shows the product, which must not appear before the "${p.notBefore}" beat. The beats before it are the story that earns it — take it out of this one entirely, including on screens, shelves and in hands.`;
    case "world_directs": return `The "world" says "${p.phrase}", which directs the camera instead of describing the place. It is sent with every frame, so an instruction in it is obeyed on every frame, literally — one that asked for the building to stay in shot produced a scale model of it standing in a room. Describe only what the place is made of, how big it is and how it is lit.`;
    case "thin_world": return `The "world" is ${p.was} characters and needs at least ${p.want}. Name the materials, the scale, the light, the colour and the time of day; anything left out is something the camera will invent differently in every shot.`;
    case "vague_scene": return `The ${p.beat} scene says "${p.word}", which describes nothing and leaves the frame to chance. Name the actual thing: what it is made of, what colour, what size.`;
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
  beats: { id: string; seconds: number; moments?: number }[];
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
    input.style.logoRole
      ? `First, establish the WORLD: the one place every shot of this advert happens in. At least ${WORLD_MIN_CHARS} characters, and dense with specifics — what the place is built from, how big it is, the quality and direction of the light, the time of day, the palette, what the air looks like, and the few large things that are always in it. Keep it to a handful of big objects rather than a list of small ones: anything small and scattered will morph and slide once the frames are animated. Say where the light in this place comes from, and give it enough of it to be seen by: a world with no light sources named is one the camera renders nearly black. Every detail you leave out is one the camera will invent differently in each shot, so leave out nothing.\nDescribe the place and nothing else. No instructions about shots, framing or what the camera should do — this text is sent with every frame, so a rule inside it is obeyed on every frame and taken literally. Then write the beats, every one of them inside that world.`
      : ``,
    input.style.logoRole ? `` : ``,
    `For each beat, write two things: the line that appears on screen, and the scene the camera is looking at while it does.`,
    ``,
    `Rules for the scene:`,
    input.style.logoRole
      ? `- These scenes are moments of ONE journey through ONE place, in order, and the company's mark is part of that place: ${input.style.logoRole} Each scene carries on from the last — further in, further up, further out — and the place stays recognisably the same throughout. Say where this moment is in the journey.`
      : ``,
    /*
     * Variety of scale, demanded rather than hoped for. Left to itself the
     * model writes an establishing shot every time, and nine establishing
     * shots of the same building is a slideshow of one idea.
     */
    input.style.logoRole
      ? `- Vary how close the camera is. Only one or two of these are wide shots of the whole place; the rest are inside it, at a bench, over a shoulder, on a detail — hands, a tool, a face turned away, something being lifted. A run of wide shots of the same building is one idea repeated, not a journey.`
      : ``,
    /*
     * The move, named per scene. Each clip is animated from a still, so if the
     * scene does not say what happens, almost nothing does.
     */
    input.style.logoRole
      ? `- Say what MOVES in the shot, not just what is in it: who walks where, what is lifted, what the light does, which way the camera travels. Each shot is a few seconds of motion, and a scene that describes only furniture produces a photograph.`
      : ``,
    /*
     * A light source in every scene, named.
     *
     * A world set at night or at blue hour is a world the model will happily
     * render nearly black, and it is right to — it was told it is dark. Two
     * shots of one advert came back with the lower half of the frame lost.
     * Brightening that afterwards only lifts noise; what fixes it is something
     * in the scene that is actually giving off light, which is also how a
     * cinematographer would solve it.
     */
    input.style.logoRole
      ? `- Name a light in every scene and say what it falls on — a lamp, a doorway, a screen, a window, a flame, a work light. A dark world is still a lit frame: a viewer has to be able to see the thing the shot is about.`
      : ``,
    `- Concrete and specific, and written as what a camera sees. Name the things: what they are made of, what colour, how big, how lit. Two sentences at most.`,
    /*
     * Few and large, for the same reason as the keyframe. A scene that lists a
     * dozen small objects is a clip in which a dozen small objects morph.
     */
    `- Name at most three or four things in shot, and make them big enough to see. Scattered small items — screws, cables, papers, offcuts, clutter — come out of a generated clip sliding, multiplying and changing shape, so a scene that asks for a cluttered bench gets one that will not hold still.`,
    /*
     * Named rather than described, because "be specific" is advice and a list
     * of refused words is a rule. These are the words that sound like a
     * specification and commit to nothing.
     */
    `- Never use these words, which describe nothing: ${VAGUE_WORDS.slice(0, 10).join(", ")}. If one of them is the word that fits, the detail has not been decided yet — decide it.`,
    input.style.logoRole
      ? `- Carry the world through. Every scene restates the details of the place that are visible in it — the same materials, the same light, the same palette — because each shot is generated on its own and anything unsaid is re-invented.`
      : ``,
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
    input.style.logoRole
      ? `Answer as JSON: { "world": "...", "lines": [ { "beat": "...", "onScreen": "...", "scene": "...", "voiceover": "..." } ], "callToAction": "..." }`
      : `Answer as JSON: { "lines": [ { "beat": "...", "onScreen": "...", "scene": "...", "voiceover": "..." } ], "callToAction": "..." }`,
  ].filter(Boolean).join("\n");
}
