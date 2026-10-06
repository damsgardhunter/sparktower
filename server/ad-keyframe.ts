/**
 * The first frame of a clip, drawn before anything is animated.
 *
 * ## The problem this solves
 *
 * Everything the pipeline made before this was a *plate* — footage generated
 * from a description, with the business's logo and words composited over the
 * top afterwards. Watched back, the verdict was: "it still feels and only
 * looks like an overlay over some random actions." That is exactly what it
 * was. The brand sat on the advert rather than being in it, and nothing in
 * the frame knew the brand existed.
 *
 * Text-to-video cannot fix that. Each clip is generated independently from a
 * sentence, so a building described in shot one is a different building in
 * shot three, and a logo described in words is a model's guess at a logo —
 * which is worse than no logo, because it is a company's mark, wrong, in their
 * own advertisement.
 *
 * ## What this does instead
 *
 * Draws a still for each shot, with the business's real logo handed to the
 * image model as a reference, and animates *that*. The logo can then be a
 * thing in the world — a building people walk into, a sign over a door, a
 * shape on the horizon — because it was drawn into the frame rather than
 * pasted over it.
 *
 * ## Why each frame is drawn from the one before
 *
 * Continuity. The second keyframe is drawn with the previous clip's final
 * frame as a reference alongside the logo, so the room in shot two is the room
 * shot one ended in. That is the difference between five clips and one
 * journey, and it is the whole reason a story advert is possible at all —
 * "you walk into the tower, and each floor is somebody building something" is
 * not a thing you can ask five independent generations for.
 */
import { toFile } from "openai";
import { openai } from "./replit_integrations/image/client";
import { IMAGE_MODEL, IMAGE_QUALITY } from "./aiModels";
import { ObjectStorageService } from "./replit_integrations/object_storage";
import { readReference } from "./project-visuals";
import { adFormat, type AdFormatId } from "@shared/ads";

/**
 * The sizes the image model actually offers, mapped from our frame shapes.
 *
 * Not the advert's own dimensions: the model takes three sizes and anything
 * else is refused. The keyframe is scaled and cropped to the real frame by the
 * compositor later anyway, so what matters here is getting the *shape* right —
 * a vertical advert generated from a landscape still loses a third of its
 * composition to the crop, which is where the subject usually is.
 */
export function keyframeSize(format: AdFormatId): "1024x1024" | "1024x1536" | "1536x1024" {
  const f = adFormat(format);
  if (!f) return "1024x1024";
  if (f.height > f.width) return "1024x1536";
  if (f.width > f.height) return "1536x1024";
  return "1024x1024";
}

export interface KeyframeRequest {
  /** What the script asked to see. */
  scene: string;
  /** The business's own words, for grounding. */
  brief: string;
  format: AdFormatId;
  /** Object path to the real logo. Without it this is just an illustrator. */
  logoPath?: string | null;
  /** How the logo appears in the world, when the style puts it there. */
  logoRole?: string | null;
  /** The world, restated here too — the drawing is where it matters most. */
  world?: string | null;
  /**
   * Who the film follows, restated on every frame they are in.
   *
   * The same argument as the world and a shorter leash: a place drawn
   * slightly differently twice is a continuity wobble, and a person drawn
   * differently twice is two people, which ends the film.
   */
  character?: string | null;
  /** The previous clip's last frame, as a PNG buffer, for continuity. */
  previousFrame?: Buffer | null;
  ownerId: string;
}

/**
 * What the image model is told.
 *
 * Says what the references *are* before saying what to draw, because an
 * unlabelled reference is a picture the model borrows a mood from. Told that
 * the first image is the company's actual mark, it reproduces it; told
 * nothing, it paints something in the same colours.
 */
export function keyframePrompt(input: {
  scene: string; brief: string; logoRole?: string | null; world?: string | null;
  character?: string | null;
  hasLogo: boolean; hasPrevious: boolean;
}): string {
  const refs: string[] = [];
  if (input.hasLogo) refs.push("The first reference image is the company's actual logo.");
  if (input.hasPrevious) {
    refs.push(
      `The ${input.hasLogo ? "second" : "first"} reference image is the last frame of the previous shot in this same advert. ` +
      `Keep the same place, the same architecture, the same light and the same palette — this is the next moment of one continuous film, not a new scene.`,
    );
  }

  return [
    ...refs,
    refs.length ? "" : "",
    input.world?.trim()
      ? `The world this frame is in, identical in every frame of this advert: ${input.world.replace(/\s+/g, " ").trim()}`
      : "",
    input.world?.trim() ? `` : "",
    input.character?.trim()
      ? `The person in this film, the same one in every frame they appear in: ${input.character.replace(/\s+/g, " ").trim()}`
      : "",
    `Draw a single photographic frame: ${input.scene.replace(/\s+/g, " ").trim()}`,
    ``,
    input.hasLogo && input.logoRole
      ? `The logo belongs in the world of this frame, not on top of it: ${input.logoRole} Built from the same shapes and colours as the reference, at the scale the scene gives it, lit by the scene's own light and casting the shadows that light would cast. Not a flat overlay, not a watermark, not a sticker.`
      : input.hasLogo
        ? `If the logo appears, it is a real object in the scene — on a building, a sign or a surface — lit by the scene's own light. Never a flat overlay.`
        : ``,
    ``,
    /*
     * The same rule the video prompt carries. The on-screen line is typeset
     * over this frame afterwards, so lettering drawn here ends up underneath
     * it — two attempts at the same words, one of them misspelt.
     */
    `No captions, no subtitles, no watermark and no lettering anywhere in the frame except where it is physically part of the scene.`,
    `No faces looking at the camera and no recognisable person.`,
    `Leave the lower third of the frame simple and uncluttered: a line of type is set over it.`,
    ``,
    `Photographic and real: full-frame camera, fast prime lens, natural light, shallow depth of field, true-to-life colour. Not an illustration, not a 3D render, not stylised.`,
    ``,
    `For context, the business this is for: ${input.brief.replace(/\s+/g, " ").trim().slice(0, 400)}`,
  ].filter((l) => l !== "").join("\n");
}

/**
 * Draws the frame, and returns it as raw base64 plus the path it was stored at.
 *
 * Base64 because that is what goes to the video model — see `KlingSubmit.image`
 * — and the stored copy exists so a render can be explained afterwards. A
 * keyframe is the single most informative artefact in a failed advert: it says
 * whether the problem was the drawing or the animation.
 */
export async function drawKeyframe(input: KeyframeRequest): Promise<{ base64: string; path: string }> {
  const references = [];
  const logo = input.logoPath ? await readReference(input.logoPath, "logo") : null;
  if (logo) references.push(logo);
  if (input.previousFrame) {
    references.push(await toFile(input.previousFrame, "previous.png", { type: "image/png" }));
  }

  const prompt = keyframePrompt({
    scene: input.scene,
    brief: input.brief,
    logoRole: input.logoRole,
    world: input.world,
    character: input.character,
    hasLogo: !!logo,
    hasPrevious: !!input.previousFrame,
  });

  /*
   * `edit` when there is anything to work from and `generate` when there is
   * not. They are different endpoints rather than one with an optional
   * argument, and `edit` with an empty array is a request with no subject.
   */
  const response: any = references.length
    ? await openai.images.edit({
      model: IMAGE_MODEL, prompt, image: references,
      size: keyframeSize(input.format), quality: IMAGE_QUALITY,
    } as any)
    : await openai.images.generate({
      model: IMAGE_MODEL, prompt,
      size: keyframeSize(input.format), quality: IMAGE_QUALITY,
    } as any);

  const drawn = response?.data?.[0]?.b64_json;
  if (!drawn) throw new Error("The image model returned no keyframe");
  const png = Buffer.from(drawn, "base64");

  const path = await new ObjectStorageService().writeObjectBuffer(
    png, "image/png",
    /* Private: this is an unfinished advert's working, not something to publish. */
    { owner: input.ownerId, visibility: "private" },
  );
  /* The PNG is kept; what travels is the small one. */
  return { base64: await forSending(png), path };
}

/**
 * The keyframe, small enough to put in a request body.
 *
 * The image model returns a PNG, and a 1024×1536 one is about two megabytes —
 * which is 2.7 MB of base64 inside a JSON body, sent to a host on the other
 * side of the world, once per clip. That is under the provider's documented
 * ceiling and still far too big to be reliable: the third attempt at a
 * thirty-second advert died on a bare "fetch failed" part way through, with
 * three clips already generated and paid for.
 *
 * JPEG at 88 is a few hundred kilobytes and indistinguishable here. The
 * provider uses this frame as the first frame of a generated clip and then
 * invents thirty more from it; the compression artefacts do not survive that
 * process in any form anybody could see. The lossless copy is the one in
 * storage, which is the one a person would ever look at.
 */
async function forSending(png: Buffer): Promise<string> {
  const sharp = (await import("sharp")).default;
  const jpeg = await sharp(png).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  return jpeg.toString("base64");
}
