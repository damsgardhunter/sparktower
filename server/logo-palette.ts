/**
 * The colours actually in a business's logo.
 *
 * A brand kit asks for a primary colour, and the honest answer for most small
 * businesses is "the colour in my logo" — which they know by eye and not by
 * hex. Asking somebody to read a colour off their own logo with an eyedropper
 * is a step most people abandon, and the result when they guess is an advert
 * whose lettering nearly matches their mark, which looks worse than one that
 * does not match at all.
 *
 * So the logo is read and its colours offered. The business still picks; this
 * only removes the eyedropper.
 *
 * ## Why the counting is done on a tiny thumbnail
 *
 * Exact pixel counts are not the point — the ranked palette of a logo is the
 * same at sixty-four pixels across as at two thousand, and reading the small
 * version is roughly a thousand times less work. A logo is also usually flat
 * colour, so downsampling without smoothing keeps the palette honest rather
 * than inventing blends between neighbouring shapes.
 */
import sharp from "sharp";

export interface PaletteEntry {
  hex: string;
  /** Share of the non-transparent pixels, 0–1. */
  share: number;
}

/** Bucket size per channel. Coarse on purpose: see `quantise`. */
const STEP = 24;

/**
 * Round a channel into a bucket.
 *
 * Without this, a logo saved as a JPEG returns four hundred near-identical
 * blues and no dominant colour at all. Twenty-four is coarse enough to
 * collapse compression noise and fine enough to keep two deliberate shades
 * apart.
 */
const quantise = (v: number) => Math.min(255, Math.round(v / STEP) * STEP);

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase()}`;

/**
 * The colours in a logo, most used first.
 *
 * Transparent and near-transparent pixels are skipped — a logo is mostly
 * transparent and its background is not one of its colours. So are pixels
 * that are almost white or almost black: they are the paper and the outline,
 * they dominate every count, and neither is what somebody means by "my brand
 * colour". They are still *available* as a fill, just not proposed as the
 * brand.
 */
export async function logoPalette(input: Buffer, take = 5): Promise<PaletteEntry[]> {
  const { data, info } = await sharp(input)
    .resize(64, 64, { fit: "inside", kernel: "nearest" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const counts = new Map<string, number>();
  let considered = 0;

  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3] ?? 255];
    if (a < 128) continue;
    /*
     * Near-white and near-black are the page and the ink. They are almost
     * always the largest share and never the answer to "what colour is your
     * brand", so they are excluded from the proposal.
     */
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > 240 && min > 240) continue;
    if (max < 24) continue;
    considered += 1;
    const key = hex(quantise(r), quantise(g), quantise(b));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  if (considered === 0) return [];
  return [...counts.entries()]
    .map(([h, n]) => ({ hex: h, share: n / considered }))
    .sort((a, b) => b.share - a.share)
    .slice(0, take);
}

/**
 * A brand kit proposed from a logo.
 *
 * The most-used colour becomes the primary, because that is the one somebody
 * means. The accent is the next one that is *visibly different* from it rather
 * than simply the second most common — a logo with a navy and a slightly
 * lighter navy has one colour as far as lettering is concerned, and proposing
 * the second produces a halo nobody can see.
 *
 * Nothing is saved. This is a suggestion with the numbers behind it, and the
 * business confirms or ignores it.
 */
export async function brandFromLogo(input: Buffer): Promise<{ primaryColor: string | null; accentColor: string | null; palette: PaletteEntry[] }> {
  const palette = await logoPalette(input);
  if (!palette.length) return { primaryColor: null, accentColor: null, palette: [] };

  const { contrastRatio } = await import("@shared/ad-type");
  const primaryColor = palette[0].hex;
  const accentColor = palette.slice(1).find((p) => contrastRatio(p.hex, primaryColor) >= 2)?.hex ?? null;
  return { primaryColor, accentColor, palette };
}
