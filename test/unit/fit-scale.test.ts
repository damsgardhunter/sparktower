/**
 * The arithmetic behind a tab bar that stays on one line.
 *
 * Most of what could go wrong here goes wrong at the edges rather than in the
 * middle: the interesting cases are the ones where nothing has been measured
 * yet, where the measurement is nonsense, and where the row cannot be made to
 * fit at any readable size. The middle — "two thirds of the width, so two
 * thirds of the size" — is one line of division.
 */
import { describe, it, expect } from "vitest";
import { fitScale, MIN_FIT_SCALE } from "../../client/src/lib/fit-scale";

describe("fitting a row onto one line", () => {
  it("leaves a row that already fits at its designed size", () => {
    expect(fitScale({ available: 800, natural: 500 })).toBe(1);
    expect(fitScale({ available: 500, natural: 500 }), "exactly filling is fitting").toBe(1);
  });

  /*
   * Never larger. There is a designed size for this type; a tab bar on a wide
   * monitor should be that size rather than stretched to the viewport.
   */
  it("never scales a short row up to fill the space", () => {
    expect(fitScale({ available: 4000, natural: 300 })).toBe(1);
  });

  it("shrinks in proportion to how much is missing", () => {
    expect(fitScale({ available: 400, natural: 500 })).toBeCloseTo(0.8, 2);
    expect(fitScale({ available: 375, natural: 500 })).toBeCloseTo(0.75, 2);
  });

  /* Rounded down, not to nearest: a scale that rounds up still overflows. */
  it("rounds towards fitting rather than towards the nicer number", () => {
    const scale = fitScale({ available: 499, natural: 500 });
    expect(scale).toBeLessThan(1);
    expect(scale * 500).toBeLessThanOrEqual(499);
  });

  /*
   * The oscillation guard. Applying the scale resizes the row, which is
   * reported back as a resize, which recomputes — so a recompute from an
   * unchanged layout has to return the identical number or the row shivers
   * forever. Quantising is what makes that true.
   */
  it("returns the same answer for measurements a fraction of a pixel apart", () => {
    const a = fitScale({ available: 400, natural: 500 });
    const b = fitScale({ available: 400.3, natural: 500.2 });
    expect(b).toBe(a);
  });

  /*
   * Below nine pixels a label is not small, it is unreadable. The caller lets
   * the row scroll past this point instead, which is a worse row than a small
   * one but a better one than an illegible one.
   */
  it("stops at the readable floor however narrow the space", () => {
    expect(fitScale({ available: 40, natural: 900 })).toBe(MIN_FIT_SCALE);
    expect(fitScale({ available: 1, natural: 900 })).toBe(MIN_FIT_SCALE);
    expect(MIN_FIT_SCALE * 14).toBeCloseTo(9, 5);
  });

  it("honours a floor the caller sets, including none at all", () => {
    expect(fitScale({ available: 100, natural: 1000, min: 0.5 })).toBe(0.5);
    expect(fitScale({ available: 100, natural: 1000, min: 0 })).toBeCloseTo(0.1, 2);
  });

  /*
   * Nothing is measured on the first paint — before layout, and again before
   * the font loads — and both widths read 0. Shrinking on that would flash the
   * tabs in at the minimum size and grow them, which is exactly what it did.
   */
  it("treats an unmeasured row as one that fits", () => {
    expect(fitScale({ available: 0, natural: 0 })).toBe(1);
    expect(fitScale({ available: 600, natural: 0 })).toBe(1);
    expect(fitScale({ available: 0, natural: 600 })).toBe(1);
  });

  /*
   * `clientWidth` on a detached node, a measurement taken mid-unmount, a
   * division that went wrong upstream. A NaN scale sets `font-size: NaNpx`,
   * which the browser ignores — so the row would render at the inherited size
   * and the bug would only show as "sometimes it doesn't fit".
   */
  it("survives measurements that are not numbers", () => {
    for (const bad of [NaN, Infinity, -Infinity, -200]) {
      expect(fitScale({ available: bad, natural: 500 }), `available ${bad}`).toBe(1);
      expect(fitScale({ available: 500, natural: bad }), `natural ${bad}`).toBe(1);
    }
    expect(fitScale({ available: 400, natural: 500, min: NaN })).toBeGreaterThan(0);
  });
});
