/**
 * Milestones authored once and referenced by more than one path, so switching
 * paths carries the work across instead of asking for it again.
 */
export const SHARED_MILESTONES = {
  "SH-01": { title: "Positioning statement", paths: ["ship_mvp", "raise_funding"] },
  "SH-02": { title: "Pricing model", paths: ["ship_mvp", "systemize_business", "raise_funding"] },
  "SH-03": { title: "Core metric definition", paths: ["ship_mvp", "systemize_business", "raise_funding"] },
  "SH-04": { title: "Financial baseline", paths: ["systemize_business", "raise_funding"] },
  "SH-05": { title: "Customer list", paths: ["ship_mvp", "systemize_business"] },
  "SH-06": { title: "Competitor landscape", paths: ["ship_mvp", "raise_funding"] },
} as const;

export type SharedMilestoneId = keyof typeof SHARED_MILESTONES;
