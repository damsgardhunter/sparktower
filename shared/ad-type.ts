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

/**
 * The largest and smallest a line is ever set at, as a share of the short edge.
 *
 * The ceiling is the size a hook wants to be. The floor is the size below
 * which type on a phone stops being a headline and starts being a caption —
 * shrinking past it to fit a long line produces something nobody reads
 * anyway, so at that point the line is trimmed instead.
 */
export const TYPE_SIZE = { max: 0.075, min: 0.042 } as const;

/**
 * A line, and the size to set it at, guaranteed to fit the width it is given.
 *
 * This exists because `lineLimit` is a *reading-speed* limit and was being
 * used as if it were a width one. They are not the same number and at some
 * lengths they are nowhere near: a three-second proof beat is allowed
 * forty-five characters to read comfortably, and forty-five characters set at
 * the hook's size on a vertical frame is about twice the width of the safe
 * box. The first advert this pipeline rendered end to end had "Made by people
 * who use it" clipped at both edges — the M and the final word were off the
 * frame — and nothing in the chain had checked.
 *
 * So: shrink the type until the line fits, down to the floor, and only then
 * trim. Shrinking first because the whole line surviving smaller is better
 * than most of it surviving large, and trimming at all is a last resort —
 * `lineLimit` in the script writer is what is supposed to prevent it, and a
 * trim here means a script was written against a different frame.
 */
export function fitLine(
  text: string,
  box: { width: number },
  shortEdge: number,
  max: number = TYPE_SIZE.max,
): { text: string; sizeRatio: number } {
  const clean = text.trim();
  if (!clean) return { text: "", sizeRatio: max };

  /*
   * Worked out in whole pixels, because that is what `charsPerLine` measures
   * and what ffmpeg is eventually given. Going via a ratio and rounding back
   * cost a character every time: the ratio that exactly fits rounds *up* to
   * the nearest pixel, which fits one fewer character than it was chosen for,
   * and a line that should have been set a hair smaller got trimmed instead.
   */
  const biggest = Math.floor(shortEdge * max);
  /* Ceiling, not floor: flooring lands a fraction *below* the stated minimum. */
  const smallest = Math.ceil(shortEdge * TYPE_SIZE.min);
  const fontSize = Math.max(smallest, Math.min(biggest, Math.floor(box.width / (clean.length * 0.52))));
  const sizeRatio = fontSize / shortEdge;

  const fits = charsPerLine(box.width, fontSize);
  if (clean.length <= fits) return { text: clean, sizeRatio };
  /* Still too long at the smallest size worth setting. Cut on a word. */
  const cut = clean.slice(0, Math.max(1, fits - 1));
  const onWord = cut.includes(" ") ? cut.slice(0, cut.lastIndexOf(" ")) : cut;
  return { text: `${onWord.trimEnd()}…`, sizeRatio };
}

/** The longest line this copy may be, given the frame and the size it will be set at. */
export function lineBudget(frame: { width: number }, sizeRatio: number, shortEdge: number): number {
  return charsPerLine(frame.width, Math.round(shortEdge * sizeRatio));
}
