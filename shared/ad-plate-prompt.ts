/**
 * What the video model is actually told, for one plate.
 *
 * This is the file that was missing when the first advert came back as "a zoom
 * into a desk with nothing on it and a white room as the background". Nothing
 * was wrong with the model. It had been handed a style's plate direction —
 * "a clear working surface, lit evenly, camera on a slow dolly" — and that is
 * precisely what it drew. Nobody had told it what the business was, what was
 * on the surface, or what the shot was for.
 *
 * ## The order, and why
 *
 * Subject, then setting, then camera, then prohibitions. A model given the
 * prohibitions first writes to the prohibitions: ask for "no text" before
 * saying what the scene is and a surprising amount of the frame becomes an
 * argument about text. The subject has to be the first thing in the sentence
 * because it is the first thing that should be in the frame.
 *
 * ## What is never described
 *
 * The product, the logo, the words and the price. All four are composited from
 * the business's own files afterwards (`server/ad-compositor.ts`), so the plate
 * needs *room* for them rather than a description of them. A model asked for a
 * logo draws something that resembles one, which is worse than no logo at all
 * because it is a company's mark, wrong, in their own advertisement. A model
 * asked for lettering misspells it about a quarter of the time.
 *
 * So the negative prompt is not tidying-up. It is the mechanism: the plate is
 * deliberately an empty stage, and `brandMoment` shots leave the room on
 * purpose.
 */
import type { AdBeatId } from "./ads";
import type { Plate } from "./ad-shots";

/**
 * Everything the model must not draw, in one string.
 *
 * Every entry is here because the thing it names is composited in afterwards
 * from a real file, and a generated version of it would be drawn *underneath*
 * the real one — two logos, two prices, two attempts at the same word.
 */
export const PLATE_NEGATIVE = [
  /* Composited afterwards from the brand kit and the business's own photographs. */
  "text", "words", "lettering", "captions", "subtitles", "watermark",
  "logo", "brand mark", "signage", "price tag", "packaging label",
  /* A generated face is a real person's likeness, used to sell something, without asking. */
  "faces", "people looking at camera", "recognisable faces",
  /*
   * The failure modes that make a generated clip read as generated.
   *
   * The second group is the one somebody actually complained about, and none
   * of it was named here: "instances with the person going through the desk
   * they are working at and random floating objects and items on the desk
   * morphing constantly". A negative prompt cannot fix a model's physics, but
   * leaving the specific failures unnamed guarantees nothing is even trying.
   */
  "extra fingers", "deformed hands", "warped straight lines", "flickering",
  "split screen", "collage", "frame within a frame",
  /* Objects that do not behave like objects. */
  "morphing objects", "objects changing shape", "objects appearing from nowhere",
  "objects disappearing", "duplicated objects", "floating objects",
  "objects hovering above surfaces", "melting", "warping geometry",
  /* Bodies that do not behave like bodies. */
  "limbs passing through solid objects", "hands clipping through surfaces",
  "body intersecting furniture", "arms merging with the table",
] as const;

export const plateNegativePrompt = (): string => PLATE_NEGATIVE.join(", ");

/**
 * One line naming what the frame has to leave room for.
 *
 * Phrased as composition — where the empty space goes — rather than as a
 * prohibition, because "leave the lower third clear" is a thing a camera
 * operator does and "do not put anything in the lower third" is a thing a
 * model argues with.
 */
function roomFor(beats: string[], brandMoment: boolean): string {
  const needs: string[] = [];
  /* The on-screen line sits in the lower third on every format. */
  needs.push("the lower third of the frame kept simple and uncluttered, so a line of type can sit over it");
  if (beats.includes("product")) {
    needs.push("a clear, unobstructed surface in the middle of the frame at a believable height, with nothing standing on it");
  }
  if (brandMoment) {
    needs.push("one broad area of plain, evenly lit surface for a colour wash to be laid over");
  }
  return `Composition: ${needs.join("; ")}.`;
}

export interface PlatePromptInput {
  /** The business's own words. The subject of the whole advert. */
  brief: string;
  /**
   * Only the parts of the shape this needs: what it is called, how it is shot,
   * and what to avoid. Taking the whole `AdStyle` meant a story format could
   * not be passed here at all, and the two have nothing else in common.
   */
  style: { label: string; plate: string; avoid: string };
  plate: Plate;
  /** Whether any shot cut from this plate is a brand moment. */
  brandMoment: boolean;
  /**
   * Whether the clip starts from a frame we drew.
   *
   * It changes what the prompt is for, completely. Text-to-video has to be
   * told what exists, because nothing does yet. Image-to-video is handed the
   * scene as a finished photograph and asked what happens next — so a prompt
   * that spends its length re-describing the furniture is telling the model
   * things it can already see, and leaving the one thing it cannot know, the
   * motion, to a single line near the end. That is why the clips came back
   * looking like one locked-off scene at a time.
   */
  fromKeyframe?: boolean;
  /** What the business is called, when it affects the setting rather than the lettering. */
  businessName?: string | null;
  /**
   * The scenes the script wrote for the beats on this plate.
   *
   * This is what makes one advert look different from another. Without it
   * every plate is prompted from the style's own direction, which is one
   * sentence shared by every advert of that style ever made — "the situation
   * the problem happens in, ordinary light, ordinary room" — so a coffee
   * roaster and a piece of software are handed identical instructions and get
   * identical footage. The style says what *kind* of shot this is; the scene
   * says what is in it.
   */
  scenes?: string[];
  /**
   * The world, restated in full on every clip.
   *
   * Repeated rather than referenced, because each generation is a separate
   * request with no memory of the others. Sent once and assumed, it is a
   * different building every time — which is exactly what "it likes to make
   * shortcuts" looks like from the outside: the model fills whatever the
   * prompt left open with the cheapest plausible thing, and it fills it
   * differently each time.
   */
  world?: string | null;
}

/**
 * The prompt for one plate.
 *
 * Deliberately not per shot. A plate is one continuous camera move that
 * several shots are cut out of — that is the whole reason it costs one
 * generation instead of three — so it gets one prompt describing one move, and
 * the cutting happens afterwards.
 */
/**
 * The most a prompt may be, because the provider refuses a longer one.
 *
 * Kling answers 400 with "prompt: size must be between 0 and 2500" and
 * generates nothing, which is a cheap failure and an easy one to cause: a
 * dense world description is a thousand characters on its own and it is sent
 * with every clip. Found by a thirty-second advert that refused all nine.
 */
export const PROMPT_MAX_CHARS = 2500;

/**
 * The world, shortened to whatever room is left, cut at a sentence.
 *
 * The world is trimmed rather than the scene because the scene is what makes
 * this shot different from the other eight, and because the world's opening
 * sentences are the ones that carry the most — what the place is built from
 * and what the light is doing. Cutting at a sentence rather than a character
 * avoids ending the only description the model gets mid-clause.
 */
export function fitWorld(world: string, room: number): string {
  const clean = world.replace(/\s+/g, " ").trim();
  if (clean.length <= room) return clean;
  /* Keep whole sentences while they fit; if even the first does not, take the characters. */
  let out = "";
  for (const sentence of clean.split(/(?<=[.;])\s+/)) {
    if ((out + sentence).length > room) break;
    out += (out ? " " : "") + sentence;
  }
  return out || clean.slice(0, Math.max(0, room - 1)).trimEnd();
}

/** The scenes, shared down to a budget between them, each cut at a sentence. */
function fitScenes(scenes: string[], room: number): string[] {
  if (!scenes.length) return scenes;
  const each = Math.floor(room / scenes.length);
  return scenes.map((s) => fitWorld(s, each));
}

export function platePrompt(input: PlatePromptInput): string {
  const { brief, style, plate } = input;
  let scenes = (input.scenes ?? []).map((s) => s.trim()).filter(Boolean);

  /*
   * The room left for the world, measured rather than guessed.
   *
   * Assembling with a single character gives the real overhead — including
   * the two lines that only exist when there *is* a world, which a guessed
   * margin got wrong and left four of nine prompts over the limit.
   */
  const overhead = assemble("~").length - 1;
  const room = PROMPT_MAX_CHARS - overhead;
  const world = input.world?.trim() && room > 80 ? fitWorld(input.world, room) : "";
  const out = assemble(world);
  if (out.length <= PROMPT_MAX_CHARS) return out;

  /*
   * Over even with no world: the scenes themselves are too long.
   *
   * Dropping the world first and the scene only as a last resort is the right
   * order — the world repeats across every clip and the scene is what makes
   * this one different — but "trim the world" cannot help once there is no
   * world left, and a prompt one character over is a clip the provider refuses
   * outright. So the scenes are cut too, and the length is enforced rather
   * than calculated, because the arithmetic above can be got wrong again.
   */
  const bare = assemble("");
  if (bare.length <= PROMPT_MAX_CHARS) return bare;
  const spare = PROMPT_MAX_CHARS - (bare.length - scenes.join(" Then: ").length);
  scenes = fitScenes(scenes, Math.max(0, spare));
  return assemble("").slice(0, PROMPT_MAX_CHARS);

  /**
   * What happens, for a clip that starts from a drawn frame.
   *
   * Motion first and at length, because the still already carries everything
   * else. The world is still here but short: the model is matching a
   * photograph it can see rather than building a place from a description, so
   * a few words of palette and light are enough to stop it drifting.
   */
  /**
   * The move, restrained for a clip that starts from a drawn frame.
   *
   * Animating a still means inventing everything the still does not show, and
   * the bigger the move the more of that there is: an orbit has to imagine the
   * far side of every object and the floor behind the subject, and what comes
   * back is a person passing through their own desk. The frame already exists,
   * so the camera's job is to breathe rather than to explore — and a small
   * move on a good frame reads better than a large one on a disintegrating
   * scene.
   */
  function gentle(camera: string): string {
    /*
     * Travelling moves and fast ones both. A "hard push in" does not go
     * anywhere but it covers the distance quickly, and speed costs the model
     * the same coherence that travel does — it was the move on the first clip
     * of the vlog, and the first clip is where the desk ate an arm.
     */
    const big = /orbit|dolly through|crane|whip|snap|arc from|hard |fast |quick /i;
    if (!big.test(camera)) return camera;
    /*
     * Keep the axis the planner chose and lose the speed. Collapsing them all
     * to a push would make every restrained shot the same move, which trades
     * one kind of sameness for another — the planner picked a tilt or a pan
     * for a reason, and slow is the only part that needs changing.
     */
    if (/orbit|arc from|pan/i.test(camera)) return "a slow drift sideways, barely moving";
    if (/crane|tilt down|settle/i.test(camera)) return "a slow settle downward, barely moving";
    if (/tilt up/i.test(camera)) return "a slow tilt upward, barely moving";
    if (/zoom|pull out/i.test(camera)) return "a slow pull back, barely moving";
    return "a slow push in, barely moving";
  }

  function motionPrompt(): string {
    return [
      `Animate this photograph. It is the first frame; everything below is what happens over the next few seconds.`,
      ``,
      `Camera: ${gentle(plate.camera)}, one continuous move, no cuts and no scene change. Keep the move small: the frame is already right, and a large move invents what is not in it.`,
      scenes.length ? `What happens: ${scenes.join(" Then: ")}` : "",
      `People and objects keep moving throughout: somebody walks, hands work, light shifts, dust or steam drifts. Nothing in frame is frozen.`,
      /*
       * Said in the positive, because the negative prompt is the other half of
       * this and models drop negations. "Rests solidly on the surface" is a
       * thing a camera can be pointed at; "does not float" is an argument.
       */
      `Everything in the frame is solid and stays itself: objects keep the same shape, size and position on the surfaces they rest on, hands and arms go around things rather than through them, and nothing appears, vanishes or changes into something else. Only the things named above move.`,
      ``,
      `Hold the photograph's own place, materials, palette and light exactly — this is a continuation of it, not a new scene. Do not cut away, do not change location, do not add or remove the structures already in it.`,
      /*
       * Said as a closed set, which is stronger than any list of things not to
       * do. "Stuff keeps appearing out of nowhere" is the model filling time by
       * inventing, and the fix is telling it the frame is already complete.
       */
      `The things in the first frame are ALL the things there are. Nothing new enters the frame, nothing is added to the surfaces, and no object appears that is not already visible in the photograph — the only change over these seconds is that what is already there moves.`,
      input.world?.trim() ? `For reference, the world: ${fitWorld(input.world, 420)}` : "",
      ``,
      `Live action, photographic, true-to-life colour. Not an illustration, not a render.`,
    ].filter((line) => line !== "").join("\n").slice(0, PROMPT_MAX_CHARS);
  }

  function assemble(world: string): string {
  if (input.fromKeyframe) return motionPrompt();

  return [
    /*
     * The subject first, in the business's own words, trimmed rather than
     * summarised. A summary is a second opinion about what the business is,
     * and this file is not qualified to have one.
     */
    `A live-action advertising shot for this business: ${brief.replace(/\s+/g, " ").trim()}`,
    input.businessName ? `The business is called ${input.businessName}.` : "",
    ``,
    /*
     * The written scene leads, because it is the specific one, and the style's
     * direction follows as the manner it is shot in. A plate covering two
     * beats gets both scenes: they are moments of one continuous move, so the
     * model is told to find a frame that holds both rather than to cut.
     */
    scenes.length
      ? `Scene: ${scenes.length > 1
          ? `one continuous shot that passes through both of these — ${scenes.join(" Then: ")}`
          : scenes[0]}`
      : "",
    scenes.length ? `Shot in this manner: ${style.plate}` : `Setting: ${style.plate}`,
    ``,
    /* As much of the world as fits. See PlatePromptInput.world and fitWorld. */
    world ? `The world this is in, which is the same in every shot of this advert: ${world}` : "",
    world ? `Match it exactly — the same materials, the same light, the same palette, the same time of day. Nothing in this shot contradicts it.` : "",
    ``,
    /* The camera move is the plate's identity: it is what makes the windows cut together. */
    `Camera: ${plate.camera}, one continuous move, no cuts.`,
    `Something is moving in every frame — the camera, the light, or something in the scene. A still frame reads as a photograph and loses the viewer.`,
    ``,
    roomFor(plate.beats, input.brandMoment),
    ``,
    /*
     * Realism last among the positives, and stated as photography rather than
     * as a style word. "Realistic" is a word every model claims to be already;
     * a lens and a light are instructions.
     */
    `Look: photographed on a full-frame camera with a fast prime lens, natural light, shallow depth of field, true-to-life colour. Not an illustration, not a render, not stylised.`,
  ].filter((line) => line !== "").join("\n");
  }
}
