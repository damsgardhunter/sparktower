/**
 * The phone's copy of `client/src/lib/working-view.ts`.
 *
 * Metro cannot resolve the web app's `@shared` alias, so this is a hand copy, and
 * `test/unit/mobile-mirror.test.ts` runs both on the same inputs. No imports at
 * all, which is what keeps that comparison possible.
 *
 * The waits this describes are longer on a phone than on the web, not shorter —
 * same model call, worse connection — so the phone had the most to gain from a bar
 * that says which stage is happening and the least of it: a bare ActivityIndicator
 * everywhere, which says "something is happening" and refuses the only four
 * questions anybody has while watching it.
 */

export interface WorkingStage {
  id: string;
  /** What the machine is doing here, as a person would say it. Sentence case, no ellipsis — the view adds one. */
  label: string;
}

export interface WorkingView {
  /** The sentence to show, without its ellipsis. */
  label: string;
  /** Which stage is current, or -1 for "asked for, nothing reported". */
  index: number;
  /** One fill percentage per stage, 0–100, in order. */
  widths: number[];
}

/** What a run says when it has been started and has not reported a stage yet. */
export const WORKING_UNSTARTED_LABEL = "Getting started";

/** The fill for the current stage when nobody knows how far through it is. */
export const WORKING_CURRENT_WIDTH = 60;

/** The floor for a known progress, so "just begun" does not read as "not begun". */
export const WORKING_MIN_WIDTH = 8;

export function workingView(
  stages: readonly WorkingStage[],
  current?: string | null,
  saying?: string | null,
  progress?: number | null,
): WorkingView {
  const index = current ? stages.findIndex((s) => s.id === current) : -1;
  const label = saying ?? (index >= 0 ? stages[index].label : WORKING_UNSTARTED_LABEL);

  const widths = stages.map((_, i) => {
    if (i < index) return 100;
    if (i !== index) return 0;
    if (typeof progress === "number" && Number.isFinite(progress)) {
      return Math.min(100, Math.max(WORKING_MIN_WIDTH, Math.round(progress * 100)));
    }
    return WORKING_CURRENT_WIDTH;
  });

  return { label, index, widths };
}
