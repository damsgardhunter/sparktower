/**
 * The SparkTower mark that rides the create semicircle — and the only place the
 * file is named.
 *
 * Swapping the artwork is the whole change: drop the new PNG in as
 * `assets/sparktower-mark.png`, or point the `require` below at it. Nothing
 * else in the bar knows the filename, so nothing else needs touching.
 *
 * Two things the mark has to keep being, because the bar leans on both:
 *
 *   - **White line art on transparency.** It sits on the Nova gradient and is
 *     never tinted — tinting flattens the bolts. It would vanish on a light
 *     surface, so it belongs on the semicircle and nowhere pale.
 *   - **Square, tower centred.** The art runs top to bottom of the square
 *     (alpha spans ~6%–92% of the height, ~26%–74% of the width), so the whole
 *     square is drawn inside the dome rather than the dome cropping a half of
 *     it — see MARK_INSET, which is the breathing room that keeps the bolts off
 *     the curve.
 */
export const TOWER_MARK = require("../../../assets/sparktower-mark.png");

/** Gap between the mark's square and the dome's edge, so the bolts never touch the curve. */
export const MARK_INSET = 14;
