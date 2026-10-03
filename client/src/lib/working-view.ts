/**
 * What a Nova wait should draw, worked out without drawing it.
 *
 * Pure, and out of the component, because the phone needs the same answers and
 * Metro cannot resolve `@shared`. `mobile/src/workingView.ts` is its copy and
 * `test/unit/mobile-mirror.test.ts` runs both on the same inputs.
 *
 * The rules this holds are the ones that make the bar honest rather than
 * decorative, and each is a decision rather than a detail:
 *
 *   - **An unknown stage is "nothing started", not "the first one finished".** A
 *     run that has been asked for and has not reported yet is at index -1, so
 *     every segment is empty. Treating it as stage zero would show a completed
 *     step that never happened.
 *   - **The current stage is 60% unless the caller genuinely knows.** Nothing
 *     here knows how far through a stage it is, and a bar that crept to 95% and
 *     sat there would be making it up. 60% is an admission; a precise-looking
 *     invented number would be the worse lie.
 *   - **A known progress is floored well above zero**, so a stage that has only
 *     just begun still reads as begun rather than as not started.
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
