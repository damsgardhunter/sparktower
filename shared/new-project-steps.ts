/**
 * The new-project stepper, as an ordered list the client and its tests share.
 *
 * Setup is the conversation with Nova plus the fields it fills; goal and kind
 * are the two questions every project has to answer; review is the last look
 * before it exists. The order is the point — the goal is asked *after* Nova
 * has heard what the thing is, so it can propose one.
 */
export const NEW_PROJECT_STEPS = ["setup", "goal", "subcategory", "review"] as const;
export type NewProjectStep = (typeof NEW_PROJECT_STEPS)[number];

export const stepIndex = (s: NewProjectStep) => NEW_PROJECT_STEPS.indexOf(s);
export const nextStep = (s: NewProjectStep): NewProjectStep | null =>
  NEW_PROJECT_STEPS[stepIndex(s) + 1] ?? null;
export const prevStep = (s: NewProjectStep): NewProjectStep | null =>
  stepIndex(s) > 0 ? NEW_PROJECT_STEPS[stepIndex(s) - 1] : null;
