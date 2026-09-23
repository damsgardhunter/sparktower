/**
 * Nova's look, in one place.
 *
 * The gradient was written out by hand in four files and the phrase
 * "bg-gradient-to-r from-green-400 via-emerald-500 to-purple-500" appeared
 * identically in three of them. That is not a style, it is a coincidence that
 * has held so far: the first time somebody adjusts the purple, three screens
 * change and the fourth quietly does not, and nobody finds out until a
 * screenshot.
 *
 * `shared/backing.ts` holds the same colours as CSS for the places that need a
 * real `linear-gradient` — an inline style, a canvas, an email — and these are
 * the Tailwind class strings for everywhere else. Both read from the same
 * three colours; if one moves, move both.
 */

/** The gradient, left to right. On a fill: a bar, a dot, a chip. */
export const NOVA_GRADIENT = "bg-gradient-to-r from-green-400 via-emerald-500 to-purple-500";

/** The same, diagonally, for a surface large enough that a flat sweep reads as a band. */
export const NOVA_GRADIENT_BR = "bg-gradient-to-br from-green-400 via-emerald-500 to-purple-500";

/**
 * A tint of it, for the background of something that is merely *related* to
 * Nova rather than actively doing anything. Full strength on a large surface
 * is a brand exercise; this is the one to reach for by default.
 */
export const NOVA_TINT = "bg-gradient-to-br from-primary/5 to-transparent";

/**
 * The label above a number in a glance strip.
 *
 * Small, spaced and quiet, because the number under it is the thing being
 * read. Written down because it appeared, character for character, on nine
 * screens.
 */
export const GLANCE_LABEL = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
