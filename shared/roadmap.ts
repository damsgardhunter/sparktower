/**
 * How long a roadmap should be.
 *
 * The first version asked the model for "4-7 phases" and silently discarded
 * anything past eight, so every roadmap came out at about six — and there was
 * no way to ask for more. Six is fine for a weekend project and useless for
 * a year, and the builder is the only one who knows which they have.
 *
 * Shared so the picker in the client and the prompt on the server can't drift.
 */
export const ROADMAP_DEPTHS = {
  overview: {
    label: "Overview",
    min: 4, max: 6,
    hint: "The big moves, one line each. Good for a first look.",
  },
  standard: {
    label: "Standard",
    min: 7, max: 10,
    hint: "Every step you'd actually plan a week around.",
  },
  detailed: {
    label: "Detailed",
    min: 11, max: 16,
    hint: "Nothing folded together. Good for a long build or a team.",
  },
} as const;

export type RoadmapDepth = keyof typeof ROADMAP_DEPTHS;
export const ROADMAP_DEPTH_IDS = Object.keys(ROADMAP_DEPTHS) as RoadmapDepth[];
export const DEFAULT_ROADMAP_DEPTH: RoadmapDepth = "standard";

/** Hard ceiling in the parser. Above the largest depth so nothing is discarded. */
export const MAX_ROADMAP_PHASES = 20;

export const roadmapDepth = (v: unknown): RoadmapDepth =>
  typeof v === "string" && v in ROADMAP_DEPTHS ? (v as RoadmapDepth) : DEFAULT_ROADMAP_DEPTH;

/**
 * The depth an existing roadmap was built at, read off its length.
 *
 * Used when revising or rebuilding: a builder who asked for sixteen phases
 * and then rebuilds must get sixteen back, not the default ten — folding their
 * roadmap down on every rebuild is precisely the "it keeps skipping my steps"
 * complaint, arriving through a side door.
 */
export function depthForPhaseCount(n: number): RoadmapDepth {
  if (n >= ROADMAP_DEPTHS.detailed.min) return "detailed";
  if (n >= ROADMAP_DEPTHS.standard.min) return "standard";
  return "overview";
}
