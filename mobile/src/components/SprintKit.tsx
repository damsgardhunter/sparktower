/**
 * Shared pieces for the sprint screens: phases, options and labels, restated
 * from the web's sprint pages so the phone and the website describe a sprint
 * the same way.
 */
import { colors } from "../theme";
import type { IconName } from "./ui";

export type Duration = "24h" | "72h";
export type ProductStyle = "past" | "modern" | "futuristic";

export const SPRINT_PHASES = ["setup", "ideation", "alignment", "building", "validation", "review", "completed"] as const;

export const PHASE_LABELS: Record<string, string> = {
  setup: "Setup", ideation: "Ideation", alignment: "Alignment", building: "Building",
  validation: "Validation", review: "Review", completed: "Completed",
};

export const PHASE_ICONS: Record<string, IconName> = {
  setup: "sparkles", ideation: "bulb", alignment: "locate", building: "list",
  validation: "document-text", review: "people", completed: "checkmark-circle",
};

export const PHASE_COLORS: Record<string, string> = {
  setup: colors.textSecondary, ideation: colors.warning, alignment: colors.info, building: colors.primary,
  validation: "#0891B2", review: colors.novaPurple, completed: colors.success,
};

export const DURATION_OPTIONS: { value: Duration; label: string; body: string; icon: IconName }[] = [
  { value: "24h", label: "24-hour sprint", body: "Quick validation sprint. Problem definition, ICP, value proposition, and a product brief.", icon: "flash" },
  { value: "72h", label: "72-hour sprint", body: "Extended sprint with validation: outreach emails, social posts, interview questions, and evidence.", icon: "time" },
];

export const STYLE_OPTIONS: { value: ProductStyle; label: string; body: string; icon: IconName }[] = [
  { value: "past", label: "Reimagined Classic", body: "Reimagine a past product with modern technology.", icon: "hourglass" },
  { value: "modern", label: "Modern Innovation", body: "Improve on a product or service that exists today.", icon: "desktop" },
  { value: "futuristic", label: "Future Vision", body: "Build something that doesn't exist yet.", icon: "rocket" },
];

export const styleLabel = (v?: string | null) => STYLE_OPTIONS.find((o) => o.value === v)?.label ?? v ?? "";

export interface SprintIdea {
  name: string; tagline: string; pitch: string; twist: string; whoItsFor: string; vibe: string;
}

/** "2m 05s" / "1h 04m" — compact enough for the waiting-room stat row. */
export function formatWait(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${String(totalSeconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Sprint credit costs, restated from shared/plans.ts CREDIT_COSTS. */
export const SPRINT_CREDIT_COSTS = {
  sprintIdeaSuggestion: 1,
  practiceSprint: 1,
  novaPartnerReply: 1,
  novaPartnerAnswers: 2,
  sprintReport: 3,
} as const;

export const credits = (n: number) => `${n} credit${n === 1 ? "" : "s"}`;

/**
 * Whether a failed call was the plan saying no rather than something breaking:
 * a 402 `upgrade_required` (the feature needs a higher plan) or a 403
 * `insufficient_credits`. Either way the way on is the pricing screen.
 */
export function planBlock(err: any): "upgrade" | "credits" | null {
  const code = err?.body?.code;
  if (err?.status === 402 || code === "upgrade_required") return "upgrade";
  if (code === "insufficient_credits" || code === "fair_use_limit") return "credits";
  return null;
}
