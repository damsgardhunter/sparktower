/**
 * Serving a picture at the size it is being looked at.
 *
 * Nothing resized anything. A photo straight off a phone is three to five
 * megabytes, and that is what was stored and what was sent — to a browser
 * drawing it 40 pixels across in a comment thread, and to a phone drawing it
 * in a 68-pixel circle. Every avatar on a busy page was a full-resolution
 * photograph, paid for twice: once as bytes out of the bucket, once as bytes
 * over somebody's mobile data, and again in the second the page spends
 * decoding it.
 *
 * So `?w=` asks for a width, and what comes back is built once and kept. The
 * derivative is a real object beside the original, so the second person to
 * look at that avatar costs nothing to serve and the bucket's egress bill is
 * the small file rather than the big one.
 *
 * Deliberately narrow, in three ways:
 *
 *  - **A fixed set of widths.** Any number would let one caller fill the
 *    bucket with a thousand near-identical copies of every image.
 *  - **Only formats worth resizing.** JPEG, PNG and WebP. An SVG is already
 *    small and resizing it is meaningless; an animated GIF comes back as a
 *    still frame, which is worse than being large.
 *  - **Only images the world can already read.** A derivative is a second copy
 *    with its own life, and a copy of a private object is how a private object
 *    stops being private. Anything carrying an ACL is served as it is.
 */
import sharp from "sharp";

/**
 * The widths the product actually draws things at, rounded up for retina
 * screens: an avatar, a card's logo, a phone's full width, a desktop cover.
 * A request for anything else is served the original rather than refused —
 * the picture is the point, and a wrong-sized one beats a broken one.
 */
export const ALLOWED_WIDTHS = [96, 256, 640, 1280] as const;

/** What sharp will re-encode without making the picture worse. */
const RESIZABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

/** The width a request is asking for, or null when it isn't asking for one we make. */
export function wantedWidth(raw: unknown): number | null {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && (ALLOWED_WIDTHS as readonly number[]).includes(n) ? n : null;
}

/**
 * Where the resized copy lives: beside the original, named for its width.
 *
 * Under `derivatives/` rather than next to the upload so that anything which
 * lists or sweeps uploads — a retention job, a bucket lifecycle rule — can
 * tell a thing somebody uploaded from a thing this server made and can remake.
 */
export function derivativePathFor(objectPath: string, width: number): string | null {
  const m = /^\/objects\/uploads\/([A-Za-z0-9_-]+)$/.exec(objectPath);
  return m ? `/objects/derivatives/${m[1]}/w${width}` : null;
}

export const isResizable = (contentType: string | null | undefined): boolean =>
  RESIZABLE.has(String(contentType ?? "").split(";")[0].trim().toLowerCase());

/**
 * The smaller copy, or null when making one would be pointless or wrong.
 *
 * Null rather than a throw for "already smaller than asked for": a 64-pixel
 * logo requested at 256 is not an error, and storing a blown-up copy of it
 * would cost bytes to make the picture worse. `withoutEnlargement` says the
 * same thing to sharp, and this says it before the work is done.
 *
 * `rotate()` with no argument applies the EXIF orientation and drops the tag.
 * Without it, every photo taken in portrait on an iPhone comes back on its
 * side — the orientation lives in metadata that resizing discards.
 */
export async function buildDerivative(
  original: Buffer,
  contentType: string,
  width: number,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!isResizable(contentType)) return null;

  const image = sharp(original, { failOn: "none" });
  const meta = await image.metadata().catch(() => null);
  if (!meta?.width) return null;
  // EXIF may say the picture is on its side, in which case its real width is its stored height.
  const upright = meta.orientation && meta.orientation >= 5 ? meta.height ?? meta.width : meta.width;
  if (upright <= width) return null;

  const type = contentType.split(";")[0].trim().toLowerCase();
  const pipeline = image.rotate().resize({ width, withoutEnlargement: true });
  /*
   * The format is kept rather than improved. WebP would be smaller again, but
   * a derivative that is a different type from the thing it stands in for has
   * to be described as one everywhere it is served, and a PNG's transparency
   * is not something to lose quietly in a resize.
   */
  const buffer = type === "image/png"
    ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
    : type === "image/webp"
      ? await pipeline.webp({ quality: 82 }).toBuffer()
      : await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();

  /*
   * A derivative that came out bigger than the original is not a derivative.
   * It happens with small PNGs and with photographs already compressed hard,
   * and storing one would mean paying to serve more bytes than before.
   */
  return buffer.length < original.length ? { buffer, contentType: type } : null;
}
