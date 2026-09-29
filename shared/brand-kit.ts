/**
 * A logo and a cover image, drawn to stand in until somebody designs the real
 * ones.
 *
 * ## Why this is a placeholder and says so
 *
 * A generated logo is not a brand. It has no trademark search behind it, no
 * conversation about what the business is for, and no designer who will make
 * the next fifty things match it. What it does have is the thing an empty
 * project page cannot get any other way: a page that looks like somebody's
 * business rather than a form with the pictures missing. Every surface in this
 * product reads the logo — the public page, the feed, the backer merch, the
 * badge art, the images on the profile — and until there is one they all look
 * unfinished at once.
 *
 * So the copy calls it a placeholder everywhere it appears, and the upload
 * field stays exactly where it was. This is the thing you use on day one and
 * replace in month six, and pretending otherwise would be selling a dollar
 * logo as a brand.
 *
 * ## Why four styles rather than one button
 *
 * One button means one look, and the one look is whatever the model reaches
 * for first — which for "logo" is a glossy gradient roundel, on every project,
 * forever. Four named directions is the smallest set that covers what people
 * actually mean when they picture their own mark:
 *
 *   - a **name** logo when the name is the thing worth showing;
 *   - an **artistic** one when the business has a character to draw;
 *   - a **simple** one when it will live at sixteen pixels in a browser tab;
 *   - a **symmetric** one when it needs to read as established.
 *
 * They are choices about the drawing, not about what the business is, so
 * nobody has to know anything to pick one, and picking a different one is the
 * honest way to try again.
 *
 * ## Why the cover is drawn from the logo and not beside it
 *
 * A cover generated from the same brief as the logo is a second picture of the
 * same idea, and the two never quite belong to each other — slightly different
 * palettes, a shape that rhymes but does not match. The cover is drawn by
 * handing the model the logo it has just made, so the banner is demonstrably
 * the same business: same colours, the mark itself somewhere in it, at the
 * proportions the logo established.
 */

/** How many pictures one press makes. Read by the hourly ceiling in server/images.ts. */
export const BRAND_KIT_IMAGES = 2;

export interface LogoStyleDef {
  id: LogoStyleId;
  /** What the button says. */
  label: string;
  /** One line under it, for somebody choosing between four. */
  blurb: string;
  /**
   * What the model is told to draw. Written as direction rather than as a
   * whole prompt so the shared parts — the brief, the palette rule, the
   * background — stay in one place and cannot drift between four styles.
   */
  direction: string;
  /**
   * Whether the company's name is drawn into the mark.
   *
   * Only the name logo sets it. Everything else says "no lettering at all",
   * because a model given a name and no instruction puts it in half the time
   * and misspells it in a quarter of those — a logo with a typo in it is worse
   * than a logo with no words.
   */
  lettering: boolean;
}

export type LogoStyleId = "name" | "artistic" | "simple" | "symmetric";

export const LOGO_STYLES: LogoStyleDef[] = [
  {
    id: "name",
    label: "Name logo",
    blurb: "The company name, set as a wordmark.",
    lettering: true,
    direction: [
      "Draw a wordmark: the company's name, set as type, as the whole logo.",
      "Spell the name exactly as given, once, with no tagline, no second line and no invented words.",
      "Letterforms are the design — weight, spacing and one deliberate detail in a single letter.",
      "A small mark beside the name is allowed only if it grows out of a letter. No separate emblem.",
    ].join(" "),
  },
  {
    id: "artistic",
    label: "Artistic logo",
    blurb: "An expressive mark with some character to it.",
    lettering: false,
    direction: [
      "Draw an expressive emblem: an illustrated mark with a subject you can name,",
      "drawn with visible craft — brush weight, a confident line, some texture.",
      "Rich but still a logo: it must survive being printed in one colour.",
    ].join(" "),
  },
  {
    id: "simple",
    label: "Simple logo",
    blurb: "One clean shape that still reads at tab size.",
    lettering: false,
    direction: [
      "Draw a minimal mark: one idea, two or three shapes at most, flat colour, no gradients,",
      "no shadows, no highlights, no three-dimensional effects.",
      "It has to be recognisable at sixteen pixels, so nothing thinner than a thick stroke.",
    ].join(" "),
  },
  {
    id: "symmetric",
    label: "Symmetric logo",
    blurb: "A balanced mark — the steady, established look.",
    lettering: false,
    direction: [
      "Draw a symmetric mark: mirrored on its vertical axis, or radially balanced,",
      "centred in the square with even weight on both sides.",
      "Geometric construction, deliberate negative space, the settled look of a crest or a monogram.",
    ].join(" "),
  },
];

export const isLogoStyle = (v: unknown): v is LogoStyleId =>
  typeof v === "string" && LOGO_STYLES.some((s) => s.id === v);

export const logoStyle = (id: LogoStyleId): LogoStyleDef =>
  LOGO_STYLES.find((s) => s.id === id)!;
