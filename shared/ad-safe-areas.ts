/**
 * Where it is safe to put something, per format.
 *
 * Every platform draws its own interface over the video, and anything rendered
 * underneath it is invisible — a call to action behind TikTok's caption is a
 * call to action nobody saw. These insets are the fraction of each edge to
 * stay out of, and they are deliberately generous: a centred message that
 * could have been two per cent wider is a trade worth making against one that
 * is half-covered on one platform.
 *
 * YouTube's outro is the sharpest case and has its own rule, because its end
 * screens are not an overlay at the edge — they occupy the middle and right of
 * the frame for the last twenty seconds, which is exactly where an outro
 * would otherwise put the brand.
 */
import type { AdFormatId } from "./ads";

export interface SafeArea {
  /** Fraction of the height to avoid at the top. */
  top: number;
  bottom: number;
  left: number;
  right: number;
  why: string;
}

export const SAFE_AREAS: Record<AdFormatId, SafeArea> = {
  vertical: {
    top: 0.10, bottom: 0.22, left: 0.06, right: 0.16,
    why: "TikTok and Reels put the caption, the handle and the sound along the bottom, and a column of buttons up the right. The bottom fifth and the right sixth are theirs.",
  },
  square: {
    top: 0.06, bottom: 0.14, left: 0.05, right: 0.05,
    why: "A feed crops a square less aggressively, but the first line of the caption sits under it and a like button can overlap the lower edge.",
  },
  wide: {
    top: 0.06, bottom: 0.14, left: 0.05, right: 0.05,
    why: "A player's controls and the progress bar cover the bottom eighth whenever somebody moves the mouse, and the title sits across the top.",
  },
};

/** The rectangle in pixels that it is safe to draw in. */
export function safeBox(format: { width: number; height: number }, area: SafeArea) {
  const x = Math.round(format.width * area.left);
  const y = Math.round(format.height * area.top);
  return {
    x,
    y,
    width: Math.round(format.width * (1 - area.left - area.right)),
    height: Math.round(format.height * (1 - area.top - area.bottom)),
  };
}

/**
 * The outro's rule, which is not an inset.
 *
 * YouTube draws a subscribe button and up to two video cards over the final
 * twenty seconds, across the centre and the right. So the brand goes
 * bottom-left and the rest of the frame stays empty — not because empty looks
 * better, but because anything there is covered.
 */
export const YOUTUBE_OUTRO_RULE = {
  brandCorner: "bottom-left" as const,
  /** Fraction of the frame YouTube may cover. Nothing of ours goes here. */
  reserved: { x: 0.30, y: 0.12, width: 0.70, height: 0.76 },
  why: "A subscribe button and two end-screen cards, drawn by YouTube over the last twenty seconds. Anything rendered under them is invisible, and an outro whose brand is centred is an outro with a subscribe button over the brand.",
};
