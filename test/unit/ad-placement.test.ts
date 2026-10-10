/**
 * Where a line sits, decided from the picture rather than assumed.
 *
 * The arithmetic is tested and the file reading is not: `placeLine` spawns
 * ffmpeg and reads a frame off disk, and what is worth holding still is the
 * judgement — which band is busiest, and how much better another one has to be
 * before the words move.
 */
import { describe, it, expect } from "vitest";
import { busyness, chooseBand, BAND_HEIGHTS, DEFAULT_HEIGHT, MOVE_THRESHOLD } from "../../server/ad-placement";

/** A frame as rows of grey: `rows[y][x]`. */
const flat = (value: number, h = 100, w = 50) =>
  Array.from({ length: h }, () => Array.from({ length: w }, () => value));

function noisyBand(rows: number[][], from: number, to: number) {
  const out = rows.map((r) => r.slice());
  for (let y = from; y < to; y++) for (let x = 0; x < out[y].length; x++) out[y][x] = x % 2 ? 255 : 0;
  return out;
}

describe("how busy a band is", () => {
  it("is nothing at all for a flat band, whatever its brightness", () => {
    /*
     * Brightness is not the question. A band can be very dark and perfectly
     * easy to read type over; what ruins a line is detail behind it.
     */
    expect(busyness(flat(0), 10, 20)).toBe(0);
    expect(busyness(flat(255), 10, 20)).toBe(0);
    expect(busyness(flat(128), 10, 20)).toBe(0);
  });

  it("rises with the detail in it", () => {
    const rows = noisyBand(flat(128), 40, 60);
    expect(busyness(rows, 40, 20)).toBeGreaterThan(busyness(rows, 0, 20));
  });

  it("only measures the band it was asked about", () => {
    const rows = noisyBand(flat(128), 0, 20);
    expect(busyness(rows, 60, 20), "a quiet band stays quiet when another is loud").toBe(0);
  });

  it("reads the top of the frame when asked about above it, not the bottom", () => {
    /*
     * A negative index is not an error in JavaScript, it counts from the end —
     * so an unclamped `slice(-50, 20)` quietly measures the bottom of the
     * frame when asked about the top, and a busy floor would push the words
     * away from a perfectly empty sky.
     */
    /*
     * The noise sits where an unclamped `slice(-50, -30)` would land, which is
     * the only way to tell the two apart: with it anywhere else, counting from
     * the end happens to find quiet rows and the bug reads as correct.
     */
    const rows = noisyBand(flat(128), 50, 70);
    expect(busyness(rows, -50, 20), "counted from the end and measured rows 50-70").toBe(0);
    expect(busyness(rows, 1000, 20), "past the bottom is nothing, not a crash").toBe(0);
    expect(busyness(rows, 50, 20), "and the busy band is still busy").toBeGreaterThan(0);
  });

  it("measures the part that is in frame when a band straddles the top edge", () => {
    /*
     * The realistic case, and the only one that tells the near clamp apart: a
     * line near the top of the safe area sits a little above it once its own
     * height is allowed for. Unclamped, `slice(-5, 25)` starts after it ends
     * and reports nothing at all — so a band over a busy sky would read as
     * perfectly quiet and the words would be laid straight over it.
     */
    const rows = noisyBand(flat(128), 0, 20);
    expect(busyness(rows, -5, 30), "reported nothing for a band that is half in frame").toBeGreaterThan(0);
  });
});

describe("choosing where the words go", () => {
  it("keeps the conventional place when nothing is clearly better", () => {
    /*
     * Type that wanders between shots for no visible reason is its own kind of
     * distracting, so a tie goes to where a viewer already expects the words.
     */
    expect(chooseBand({ 0.22: 100, 0.5: 100, 0.78: 100 })).toBe(DEFAULT_HEIGHT);
    expect(chooseBand({ 0.22: 99, 0.5: 98, 0.78: 100 }), "marginally quieter is not a reason to move").toBe(DEFAULT_HEIGHT);
  });

  it("moves when the usual place is genuinely cluttered", () => {
    expect(chooseBand({ 0.22: 10, 0.5: 400, 0.78: 500 })).toBe(0.22);
    expect(chooseBand({ 0.22: 400, 0.5: 10, 0.78: 500 })).toBe(0.5);
  });

  it("moves exactly at the threshold it documents, and not before", () => {
    const home = 100;
    expect(chooseBand({ 0.22: home * MOVE_THRESHOLD, 0.5: home, 0.78: home }), "equal to the threshold is not better than it").toBe(DEFAULT_HEIGHT);
    expect(chooseBand({ 0.22: home * MOVE_THRESHOLD - 1, 0.5: home, 0.78: home })).toBe(0.22);
  });

  it("falls back to the usual place when the frame could not be measured", () => {
    expect(chooseBand({})).toBe(DEFAULT_HEIGHT);
  });

  it("only ever answers with a height it was given", () => {
    for (const scores of [{ 0.22: 1, 0.5: 2, 0.78: 3 }, { 0.22: 3, 0.5: 1, 0.78: 2 }, {}]) {
      expect(BAND_HEIGHTS as readonly number[]).toContain(chooseBand(scores));
    }
  });
});
