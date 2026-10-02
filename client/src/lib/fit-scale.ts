/**
 * Shrinking a row of text until it fits on one line.
 *
 * The project page's tab bar used to wrap: on a narrow window "Followers 156"
 * dropped onto a second line, and the five tabs became a two-line block whose
 * height changed as counts loaded. Wrapping is the safe default for a row of
 * unknown width, but a tab bar is a single horizontal thing — a visitor reads
 * it as one control, and half of it below the other half reads as two.
 *
 * So the row stays on one line and the type gets smaller instead. The scale is
 * a ratio of what is available to what the row needs at its natural size, and
 * the caller applies it as a font size on the row's own element, with the
 * padding, the gaps and the icons all sized in `em` so every part of the row
 * shrinks by exactly the same factor. That proportionality is what makes one
 * measurement enough: if the padding were fixed in pixels, scaling the text by
 * 0.7 would not scale the row by 0.7, and fitting would take a search.
 *
 * Two things this deliberately does not do:
 *
 *   - **It never scales up.** There is a designed size for this type and a tab
 *     bar on a wide monitor should be that size, not stretched to the viewport.
 *   - **It stops at a floor.** Below about nine pixels a label is not small, it
 *     is unreadable, and a row of unreadable labels is worse than a row that
 *     scrolls. The caller lets the row scroll past that point.
 */

export interface FitScaleInput {
  /** Width the row has to live in, in pixels. */
  available: number;
  /** Width the row needs at scale 1, in pixels. */
  natural: number;
  /** The smallest scale worth applying, as a fraction of the base size. */
  min?: number;
}

/**
 * The granularity of the answer.
 *
 * Applying the scale changes the row's size, which a ResizeObserver reports,
 * which recomputes the scale — so a value that moves by a thousandth on every
 * pass oscillates forever and the row visibly shivers. Quantising to half a
 * percent means a recompute from an unchanged layout returns the identical
 * number and the loop settles on the first pass.
 */
const STEP = 200;

/** Nine pixels against a fourteen pixel base: the floor, as a fraction. */
export const MIN_FIT_SCALE = 9 / 14;

export function fitScale({ available, natural, min = MIN_FIT_SCALE }: FitScaleInput): number {
  /*
   * An unmeasured row is not a row that needs shrinking. Both of these are
   * zero on the first paint, before layout has happened and before fonts have
   * loaded, and treating that as "needs to be 0.64 of the size" would flash
   * the tabs in at the minimum and grow them — which is what it looked like
   * when this returned the ratio unconditionally.
   */
  if (!Number.isFinite(available) || available <= 0) return 1;
  if (!Number.isFinite(natural) || natural <= 0) return 1;
  if (natural <= available) return 1;

  const floor = Number.isFinite(min) ? Math.min(1, Math.max(0, min)) : MIN_FIT_SCALE;
  const wanted = Math.floor((available / natural) * STEP) / STEP;
  return Math.min(1, Math.max(floor, wanted));
}
