/**
 * Single source of truth for subscription tiers, entitlements, and pricing copy.
 *
 * Everything tier-related reads from here: credit limits (server/storage.ts),
 * feature gates (server/entitlements.ts), the Stripe product seed
 * (server/seed-stripe.ts), the /api/plans response, and the pricing page.
 * Change a number here and it changes everywhere.
 */

export type TierId = "free" | "starter" | "builder" | "pro";

export const TIER_IDS: TierId[] = ["free", "starter", "builder", "pro"];

/**
 * Tiers from an earlier pricing structure. Existing subscribers still carry
 * these strings in users.subscription_tier and in Stripe price metadata, so
 * they're mapped forward rather than dropped to free.
 */
export const LEGACY_TIER_ALIASES: Record<string, TierId> = {
  spark_pro: "starter",
  spark_business: "builder",
  spark_unlimited: "pro",
};

/** Normalizes any stored tier string (including legacy aliases) to a TierId. */
export function normalizeTier(tier: string | null | undefined): TierId {
  if (!tier) return "free";
  if (TIER_IDS.includes(tier as TierId)) return tier as TierId;
  return LEGACY_TIER_ALIASES[tier] || "free";
}

/** Higher rank == more capable. Used for upgrade/downgrade comparisons. */
export function tierRank(tier: string | null | undefined): number {
  return TIER_IDS.indexOf(normalizeTier(tier));
}

export function isAtLeast(tier: string | null | undefined, minimum: TierId): boolean {
  return tierRank(tier) >= TIER_IDS.indexOf(minimum);
}

// ---------------------------------------------------------------------------
// Entitlements
// ---------------------------------------------------------------------------

export type Level<T extends string> = T;
export type CoachingLevel = "basic" | "enhanced" | "advanced";
export type MatchingLevel = "basic" | "enhanced" | "priority";
export type AnalyticsLevel = "none" | "basic" | "advanced";
export type MemoryLevel = "basic" | "expanded" | "full";
export type TaskGenLevel = "none" | "limited" | "full";

export interface Entitlements {
  /** Monthly Nova credit allowance. Infinity for Pro (see FAIR_USE_MONTHLY_CAP). */
  credits: number;
  /** Max private projects. 0 = none, Infinity = unlimited. */
  privateProjects: number;
  /** Depth of Nova's project coaching prompts. */
  novaCoaching: CoachingLevel;
  /** How much prior project context Nova is given (message count). */
  novaMemory: MemoryLevel;
  /** Nova AI Roadmap Builder. */
  aiRoadmap: boolean;
  /** Nova revising an existing roadmap as the project moves. */
  roadmapUpdates: boolean;
  /** AI-generated milestones from a roadmap. */
  aiMilestones: boolean;
  /** AI task generation depth. */
  aiTaskGeneration: TaskGenLevel;
  /** Teammate matching quality. */
  teamMatching: MatchingLevel;
  /** Project analytics depth. */
  projectAnalytics: AnalyticsLevel;
  /** Requests jump the queue and use the stronger model. */
  priorityAi: boolean;
  /** AI project health checks. */
  projectHealthChecks: boolean;
  /** AI strategy recommendations. */
  strategyRecommendations: boolean;
  /** Can create their own Sprints (not just join). */
  createSprints: boolean;
  /** Elevated placement in discover/profile surfaces. */
  premiumVisibility: boolean;
  /** Early access to new Nova capabilities. */
  earlyAccess: boolean;
}

/** Feature keys that are simple on/off gates, usable with requireFeature(). */
export type BooleanFeature = {
  [K in keyof Entitlements]: Entitlements[K] extends boolean ? K : never;
}[keyof Entitlements];

/**
 * Pro is marketed as unlimited. This cap exists so a single account can't run
 * thousands of automated calls and destroy margins — it's the enforcement arm
 * of the fair-use clause in the terms. Deliberately far above any human use.
 */
export const FAIR_USE_MONTHLY_CAP = 5000;

/** Nova context depth per memory level, in prior messages. */
export const MEMORY_MESSAGE_LIMIT: Record<MemoryLevel, number> = {
  basic: 10,
  expanded: 30,
  full: 100,
};

/** Max tasks a single AI task generation may produce. */
export const TASK_GEN_LIMIT: Record<TaskGenLevel, number> = {
  none: 0,
  limited: 5,
  full: 15,
};

export const ENTITLEMENTS: Record<TierId, Entitlements> = {
  free: {
    credits: 20,
    privateProjects: 0,
    novaCoaching: "basic",
    novaMemory: "basic",
    aiRoadmap: false,
    roadmapUpdates: false,
    aiMilestones: false,
    aiTaskGeneration: "none",
    teamMatching: "basic",
    projectAnalytics: "none",
    priorityAi: false,
    projectHealthChecks: false,
    strategyRecommendations: false,
    createSprints: false,
    premiumVisibility: false,
    earlyAccess: false,
  },
  starter: {
    credits: 200,
    privateProjects: 3,
    novaCoaching: "enhanced",
    novaMemory: "expanded",
    aiRoadmap: false,
    roadmapUpdates: false,
    aiMilestones: false,
    aiTaskGeneration: "limited",
    teamMatching: "enhanced",
    projectAnalytics: "basic",
    priorityAi: false,
    projectHealthChecks: false,
    strategyRecommendations: false,
    createSprints: true,
    premiumVisibility: false,
    earlyAccess: false,
  },
  builder: {
    credits: 750,
    privateProjects: Infinity,
    novaCoaching: "advanced",
    novaMemory: "full",
    aiRoadmap: true,
    roadmapUpdates: true,
    aiMilestones: true,
    aiTaskGeneration: "full",
    teamMatching: "priority",
    projectAnalytics: "advanced",
    priorityAi: false,
    projectHealthChecks: false,
    strategyRecommendations: false,
    createSprints: true,
    premiumVisibility: false,
    earlyAccess: false,
  },
  pro: {
    credits: Infinity,
    privateProjects: Infinity,
    novaCoaching: "advanced",
    novaMemory: "full",
    aiRoadmap: true,
    roadmapUpdates: true,
    aiMilestones: true,
    aiTaskGeneration: "full",
    teamMatching: "priority",
    projectAnalytics: "advanced",
    priorityAi: true,
    projectHealthChecks: true,
    strategyRecommendations: true,
    createSprints: true,
    premiumVisibility: true,
    earlyAccess: true,
  },
};

export function getEntitlements(tier: string | null | undefined): Entitlements {
  return ENTITLEMENTS[normalizeTier(tier)];
}

export function hasFeature(tier: string | null | undefined, feature: BooleanFeature): boolean {
  return getEntitlements(tier)[feature] === true;
}

/** The cheapest tier that grants a given boolean feature, for upsell copy. */
export function minimumTierFor(feature: BooleanFeature): TierId | null {
  return TIER_IDS.find((t) => ENTITLEMENTS[t][feature] === true) ?? null;
}

// ---------------------------------------------------------------------------
// Credit costs
// ---------------------------------------------------------------------------

export const CREDIT_COSTS = {
  novaChat: 1,
  novaGuide: 1,
  taskGeneration: 1,
  /** Nova re-sequences the board into a runnable order. */
  taskSequencing: 2,
  /**
   * Nova plans the work: milestones broken into ordered, estimated tasks.
   * Priced above sequencing because it reasons over the whole project and
   * writes a plan, rather than re-ordering what's already there.
   */
  taskAssist: 4,
  /**
   * Nova's help on one surface — milestones, research, pricing, strategy.
   * Priced between a chat turn and a full task plan: it reasons over the
   * project and proposes concrete changes, but scoped to one area.
   */
  novaAssist: 3,
  /**
   * Nova audits the real codebase against the plan. Priced above a health
   * check because it ingests and reasons over an entire repository.
   */
  codeAudit: 8,
  // --- Nova document builder ---
  /** Nova plans a document: pages, grid, and a headline for every block. */
  documentPlan: 5,
  /** Filling one block's content. Whole-document fills charge per block. */
  documentBlockFill: 1,
  /** Floor and ceiling for a whole-document fill, whatever the block count. */
  documentFillMin: 3,
  documentFillMax: 40,
  personaGeneration: 1,
  progressSummary: 1,
  gapDetection: 1,
  peopleRecommendation: 1,
  roadmapGeneration: 3,
  roadmapUpdate: 2,
  healthCheck: 2,
  /** Nova applies one health-check recommendation to the project itself. */
  healthFix: 3,
  strategyRecommendation: 2,
  videoGeneration: 5,
  /** "What should I do next?" — ranks the 3 highest-impact actions. */
  nextActions: 3,
  /**
   * Nova drafting a weekly check-in.
   *
   * Priced low on purpose: this is the assist on the habit the whole product
   * depends on, and a cost someone weighs up each week is a cost that stops
   * them checking in.
   */
  checkInDraft: 1,
  /**
   * Full roadmap rebuild. Priced as a range because cost scales with how much
   * project context has to be re-planned; see roadmapRebuildCost().
   */
  roadmapRebuildMin: 8,
  roadmapRebuildMax: 15,
  /** Nova reads a résumé and builds out the profile. */
  resumeEvaluation: 4,
  /** Checks pricing against the target customer and comparable products. */
  pricingAnalysis: 5,
  // Investor readiness suite
  pitchDeckOutline: 8,
  investorReadinessScore: 5,
  mockInterviewQuestion: 1,
  mockInterviewGrading: 2,
  pitchCritique: 5,
  // Sprints
  sprintIdeaSuggestion: 1,
  practiceSprint: 1,
  novaPartnerReply: 1,
  novaPartnerAnswers: 2,
  sprintReport: 3,
} as const;

/**
 * A whole-document fill costs one credit per block, floored and capped.
 *
 * Per-block pricing is the honest shape — a 30-page business plan really is
 * thirty times the work of a one-pager — but an unbounded charge on a document
 * the user hasn't seen filled yet is a nasty surprise, hence the ceiling. The
 * client quotes this before the run.
 */
export function documentFillCost(blockCount: number): number {
  const { documentFillMin: min, documentFillMax: max, documentBlockFill } = CREDIT_COSTS;
  const raw = Math.max(0, Math.round(blockCount)) * documentBlockFill;
  return Math.max(min, Math.min(max, raw));
}

/**
 * A rebuild re-plans everything, so it costs more when there's more to
 * re-plan. Scales linearly from the floor to the ceiling based on how much
 * project material Nova has to reconcile — phases, milestones and tasks.
 *
 * Quoted to the user before they commit so the charge is never a surprise.
 */
export function roadmapRebuildCost(counts: {
  phases: number;
  milestones: number;
  tasks: number;
}): number {
  const { roadmapRebuildMin: min, roadmapRebuildMax: max } = CREDIT_COSTS;
  // Weight phases heaviest — each one is a unit of re-planning.
  const weight = counts.phases * 1.5 + counts.milestones + counts.tasks * 0.25;
  // ~20 weighted units saturates to the ceiling.
  const scaled = Math.round(min + Math.min(1, weight / 20) * (max - min));
  return Math.max(min, Math.min(max, scaled));
}

// ---------------------------------------------------------------------------
// Pricing page presentation
// ---------------------------------------------------------------------------

export interface PlanFeatureRow {
  label: string;
  /** true/false for a check or dash; a string renders as a level label. */
  values: Record<TierId, boolean | string>;
}

/**
 * The full comparison matrix, rendered as a table lower on the pricing page.
 * Credits appear here rather than as each plan's headline — the plans sell the
 * outcome, the table sells the details.
 */
export const COMPARISON_ROWS: PlanFeatureRow[] = [
  { label: "Price", values: { free: "$0", starter: "$7.99/mo", builder: "$16.99/mo", pro: "$29.99/mo" } },
  { label: "Nova AI credits", values: { free: "20/month", starter: "200/month", builder: "750/month", pro: "Unlimited*" } },
  { label: "Public projects", values: { free: true, starter: true, builder: true, pro: true } },
  { label: "Join contests", values: { free: true, starter: true, builder: true, pro: true } },
  { label: "Community access", values: { free: true, starter: true, builder: true, pro: true } },
  { label: "Private projects", values: { free: false, starter: "3", builder: "Unlimited", pro: "Unlimited" } },
  { label: "Nova project coaching", values: { free: "Basic", starter: "Enhanced", builder: "Advanced", pro: "Advanced" } },
  { label: "AI roadmap creation", values: { free: false, starter: false, builder: true, pro: true } },
  { label: "Roadmap updates", values: { free: false, starter: false, builder: true, pro: true } },
  { label: "AI task generation", values: { free: false, starter: "Limited", builder: true, pro: true } },
  { label: "Team matching", values: { free: "Basic", starter: "Enhanced", builder: "Priority", pro: "Priority" } },
  { label: "Project analytics", values: { free: false, starter: "Basic", builder: "Advanced", pro: "Advanced" } },
  { label: "Nova project memory", values: { free: "Basic", starter: "Expanded", builder: "Full", pro: "Full" } },
  { label: "Create your own Sprints", values: { free: false, starter: true, builder: true, pro: true } },
  { label: "AI project health checks", values: { free: false, starter: false, builder: false, pro: true } },
  { label: "AI strategy recommendations", values: { free: false, starter: false, builder: false, pro: true } },
  { label: "Priority AI processing", values: { free: false, starter: false, builder: false, pro: true } },
  { label: "Premium project visibility", values: { free: false, starter: false, builder: false, pro: true } },
  { label: "Early access to new Nova features", values: { free: false, starter: false, builder: false, pro: true } },
];

export interface PlanPresentation {
  tier: TierId;
  /** Progression word shown above the plan name — Explore → Accelerate. */
  stage: string;
  name: string;
  /** One line under the stage, framing the outcome. */
  promise: string;
  /** Headline on the plan card. */
  headline: string;
  /** Two-sentence pitch selling the result, not the credits. */
  pitch: string;
  priceMonthly: number;
  cta: string;
  /** Benefit-led bullets. Credits sit mid-list, never first. */
  highlights: string[];
  /** Renders with visual emphasis as the recommended plan. */
  featured?: boolean;
  /** Small print under the CTA. */
  footnote?: string;
}

export const PLAN_PRESENTATION: Record<TierId, PlanPresentation> = {
  free: {
    tier: "free",
    stage: "Explore",
    name: "Free",
    promise: "Turn an idea into your first project.",
    headline: "Turn your idea into something real.",
    pitch: "Tell Nova what you're thinking about building. It'll help you shape the idea into an actual project you can share.",
    priceMonthly: 0,
    cta: "Start Building Free",
    highlights: [
      "Shape your idea with Nova",
      "Create public projects",
      "20 Nova AI credits/month",
      "Join contests and Sprints",
      "Discover other builders",
      "Basic team matching",
      "Community access",
    ],
  },
  starter: {
    tier: "starter",
    stage: "Start",
    name: "Starter",
    promise: "Get Nova's help building your project.",
    headline: "Get serious about your idea.",
    pitch: "Nova breaks your project down, suggests what to work on, and remembers where you left off. Keep work private until you're ready to show it.",
    priceMonthly: 7.99,
    cta: "Start Building",
    highlights: [
      "Everything in Free",
      "AI project breakdowns",
      "AI-generated task suggestions",
      "3 private projects",
      "200 Nova AI credits/month",
      "Enhanced teammate matching",
      "Basic project analytics",
      "Create your own Sprints",
    ],
  },
  builder: {
    tier: "builder",
    stage: "Build",
    name: "Builder",
    promise: "Get a personalized roadmap from idea to launch.",
    headline: 'Turn "someday" into a plan.',
    pitch: "Nova turns your goal into a personalized roadmap, breaks it into milestones, and helps you figure out what to work on next.",
    priceMonthly: 16.99,
    cta: "Build My Roadmap",
    featured: true,
    footnote: "Recommended for founders, creators, students, and serious builders.",
    highlights: [
      "Personalized AI roadmaps",
      "AI-generated milestones & tasks",
      "Nova keeps your roadmap current",
      "Unlimited private projects",
      "750 Nova AI credits/month",
      "Find people with the skills you're missing",
      "Advanced project analytics",
      "Track your progress from idea → launch",
    ],
  },
  pro: {
    tier: "pro",
    stage: "Accelerate",
    name: "Pro",
    promise: "Nova works alongside you without limits.",
    headline: "Build without limits.",
    pitch: "Unlimited Nova, priority processing, and ongoing analysis of your project's health and strategy. For people building every day.",
    priceMonthly: 29.99,
    cta: "Build Without Limits",
    footnote: "Unlimited subject to fair use. See terms.",
    highlights: [
      "Unlimited Nova AI usage*",
      "Unlimited roadmaps and projects",
      "Priority AI processing",
      "AI project health checks",
      "AI strategy recommendations",
      "Advanced team recommendations",
      "Full project history and context",
      "Early access to new Nova capabilities",
      "Premium project visibility",
    ],
  },
};

export const FAIR_USE_NOTICE =
  `*Pro includes unlimited Nova usage for normal individual use, subject to a fair-use ` +
  `limit of ${FAIR_USE_MONTHLY_CAP.toLocaleString()} AI actions per month to prevent ` +
  `automated abuse. We'll always reach out before restricting an account.`;

/** Stripe product/price definitions, derived from the presentation above. */
export const STRIPE_PLANS = TIER_IDS.filter((t) => t !== "free").map((tier) => {
  const plan = PLAN_PRESENTATION[tier];
  const ent = ENTITLEMENTS[tier];
  return {
    tier,
    name: `Spark ${plan.name}`,
    description: plan.promise,
    unitAmount: Math.round(plan.priceMonthly * 100),
    metadata: {
      tier,
      credits: ent.credits === Infinity ? "unlimited" : String(ent.credits),
    },
  };
});
