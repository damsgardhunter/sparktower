/**
 * Where the line goes, decided by looking at the footage.
 *
 * Every line was set at the same height in every shot, because that is where
 * on-screen type conventionally goes and because nothing here could see the
 * picture. It is the right default and it is wrong often enough to matter: the
 * lower third is where a table, a bench, a crowd or somebody's hands usually
 * are, and a headline laid over the busiest part of a frame is the thing that
 * makes an advert look assembled rather than made.
 *
 * So the frame is measured. The quietest band inside the safe area wins, with
 * the conventional position given a head start — moving the type is worth
 * doing when the usual place is genuinely cluttered, and not worth doing
 * because one band scored a fraction better than another. Type that wanders
 * between shots for no visible reason is its own kind of distracting.
 */
import path from "path";
import os from "os";
import { promises as fs } from "fs";
import { randomUUID } from "crypto";
import { runFfmpeg } from "./ad-compositor";
import { safeBox, SAFE_AREAS } from "@shared/ad-safe-areas";
import { adFormat, type AdFormatId } from "@shared/ads";

/**
 * The heights a line may sit at, as a fraction of the safe box.
 *
 * Three, not a continuous range. A line that can land anywhere lands somewhere
 * slightly different in every shot, which reads as drift rather than
 * composition; three named positions read as a decision.
 */
export const BAND_HEIGHTS = [0.22, 0.5, 0.78] as const;

/**
 * How much better another band has to be before the line moves.
 *
 * The lower third is where a viewer's eye already expects the words, so it
 * keeps the position unless somewhere else is clearly calmer. Twenty-five per
 * cent quieter, measured on variance — enough to rule out ties and noise, low
 * enough that a genuinely busy lower third loses.
 */
export const MOVE_THRESHOLD = 0.75;

/** The conventional home, and the one every band is compared against. */
export const DEFAULT_HEIGHT = 0.78;

/**
 * How busy each band is, given the rows of a greyscale frame.
 *
 * Variance rather than brightness: a band can be dark and still ruin a line if
 * it is dark in a complicated way. What makes type unreadable is detail behind
 * it — edges, texture, contrast — and variance is the cheapest honest measure
 * of that. Exported because the arithmetic is the part worth testing, and
 * reading a frame off disk is not.
 */
export function busyness(rows: number[][], top: number, height: number): number {
  /*
   * Clipped to the frame, and empty when it does not reach the frame at all.
   *
   * Both edges matter and neither is obvious. A negative index is not an error
   * in JavaScript, it counts from the end — so an unclamped slice quietly
   * measures the bottom of the picture when asked about above the top. And
   * clamping the near edge to the last row has the mirror problem: a band
   * entirely below the frame comes back as a reading of its bottom edge rather
   * than as nothing. A band with no picture in it has nothing to say about the
   * picture.
   */
  /*
   * Both ends clamped to zero, not just the near one.
   *
   * `slice` reads a negative index as counting from the end, and a band above
   * the frame has *both* ends negative — so clamping only `from` leaves
   * `slice(0, -30)`, which is "everything except the last thirty rows": almost
   * the whole picture, reported as the busyness of a band that is not in it.
   */
  const from = Math.max(0, Math.round(top));
  const to = Math.max(0, Math.min(rows.length, Math.round(top + height)));
  /* An empty slice covers both "above the frame" and "below it". */
  const band = rows.slice(from, to).flat();
  if (!band.length) return 0;
  const mean = band.reduce((n, v) => n + v, 0) / band.length;
  return band.reduce((n, v) => n + (v - mean) ** 2, 0) / band.length;
}

/**
 * Which of the three heights to use, given how busy each one is.
 *
 * Pure, so the decision can be tested without a video file anywhere near it.
 */
export function chooseBand(scores: Record<number, number>): number {
  const home = scores[DEFAULT_HEIGHT];
  if (home === undefined) return DEFAULT_HEIGHT;
  let best = DEFAULT_HEIGHT;
  let bestScore = home;
  for (const height of BAND_HEIGHTS) {
    const score = scores[height];
    if (score === undefined) continue;
    /* Only a clearly calmer band is worth moving to; ties keep the convention. */
    if (score < bestScore * MOVE_THRESHOLD) {
      best = height;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Reads one frame of a clip and picks the height for its line.
 *
 * Falls back to the conventional position on any failure. A placement that
 * could not be computed is not a reason to fail an advert somebody paid for —
 * it is a reason to use the default, which is what the whole product did until
 * now and which is fine.
 */
export async function placeLine(
  clip: string,
  atSeconds: number,
  format: AdFormatId,
  lineHeightPx: number,
): Promise<number> {
  const frame = path.join(os.tmpdir(), `ad-place-${randomUUID().slice(0, 8)}.png`);
  try {
    const shape = adFormat(format)!;
    const box = safeBox(shape, SAFE_AREAS[format]);

    /*
     * Analysed at a fraction of full size: this is looking for where detail
     * is, not what the detail is, and a 160-pixel-tall thumbnail answers that
     * as well as a 1920-pixel frame for a thousandth of the work.
     */
    const analysisHeight = 160;
    await runFfmpeg([
      "-y", "-ss", String(atSeconds), "-i", clip, "-frames:v", "1",
      "-vf", `scale=-1:${analysisHeight}`, frame,
    ]);

    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(frame).greyscale().raw().toBuffer({ resolveWithObject: true });
    const rows: number[][] = [];
    for (let y = 0; y < info.height; y++) {
      rows.push(Array.from(data.subarray(y * info.width, (y + 1) * info.width)));
    }

    const scale = info.height / shape.height;
    const bandPx = Math.max(2, lineHeightPx * 1.6 * scale);
    const scores: Record<number, number> = {};
    for (const height of BAND_HEIGHTS) {
      scores[height] = busyness(rows, (box.y + box.height * height) * scale - bandPx / 2, bandPx);
    }
    return chooseBand(scores);
  } catch (error) {
    console.warn(`[ad-placement] falling back to the usual height:`, (error as Error)?.message);
    return DEFAULT_HEIGHT;
  } finally {
    await fs.rm(frame, { force: true }).catch(() => {});
  }
}
