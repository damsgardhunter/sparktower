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
import type { AdStyle } from "./ad-styles";

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
  /* The failure modes that make a generated clip read as generated. */
  "extra fingers", "deformed hands", "warped straight lines", "flickering",
  "split screen", "collage", "frame within a frame",
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
function roomFor(beats: AdBeatId[], brandMoment: boolean): string {
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
  style: AdStyle;
  plate: Plate;
  /** Whether any shot cut from this plate is a brand moment. */
  brandMoment: boolean;
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
}

/**
 * The prompt for one plate.
 *
 * Deliberately not per shot. A plate is one continuous camera move that
 * several shots are cut out of — that is the whole reason it costs one
 * generation instead of three — so it gets one prompt describing one move, and
 * the cutting happens afterwards.
 */
export function platePrompt(input: PlatePromptInput): string {
  const { brief, style, plate } = input;
  const scenes = (input.scenes ?? []).map((s) => s.trim()).filter(Boolean);

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
