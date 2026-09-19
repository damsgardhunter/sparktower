/**
 * The two palettes, held to the same shape and to being actually dark.
 *
 * A token missing from one scheme is not a type error at the call site — it is
 * `undefined` handed to React Native, which drops the style and renders black
 * text on a black card with no warning anywhere. It would be found by a person
 * with a dark phone looking at the one screen that uses it, which is the worst
 * available way to find it.
 */
import { describe, it, expect } from "vitest";
import { palettes } from "./theme";

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** Perceived brightness, 0–1. Enough to say "this is a dark colour" and no more. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("the palettes", () => {
  it("have exactly the same tokens", () => {
    expect(Object.keys(palettes.dark).sort()).toEqual(Object.keys(palettes.light).sort());
  });

  it("are all real colours", () => {
    for (const [scheme, palette] of Object.entries(palettes)) {
      for (const [token, value] of Object.entries(palette)) {
        expect(value, `${scheme}.${token}`).toMatch(HEX);
      }
    }
  });
});

describe("dark is dark", () => {
  const { dark, light } = palettes;

  it("puts light text on dark ground, and the other way round", () => {
    expect(luminance(dark.background)).toBeLessThan(0.1);
    expect(luminance(dark.text)).toBeGreaterThan(0.5);
    expect(luminance(light.background)).toBeGreaterThan(0.8);
    expect(luminance(light.text)).toBeLessThan(0.1);
  });

  it("keeps cards visible against the page they sit on", () => {
    /*
     * The inverse of light mode, and the thing most often got wrong: on white,
     * a card is lighter than the page; on black it has to be lighter still, or
     * the separation vanishes and the screen is one flat sheet.
     */
    expect(luminance(dark.surface)).toBeGreaterThan(luminance(dark.background));
    expect(luminance(dark.border)).toBeGreaterThan(luminance(dark.background));
  });

  it("keeps body text readable on every surface it lands on", () => {
    for (const ground of [dark.background, dark.surface, dark.surfaceRaised] as const) {
      // 4.5:1 is the usual floor for body text.
      expect(contrast(dark.text, ground), `text on ${ground}`).toBeGreaterThan(4.5);
      // Secondary text is smaller-print, but still has to be read.
      expect(contrast(dark.textSecondary, ground), `secondary on ${ground}`).toBeGreaterThan(3);
    }
  });

  it("keeps the brand purple rather than following the web's dark block into blue", () => {
    /*
     * The web's `.dark` sets --primary to a blue, which is a leftover from the
     * template its theme started as. Mirroring it would make this product a
     * different colour after sunset.
     */
    const [r, , b] = [1, 3, 5].map((i) => parseInt(dark.primary.slice(i, i + 2), 16));
    expect(r, "a purple has real red in it, a blue does not").toBeGreaterThan(120);
    expect(b).toBeGreaterThan(r);
    // And it has to be legible on the dark page, which the light-mode purple is not.
    expect(contrast(dark.primary, dark.background)).toBeGreaterThan(3);
  });
});
