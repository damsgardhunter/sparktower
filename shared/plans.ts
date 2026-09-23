/**
 * Single source of truth for what SparkTower charges for, and what it doesn't.
 *
 * ## The decision this file encodes
 *
 * Everything a person does themselves is free, forever, for everyone: paths,
 * boards, milestones, check-ins, publishing, the feed, teams, private
 * projects, the public market simulation, company accounts. Paying never buys
 * standing, reach, visibility or a feature — it buys Nova doing a piece of
 * work for you, and nothing else. That is why every gate that used to sell a
 * capability (private projects, analytics depth, matching level, health
 * checks, strategy, sprint creation, premium visibility, early access) is now
 * on for everybody: see ENTITLEMENTS below, which is deliberately one record
 * repeated four times rather than four different ones.
 *
 * What costs money is the model bill, and it is charged in dollars:
 *
 *   - a monthly allowance of MONTHLY_SMALL_ACTIONS small Nova actions, free;
 *   - a $1 day pass: unlimited small actions for 24 hours, for when it runs out;
 *   - a fixed price per big outcome — a roadmap, a document, an audit, the
 *     whole business built out, a company's training season seat.
 *
 * Nobody is ever quoted a credit. The old CREDIT_COSTS table survives at the
 * bottom of this file as a compatibility shim (clients still read it to draw
 * "this is a bigger job" hints), but nothing in the server prices anything
 * from it any more — server/entitlements.ts prices from CHARGE_FOR below.
 *
 * Everything money-related reads from here: the wallet (server/wallet.ts), the
 * charge itself (server/entitlements.ts), top-up checkout and the webhook, the
 * /api/plans response, and the pricing page. Change a number here and it
 * changes everywhere.
 */

// ---------------------------------------------------------------------------
// The price list
// ---------------------------------------------------------------------------

/**
 * A "small" Nova action: a chat turn, a next-step nudge, a persona, a progress
 * summary, tidying the board. One model call over the project, bounded.
 *
 * Twenty-five a month is roughly a busy fortnight of Nova at a builder's
 * elbow. It resets on the calendar month (storage.resetCreditsIfNeeded) and is
 * counted in actions, not in credits: one action is one action, whether it
 * read three tasks or thirty. Weighting them would put us back in the business
 * of quoting people a number they have to convert into money in their head.
 */
export const MONTHLY_SMALL_ACTIONS = 25;

/** The outcomes that carry a price. Everything else Nova does is small, or free. */
export type PricedOutcomeId =
  | "dayPass"
  | "roadmap"
  | "document"
  | "codeAudit"
  | "business"
  | "seasonSeat"
  | "wwit"
  | "imagePass";

/**
 * What each outcome costs, in cents. Whole dollars on purpose: the point of
 * moving off credits is that a person can read the price without arithmetic.
 *
 *   dayPass    — unlimited small actions for DAY_PASS_HOURS. The thing you buy
 *                when the month's allowance runs out and you're mid-flow.
 *   roadmap    — Nova builds the path and roadmap: phases, milestones, order.
 *   document   — the document builder, plan and fill, one price for the whole
 *                document however many blocks it turns out to have.
 *   codeAudit  — Nova reads the repository against the plan.
 *   business   — every section of the path built out, end to end, for one
 *                project. The deliberate "just do it all" purchase.
 *   seasonSeat — one seat in a company's private training season. The public
 *                market stays free for everyone, always.
 *   imagePass  — a day of unlimited image generation. Pictures are the one
 *                thing here that costs real money per press rather than per
 *                month, so they are not covered by the ordinary day pass: the
 *                first generation for a project (or a badge) is free, and
 *                anyone who wants more buys the day.
 *   wwit       — "What would it take?": the route from where a company is to a
 *                size it picks, built from its own check-in numbers. Priced
 *                with the roadmap and the document because it is the same kind
 *                of thing — one commissioned piece of work with an answer at
 *                the end — and it is included in `business`, which buys the
 *                lot. A project that already ran it on credits keeps it.
 */
export const OUTCOME_PRICE_CENTS: Record<PricedOutcomeId, number> = {
  dayPass: 100,
  roadmap: 300,
  document: 300,
  codeAudit: 500,
  business: 3000,
  seasonSeat: 300,
  wwit: 300,
  imagePass: 500,
};

/**
 * What the legacy `amount` argument on requireCredits/deductCredits means now.
 *
 * It used to be a price in credits. It isn't one any more — the price is
 * `opts.outcome`, or the allowance — so the only thing left for a number to
 * say is whether this action costs anything at all. Named rather than written
 * as 0 and 1 at the call site, because a bare literal in a metering call is
 * exactly the thing test/unit/ai-metering.test.ts exists to catch: a price
 * that stopped living in one place.
 */
export const CHARGEABLE = 1;
export const NO_CHARGE = 0;

/** What a day pass buys, in hours. Bought at 11pm, still good at 10pm tomorrow. */
export const DAY_PASS_HOURS = 24;

/** The image pass runs the same day-shaped window as the ordinary one. */
export const IMAGE_PASS_HOURS = 24;

/**
 * Unlimited, with a ceiling — the same argument as the AI burst limit, and it
 * bites harder here. Fifty images an hour is more than any person makes on
 * purpose and far less than a script makes by accident, and at this model's
 * prices an unbounded "unlimited" is the one thing on the price list that
 * could cost us more in a night than everything else earns in a month.
 */
export const IMAGE_PASS_HOURLY_LIMIT = 50;

/**
 * How many generations a thing gets before the pass is needed.
 *
 * One, per project and per badge. Enough to see what Nova makes of your
 * product without deciding anything, and not enough to run the picture
 * machine for free. Counted per generation rather than per image, so the
 * first go at a five-slot project page or a five-scene storyboard is the free
 * one rather than a fifth of it.
 */
export const FREE_IMAGE_RUNS = 1;

/**
 * Top-up amounts offered in Stripe Checkout.
 *
 * Round numbers, and enough of them that the $30 whole-business build and a
 * twenty-seat season are each one trip through Checkout rather than four. The
 * server refuses any amount not in this list, so the client can't name its own
 * price. A balance never expires — it is the person's money.
 */
export const TOP_UP_CENTS: readonly number[] = [500, 1000, 2000, 3000, 5000, 10000] as const;

/** The three offered first, on a wallet with nothing particular to pay for. */
export const TOP_UP_DEFAULTS: readonly number[] = [500, 1000, 2000] as const;

/** "$3", "$0.50", "$30". Used in copy and in the 402 body, so a dialog needn't format money itself. */
export function formatMoney(cents: number): string {
  const whole = cents % 100 === 0;
  return `$${whole ? cents / 100 : (cents / 100).toFixed(2)}`;
}

/**
 * What a person has to spend, and what this month's allowance has left.
 *
 * Shared rather than server-side, because the 402 below carries one and the
 * dialog that reads it must be describing the same thing the route charged.
 */
export interface Wallet {
  balanceCents: number;
  balanceDisplay: string;
  /** Small actions used this calendar month, and the free allowance they come out of. */
  allowanceUsed: number;
  allowanceLimit: number;
  allowanceRemaining: number;
  /** When the current day pass runs out, or null. */
  dayPassUntil: string | null;
  dayPassActive: boolean;
  /** …and the image pass, which is a different five-dollar thing. */
  imagePassUntil: string | null;
  imagePassActive: boolean;
}

/**
 * The body of every 402 this product sends.
 *
 * It carries everything a dialog needs — what was being bought, what it costs,
 * what is on the account, and which one thing to offer — so that no screen has
 * to know the price list, and a price that changes on the server changes in
 * every dialog at once. `remedy` is the server's answer to "what is the button
 * for", and there is deliberately only ever one.
 */
export interface PaymentRequiredBody {
  code: "payment_required";
  message: string;
  /** Human name of what they were trying to do ("a codebase audit"). */
  label: string;
  /** Which priced outcome, or null for a small action off the allowance. */
  outcome: PricedOutcomeId | null;
  price: { cents: number; display: string } | null;
  wallet: Wallet;
  /*
   * The one thing to offer. "buy_pass" covers both passes — the dollar one for
   * small actions and the five-dollar one for images — because to a person
   * they are the same press, and `outcome` already says which.
   */
  remedy: "buy_day_pass" | "buy_pass" | "top_up" | "none";
  topUp: { shortfallCents: number; suggestCents: number; optionsCents: readonly number[] } | null;
  /** So the client never hard-codes a path that moves. */
  endpoints: { wallet: string; dayPass: string; topUp: string; build: string };
}

export const PAY_ENDPOINTS = {
  wallet: "/api/nova/wallet",
  dayPass: "/api/nova/day-pass",
  imagePass: "/api/nova/image-pass",
  topUp: "/api/nova/top-up",
  build: "/api/nova/build-my-business",
} as const;

/** The smallest offered top-up that clears a shortfall, or the largest if nothing does. */
export function topUpFor(shortfallCents: number): number {
  return TOP_UP_CENTS.find((c) => c >= shortfallCents) ?? TOP_UP_CENTS[TOP_UP_CENTS.length - 1];
}

/**
 * How Nova's actions are priced, one line each.
 *
 * "small" comes out of the monthly allowance (or is free under a day pass).
 * "free" costs nothing at all and never asks. Anything else names the outcome
 * it is part of, and is paid for in dollars at OUTCOME_PRICE_CENTS.
 *
 * Read the "document" rows together: the plan is where the $3 is taken, and
 * every fill, re-plan and tighten inside that document is free afterwards —
 * that is what "one price for the whole document" means. Same shape for the
 * roadmap: generation and a full rebuild are the purchase; keeping it current
 * afterwards is a small action, because charging someone $3 to nudge a plan
 * they already paid for is how a product teaches people not to touch it.
 */
export type NovaChargeKind = "free" | "small" | PricedOutcomeId;

export type NovaActionId =
  | "novaChat" | "novaGuide" | "taskGeneration" | "taskSequencing" | "taskAssist"
  | "novaAssist" | "loopAudit" | "personaGeneration" | "progressSummary"
  | "gapDetection" | "peopleRecommendation" | "nextActions" | "healthCheck"
  | "healthFix" | "strategyRecommendation" | "videoGeneration" | "profileVisuals"
  | "postImage" | "resumeEvaluation" | "matchExplanation" | "reputationEvaluation"
  | "pricingAnalysis" | "whatWouldItTake" | "pitchDeckOutline"
  | "investorReadinessScore" | "mockInterviewQuestion" | "mockInterviewGrading"
  | "pitchCritique" | "sprintIdeaSuggestion" | "practiceSprint" | "novaPartnerReply"
  | "novaPartnerAnswers" | "sprintReport"
  | "roadmapGeneration" | "roadmapUpdate" | "roadmapRebuild"
  | "documentPlan" | "documentFill" | "documentReplan" | "documentTighten"
  | "codeAudit"
  | "buildMyBusiness";

export const CHARGE_FOR: Record<NovaActionId, NovaChargeKind> = {
  // --- Nova at your elbow. The allowance, and the day pass. ---
  novaChat: "small",
  novaGuide: "small",
  taskGeneration: "small",
  taskSequencing: "small",
  taskAssist: "small",
  novaAssist: "small",
  loopAudit: "small",
  personaGeneration: "small",
  progressSummary: "small",
  gapDetection: "small",
  peopleRecommendation: "small",
  nextActions: "small",
  healthCheck: "small",
  healthFix: "small",
  strategyRecommendation: "small",
  /*
   * The pictures. Not "small": a small action is a paragraph of text and
   * these are the most expensive thing in the product per press, some of them
   * five at a time. They have their own rule — a free first go per project or
   * badge, then the image pass — which is why they name it rather than a
   * price. See requireImages in server/images.ts.
   */
  videoGeneration: "imagePass",
  profileVisuals: "imagePass",
  postImage: "imagePass",
  resumeEvaluation: "small",
  matchExplanation: "small",
  pricingAnalysis: "small",
  pitchDeckOutline: "small",
  investorReadinessScore: "small",
  mockInterviewQuestion: "small",
  mockInterviewGrading: "small",
  pitchCritique: "small",
  sprintIdeaSuggestion: "small",
  practiceSprint: "small",
  novaPartnerReply: "small",
  novaPartnerAnswers: "small",
  sprintReport: "small",

  /*
   * The builder index is rebuilt for everybody on the hour and Nova's weekly
   * read is the platform's cost, not the builder's. Zero rather than deleted,
   * so an older client that still asks is told the truth.
   */
  reputationEvaluation: "free",

  // --- The priced outcomes. ---
  roadmapGeneration: "roadmap",
  roadmapRebuild: "roadmap",
  /** Keeping a bought roadmap current. Not a second purchase. */
  roadmapUpdate: "small",

  documentPlan: "document",
  /** Inside a document whose plan was paid for. */
  documentFill: "free",
  documentReplan: "free",
  documentTighten: "free",

  codeAudit: "codeAudit",

  /** The whole path, once, for one project. Everything on it is free afterwards. */
  buildMyBusiness: "business",

  whatWouldItTake: "wwit",
};

/** What one action costs and how, ready to put in front of a person. */
export interface ActionPrice {
  action: NovaActionId;
  kind: NovaChargeKind;
  /** Null for "free" and for "small" — a small action is paid for by the allowance or the pass, not by a price. */
  cents: number | null;
  display: string;
}

export function priceOf(action: NovaActionId): ActionPrice {
  const kind = CHARGE_FOR[action];
  if (kind === "free") return { action, kind, cents: null, display: "Free" };
  if (kind === "small") return { action, kind, cents: null, display: "Included" };
  const cents = OUTCOME_PRICE_CENTS[kind];
  return { action, kind, cents, display: formatMoney(cents) };
}

/** What the pricing page and the top-up dialog list, in the order they read best. */
export const OUTCOME_COPY: Record<PricedOutcomeId, { name: string; blurb: string }> = {
  dayPass: {
    name: "Day pass",
    blurb: "Unlimited small Nova actions for 24 hours. What you buy when the month's allowance runs out mid-flow.",
  },
  roadmap: {
    name: "Build my path and roadmap",
    blurb: "Nova turns the goal into phases, milestones and an order to do them in.",
  },
  document: {
    name: "Write a document",
    blurb: "Plan and fill, one price for the whole document however long it turns out to be.",
  },
  codeAudit: {
    name: "Audit my codebase",
    blurb: "Nova reads the repository against the plan and says what is really built.",
  },
  business: {
    name: "Nova builds the whole business",
    blurb: "Every section of the path built out, end to end, for one project.",
  },
  wwit: {
    name: "What would it take?",
    blurb: "Pick a size — $1m, $100m, $1bn or $50bn a year — and Nova builds the route there from your own check-in numbers: the gap, the stages, what breaks first, and an honest verdict on whether it's reachable from here.",
  },
  imagePass: {
    name: "A day of images",
    blurb: `Unlimited image generation for ${IMAGE_PASS_HOURS} hours — project pages, post images, storyboards, badges. Up to ${IMAGE_PASS_HOURLY_LIMIT} an hour.`,
  },
  seasonSeat: {
    name: "Training season seat",
    blurb: "Per seat, when a company runs the market simulation privately. The first season is free, and the public market always is.",
  },
};

/** The whole price list in one object — what GET /api/nova/wallet and the pricing page serve. */
export const PRICE_LIST = {
  monthlySmallActions: MONTHLY_SMALL_ACTIONS,
  dayPassHours: DAY_PASS_HOURS,
  topUpCents: TOP_UP_CENTS,
  topUpDefaults: TOP_UP_DEFAULTS,
  outcomes: (Object.keys(OUTCOME_PRICE_CENTS) as PricedOutcomeId[]).map((id) => ({
    id,
    cents: OUTCOME_PRICE_CENTS[id],
    display: formatMoney(OUTCOME_PRICE_CENTS[id]),
    ...OUTCOME_COPY[id],
  })),
} as const;

// ---------------------------------------------------------------------------
// Pricing page presentation
// ---------------------------------------------------------------------------

export interface PricingRow {
  label: string;
  price: string;
  detail: string;
}

/** What the pricing page shows now: one free column, and a short list of prices. */
export const PRICING_ROWS: PricingRow[] = [
  { label: "Everything you do yourself", price: "Free", detail: "Paths, boards, milestones, check-ins, publishing, the feed, teams, private projects, the public market, company accounts. Forever, for everyone." },
  { label: "Nova at your elbow", price: "Free", detail: `${MONTHLY_SMALL_ACTIONS} small Nova actions a month — chat, nudges, personas, progress summaries, tidying the board.` },
  { label: OUTCOME_COPY.dayPass.name, price: formatMoney(OUTCOME_PRICE_CENTS.dayPass), detail: OUTCOME_COPY.dayPass.blurb },
  { label: OUTCOME_COPY.roadmap.name, price: formatMoney(OUTCOME_PRICE_CENTS.roadmap), detail: OUTCOME_COPY.roadmap.blurb },
  { label: OUTCOME_COPY.document.name, price: formatMoney(OUTCOME_PRICE_CENTS.document), detail: OUTCOME_COPY.document.blurb },
  { label: OUTCOME_COPY.codeAudit.name, price: formatMoney(OUTCOME_PRICE_CENTS.codeAudit), detail: OUTCOME_COPY.codeAudit.blurb },
  { label: OUTCOME_COPY.wwit.name, price: formatMoney(OUTCOME_PRICE_CENTS.wwit), detail: OUTCOME_COPY.wwit.blurb },
  { label: "Your first images", price: "Free", detail: "The first set of AI images for a project — and the first for each badge — costs nothing. Badges themselves are always free to earn and to keep." },
  { label: OUTCOME_COPY.imagePass.name, price: formatMoney(OUTCOME_PRICE_CENTS.imagePass), detail: OUTCOME_COPY.imagePass.blurb },
  { label: OUTCOME_COPY.business.name, price: formatMoney(OUTCOME_PRICE_CENTS.business), detail: OUTCOME_COPY.business.blurb },
  { label: OUTCOME_COPY.seasonSeat.name, price: `${formatMoney(OUTCOME_PRICE_CENTS.seasonSeat)}/seat`, detail: OUTCOME_COPY.seasonSeat.blurb },
];

export const PRICING_NOTICE =
  "Paying never buys standing, reach or features — only Nova doing work for you. " +
  "Money you add never expires, and an action that fails is refunded automatically.";

// ===========================================================================
// Compatibility layer
// ===========================================================================
//
// Everything below this line exists so that removing subscriptions didn't turn
// into a rewrite of half the app. Roughly forty server files and twenty client
// files import a tier, an entitlement or a credit cost from here. They keep
// compiling, and they keep meaning something true:
//
//   - tiers still exist as *strings on old rows* (users.subscription_tier, and
//     Stripe price metadata on subscriptions that are being wound down), so
//     normalizeTier and friends still have work to do;
//   - entitlements still exist as a shape, but every tier now gets the same
//     one — all on — because no feature is sold any more. requireFeature and
//     requireLevel therefore always pass, and they were left in place rather
//     than deleted from thirty call sites, where a botched deletion is a
//     feature silently disappearing;
//   - CREDIT_COSTS is now presentation only: a rough "how big is this job"
//     hint some clients draw. Nothing prices anything from it.
//
// None of it should grow. New money questions are answered above.

export type TierId = "free" | "starter" | "builder" | "pro";

export const TIER_IDS: TierId[] = ["free", "starter", "builder", "pro"];

/** Tiers from earlier pricing structures, still sitting in rows and in Stripe metadata. */
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

/** Higher rank == later in TIER_IDS. Only still used to wind down old subscriptions. */
export function tierRank(tier: string | null | undefined): number {
  return TIER_IDS.indexOf(normalizeTier(tier));
}

export function isAtLeast(tier: string | null | undefined, minimum: TierId): boolean {
  return tierRank(tier) >= TIER_IDS.indexOf(minimum);
}

export type CoachingLevel = "basic" | "enhanced" | "advanced";
export type MatchingLevel = "basic" | "enhanced" | "priority";
export type AnalyticsLevel = "none" | "basic" | "advanced";
export type MemoryLevel = "basic" | "expanded" | "full";
export type TaskGenLevel = "none" | "limited" | "full";
export type Level<T extends string> = T;

export interface Entitlements {
  /** Small Nova actions included each month. Same for everyone. */
  credits: number;
  /** Max private projects. Infinity: they were never a thing worth selling. */
  privateProjects: number;
  novaCoaching: CoachingLevel;
  novaMemory: MemoryLevel;
  aiRoadmap: boolean;
  roadmapUpdates: boolean;
  aiMilestones: boolean;
  aiTaskGeneration: TaskGenLevel;
  teamMatching: MatchingLevel;
  projectAnalytics: AnalyticsLevel;
  /**
   * Whether requests use the stronger, dearer model. False for everyone: it is
   * a cost decision, not something anyone is sold, and the prices above are
   * set against the standard model's bill.
   */
  priorityAi: boolean;
  projectHealthChecks: boolean;
  strategyRecommendations: boolean;
  createSprints: boolean;
  premiumVisibility: boolean;
  earlyAccess: boolean;
}

export type BooleanFeature = {
  [K in keyof Entitlements]: Entitlements[K] extends boolean ? K : never;
}[keyof Entitlements];

/**
 * What everybody gets. One record, not four.
 *
 * Written out as a constant and then handed to every tier so that a reader
 * grepping ENTITLEMENTS.pro sees immediately that there is nothing special in
 * it. Deleting the tier keys would break every caller for no gain.
 */
export const FREE_FOR_EVERYONE: Entitlements = {
  credits: MONTHLY_SMALL_ACTIONS,
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
  projectHealthChecks: true,
  strategyRecommendations: true,
  createSprints: true,
  premiumVisibility: true,
  earlyAccess: true,
};

export const ENTITLEMENTS: Record<TierId, Entitlements> = {
  free: FREE_FOR_EVERYONE,
  starter: FREE_FOR_EVERYONE,
  builder: FREE_FOR_EVERYONE,
  pro: FREE_FOR_EVERYONE,
};

export function getEntitlements(_tier?: string | null): Entitlements {
  return FREE_FOR_EVERYONE;
}

export function hasFeature(_tier: string | null | undefined, feature: BooleanFeature): boolean {
  return FREE_FOR_EVERYONE[feature] === true;
}

/** Everything is on the free tier now, so the answer is always "free" (or null if the key is off). */
export function minimumTierFor(feature: BooleanFeature): TierId | null {
  return FREE_FOR_EVERYONE[feature] === true ? "free" : null;
}

/**
 * The old runaway-automation ceiling. Kept as the burst backstop on the
 * unlimited side of a day pass: a pass is unlimited for a person, and this is
 * what stops it being unlimited for a script. server/moderation.ts's per-minute
 * AI limit is the first line; this is the month's.
 */
export const FAIR_USE_MONTHLY_CAP = 5000;

export const FAIR_USE_NOTICE =
  `*A day pass is unlimited for normal individual use, subject to a fair-use limit of ` +
  `${FAIR_USE_MONTHLY_CAP.toLocaleString()} AI actions per month to prevent automated abuse. ` +
  `We'll always reach out before restricting an account.`;

/** Nova context depth. One level for everyone now; the map stays for the lookups. */
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

/**
 * Presentation only. These numbers used to be money; now they are a rough
 * sense of size, which is all a client ever drew them for ("this is a bigger
 * job than a chat turn"). Nothing is priced from them — see CHARGE_FOR.
 */
export const CREDIT_COSTS = {
  novaChat: 1,
  novaGuide: 1,
  taskGeneration: 1,
  taskSequencing: 2,
  taskAssist: 4,
  novaAssist: 3,
  codeAudit: 8,
  loopAudit: 3,
  documentPlan: 5,
  documentBlockFill: 1,
  documentFillMin: 3,
  documentFillMax: 40,
  personaGeneration: 1,
  progressSummary: 1,
  gapDetection: 1,
  peopleRecommendation: 1,
  roadmapGeneration: 3,
  roadmapUpdate: 2,
  healthCheck: 2,
  healthFix: 3,
  strategyRecommendation: 2,
  videoGeneration: 5,
  profileVisuals: 5,
  profileVisualSingle: 1,
  postImage: 2,
  nextActions: 3,
  roadmapRebuildMin: 8,
  roadmapRebuildMax: 15,
  resumeEvaluation: 4,
  matchExplanation: 1,
  reputationEvaluation: 0,
  pricingAnalysis: 5,
  whatWouldItTake: 5,
  pitchDeckOutline: 8,
  investorReadinessScore: 5,
  mockInterviewQuestion: 1,
  mockInterviewGrading: 2,
  pitchCritique: 5,
  sprintIdeaSuggestion: 1,
  practiceSprint: 1,
  novaPartnerReply: 1,
  novaPartnerAnswers: 2,
  sprintReport: 3,
} as const;

/** Size hint for a whole-document fill. The document itself is one price. */
export function documentFillCost(blockCount: number): number {
  const { documentFillMin: min, documentFillMax: max, documentBlockFill } = CREDIT_COSTS;
  const raw = Math.max(0, Math.round(blockCount)) * documentBlockFill;
  return Math.max(min, Math.min(max, raw));
}

/** Size hint for a roadmap rebuild. A rebuild is priced as a roadmap. */
export function roadmapRebuildCost(counts: {
  phases: number;
  milestones: number;
  tasks: number;
}): number {
  const { roadmapRebuildMin: min, roadmapRebuildMax: max } = CREDIT_COSTS;
  const weight = counts.phases * 1.5 + counts.milestones + counts.tasks * 0.25;
  const scaled = Math.round(min + Math.min(1, weight / 20) * (max - min));
  return Math.max(min, Math.min(max, scaled));
}

export interface PlanFeatureRow {
  label: string;
  values: Record<TierId, boolean | string>;
}

/** Kept so the old comparison table still renders while the pricing page is rebuilt: every row, free. */
export const COMPARISON_ROWS: PlanFeatureRow[] = [
  "Everything you build yourself",
  "Public and private projects",
  "Paths, boards and milestones",
  "Teams and company accounts",
  "The public market simulation",
  "Nova project coaching",
  "Team matching",
  "Project analytics",
  "Create your own Sprints",
].map((label) => ({ label, values: { free: true, starter: true, builder: true, pro: true } }));

export interface PlanPresentation {
  tier: TierId;
  stage: string;
  name: string;
  promise: string;
  headline: string;
  pitch: string;
  priceMonthly: number;
  cta: string;
  highlights: string[];
  featured?: boolean;
  footnote?: string;
}

/**
 * One "plan", because there is one: free. The record is still keyed by tier so
 * that code holding a legacy tier string can still look up a name to show
 * somebody whose old subscription hasn't finished winding down.
 */
const FREE_PLAN: PlanPresentation = {
  tier: "free",
  stage: "Build",
  name: "Free",
  promise: "Build the whole thing. Pay only when Nova does the work.",
  headline: "Everything you do yourself is free.",
  pitch:
    "Paths, boards, milestones, teams, publishing, the market — all of it, forever. " +
    `Nova comes with ${MONTHLY_SMALL_ACTIONS} small actions a month, and when you want Nova to build ` +
    "something outright, you pay for that one thing in dollars.",
  priceMonthly: 0,
  cta: "Start Building",
  footnote: PRICING_NOTICE,
  highlights: [
    "Every feature, free forever",
    `${MONTHLY_SMALL_ACTIONS} small Nova actions a month`,
    `${formatMoney(OUTCOME_PRICE_CENTS.dayPass)} day pass for unlimited small actions`,
    `${formatMoney(OUTCOME_PRICE_CENTS.roadmap)} — Nova builds your path and roadmap`,
    `${formatMoney(OUTCOME_PRICE_CENTS.document)} — Nova writes a document`,
    `${formatMoney(OUTCOME_PRICE_CENTS.codeAudit)} — Nova audits your codebase`,
    `${formatMoney(OUTCOME_PRICE_CENTS.business)} — Nova builds the whole business`,
  ],
};

export const PLAN_PRESENTATION: Record<TierId, PlanPresentation> = {
  free: FREE_PLAN,
  starter: { ...FREE_PLAN, tier: "starter" },
  builder: { ...FREE_PLAN, tier: "builder" },
  pro: { ...FREE_PLAN, tier: "pro" },
};

/**
 * Stripe products to seed. No subscription products any more: the only thing
 * Checkout sells is a top-up, and those are created inline with `price_data`
 * from TOP_UP_CENTS (see /api/nova/top-up), so there is nothing to seed.
 *
 * Left as an empty array rather than deleted so server/seed-stripe.ts keeps
 * compiling and keeps being a no-op that says so, instead of vanishing and
 * taking the wind-down story with it.
 */
export const STRIPE_PLANS: {
  tier: TierId;
  name: string;
  description: string;
  unitAmount: number;
  metadata: Record<string, string>;
}[] = [];
