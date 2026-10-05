/**
 * How words look on an advert: thick, outlined, and legible over anything.
 *
 * ## Why bubble letters are a legibility decision, not a style one
 *
 * A caption on a feed video has to survive being drawn over footage nobody
 * chose — a plate that is pale in one shot and dark in the next, bright at the
 * top and busy at the bottom. A box behind the text solves that by hiding the
 * footage, which works and looks like a subtitle.
 *
 * The alternative is to make the letters themselves carry their own contrast:
 * a thick fill, a heavy outline in the opposite tone, and a soft shadow under
 * it. That reads over light and dark in the same shot, needs no box, and is
 * also what every advert on the platform looks like — which is the point. A
 * business's advert should look like it belongs there.
 *
 * ## Where the colours come from
 *
 * The fill is the brand's. The outline is chosen *against* it, by contrast
 * ratio rather than by taste: a brand colour that is already dark gets a light
 * outline and vice versa. That is the one decision here that cannot be left to
 * the business, because "pick an outline colour" is a question nobody can
 * answer and getting it wrong makes the words disappear.
 */

/** Relative luminance, per WCAG. The gamma expansion is not optional — skipping it makes mid-greys read as light. */
export function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const channel = (pair: string) => {
    const v = parseInt(pair, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(h.slice(0, 2)) + 0.7152 * channel(h.slice(2, 4)) + 0.0722 * channel(h.slice(4, 6));
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The more readable of white or near-black against this colour. */
export const againstColor = (hex: string): string =>
  contrastRatio(hex, "#FFFFFF") >= contrastRatio(hex, "#111111") ? "#FFFFFF" : "#111111";

export interface TypeTreatment {
  /** The letter bodies. */
  fill: string;
  /** The outline drawn around them, chosen for contrast against the fill. */
  outline: string;
  /** Outline thickness as a fraction of the font size. */
  outlineRatio: number;
  /**
   * A second, wider outline in the fill's own contrast colour, drawn under the
   * first. Two outlines is what separates sticker lettering from outlined
   * text — one reads as a stroke, two reads as an object sitting on the video.
   */
  haloRatio: number;
  halo: string;
  /** Shadow offset as a fraction of the font size, and its colour. */
  shadowRatio: number;
  shadow: string;
}

export const TYPE_STYLES = [
  {
    id: "bubble", label: "Bubble",
    why: "Thick fill, double outline, soft shadow. Reads over light and dark footage in the same shot, and looks like what people expect an advert to look like.",
  },
  {
    id: "outline", label: "Outlined",
    why: "One outline, no halo. Quieter — for a brand whose whole look is restrained, where sticker lettering would be wrong.",
  },
  {
    id: "plain", label: "Plain",
    why: "Fill and a shadow only. Needs a plate that is reliably dark or reliably light, so it is offered and not the default.",
  },
] as const;
export type TypeStyleId = (typeof TYPE_STYLES)[number]["id"];
export const TYPE_STYLE_IDS = TYPE_STYLES.map((t) => t.id) as TypeStyleId[];

/**
 * The treatment for a brand, in a style.
 *
 * `accent` is used for the halo when it is far enough from the fill to read as
 * a deliberate second colour. When it is not — a brand whose accent is nearly
 * its primary — the halo falls back to the contrast colour, because two
 * near-identical outlines is a blurry edge rather than a design.
 */
export function typeTreatment(
  brand: { primaryColor: string; backgroundColor: string; accentColor?: string | null },
  style: TypeStyleId = "bubble",
): TypeTreatment {
  const fill = brand.primaryColor;
  const outline = againstColor(fill);
  const accent = brand.accentColor ?? null;
  /*
   * Three is the ratio at which two colours are distinguishable at a glance
   * on a small screen — well below the 4.5 wanted for body text, which is the
   * right bar for a decorative edge rather than something being read.
   */
  const accentReads = !!accent && contrastRatio(accent, fill) >= 3 && contrastRatio(accent, outline) >= 1.6;

  if (style === "plain") {
    return { fill, outline, outlineRatio: 0, halo: outline, haloRatio: 0, shadow: "#000000", shadowRatio: 0.03 };
  }
  if (style === "outline") {
    return { fill, outline, outlineRatio: 0.06, halo: outline, haloRatio: 0, shadow: "#000000", shadowRatio: 0.02 };
  }
  return {
    fill,
    outline,
    outlineRatio: 0.08,
    halo: accentReads ? accent! : againstColor(outline),
    haloRatio: 0.14,
    shadow: "#000000",
    shadowRatio: 0.035,
  };
}

/**
 * How many characters fit on a line at this size, roughly.
 *
 * Used to refuse copy rather than to wrap it. A headline that needs wrapping
 * on a vertical advert is a headline that is too long — two lines of large
 * type is most of the frame, and three is a poster. The script writer reads
 * this so it writes to the space rather than being cropped to it.
 */
export function charsPerLine(frameWidth: number, fontSize: number): number {
  /*
   * 0.52 of the font size per character, which is about right for a bold
   * geometric sans in mixed case. Deliberately pessimistic: a line that
   * turns out to fit is fine, and one that overflows is clipped mid-word.
   */
  return Math.floor(frameWidth / (fontSize * 0.52));
}

/** The longest line this copy may be, given the frame and the size it will be set at. */
export function lineBudget(frame: { width: number }, sizeRatio: number, shortEdge: number): number {
  return charsPerLine(frame.width, Math.round(shortEdge * sizeRatio));
}
