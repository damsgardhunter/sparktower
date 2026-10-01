/**
 * Choosing which part of a photo survives.
 *
 * Every place the app shows a picture in a fixed shape — a round avatar, a wide
 * cover band — it has been doing `object-cover` / `bg-cover bg-center`, which
 * takes the middle and throws the rest away. That is the right default and a
 * bad only option. A 978x673 screenshot in a circle loses both sides; a 4032x3024
 * phone photo in a band of 4:1 keeps a horizontal strip through the middle,
 * which is where the top of somebody's head usually isn't.
 *
 * So the crop becomes something the person picks, and the picked crop is baked
 * into the stored image rather than remembered as a transform. That is the
 * important decision here, and it is worth saying why: a focal point in the
 * database would have to be read by the profile page, the rail card, the feed,
 * every card that shows an avatar, the mobile app and the OG-image renderer, and
 * any one of them that forgot would silently go back to centre-cropping. Baking
 * it in means every one of those is already correct and none of them had to
 * change. The cost is that the original is not kept, so re-framing means
 * picking the file again.
 *
 * ## The model
 *
 * Three numbers: a zoom, and the centre of the crop in source-image pixels. The
 * crop is always the largest rectangle of the required aspect that fits the
 * image, divided by the zoom, and always wholly inside the image — so there is
 * no way to drag past the edge and bake in a transparent margin, which is the
 * failure every hand-rolled cropper has.
 *
 * This half is deliberately pure arithmetic with no canvas and no DOM, because
 * it is the half that can be wrong in ways nobody sees until a face is missing.
 * The drawing is at the bottom and needs a browser.
 */

/** A rectangle of the source image, in source pixels. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the person is manipulating: how far in, and what is in the middle. */
export interface CropTransform {
  /** 1 means "as much of the image as this shape can hold". Never below 1. */
  zoom: number;
  /** The centre of the crop, in source-image pixels. */
  centerX: number;
  centerY: number;
}

/** Past about this the pixels are gone anyway, and the slider stops being useful. */
export const MAX_ZOOM = 5;

/**
 * The shapes the app actually shows, and the size worth storing for each.
 *
 * The aspects are not taste, they are measurements: the avatar is rendered in a
 * circle, and the cover band on the profile is `aspect-[4/1]`. A cropper whose
 * frame does not match where the picture lands is a cropper that lies, which is
 * the bug this is fixing — the old preview used `object-contain`, showed the
 * whole photo, and then the page cropped it anyway.
 *
 * Output sizes are generous enough for a retina header and small enough that
 * re-encoding fixes the other half of the problem: a 12-megapixel phone photo
 * came to the uploader at several megabytes and sometimes past the limit, and
 * what came out the far end was going to be drawn 400px wide.
 */
export const CROP_PRESETS = {
  avatar: { aspect: 1, outWidth: 512, outHeight: 512, label: "Profile photo" },
  cover: { aspect: 4, outWidth: 1600, outHeight: 400, label: "Cover photo" },
} as const;

export type CropPresetName = keyof typeof CROP_PRESETS;

/**
 * A dimension that can be divided by.
 *
 * `Math.max(1, NaN)` is `NaN`, not 1 — so a guard written that way passes the
 * bad value straight through, and one NaN out of a failed decode becomes a crop
 * rectangle of NaNs and a blank canvas with nothing logged. Every entry point
 * goes through this.
 */
const side = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 1);

/**
 * The largest rectangle of the given aspect that fits inside the image.
 *
 * This is the zoom-1 crop: the most of the photo that the shape can possibly
 * hold. Everything else is this, smaller.
 */
export function largestFittingRect(
  imageWidth: number,
  imageHeight: number,
  aspect: number,
): { width: number; height: number } {
  const w = side(imageWidth);
  const h = side(imageHeight);
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  /* Wider than the shape → height is the limit. Taller → width is. */
  return w / h > a ? { width: h * a, height: h } : { width: w, height: w / a };
}

/** The zoom, with the slider's bounds applied. Below 1 would letterbox. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(1, zoom));
}

/**
 * The transform, made legal.
 *
 * Clamping the centre rather than the offset is what keeps the crop inside the
 * image at every zoom: as you zoom out, the room to pan shrinks to nothing, and
 * at zoom 1 in the limiting axis there is exactly one legal centre. A cropper
 * that clamps a pan offset instead drifts out of bounds the moment the zoom
 * changes while the pan stays put.
 */
export function clampTransform(
  imageWidth: number,
  imageHeight: number,
  aspect: number,
  transform: CropTransform,
): CropTransform {
  const w = side(imageWidth);
  const h = side(imageHeight);
  const zoom = clampZoom(transform.zoom);
  const base = largestFittingRect(w, h, aspect);
  const width = base.width / zoom;
  const height = base.height / zoom;

  const halfW = width / 2;
  const halfH = height / 2;
  /*
   * `Math.max(lo, ...)` last, so a crop that is somehow wider than the image
   * lands centred instead of inverting the range and flying off.
   */
  const cx = Math.max(halfW, Math.min(w - halfW, Number.isFinite(transform.centerX) ? transform.centerX : w / 2));
  const cy = Math.max(halfH, Math.min(h - halfH, Number.isFinite(transform.centerY) ? transform.centerY : h / 2));
  return { zoom, centerX: cx, centerY: cy };
}

/** The crop, in source pixels, for a transform that has been made legal. */
export function cropRect(
  imageWidth: number,
  imageHeight: number,
  aspect: number,
  transform: CropTransform,
): CropRect {
  const t = clampTransform(imageWidth, imageHeight, aspect, transform);
  const base = largestFittingRect(side(imageWidth), side(imageHeight), aspect);
  const width = base.width / t.zoom;
  const height = base.height / t.zoom;
  return { x: t.centerX - width / 2, y: t.centerY - height / 2, width, height };
}

/** Everything in the middle, as much as the shape will hold — where the dialog opens. */
export function initialTransform(imageWidth: number, imageHeight: number, aspect: number): CropTransform {
  return clampTransform(imageWidth, imageHeight, aspect, {
    zoom: 1, centerX: side(imageWidth) / 2, centerY: side(imageHeight) / 2,
  });
}

/**
 * A drag, converted from the screen to the image.
 *
 * The frame on screen is `frameWidth` wide and shows `crop.width` of the image,
 * so one screen pixel is `crop.width / frameWidth` image pixels — and dragging
 * right moves the *image* right, which moves the crop left. Getting that sign
 * wrong gives a cropper that fights the mouse, which is the other bug every
 * hand-rolled one has.
 */
export function panBy(
  imageWidth: number,
  imageHeight: number,
  aspect: number,
  transform: CropTransform,
  screenDeltaX: number,
  screenDeltaY: number,
  frameWidth: number,
): CropTransform {
  const rect = cropRect(imageWidth, imageHeight, aspect, transform);
  const perPixel = frameWidth > 0 ? rect.width / frameWidth : 1;
  return clampTransform(imageWidth, imageHeight, aspect, {
    zoom: transform.zoom,
    centerX: transform.centerX - screenDeltaX * perPixel,
    centerY: transform.centerY - screenDeltaY * perPixel,
  });
}

/**
 * Zoom while holding the middle of the frame still.
 *
 * Re-clamped afterwards because zooming out grows the crop, which can push it
 * past an edge it was previously sitting against.
 */
export function zoomTo(
  imageWidth: number,
  imageHeight: number,
  aspect: number,
  transform: CropTransform,
  zoom: number,
): CropTransform {
  return clampTransform(imageWidth, imageHeight, aspect, { ...transform, zoom });
}

/**
 * How the image should be positioned inside the on-screen frame, as CSS.
 *
 * The preview is a plain `<img>` scaled and offset rather than a canvas, so what
 * the person drags is the real decoded image at full quality and the browser
 * does the resampling. The canvas is only touched once, at the end.
 */
export function previewStyle(
  imageWidth: number,
  imageHeight: number,
  aspect: number,
  transform: CropTransform,
  frameWidth: number,
): { width: number; height: number; left: number; top: number } {
  const rect = cropRect(imageWidth, imageHeight, aspect, transform);
  const scale = frameWidth / rect.width;
  return {
    width: side(imageWidth) * scale,
    height: side(imageHeight) * scale,
    left: -rect.x * scale,
    top: -rect.y * scale,
  };
}

// ─── The part that needs a browser ───────────────────────────────────────────

/** Why a picked file could not be shown, in words worth putting on screen. */
export class ImageDecodeError extends Error {}

/**
 * Decode a picked file, with the rotation its EXIF asked for already applied.
 *
 * `imageOrientation: "from-image"` is the whole reason this goes through
 * `createImageBitmap`: a photo taken on a phone held upright is stored on its
 * side with a tag saying so, and a canvas that ignores the tag bakes in a
 * sideways picture. The `<img>` fallback honours the tag too, per spec, which is
 * what makes it a safe fallback rather than a different bug.
 *
 * HEIC is the case worth naming in the error. iPhones shoot it by default, a
 * file input with `accept="image/*"` accepts it, Safari can decode it and Chrome
 * cannot — so without this the person gets "upload failed" for a file that is
 * perfectly good on the machine they picked it from.
 */
export async function decodeImageFile(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; url: string }> {
  const url = URL.createObjectURL(file);
  const heicish = /\.(heic|heif)$/i.test(file.name) || /hei[cf]/i.test(file.type);

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, url };
    } catch {
      /* Fall through to the <img> path, which some browsers manage when createImageBitmap doesn't. */
    }
  }

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, url };
  } catch {
    URL.revokeObjectURL(url);
    throw new ImageDecodeError(
      heicish
        ? "This looks like an iPhone HEIC photo, which this browser can't read. In Photos, choose Share then \"Export as JPEG\" — or open this page in Safari."
        : "That image couldn't be read. Try a PNG, JPG or WebP.",
    );
  }
}

/**
 * Draw the chosen crop at the stored size and hand back a file to upload.
 *
 * Always JPEG: the input is a photo, the output is a header, and a PNG of a
 * photograph is several times the size for no visible gain. The white fill
 * underneath matters for the one case it applies to — a transparent PNG
 * flattened onto nothing comes out with black edges.
 */
export async function renderCrop(
  decoded: { source: CanvasImageSource; width: number; height: number },
  aspect: number,
  transform: CropTransform,
  outWidth: number,
  outHeight: number,
  fileName = "crop.jpg",
): Promise<File> {
  const rect = cropRect(decoded.width, decoded.height, aspect, transform);
  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageDecodeError("This browser can't prepare the image.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outWidth, outHeight);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    decoded.source,
    rect.x, rect.y, rect.width, rect.height,
    0, 0, outWidth, outHeight,
  );

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new ImageDecodeError("This browser couldn't prepare the image.");
  return new File([blob], fileName.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}
