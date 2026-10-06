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
    id: "native", label: "Native caption",
    why: "White, with a hard black edge and no brand colour in it at all — the way a caption looks on a phone. For the story formats, where a branded sticker is the thing that gives the film away as an advert.",
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
 * ## Which colour does which job
 *
 * The brand's colour is the **ring**, not the letters. This was the wrong way
 * round and it is the single thing that made the first rendered adverts look
 * amateur: `fill` was the brand's primary, so a business whose colour is a
 * muddy gold got muddy gold letter bodies set over footage nobody could
 * predict, and the one part of the frame that has to be readable was given
 * the one colour chosen for something else entirely.
 *
 * Actual sticker lettering — the thing people mean when they say bubble
 * letters — is a high-contrast fill inside a thick coloured outline. The fill
 * is white or near-black because it has to survive being laid over a bright
 * window in one shot and a dark table in the next; the brand is unmistakable
 * because it is the ring around every letter, which is a larger area than the
 * letters themselves.
 *
 * So: halo takes the brand colour, fill takes whatever contrasts with it most,
 * and the thin outline between them exists to stop the two bleeding together.
 *
 * ## Why none of it is chosen from the footage
 *
 * It cannot be. The plate is generated after this is decided, and it changes
 * from shot to shot — a treatment picked for a bright kitchen is wrong three
 * seconds later in the same advert. The dark shadow underneath is what makes
 * it work on light footage and the halo is what makes it work on dark, which
 * is why both are always drawn rather than selected between.
 */
export function typeTreatment(
  brand: { primaryColor: string; backgroundColor: string; accentColor?: string | null },
  style: TypeStyleId = "bubble",
): TypeTreatment {
  /*
   * The ring is the primary, because the primary is the brand. The accent is
   * a fallback and nothing more.
   *
   * The first version of this rule preferred whichever of the two contrasted
   * harder with white, which sounds reasonable and is wrong every time: the
   * darker colour always wins that comparison, so a business whose primary is
   * a gold and whose accent is a near-black got a near-black ring — a
   * perfectly readable piece of lettering with no brand in it at all, which is
   * the thing this whole treatment exists to put there.
   *
   * The accent is used only when the primary cannot hold a fill against it:
   * a mid-grey has no strong contrast colour in either direction, and a ring
   * nobody can read letters inside is not a ring.
   */
  const primary = brand.primaryColor;
  const accent = brand.accentColor ?? null;
  const holds = (ring: string) => contrastRatio(againstColor(ring), ring) >= 4.5;
  const halo = holds(primary) || !accent || !holds(accent) ? primary : accent;

  /* Whatever reads hardest against the ring. */
  const fill = againstColor(halo);
  /*
   * A thin line between fill and ring. Normally the fill's own contrast
   * colour — which is the ring's family — so where those two would blur into
   * each other it takes the fill's colour instead and reads as a gap.
   */
  const between = againstColor(fill);
  /*
   * Where that line would be the ring's own colour it is not a separator, it
   * is a thicker ring — so there is no line at all, and the ring does the
   * separating on its own. An earlier version set it to the fill's colour
   * instead, which is worse than nothing: an outline the same colour as the
   * letters is not an outline, and it is the one thing this must never be.
   */
  const separates = contrastRatio(between, halo) >= 1.6;
  const outline = between;

  if (style === "native") {
    /*
     * The brand deliberately absent.
     *
     * Every other treatment here puts the company's colour in the lettering,
     * which is right for an advert and wrong for a film pretending not to be
     * one. A caption in a brand palette is the detail that gives it away: real
     * captions are white with a hard dark edge, because that is what survives
     * being burned in by a phone. The brand is in the film through the product
     * and the words, not through the colour of the subtitles.
     */
    return { fill: "#FFFFFF", outline: "#000000", outlineRatio: 0.075, halo: "#000000", haloRatio: 0, shadow: "#000000", shadowRatio: 0.02 };
  }
  if (style === "plain") {
    return { fill, outline, outlineRatio: 0, halo, haloRatio: 0, shadow: "#000000", shadowRatio: 0.03 };
  }
  if (style === "outline") {
    /* One ring, in the brand's colour, and no second outline. */
    return { fill, outline: halo, outlineRatio: 0.07, halo, haloRatio: 0, shadow: "#000000", shadowRatio: 0.02 };
  }
  return {
    fill,
    outline,
    outlineRatio: separates ? 0.05 : 0,
    halo,
    /* Thicker than it was: the ring is the brand, so it has to be seen as one. */
    haloRatio: 0.16,
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
