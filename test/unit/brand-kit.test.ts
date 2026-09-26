/**
 * The dollar logo, at the two points where it can go wrong quietly.
 *
 * The first is the styles. Four buttons that all send the same instruction is
 * the failure this feature is most likely to have and least likely to notice —
 * a person presses "Simple", gets the same glossy roundel "Artistic" gave them,
 * and concludes the product is lying about the choice. The difference between
 * the four is one string each, so this reads them.
 *
 * The second is the lettering rule. A model handed a company name and no
 * instruction about it draws the name into the mark roughly half the time and
 * misspells it in a good share of those, and a logo with a typo in it is worse
 * than a logo with no words. So exactly one style asks for text, and the other
 * three forbid it in terms the model cannot read as a suggestion.
 */
import { describe, it, expect } from "vitest";
import { LOGO_STYLES, isLogoStyle, logoStyle, BRAND_KIT_IMAGES } from "@shared/brand-kit";
import { logoPrompt, coverPrompt } from "../../server/brand-kit";
import { stubImageBase64 } from "../../server/ai-stub";
import { OUTCOME_PRICE_CENTS, OUTCOME_COPY, CHARGE_FOR, formatMoney } from "@shared/plans";

const project = {
  id: "p1",
  title: "Kettle & Fern",
  category: "saas",
  ownerId: "u1",
  oneLiner: "We help small tea rooms take bookings without a website.",
  description: "A booking page a tea room can set up in ten minutes.",
  problemStatement: "Independent tea rooms lose walk-in trade to anyone with an online booking link.",
  targetUser: "Owners of one- and two-room cafés.",
} as any;

describe("the four looks a logo can have", () => {
  it("offers exactly the four, each with its own instruction to the model", () => {
    expect(LOGO_STYLES.map((s) => s.id)).toEqual(["name", "artistic", "simple", "symmetric"]);

    const directions = LOGO_STYLES.map((s) => s.direction.trim());
    expect(new Set(directions).size, "four buttons that send the same prompt are one button").toBe(4);
    for (const style of LOGO_STYLES) {
      expect(style.label.trim(), `${style.id} needs something on its button`).not.toBe("");
      expect(style.blurb.trim(), `${style.id} needs a line under it`).not.toBe("");
    }
  });

  /* And the prompts really differ, not just the table they came from. */
  it("asks for a different drawing for each one", () => {
    const prompts = LOGO_STYLES.map((s) => logoPrompt(project, s));
    expect(new Set(prompts).size).toBe(4);
    for (const p of prompts) expect(p).toContain("Kettle & Fern");
  });

  it("puts the name in the name logo and forbids text in the other three", () => {
    for (const style of LOGO_STYLES) {
      const prompt = logoPrompt(project, style);
      if (style.id === "name") {
        expect(style.lettering).toBe(true);
        expect(prompt, "the wordmark has to be told how to spell it").toContain('spelled exactly "Kettle & Fern"');
        expect(prompt).not.toMatch(/No text, letters, words or numbers/);
      } else {
        expect(style.lettering, `${style.id} should not ask for lettering`).toBe(false);
        expect(prompt, `${style.id} must forbid text outright`).toMatch(/No text, letters, words or numbers/);
      }
    }
  });

  it("grounds the drawing in the brief, not only the name", () => {
    const prompt = logoPrompt(project, logoStyle("simple"));
    expect(prompt).toContain("small tea rooms take bookings");
    expect(prompt).toContain("Independent tea rooms lose walk-in trade");
  });

  /*
   * The point of drawing the cover second. An edit call handed a reference and
   * no instruction about it will redraw the mark into something adjacent, which
   * is the exact mismatch that drawing the cover from the logo was meant to
   * prevent — so the instruction is the feature.
   */
  it("tells the cover to keep the logo it was handed", () => {
    const prompt = coverPrompt(project, logoStyle("artistic"));
    expect(prompt).toContain("logo");
    expect(prompt).toMatch(/not redrawn, not restyled/);
    expect(prompt, "a cover is a banner, and the page puts a title over it").toMatch(/[Ww]ide landscape/);
  });

  it("takes only the four ids", () => {
    for (const style of LOGO_STYLES) expect(isLogoStyle(style.id)).toBe(true);
    for (const junk of ["", "NAME", "trio", "__proto__", null, undefined, 3, {}]) {
      expect(isLogoStyle(junk as unknown), `${String(junk)} is not a look`).toBe(false);
    }
  });
});

describe("what it costs", () => {
  it("is a dollar, and the whole-business build buys it", () => {
    expect(OUTCOME_PRICE_CENTS.brand).toBe(100);
    expect(formatMoney(OUTCOME_PRICE_CENTS.brand)).toBe("$1");
    expect(CHARGE_FOR.brandKit, "priced in dollars, not out of the monthly allowance").toBe("brand");
    /*
     * Said out loud in the copy, not only in the code. The price is a dollar
     * and the thing being bought is a stand-in; a blurb that called it a brand
     * would be selling a designer for a dollar.
     */
    expect(OUTCOME_COPY.brand.blurb.toLowerCase()).toContain("placeholder");
  });

  it("makes two pictures, which is what the hourly ceiling is told", () => {
    expect(BRAND_KIT_IMAGES).toBe(2);
  });
});

/**
 * The fake drawing. Its whole value is that the image routes — the only ones
 * that cost real money on every press — can be driven for nothing, and the way
 * that fails is silent: a stub returning something the routes can't store looks
 * like broken image generation rather than a broken stub.
 */
describe("the stubbed image", () => {
  const png = (size: unknown) => Buffer.from(stubImageBase64(size), "base64");

  it("is a real PNG of the size that was asked for", () => {
    const wide = png("1536x1024");
    expect([...wide.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(wide.toString("ascii", 12, 16), "the header chunk comes first").toBe("IHDR");
    expect(wide.readUInt32BE(16)).toBe(1536);
    expect(wide.readUInt32BE(20)).toBe(1024);
    expect(wide.toString("ascii", wide.length - 8, wide.length - 4)).toBe("IEND");

    const square = png("1024x1024");
    expect(square.readUInt32BE(16)).toBe(1024);
    expect(square.readUInt32BE(20)).toBe(1024);
  });

  it("falls back to a square rather than throwing on a size it can't read", () => {
    for (const size of [undefined, null, "auto", "1024", "banana"]) {
      const buf = png(size);
      expect(buf.readUInt32BE(16), `${String(size)} should still draw something`).toBe(512);
      expect(buf.readUInt32BE(20)).toBe(512);
    }
  });
});
