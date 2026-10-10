/**
 * How words look on an advert, and where their colours come from.
 *
 * Bubble lettering is a legibility decision before it is a style one. A
 * caption on a feed video is drawn over footage nobody chose — pale in one
 * shot and dark in the next — and letters that carry their own contrast
 * survive that where a flat fill does not. The alternative, a box behind the
 * text, works by hiding the footage and looks like a subtitle.
 *
 * The colours come from the brand, and the brand can come from the logo,
 * because "what is your brand colour" is a question most small businesses
 * answer by eye and not in hex.
 */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  TYPE_STYLES, againstColor, charsPerLine, contrastRatio, luminance, typeTreatment,
} from "@shared/ad-type";
import { brandFromLogo, logoPalette } from "../../server/logo-palette";

describe("contrast maths", () => {
  it("matches the known luminance of black and white", () => {
    expect(luminance("#000000")).toBeCloseTo(0, 5);
    expect(luminance("#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("gets the gamma expansion right, not a linear average", () => {
    /*
     * Mid-grey is about 0.21 in relative luminance, not 0.5. Skipping the
     * gamma step is the classic error and makes mid-tones read as light, so
     * every outline on a mid-toned brand would come out the wrong way round.
     */
    expect(luminance("#808080")).toBeGreaterThan(0.18);
    expect(luminance("#808080")).toBeLessThan(0.24);
  });

  it("gives black on white the maximum ratio", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    /* And is symmetric, since it is a ratio of two luminances. */
    expect(contrastRatio("#1B9AAA", "#FFFFFF")).toBeCloseTo(contrastRatio("#FFFFFF", "#1B9AAA"), 6);
  });

  it("picks the readable side of any colour", () => {
    expect(againstColor("#111111")).toBe("#FFFFFF");
    expect(againstColor("#FFFFFF")).toBe("#111111");
    /* And actually improves things: the chosen side must beat the other. */
    for (const hex of ["#1B9AAA", "#808080", "#F5F1E3", "#4B0082"]) {
      const chosen = againstColor(hex);
      const other = chosen === "#FFFFFF" ? "#111111" : "#FFFFFF";
      expect(contrastRatio(hex, chosen), hex).toBeGreaterThanOrEqual(contrastRatio(hex, other));
    }
  });
});

describe("the bubble treatment", () => {
  it("always outlines against the fill, never with it", () => {
    /*
     * The one decision that cannot be left to the business: "pick an outline
     * colour" is a question nobody can answer, and getting it wrong makes the
     * words vanish.
     */
    for (const primaryColor of ["#1B9AAA", "#111111", "#FFFFFF", "#F5F1E3", "#4B0082"]) {
      const t = typeTreatment({ primaryColor, backgroundColor: "#FFFFFF" });
      expect(contrastRatio(t.fill, t.outline), primaryColor).toBeGreaterThan(4);
    }
  });

  it("draws two outlines, because one reads as a stroke and two as an object", () => {
    const t = typeTreatment({ primaryColor: "#1B9AAA", backgroundColor: "#FFFFFF", accentColor: "#F5F1E3" });
    expect(t.outlineRatio).toBeGreaterThan(0);
    expect(t.haloRatio).toBeGreaterThan(t.outlineRatio);
  });

  it("refuses an accent too close to the fill to be seen", () => {
    /*
     * A brand whose accent is nearly its primary has one colour as far as
     * lettering goes. Two near-identical outlines is a blurry edge, not a
     * design, so the halo falls back.
     */
    const close = typeTreatment({ primaryColor: "#1B9AAA", backgroundColor: "#FFF", accentColor: "#1C9BAB" });
    expect(close.halo).not.toBe("#1C9BAB");
    const far = typeTreatment({ primaryColor: "#1B9AAA", backgroundColor: "#FFF", accentColor: "#F5F1E3" });
    expect(contrastRatio(far.halo, far.fill)).toBeGreaterThanOrEqual(2);
  });

  it("offers a quieter option and a plain one, and says when plain is wrong", () => {
    expect(TYPE_STYLES.map((t) => t.id)).toEqual(["bubble", "outline", "native", "plain"]);
    const plain = typeTreatment({ primaryColor: "#1B9AAA", backgroundColor: "#FFF" }, "plain");
    expect(plain.outlineRatio).toBe(0);
    expect(plain.haloRatio).toBe(0);
    /* Plain needs a predictable plate, so the catalogue says so rather than
     * leaving somebody to find out on a pale shot. */
    expect(TYPE_STYLES.find((t) => t.id === "plain")!.why).toMatch(/reliably dark or reliably light/i);
  });

  it("keeps the brand out of a native caption entirely", () => {
    /*
     * The one treatment that must not carry the company's colour. Every other
     * one here puts the brand in the lettering, which is right for an advert
     * and is the detail that gives away a film pretending not to be one: real
     * captions are white with a hard dark edge, because that is what a phone
     * burns in. The brand reaches those films through the product and the
     * words instead.
     */
    for (const primaryColor of ["#1B9AAA", "#C09030", "#E01B24", "#101820"]) {
      const t = typeTreatment({ primaryColor, backgroundColor: "#FFFFFF", accentColor: "#FF00FF" }, "native");
      for (const part of [t.fill, t.outline, t.halo, t.shadow]) {
        expect(part.toUpperCase(), `${primaryColor} leaked into a native caption`).toMatch(/^#(FFFFFF|000000)$/);
      }
      /* And it is still readable over anything: white letters, hard black edge. */
      expect(t.fill.toUpperCase()).toBe("#FFFFFF");
      expect(t.outlineRatio).toBeGreaterThan(0);
    }
  });

  it("keeps a shadow under every style, including plain", () => {
    for (const style of TYPE_STYLES) {
      const t = typeTreatment({ primaryColor: "#1B9AAA", backgroundColor: "#FFF" }, style.id);
      expect(t.shadowRatio, style.id).toBeGreaterThan(0);
    }
  });
});

describe("writing to the space rather than being cropped to it", () => {
  it("gives fewer characters at a larger size", () => {
    expect(charsPerLine(1080, 60)).toBeGreaterThan(charsPerLine(1080, 120));
  });

  it("is pessimistic rather than optimistic", () => {
    /*
     * A line that turns out to fit is fine; one that overflows is clipped
     * mid-word on somebody's advert. At a tenth of the frame height on a
     * vertical video, a headline is a handful of words, not a sentence.
     */
    const atTenth = charsPerLine(1080, Math.round(1080 * 0.095));
    expect(atTenth).toBeLessThan(25);
    expect(atTenth).toBeGreaterThan(8);
  });
});

describe("reading the colours out of a logo", () => {
  const logo = async (body: string) =>
    sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">${body}</svg>`)).png().toBuffer();

  it("finds the colour somebody would call their brand colour", async () => {
    const png = await logo(`<circle cx="200" cy="200" r="150" fill="#1B9AAA"/>`);
    const palette = await logoPalette(png);
    expect(palette.length).toBeGreaterThan(0);
    /* Quantised, so near rather than exact — the bucket, not the pixel. */
    expect(contrastRatio(palette[0].hex, "#1B9AAA")).toBeLessThan(1.3);
  });

  it("ignores the transparent background, which is not one of the colours", async () => {
    const png = await logo(`<circle cx="200" cy="200" r="60" fill="#1B9AAA"/>`);
    const palette = await logoPalette(png);
    /* A small mark on a large transparent canvas: the mark still wins. */
    expect(palette[0].share).toBeGreaterThan(0.5);
  });

  it("ignores the paper and the ink", async () => {
    /*
     * Near-white and near-black dominate every count and are never what
     * somebody means by their brand colour. Still available as a fill — just
     * not proposed.
     */
    const png = await logo(
      `<rect width="400" height="400" fill="#FFFFFF"/>` +
      `<circle cx="200" cy="200" r="80" fill="#1B9AAA"/>` +
      `<text x="200" y="380" font-size="30" fill="#000000">x</text>`,
    );
    const palette = await logoPalette(png);
    expect(palette.length).toBeGreaterThan(0);
    for (const entry of palette) {
      expect(entry.hex, "white should not be proposed").not.toBe("#FFFFFF");
      expect(entry.hex, "black should not be proposed").not.toBe("#000000");
    }
  });

  it("proposes an accent only when it is visibly different", async () => {
    const twoTone = await logo(
      `<circle cx="200" cy="200" r="150" fill="#1B9AAA"/><rect x="140" y="180" width="120" height="50" fill="#F5F1E3"/>`,
    );
    const far = await brandFromLogo(twoTone);
    expect(far.primaryColor).toBeTruthy();
    expect(far.accentColor, "two distinct colours should give an accent").toBeTruthy();
    expect(contrastRatio(far.accentColor!, far.primaryColor!)).toBeGreaterThanOrEqual(2);

    /* One colour, plus a shade of itself: no accent worth proposing. */
    const oneTone = await logo(`<circle cx="200" cy="200" r="150" fill="#1B9AAA"/>`);
    expect((await brandFromLogo(oneTone)).accentColor).toBeNull();
  });

  it("answers rather than throwing on a logo with nothing in it", async () => {
    /* A fully transparent or all-white file is a real upload. */
    const blank = await logo("");
    const res = await brandFromLogo(blank);
    expect(res.primaryColor).toBeNull();
    expect(res.palette).toEqual([]);
  });
});
