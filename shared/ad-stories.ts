/**
 * Story formats: the shapes that get watched, as opposed to the shapes that
 * look like adverts.
 *
 * ## Why this exists beside `shared/ad-styles.ts`
 *
 * Everything in this feature until now was built on a commercial structure —
 * hook, problem, product, proof, call to action — with the brand in frame from
 * the first second. That is what an advert looks like, and looking like an
 * advert is the problem. Watching one back, the verdict was "the video just
 * seems obviously AI right now."
 *
 * The formats here are built from what actually gets watched, and they
 * contradict the commercial shape on purpose:
 *
 *   - **The hook is a picture, not a logo.** Something strange, funny or
 *     emotional in the first second or two. A viewer decides almost instantly.
 *   - **There is a character.** People follow characters, not products.
 *   - **There is one turn.** The film sets an expectation and flips it. The
 *     flip is the thing that gets shared.
 *   - **It feels native.** Selfie angles, captions, somebody talking to you.
 *     Polished commercial looks perform *worse* — which is why each format
 *     carries its own `look` and most of them are not cinematic.
 *   - **The product arrives late.** It is the payoff of a story rather than
 *     the subject of the film.
 *
 * `productAt` is the one number that encodes the last point, and it is the
 * clearest difference from the styles next door: there, the product beat is
 * the middle and the biggest. Here it is the last third.
 */
import { SHOT_KINDS, planPlates, type Shot, type ShotKindId, type Plate } from "./ad-shots";

export interface StoryBeat {
  id: string;
  label: string;
  /** What happens in it, written as direction for whoever fills the format in. */
  purpose: string;
  /** Share of the runtime. Normalised across the format, so they need not sum to one. */
  share: number;
  /** Below this it cannot land, and the beat is dropped from a short cut instead. */
  minSeconds: number;
  /** The rhythm of shots inside it. */
  shots: ShotKindId[];
}

export interface StoryFormat {
  id: string;
  label: string;
  /** One line, for somebody choosing. */
  blurb: string;
  bestFor: string;
  beats: StoryBeat[];
  /**
   * Who the film follows, as direction for inventing one.
   *
   * Set on every format that has a character, which is most of them. The
   * writer invents a specific one from the business's own brief and describes
   * them once; that description then goes into every keyframe, which is what
   * makes it the same person in shot four as in shot one.
   */
  character?: string;
  /**
   * How it is shot, and the reason each format feels like a post rather than
   * an advert. Replaces the cinematic direction entirely — a selfie vlog
   * described with a fast prime lens and shallow depth of field is a perfume
   * commercial.
   */
  look: string;
  /** Where in the runtime the product may first appear, as a fraction. */
  productAt: number;
  /** Whether the first frame of each clip is drawn, for character consistency. */
  keyframes: boolean;
  /**
   * How the on-screen line is set.
   *
   * "native" for everything that is pretending not to be an advert, which is
   * all of these but one: a caption in the company's colours is the detail
   * that gives the film away, however good the footage is. The impossible
   * visual is the exception, because it is the one format where polish is the
   * point and nobody mistakes it for a post.
   */
  captions: "native" | "bubble";
}

/**
 * Nothing in the first frames is the brand.
 *
 * Stated once and read by the prompt builders, because it is the rule most
 * likely to be quietly broken: the temptation on every generation is to put
 * the logo in, and a logo in the first second is the thing a viewer scrolls
 * past.
 */
export const HOOK_HOLD_FRACTION = 0.2;

export const STORY_FORMATS: StoryFormat[] = [
  {
    id: "character_vlog",
    label: "Character vlog",
    blurb: "A character films themselves talking about their day, and the product solves it.",
    bestFor: "Almost anything. The most reliable of these: a character carries a product nobody has heard of.",
    character: "Invent one specific character with a job and a grievance, drawn from who this business is actually for — not a model, not an everyman. Someone with a face the camera can be close to and a reason to be filming.",
    look: "THIS FOOTAGE IS THE PHONE. It is the front-facing camera of the phone the character is holding at arm's length: their face fills the upper half of the frame, they are looking straight into the lens and talking to it, and the room is behind them. Not a camera watching somebody hold a phone — the phone's own view. Handheld and slightly unsteady, lit by whatever is actually there, no colour grade and no shallow depth of field.",
    productAt: 0.55,
    keyframes: true,
    captions: "native",
    beats: [
      { id: "greet", label: "Greets the camera", purpose: "The character talks to the viewer from inside a situation that is already strange or funny. No setup, no explanation — they are mid-day and mid-problem.", share: 0.2, minSeconds: 2, shots: ["punch", "scene"] },
      { id: "complain", label: "The grievance", purpose: "What is making their day worse, in their own words, specific and small rather than grand.", share: 0.27, minSeconds: 3, shots: ["scene"] },
      { id: "discover", label: "Finds the thing", purpose: "The product arrives — shown, not announced. The first time it is on screen.", share: 0.27, minSeconds: 3, shots: ["scene", "punch"] },
      { id: "react", label: "The turn", purpose: "Their reaction, which is the joke or the relief. This is what gets shared, so it is the line somebody repeats.", share: 0.26, minSeconds: 3, shots: ["scene"] },
    ],
  },
  {
    id: "pov",
    label: "POV",
    blurb: "\"POV: you're a…\" — the viewer is the character, and the camera is their eyes.",
    bestFor: "A product whose user recognises themselves instantly. The struggle has to be one somebody has had this week.",
    character: "The viewer is the character, so describe whose eyes these are: their situation, their hands, what is in front of them. Never show their face — a point of view with a face in it is not a point of view.",
    look: "First person, camera at eye height, hands entering frame from below. Phone footage: a little shaky, available light, no grade. The viewer should feel they are holding the camera, not watching one.",
    productAt: 0.6,
    keyframes: true,
    captions: "native",
    beats: [
      { id: "setup", label: "The situation", purpose: "Where the viewer is and what they are looking at, with the on-screen line naming it: \"POV: it's 2am and you've opened forty tabs.\"", share: 0.25, minSeconds: 2, shots: ["scene"] },
      { id: "breaking", label: "The moment it gets too much", purpose: "The small specific thing that tips it over. Felt rather than explained.", share: 0.3, minSeconds: 3, shots: ["punch", "scene"] },
      { id: "thing", label: "The thing that helps", purpose: "The product, entering from the viewer's own hands.", share: 0.25, minSeconds: 3, shots: ["scene"] },
      { id: "relief", label: "Relief", purpose: "The same place, after. Nothing is said; the difference is visible.", share: 0.2, minSeconds: 2, shots: ["scene"] },
    ],
  },
  {
    id: "fake_out",
    label: "Fake-out",
    blurb: "Opens as a nature documentary, a trailer or a news report, then flips.",
    bestFor: "A product in a dull-sounding category. The borrowed format does the work the category cannot.",
    character: "A subject for the borrowed format to observe — treated with total seriousness, which is where the comedy is.",
    look: "Shot in the borrowed format's own style exactly, and played straight: if it is a nature documentary it is long lenses and patient framing, if it is a news report it is a locked-off two-shot and hard light. The joke only lands if nothing winks at the camera.",
    productAt: 0.62,
    keyframes: true,
    captions: "native",
    beats: [
      { id: "borrowed", label: "The borrowed opening", purpose: "A completely straight opening in the other format. A viewer should not yet know what they are watching.", share: 0.35, minSeconds: 4, shots: ["scene", "sweep"] },
      { id: "reveal", label: "The flip", purpose: "The reveal that this is about something mundane. The turn, and the whole reason the film exists.", share: 0.3, minSeconds: 3, shots: ["punch", "scene"] },
      { id: "punchline", label: "The product as punchline", purpose: "The product lands as the joke's last line rather than as a demonstration.", share: 0.35, minSeconds: 3, shots: ["scene"] },
    ],
  },
  {
    id: "before_after",
    label: "Before and after",
    blurb: "Chaos, a hard transition, the same place transformed.",
    bestFor: "Anything whose result is visible. If the change cannot be seen in a photograph, this is the wrong format.",
    look: "The same camera position in both halves, so the cut carries the change. Ordinary light, ordinary room, nothing styled — a staged 'before' kills it.",
    productAt: 0.65,
    keyframes: true,
    captions: "native",
    beats: [
      { id: "before", label: "Before", purpose: "The mess, shot plainly and honestly. Specific clutter, not symbolic clutter.", share: 0.4, minSeconds: 3, shots: ["scene"] },
      { id: "turn", label: "The transition", purpose: "A snap, a swipe, a hand passing the lens — one physical gesture that carries the cut.", share: 0.18, minSeconds: 2, shots: ["punch"] },
      { id: "after", label: "After", purpose: "The identical framing, transformed. The viewer should be able to compare without being told to.", share: 0.42, minSeconds: 3, shots: ["scene"] },
    ],
  },
  {
    id: "impossible",
    label: "Impossible visual",
    blurb: "Something physically impossible and satisfying — the thing sliced, grown, built, poured.",
    bestFor: "A physical product. The only format here where the product is the star from the first frame.",
    look: "Macro, slow, tactile. Hard raking light, shallow focus, the surface of the thing filling the frame. This one may be beautiful: it is the format where polish is the point.",
    /* The exception that proves the rule: an ASMR film has nothing else to show. */
    productAt: 0,
    keyframes: true,
    /* The exception: an ASMR film is already polished, so the brand may show. */
    captions: "bubble",
    beats: [
      { id: "object", label: "The object", purpose: "The product, still, filling the frame, in a way that already looks impossible.", share: 0.3, minSeconds: 2, shots: ["scene"] },
      { id: "impossible", label: "The impossible thing", purpose: "What happens to it that could not happen — sliced like glass, growing, assembling itself.", share: 0.45, minSeconds: 4, shots: ["sweep", "scene"] },
      { id: "settle", label: "Settle", purpose: "The result, held still long enough to be taken in.", share: 0.25, minSeconds: 2, shots: ["scene"] },
    ],
  },
  {
    id: "micro_doc",
    label: "Micro-documentary",
    blurb: "A narrated origin story over b-roll: \"I quit my job because…\"",
    bestFor: "A founder with a real reason. The best of these for a business whose story is better than its features.",
    character: "The founder, described as they would appear in their own footage — hands, workshop, the back of a head. Never a generated face: this is a real person, and the right version of this film uses their own camera.",
    look: "Observational b-roll: hands working, a room early in the morning, the thing being made. Natural light, documentary distance, nobody performing for the lens.",
    productAt: 0.6,
    keyframes: true,
    captions: "native",
    beats: [
      { id: "line", label: "The opening line", purpose: "The sentence that makes somebody stay — a decision, a cost, a quitting. Over the plainest possible shot.", share: 0.22, minSeconds: 3, shots: ["scene"] },
      { id: "before", label: "What it was like", purpose: "B-roll of the life or the work before. Specific and unglamorous.", share: 0.28, minSeconds: 3, shots: ["scene", "punch"] },
      { id: "making", label: "The making", purpose: "The work itself, close. This is where the product first appears, as something being made rather than sold.", share: 0.28, minSeconds: 3, shots: ["scene"] },
      { id: "now", label: "Where it is now", purpose: "The result, understated. A documentary does not do a call to action; it shows where things got to.", share: 0.22, minSeconds: 3, shots: ["scene"] },
    ],
  },
  {
    id: "series",
    label: "Recurring series",
    blurb: "The same character, a new situation each episode.",
    bestFor: "Building an audience rather than chasing one hit. Episode one introduces them; every later one is a new problem.",
    character: "One character specific enough to be recognised again in a different situation — a job, a way of speaking, one visual detail that repeats. They are the asset, not this episode.",
    look: "Consistent across episodes: the same camera, the same framing habits, the same light. A series is recognisable before the character speaks.",
    productAt: 0.55,
    keyframes: true,
    captions: "native",
    beats: [
      { id: "cold", label: "Cold open", purpose: "Straight into the situation, with the character already in trouble. No recap: a returning viewer knows them and a new one learns from what happens.", share: 0.25, minSeconds: 2, shots: ["punch", "scene"] },
      { id: "escalate", label: "It gets worse", purpose: "The situation compounds, specifically and plausibly.", share: 0.3, minSeconds: 3, shots: ["scene"] },
      { id: "solve", label: "The product", purpose: "How they get out of it, with the product doing one concrete thing.", share: 0.25, minSeconds: 3, shots: ["scene"] },
      { id: "sting", label: "The sting", purpose: "A last beat that sets up the next episode or undercuts the win. Why somebody follows.", share: 0.2, minSeconds: 2, shots: ["punch"] },
    ],
  },
];

export const STORY_FORMAT_IDS = STORY_FORMATS.map((f) => f.id);
export const storyFormat = (id: string | null | undefined): StoryFormat | null =>
  STORY_FORMATS.find((f) => f.id === id) ?? null;

/**
 * The beats of a format at a given length, in seconds that add up exactly.
 *
 * Same contract as `beatPlan` in `shared/ads.ts` and deliberately not the same
 * function: these beats are per format rather than a fixed five, and a beat
 * that cannot reach its minimum is dropped rather than flashed — a one-second
 * grievance is not a grievance.
 */
export function storyPlan(format: StoryFormat, duration: number): { id: string; seconds: number }[] {
  let kept = format.beats.slice();

  /* Drop what cannot land, cheapest first, until everything left fits. */
  for (;;) {
    const total = kept.reduce((n, b) => n + b.share, 0);
    const short = kept
      .map((b) => ({ b, got: (b.share / total) * duration }))
      .filter((x) => x.got < x.b.minSeconds)
      .sort((a, b) => a.got - b.got);
    if (!short.length || kept.length <= 2) break;
    kept = kept.filter((b) => b !== short[0].b);
  }

  const total = kept.reduce((n, b) => n + b.share, 0);
  /*
   * The floor still applies, and it is load-bearing.
   *
   * It looks redundant — the loop above drops every beat that cannot reach its
   * minimum — and it is not, because that loop stops at two beats. A format
   * whose beats cannot all fit refuses to go below two, and those two then
   * need flooring. Removing this produced a six-second fake-out with a
   * three-second opening against a four-second minimum, which is a borrowed
   * documentary opening that has no time to be mistaken for one.
   *
   * `storyMinSeconds` is the honest version of the same fact: that format
   * should not be offered at six seconds at all.
   */
  const out = kept.map((b) => ({ id: b.id, seconds: Math.max(b.minSeconds, Math.round((b.share / total) * duration)) }));

  /*
   * The remainder goes to the longest beat that can take it, and is taken from
   * the longest that can spare it. A cut whose beats do not add to the whole
   * is a second of black, or a second missing from what somebody bought.
   */
  let drift = duration - out.reduce((n, b) => n + b.seconds, 0);
  while (drift !== 0) {
    const min = (id: string) => kept.find((b) => b.id === id)!.minSeconds;
    const room = (b: { id: string; seconds: number }) => (drift > 0 ? Infinity : b.seconds - min(b.id));
    const candidates = out.filter((b) => room(b) > 0);
    if (!candidates.length) break;
    const target = candidates.reduce((a, b) => (b.seconds > a.seconds ? b : a));
    const step = drift > 0 ? Math.min(drift, 1) : -Math.min(-drift, room(target), 1);
    target.seconds += step;
    drift -= step;
  }
  return out;
}

/**
 * The shortest cut this format can actually carry.
 *
 * A format is a sequence of beats with floors, and some of them do not fit in
 * six seconds however the seconds are shared out: a fake-out needs four
 * seconds of straight-faced borrowed documentary before the reveal means
 * anything, and three beats of three seconds is not a micro-documentary.
 *
 * Offered as a refusal rather than a squeeze, because the squeeze is what
 * happens otherwise — the plan comes out summing correctly with a beat below
 * the length at which it does its job, and the film is quietly worse for a
 * reason nobody can see.
 */
export function storyMinSeconds(format: StoryFormat): number {
  /* The two longest beats always survive the drop loop, which stops at two. */
  const floors = format.beats.map((b) => b.minSeconds).sort((a, b) => b - a);
  return floors.slice(0, 2).reduce((n, s) => n + s, 0);
}

/** Whether this format can be made at this length. */
export const storyFitsIn = (format: StoryFormat, duration: number): boolean =>
  duration >= storyMinSeconds(format);

/** Which beat the product may first appear in, given the plan. */
export function productBeat(format: StoryFormat, plan: { id: string; seconds: number }[]): string | null {
  const total = plan.reduce((n, b) => n + b.seconds, 0);
  /*
   * The beat the moment falls *inside*, which is the one whose end is past it
   * — not the one that starts after it. Comparing against the start returned
   * the beat after the right one every time: a character vlog's product
   * belongs in "finds the thing", and that answered "the turn", which is a
   * film where the product never appears before the last line.
   */
  let elapsed = 0;
  for (const beat of plan) {
    elapsed += beat.seconds;
    if (elapsed / total > format.productAt) return beat.id;
  }
  return plan[plan.length - 1]?.id ?? null;
}

// ---------------------------------------------------------------------------
// What the writer is told
// ---------------------------------------------------------------------------

/**
 * The instructions for filling a story format in.
 *
 * Deliberately a different prompt from `scriptPrompt`, not a flag on it. That
 * one asks for an advert and this one asks for a film with a character in it,
 * and the two want opposite things in almost every line — one wants the
 * product early and the brand throughout, the other wants a face first and the
 * product as a payoff. Sharing them would mean a prompt full of conditionals
 * that reads as neither.
 */
export function storyPrompt(input: {
  format: StoryFormat;
  plan: { id: string; seconds: number; moments?: number }[];
  brief: string;
  businessName?: string | null;
  callToAction?: string | null;
  avoidWords?: string[];
  /** Characters per beat, from the script module, so the lines fit the frame. */
  limitFor: (beat: string, seconds: number) => number;
}): string {
  const { format, plan } = input;
  const productFrom = productBeat(format, plan);
  const beatLines = plan
    .map((b) => {
      const def = format.beats.find((x) => x.id === b.id)!;
      const moments = Math.max(1, b.moments ?? 1);
      return `  - ${b.id} (${def.label}): ${b.seconds}s, on-screen line at most ${input.limitFor(b.id, b.seconds)} characters`
        + (moments > 1 ? `, cut from ${moments} shots — its scene needs ${moments} moments` : "")
        + `\n      ${def.purpose}`;
    })
    .join("\n");

  return [
    `The business, in their own words:`,
    input.brief.replace(/\s+/g, " ").trim(),
    input.businessName ? `They are called ${input.businessName}.` : ``,
    ``,
    `Write a short film in this format — ${format.label}. ${format.blurb}`,
    `This is not an advert and must not look like one. It is the kind of thing somebody watches to the end without being asked to.`,
    ``,
    `The beats, in order:`,
    beatLines,
    ``,
    format.character ? `THE CHARACTER. ${format.character}` : ``,
    format.character
      ? `Describe them once, in the "character" field, specifically enough to be drawn the same way four times: age, build, hair, clothes, what they are holding, how they carry themselves. Every scene then refers to that same person. A description that could be two different people produces two different people.`
      : ``,
    ``,
    `THE WORLD. One place, described once in the "world" field, at least 300 characters: what it is built from, how big it is, where the light comes from and what it falls on, the palette, what is always in it. Describe the place and nothing else — no instructions about shots or framing, because this text is sent with every frame and a rule inside it is obeyed on every frame.`,
    ``,
    `Rules for the scenes:`,
    `- Written as what a camera sees, concrete and specific. Name things: what they are made of, what colour, how big, how lit. Two sentences at most.`,
    `- Say what MOVES: who does what, what is picked up, where the camera travels. Each shot is a few seconds of motion, not a photograph.`,
    `- Name a light in every scene and say what it falls on. A viewer has to be able to see the thing the shot is about.`,
    /*
     * The rule that makes it a story rather than an advert, stated as a beat
     * boundary rather than as advice, because "show the product late" is
     * advice and "not before this beat" is checkable.
     */
    productFrom
      ? `- THE PRODUCT DOES NOT APPEAR before the "${productFrom}" beat. Not on a screen, not on a shelf, not in somebody's hand, not as a logo on anything. The beats before it are the story that earns it.`
      : ``,
    `- No lettering, signs, labels, prices or logos in any scene: words are typeset over the footage afterwards.`,
    ``,
    `Rules for the lines:`,
    `- Each on-screen line fits its character limit. It is set large over moving footage: a few words, not a sentence.`,
    `- Write only what the business told you. Never invent a customer, a quote, a number, a price or a result.`,
    input.avoidWords?.length ? `- Never use these words: ${input.avoidWords.join(", ")}.` : ``,
    input.callToAction
      ? `- The last line is exactly "${input.callToAction}". Reproduce it character for character.`
      : ``,
    ``,
    `HOW IT IS SHOT, which matters as much as what is in it: ${format.look}`,
    ``,
    `Answer as JSON: { "world": "...", ${format.character ? `"character": "...", ` : ""}"lines": [ { "beat": "...", "onScreen": "...", "scene": "..." } ], "callToAction": "..." }`,
  ].filter((line) => line !== "").join("\n");
}

/**
 * The shot list for a story, from each beat's own rhythm.
 *
 * `planShots` in `shared/ad-shots.ts` reads a rhythm table keyed by the five
 * commercial beats and cannot answer for "greet" or "punchline". A format
 * carries its rhythm on each beat instead, which is also where it belongs: a
 * cold open is punches because it is a cold open, not because of anything
 * general about third beats.
 */
export function planStoryShots(format: StoryFormat, plan: { id: string; seconds: number }[]): Shot[] {
  const shots: Shot[] = [];

  for (const beat of plan) {
    const def = format.beats.find((b) => b.id === beat.id)!;
    let left = beat.seconds;
    let i = 0;
    while (left > 0) {
      const kind = SHOT_KINDS.find((k) => k.id === def.shots[i % def.shots.length])!;
      /*
       * Never shorter than the kind allows — a 0.4-second punch is a glitch,
       * not a cut — and where the remainder is too small to stand alone it is
       * given to the shot before it, which is why the seconds always add up.
       */
      const want = Math.min(Math.max(kind.minSeconds, Math.min(kind.maxSeconds, left)), left);
      const rest = left - want;
      const seconds = rest > 0 && rest < kind.minSeconds ? left : want;
      shots.push({ kind: kind.id, seconds, beat: beat.id, camera: kind.camera[shots.length % kind.camera.length], brandMoment: false });
      left -= seconds;
      i++;
    }
  }

  /*
   * No brand moments. A colour wash of the company's palette across a frame is
   * the single most advert-looking thing this renderer can do, and these
   * formats exist because looking like an advert is what stops people
   * watching. The brand arrives in the words and in the product, late.
   */
  return shots;
}

/** The plates a story's shots are generated from. */
export const planStoryPlates = (shots: Shot[]): Plate[] => planPlates(shots);
