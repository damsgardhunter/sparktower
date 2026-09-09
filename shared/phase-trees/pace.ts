/**
 * The pace model, as pure arithmetic. See "Pace model" in server/phase-trees.md.
 *
 * Optimistic by default: project from the best recent pace, and show a date
 * early even on a thin sample. The date never moves later on evidence of
 * effort; it only decays on absence, and re-entry after dormancy starts fresh.
 * Verified work gets a hard date, artifact/evidence work a range, claimed
 * work no projection, and a raise past week 4 is a pipeline, not a date.
 */
import type { VerificationTier } from "./types";

export type PaceState = "active" | "nudge" | "decaying" | "dormant";
export type ProjectionMode = "date" | "range" | "none" | "pipeline";

export interface PaceInput {
  now: Date;
  createdAt: Date;
  /** Backbone completions: when, and how big the authored estimate was. */
  completions: { at: Date; estimateMinutes: number }[];
  /** Any other sign of life — check-ins count as activity. */
  activityDates: Date[];
  /** Authored estimate minutes still open on the main line. */
  remainingMinutes: number;
  /** Authored estimate minutes on the whole main line. */
  totalMinutes: number;
  tier: VerificationTier;
  /** True once a raise is in market: outcomes depend on other people now. */
  pipeline?: boolean;
  /** What the last recalculation said, so the date can hold. */
  previous?: { projectedAt: Date | null; state: PaceState } | null;
}

export interface PaceResult {
  state: PaceState;
  daysSinceActivity: number;
  /** Observed throughput over the authored pace of the path (1.0 = on the authored month). */
  multiplier: number | null;
  mode: ProjectionMode;
  projectedAt: Date | null;
  projectedLow: Date | null;
  projectedHigh: Date | null;
  /** How the projection was reached, in words Nova can say. */
  note: string;
}

const DAY = 86_400_000;
export const AUTHORED_DAYS = 28;
const dayKey = (d: Date) => Math.floor(d.getTime() / DAY);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

export function paceState(daysSinceActivity: number): PaceState {
  if (daysSinceActivity < 7) return "active";
  if (daysSinceActivity < 8) return "nudge";
  if (daysSinceActivity < 15) return "decaying";
  return "dormant";
}

export function computePace(input: PaceInput): PaceResult {
  const { now, createdAt, completions, remainingMinutes, totalMinutes, tier, previous } = input;
  const activity = [...completions.map((c) => c.at), ...input.activityDates, createdAt];
  const last = new Date(Math.max(...activity.map((d) => d.getTime())));
  const daysSinceActivity = Math.max(0, (now.getTime() - last.getTime()) / DAY);
  const state = paceState(daysSinceActivity);

  if (input.pipeline) {
    return { state, daysSinceActivity, multiplier: null, mode: "pipeline", projectedAt: null, projectedLow: null, projectedHigh: null,
      note: "In market. Outcomes depend on other people now, so this is a pipeline, not a date." };
  }
  if (tier === "claimed") {
    return { state, daysSinceActivity, multiplier: null, mode: "none", projectedAt: null, projectedLow: null, projectedHigh: null,
      note: "This path runs on your word, so Nova reads your check-ins rather than projecting a date." };
  }
  if (remainingMinutes <= 0) {
    return { state, daysSinceActivity, multiplier: null, mode: tier === "verified" ? "date" : "range", projectedAt: now, projectedLow: now, projectedHigh: now,
      note: "The main line is complete." };
  }

  // Best recent pace: the strongest three-day window in the last fortnight.
  const recent = completions.filter((c) => now.getTime() - c.at.getTime() <= 14 * DAY);
  const perDay = new Map<number, number>();
  for (const c of recent) perDay.set(dayKey(c.at), (perDay.get(dayKey(c.at)) ?? 0) + c.estimateMinutes);
  const days = [...perDay.keys()].sort((a, b) => a - b);
  let best = 0;
  for (const d of days) {
    const window = (perDay.get(d) ?? 0) + (perDay.get(d + 1) ?? 0) + (perDay.get(d + 2) ?? 0);
    best = Math.max(best, window / 3, perDay.get(d) ?? 0);
  }
  const activeDaysLastWeek = new Set(
    [...completions.map((c) => c.at), ...input.activityDates].filter((d) => now.getTime() - d.getTime() <= 7 * DAY).map(dayKey),
  ).size;
  // Optimistic: assume they keep the days they have shown, never fewer than two a week.
  const daysPerWeek = Math.min(7, Math.max(2, activeDaysLastWeek));
  const authoredPerDay = totalMinutes / AUTHORED_DAYS;

  let daysNeeded: number;
  let multiplier: number | null;
  let note: string;
  if (best === 0) {
    // Thin sample: believe the authored month until there is a pace to read.
    daysNeeded = Math.max(0, AUTHORED_DAYS - (now.getTime() - createdAt.getTime()) / DAY) || remainingMinutes / authoredPerDay;
    multiplier = null;
    note = "No verified completions yet, so this is the authored month. The first one gives Nova a pace to read.";
  } else {
    const perCalendarDay = best * (daysPerWeek / 7);
    daysNeeded = remainingMinutes / perCalendarDay;
    multiplier = Math.round((perCalendarDay / authoredPerDay) * 100) / 100;
    note = multiplier >= 1
      ? `Tracking at ${multiplier}× the authored pace on your best recent days.`
      : `Tracking at ${multiplier}× the authored pace. The date holds while you're active; slow days don't push it out.`;
  }

  let projectedAt = addDays(now, daysNeeded);

  // Decay only on absence; hold or improve on effort; dormant starts fresh.
  if (state === "dormant") {
    return { state, daysSinceActivity, multiplier, mode: "none", projectedAt: null, projectedLow: null, projectedHigh: null,
      note: "Quiet for a while. When you're back, Nova recalculates fresh — nothing carried against you." };
  }
  if (previous?.projectedAt && previous.state !== "dormant") {
    if (state === "active" || state === "nudge") {
      if (previous.projectedAt.getTime() < projectedAt.getTime()) projectedAt = previous.projectedAt;
    } else {
      // 8–14 days: gently, one day of drift per day past the first week.
      const drift = Math.max(0, daysSinceActivity - 7);
      projectedAt = addDays(new Date(Math.max(previous.projectedAt.getTime(), projectedAt.getTime())), drift);
      note = "Pace is easing toward its earlier baseline after a quiet stretch. Any activity stops the drift.";
    }
  }

  if (tier === "verified") {
    return { state, daysSinceActivity, multiplier, mode: "date", projectedAt, projectedLow: projectedAt, projectedHigh: projectedAt, note };
  }
  const span = Math.max(1, (projectedAt.getTime() - now.getTime()) / DAY);
  return {
    state, daysSinceActivity, multiplier, mode: "range", projectedAt,
    projectedLow: addDays(now, span * 0.8), projectedHigh: addDays(now, span * 1.35),
    note: `${note} Shown as a range, because this work is checked by what you show rather than by Nova.`,
  };
}
