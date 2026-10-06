/**
 * Dialogue, as against a headline.
 *
 * Everything here exists because one number was used for two jobs. `lineLimit`
 * answers "how much copy fits on one line set large over footage", which is
 * about thirty characters and is right for an advert. Applied to a character
 * speaking, it produced "Yo—forklift vlogging in vents." and "Oh no. I have
 * momentum now." — sentences with the grammar squeezed out, which somebody
 * watching described as sounding like a two-year-old talking.
 */
import { describe, it, expect } from "vitest";
import { captionLimit, lineLimit } from "@shared/ad-script";
import { fitParagraph, charsPerLine, TYPE_SIZE } from "@shared/ad-type";
import { safeBox, SAFE_AREAS } from "@shared/ad-safe-areas";
import { AD_FORMATS } from "@shared/ads";

const frames = AD_FORMATS.map((f) => ({
  id: f.id,
  box: safeBox(f, SAFE_AREAS[f.id]),
  shortEdge: Math.min(f.width, f.height),
}));

describe("how much a character may say", () => {
  it("gives dialogue far more room than a headline", () => {
    for (const seconds of [3, 4, 5]) {
      expect(captionLimit(seconds), `${seconds}s`).toBeGreaterThan(lineLimit("greet", seconds));
    }
    /* A four-second beat is a sentence, not a fragment. */
    expect(captionLimit(4)).toBeGreaterThanOrEqual(60);
  });

  it("scales with the time there is to read it", () => {
    expect(captionLimit(4)).toBeGreaterThan(captionLimit(2));
  });

  it("stops at what two lines actually hold, however long the beat", () => {
    /* More time does not create more room on the screen. */
    expect(captionLimit(30)).toBe(captionLimit(10));
  });

  it("stays usable on a very short beat", () => {
    expect(captionLimit(1)).toBeGreaterThanOrEqual(24);
  });
});

describe("setting a line of dialogue", () => {
  it("wraps onto a second line rather than shrinking to one", () => {
    /*
     * The opposite order from a headline, where the size goes first. A caption
     * that shrinks until it fits on one line is a caption nobody can read.
     */
    const { box, shortEdge } = frames.find((f) => f.id === "vertical")!;
    const out = fitParagraph("I have been stuck on this build for three weeks", box, shortEdge);
    expect(out.lines.length).toBe(2);
    expect(out.lines.join(" ")).toBe("I have been stuck on this build for three weeks");
  });

  it("never sets a line wider than the box, in any format", () => {
    const sentences = [
      "Hi",
      "Turns out people actually want to help?",
      "I have been stuck on this build for three weeks and nobody has even seen it yet",
      "x".repeat(300),
      "antidisestablishmentarianism",
    ];
    for (const { id, box, shortEdge } of frames) {
      for (const text of sentences) {
        const out = fitParagraph(text, box, shortEdge);
        const fits = charsPerLine(box.width, Math.round(shortEdge * out.sizeRatio));
        for (const line of out.lines) {
          expect(line.length, `${id}: "${line}"`).toBeLessThanOrEqual(fits);
        }
        expect(out.lines.length, `${id} used more than two lines`).toBeLessThanOrEqual(2);
      }
    }
  });

  it("keeps one short line at the caption size rather than inflating it", () => {
    const { box, shortEdge } = frames.find((f) => f.id === "vertical")!;
    /*
     * Compared in whole pixels, which is what the sizing works in and what
     * ffmpeg is handed: 0.055 of a 1080 frame is 59.4px, and the ratio that
     * comes back is 59/1080. Asserting the ratio exactly is asserting that the
     * rounding does not happen.
     */
    const out = fitParagraph("Hi there", box, shortEdge);
    expect(Math.round(out.sizeRatio * shortEdge)).toBe(Math.floor(TYPE_SIZE.caption * shortEdge));
  });

  it("is set smaller than a headline, because it is somebody talking", () => {
    expect(TYPE_SIZE.caption).toBeLessThan(TYPE_SIZE.max);
    expect(TYPE_SIZE.caption).toBeGreaterThan(TYPE_SIZE.min);
  });

  it("breaks on words and cuts on a word when it must cut", () => {
    const { box, shortEdge } = frames.find((f) => f.id === "vertical")!;
    const source = "Okay so apparently if you just post the thing you are making then other people turn up and start helping";
    const out = fitParagraph(source, box, shortEdge);
    const kept = out.lines.join(" ").replace(/…$/, "").trimEnd();
    expect(source.startsWith(kept), `"${kept}" is not the start of the sentence`).toBe(true);
    expect(source[kept.length] === " " || kept.length === source.length, "cut mid-word").toBe(true);
  });

  it("says nothing when given nothing", () => {
    const { box, shortEdge } = frames.find((f) => f.id === "vertical")!;
    expect(fitParagraph("   ", box, shortEdge).lines).toEqual([]);
  });
});
