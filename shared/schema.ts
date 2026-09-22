import { pgTable, text, varchar, timestamp, integer, boolean, index, uniqueIndex, jsonb, unique, foreignKey, bigserial, bigint, real, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { PROJECT_GOAL_IDS, isValidSubcategory } from "./goals";

// Re-exporting from auth models as requested
export { sessions, users, mobileRefreshTokens, mcpTokens, emailVerificationTokens, passwordResetTokens, webHandoffTokens, type User, type UpsertUser, type MobileRefreshToken, type McpToken } from "./models/auth";
import { users, mobileRefreshTokens } from "./models/auth";

export const userProfiles = pgTable("user_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id).unique(),
  displayName: text("display_name"),
  username: text("username"),
  headline: text("headline"),
  bio: text("bio"),
  skills: varchar("skills").array(),
  interests: varchar("interests").array(),
  experienceLevel: text("experience_level", { enum: ["beginner", "intermediate", "expert"] }),
  resumeUrl: text("resume_url"),
  isOnboarded: boolean("is_onboarded").default(false).notNull(),
  githubUrl: text("github_url"),
  linkedinUrl: text("linkedin_url"),
  websiteUrl: text("website_url"),
  location: text("location"),
  avatarUrl: text("avatar_url"),
  /** Banner behind the avatar on the profile card. Falls back to a gradient. */
  coverUrl: text("cover_url"),
  hoursPerWeek: integer("hours_per_week"),
  riskTolerance: text("risk_tolerance", { enum: ["low", "moderate", "high"] }),
  speedVsPolish: text("speed_vs_polish", { enum: ["speed", "balanced", "polish"] }),
  scheduleStyle: text("schedule_style", { enum: ["structured", "flexible", "hybrid"] }),
  conflictStyle: text("conflict_style", { enum: ["direct", "diplomatic", "avoidant", "collaborative"] }),
  builderType: text("builder_type", { enum: ["long-term", "experimental", "both"] }),

  // --- Résumé-derived profile (see POST /api/profile/evaluate-resume) ---
  /** ProfileExperience[] — roles held, newest first. */
  experience: jsonb("experience").default([]),
  /** ProfileEducation[] */
  education: jsonb("education").default([]),
  /**
   * ProfilePortfolioProject[] — work from a résumé or elsewhere. Distinct from
   * platform projects, which live in the `projects` table.
   */
  portfolioProjects: jsonb("portfolio_projects").default([]),
  /** Nova's 2-3 sentence read on what this person is good at. */
  novaSummary: text("nova_summary"),
  /** When the résumé was last parsed, so the UI can offer a re-run. */
  resumeParsedAt: timestamp("resume_parsed_at"),
  /**
   * Public "open to" call. ProfileLookingFor — role sought, industries,
   * commitment, stage, equity. Null when they're not looking.
   */
  lookingFor: jsonb("looking_for"),
});

/** One role on someone's profile. */
export interface ProfileExperience {
  title: string;
  company: string;
  location?: string | null;
  /** Free-form so "2021" and "Mar 2021" both work. */
  startDate?: string | null;
  endDate?: string | null;
  current?: boolean;
  description?: string | null;
  /** Skills Nova inferred from this role. */
  skills?: string[];
}

export interface ProfileEducation {
  school: string;
  degree?: string | null;
  field?: string | null;
  startYear?: string | null;
  endYear?: string | null;
  description?: string | null;
}

export interface ProfilePortfolioProject {
  name: string;
  role?: string | null;
  description?: string | null;
  url?: string | null;
  technologies?: string[];
}

/** Options for the public "looking for" call. */
export const LOOKING_FOR_ROLES = [
  "Technical Cofounder", "Business Cofounder", "Design Cofounder", "First Engineer",
  "Designer", "Marketer", "Advisor / Mentor", "Investor", "Project to Join", "Freelance Work",
] as const;

export const LOOKING_FOR_STAGES = [
  "Just an idea", "Validating", "Building MVP", "MVP", "Early users", "Revenue", "Scaling",
] as const;

export const LOOKING_FOR_COMMITMENTS = [
  "< 5 hrs/week", "5–10 hrs/week", "10–15 hrs/week", "15–25 hrs/week", "25–40 hrs/week", "Full-time",
] as const;

export interface ProfileLookingFor {
  /** Whether to show the banner publicly. */
  isActive: boolean;
  role: string;
  industries: string[];
  commitment?: string | null;
  stage?: string | null;
  /** null when they'd rather not say. */
  equityAvailable?: boolean | null;
  /** Free text — what they're actually after. */
  details?: string | null;
}

export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerId: varchar("owner_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  /*
   * Required. The database default exists only so the column could be added
   * to rows that predate it — the insert schema below re-requires it, so a new
   * project must say which path it is on. See shared/goals.ts.
   */
  goal: text("goal", { enum: ["ship_mvp", "systemize_business", "run_company"] })
    .default("ship_mvp").notNull(),
  /*
   * Required, and only valid as a pair with `goal` — checked in the insert
   * schema, since a column can't express "restaurant is fine for systemizing
   * and nonsense for shipping". Plain text with a backfill default of "other".
   */
  subcategory: text("subcategory").default("other").notNull(),
  /**
   * The optional phase the project has chosen to be in (e.g. "branch-build",
   * the keep-building extension after week 2), or null on the main line.
   * Chosen explicitly, left explicitly: an extension is a dated decision,
   * never something drifted into.
   */
  activeBranch: text("active_branch"),
  /**
   * On the funding path, the route to the money the builder chose: debt,
   * seller, investor, hybrid or self. Decides which route phases the path
   * shows. Set by answering "Choose your route"; null until then.
   */
  capitalRoute: text("capital_route"),
  /** Whether the public project page takes applications to invest. Off until the owner opens it. */
  investmentOpen: boolean("investment_open").default(false).notNull(),
  /** The ask shown to would-be investors. InvestmentAsk — see shared/investment.ts. */
  investmentAsk: jsonb("investment_ask"),
  /**
   * Loops the builder removed, by name. A removed loop is a standing
   * instruction: Nova never proposes it again, however loudly the code or
   * the brief still talk about it.
   */
  rejectedLoops: text("rejected_loops").array().default([]).notNull(),
  /**
   * What the builder told Nova to keep in mind — corrections to the brief,
   * things being removed, what the loops really are. Read by every Nova
   * prompt through the project state, and it outranks the brief and the
   * board: it is the most recent thing the builder said.
   */
  novaNotes: text("nova_notes"),
  /**
   * What an audit may change without asking: "all", "safe" (only record work
   * the code shows is finished — shipped work, closed tasks, path milestones),
   * or "off". See shared/audit-catchup.ts.
   */
  auditAutoApply: text("audit_auto_apply", { enum: ["all", "safe", "off"] }).default("safe").notNull(),
  /**
   * Where the project's own data lives, for the audit's data-shape read:
   * a sealed (encrypted) read-only Postgres connection string, or "self"
   * for the platform owner's own project, which is this application. Never
   * returned to the client; only whether one is configured.
   */
  dataSource: text("data_source"),
  status: text("status", { enum: ["planning", "active", "completed"] }).default("planning").notNull(),
  teamSize: integer("team_size"),
  estimatedWeeks: integer("estimated_weeks"),
  views: integer("views").default(0).notNull(),
  totalDonations: integer("total_donations").default(0).notNull(),
  mediaUrls: varchar("media_urls").array().default([]),
  rolesNeeded: varchar("roles_needed").array().default([]),
  techStack: varchar("tech_stack").array().default([]),
  /**
   * The project's own identity, distinct from `mediaUrls` (a gallery).
   *
   * `logoUrl` is also the source image for backer merch and for the AI-built
   * backer badge, so it wants to be square and transparent where possible.
   */
  logoUrl: text("logo_url"),
  coverUrl: text("cover_url"),
  /**
   * AI images placed beside the brief on the public page, drawn from the logo
   * and cover. Shape: { [slot]: objectPath } — see shared/project-visuals.ts.
   * Written only by its own generation route.
   */
  profileVisuals: jsonb("profile_visuals").default({}),
  liveUrl: text("live_url"),
  repoUrl: text("repo_url"),
  businessPlanUrl: text("business_plan_url"),
  applicationQuestions: jsonb("application_questions").default([]),
  problemStatement: text("problem_statement"),
  targetUser: text("target_user"),
  successMetrics: text("success_metrics"),
  scope: jsonb("scope"),
  oneLiner: text("one_liner"),
  mission: text("mission"),
  valueProposition: text("value_proposition"),
  targetCustomerProfile: text("target_customer_profile"),
  // Owner-controlled visibility for the public project page. Shape:
  // { [sectionKey: string]: boolean } — absent keys fall back to each
  // section's default, so a section appears as soon as it has content.
  publicSections: jsonb("public_sections").default({}),
  landingPageConfig: jsonb("landing_page_config"),
  novaOnboardingComplete: boolean("nova_onboarding_complete").default(false),
  soloMode: boolean("solo_mode").default(false),
  // Private projects are a paid entitlement; see checkPrivateProjectQuota.
  isPrivate: boolean("is_private").default(false).notNull(),
  externalTractionUrl: text("external_traction_url"),
  /*
   * Taken down by a reviewer. A project was a *reportable* thing but not an
   * actionable one: the queue could file the report, mark it actioned, and
   * change nothing. The only lever was suspending the owner, and a suspension
   * blocks writes — it does not unpublish anything — so a doxxing or spam
   * project stayed on the public listing, the leaderboard, Discover and the
   * sitemap while its report read "handled".
   *
   * Same three columns as every other takedown target (feed posts, project
   * comments, feed comments), so `TAKEDOWN_TABLES`, the undo path and the
   * moderation log all treat a project exactly like any other content.
   * Reads that serve strangers must test `hiddenAt is null`.
   */
  hiddenAt: timestamp("hidden_at"),
  hiddenById: varchar("hidden_by_id").references(() => users.id),
  hiddenReason: text("hidden_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const novaGuideMessages = pgTable("nova_guide_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  actionsTaken: jsonb("actions_taken").default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectMembers = pgTable("project_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  role: text("role").notNull(),
  timezone: text("timezone"),
  availability: text("availability"),
  hoursPerWeek: integer("hours_per_week"),
  skills: varchar("skills").array(),
}, (table) => ({
  /*
   * One membership per person per project. Three paths add a member — the
   * create (the owner), an accepted application and an accepted invite — and
   * each checked "already a member?" in its own read before its own insert,
   * so the two join paths racing, or an application accepted after an
   * invite, could put someone on a team twice. The index makes the database
   * the one place that answers, and inserts say onConflictDoNothing.
   */
  oneMembership: unique("project_members_project_user_unique").on(table.projectId, table.userId),
}));

/**
 * An invitation to join a project (shared/invites.ts): the token itself is never
 * stored, only its SHA-256. One use, until it expires; revocable. `email` set
 * means only that account may accept it.
 */
export const projectInvites = pgTable("project_invites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  email: text("email"),
  role: text("role").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  emailStatus: text("email_status"),
  acceptedAt: timestamp("accepted_at"),
  acceptedById: varchar("accepted_by_id").references(() => users.id),
  revokedAt: timestamp("revoked_at"),
}, (table) => ({
  byProject: index("project_invites_project_idx").on(table.projectId, table.createdAt),
}));

export const donations = pgTable("donations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  donorId: varchar("donor_id").notNull().references(() => users.id),
  amount: integer("amount").notNull(), // in cents
  message: text("message"),
  /** The checkout session and payment behind it. The session id is unique: one session, one donation, however many times Stripe delivers. */
  stripeSessionId: varchar("stripe_session_id").unique(),
  stripePaymentIntentId: varchar("stripe_payment_intent_id"),
  stripeChargeId: varchar("stripe_charge_id"),
  /**
   * Cents refunded so far — Stripe's running total for the charge. A partial
   * refund lowers the project's total by what actually went back, and a
   * repeated event for the same refund moves nothing.
   */
  refundedAmount: integer("refunded_amount").default(0).notNull(),
  /** Set once the donation is refunded in full. */
  refundedAt: timestamp("refunded_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * A project's backing campaign. One per project.
 *
 * Separate from `projects` because a campaign is a distinct thing with its own
 * lifecycle — it opens, it gets reviewed, it pays out — and `projects` is
 * already carrying more columns than it should.
 */
export const projectBackingCampaigns = pgTable("project_backing_campaigns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }).unique(),
  /** Off until the creator opens it. Nothing is collectable before that. */
  enabled: boolean("enabled").default(false).notNull(),
  headline: text("headline"),
  story: text("story"),
  goalCents: integer("goal_cents"),
  /** MerchConfig — see shared/backing.ts. */
  merchConfig: jsonb("merch_config").default({}),
  /**
   * Creator-facing badge previews, `{ [levelKey]: objectPath }`.
   *
   * Cached because each one costs a model call, and a creator deciding on
   * their logo will open this screen repeatedly.
   */
  badgePreviews: jsonb("badge_previews").default({}),
  /**
   * Fixed when the campaign first opens rather than read from `now`, so a
   * backer's datestamped shirt says when the campaign started and not when
   * their particular order happened to print.
   */
  startedAt: timestamp("started_at"),
  /**
   * Payout review. Every release is approved by hand: the code audit score,
   * completed-task count and profile state are shown to the reviewer as
   * signals but gate nothing on their own, because a legitimate early-stage
   * project can score badly on all three and a convincing fake can score well.
   */
  reviewStatus: text("review_status", {
    enum: ["not_submitted", "pending", "approved", "rejected"],
  }).default("not_submitted").notNull(),
  submittedForReviewAt: timestamp("submitted_for_review_at"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedById: varchar("reviewed_by_id").references(() => users.id),
  reviewNotes: text("review_notes"),
  /**
   * Ratchets on every successful pledge so two simultaneous checkouts can't
   * both be handed believer #0047.
   */
  believerCount: integer("believer_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** One rung of the ladder. Five works; three leaves money, eight is a menu. */
export const projectBackerTiers = pgTable("project_backer_tiers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  /** The creator's own words — "Believer", "Ride or die", "Absolute unit". */
  name: text("name").notNull(),
  description: text("description"),
  /** Keys from DIGITAL_REWARDS. */
  digitalRewards: varchar("digital_rewards").array().default([]),
  /** Keys from MERCH_PRODUCTS. Non-empty makes checkout collect an address. */
  merchProducts: varchar("merch_products").array().default([]),
  /** Optional scarcity — "only 50 of these". Null is unlimited. */
  maxBackers: integer("max_backers"),
  sortOrder: integer("sort_order").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * One pledge, and the escrow record for it.
 *
 * Money lands in the platform's Stripe balance and stays there. This is a
 * separate charge, not a destination charge — nothing reaches the creator
 * until a human approves the release, which is the whole point of the gate.
 */
export const projectBackings = pgTable("project_backings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  backerId: varchar("backer_id").notNull().references(() => users.id),
  /** The rung earned, resolved from the amount rather than what was clicked. */
  tierId: varchar("tier_id").references(() => projectBackerTiers.id, { onDelete: "set null" }),
  /** Snapshot: renaming or deleting a tier later must not rewrite history. */
  tierNameAtBacking: text("tier_name_at_backing"),
  amountCents: integer("amount_cents").notNull(),
  /** Optional platform tip. Never part of the creator's payout. */
  tipCents: integer("tip_cents").default(0).notNull(),
  believerNumber: integer("believer_number"),
  message: text("message"),
  isAnonymous: boolean("is_anonymous").default(false).notNull(),
  status: text("status", {
    enum: ["pending", "held", "released", "refunded", "converted", "failed"],
  }).default("pending").notNull(),
  stripeCheckoutSessionId: varchar("stripe_checkout_session_id"),
  stripePaymentIntentId: varchar("stripe_payment_intent_id"),
  stripeChargeId: varchar("stripe_charge_id"),
  stripeTransferId: varchar("stripe_transfer_id"),
  stripeRefundId: varchar("stripe_refund_id"),
  /** ShippingAddress, collected only when the tier ships something. */
  shippingAddress: jsonb("shipping_address"),
  /** What to do if the creator never earns it out. Backer's call, at checkout. */
  unclaimedPreference: text("unclaimed_preference", {
    enum: ["refund", "donate_platform"],
  }).default("refund").notNull(),
  /** createdAt + REFUND_WINDOW_DAYS, denormalised so the sweep is one query. */
  refundDueAt: timestamp("refund_due_at"),
  /**
   * Set while the backer's bank is disputing the charge (a chargeback), and
   * cleared if the dispute is won. The money is frozen by Stripe for as long
   * as this is set, so payout release and the refund sweep both leave the
   * pledge alone: releasing it pays the creator for money the platform may
   * lose, and refunding it returns the money twice. See charge.dispute.* in
   * server/webhookHandlers.ts.
   */
  disputedAt: timestamp("disputed_at"),
  releasedAt: timestamp("released_at"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  believerNumberUnique: unique().on(table.projectId, table.believerNumber),
}));

/**
 * A physical reward on its way to a backer.
 *
 * Orders queue until the project clears review once. After that first
 * approval every later order goes straight out — the risk being defended
 * against is a creator collecting for a project that doesn't exist, and that
 * question is answered the first time a human looks, not once per shirt.
 */
export const projectMerchOrders = pgTable("project_merch_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  backingId: varchar("backing_id").notNull().references(() => projectBackings.id),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  status: text("status", {
    enum: ["queued", "submitted", "shipped", "failed", "canceled"],
  }).default("queued").notNull(),
  /** MerchOrderItem[] — product key plus the artwork it was built from. */
  items: jsonb("items").default([]),
  shippingAddress: jsonb("shipping_address"),
  printfulOrderId: varchar("printful_order_id"),
  trackingUrl: text("tracking_url"),
  lastError: text("last_error"),
  submittedAt: timestamp("submitted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * A backer's badge for one project — the reward they actually carry around.
 *
 * One row per (backer, project): backing the same project again upgrades the
 * level in place rather than accumulating duplicates, since the badge means
 * "how far I went for this project", not "how many times I paid".
 *
 * The artwork is generated once and stored, not rendered on demand. It costs a
 * model call to make and it has to look identical every time someone loads the
 * profile it's pinned to.
 */
export const backerBadges = pgTable("backer_badges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  /** Highest level earned, from BADGE_LEVELS. */
  level: text("level").notNull(),
  /** Total across every pledge to this project, which is what sets the level. */
  totalCents: integer("total_cents").default(0).notNull(),
  believerNumber: integer("believer_number"),
  foundingBeliever: boolean("founding_believer").default(false).notNull(),
  /** Object path of the generated art. Null until it's been made. */
  imageUrl: text("image_url"),
  status: text("status", { enum: ["pending", "ready", "failed"] }).default("pending").notNull(),
  lastError: text("last_error"),
  /**
   * Position on the owner's profile, 0-based. Null means not pinned — a
   * profile shows at most MAX_SHOWCASE_BADGES of these.
   */
  showcaseOrder: integer("showcase_order"),
  generatedAt: timestamp("generated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  oneBadgePerProject: unique().on(table.userId, table.projectId),
}));

/** Where a physical reward is going. Only collected when one is owed. */
export interface ShippingAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
}

/** One line on a merch order, with the artwork settled at order time. */
export interface MerchOrderItem {
  productKey: string;
  quantity: number;
  /** Snapshot of MerchConfig, so a later logo change can't alter a sent order. */
  artwork: Record<string, unknown>;
}

export const userMatches = pgTable("user_matches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  matchedUserId: varchar("matched_user_id").notNull().references(() => users.id),
  score: integer("score").notNull(),
  reasons: varchar("reasons").array(),
  /*
   * Which run produced this row. Scoring the same community twice returns the
   * same people, so without this a builder opening Discover on Tuesday sees
   * exactly who they ignored on Monday. The generator holds back anyone from
   * the last couple of batches (server/routes.ts, runMatchGeneration).
   */
  batch: integer("batch").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userMatchUnique: unique().on(table.userId, table.matchedUserId),
}));

export const badges = pgTable("badges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
  rarity: text("rarity", { enum: ["common", "rare", "epic", "legendary"] }).notNull().default("common"),
  category: text("category").notNull(),
});

export const userBadges = pgTable("user_badges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  badgeId: varchar("badge_id").notNull().references(() => badges.id),
  awardedAt: timestamp("awarded_at").defaultNow().notNull(),
}, (table) => ({
  /**
   * You can hold a badge once.
   *
   * `awardBadge` used to select-then-insert, which is a check-then-act with a
   * network round trip in the middle: one request that trips two milestones,
   * or two requests landing together, both read "not awarded" and both write.
   * The profile then shows the same badge twice and no amount of re-reading
   * fixes it. With this index the second write is a no-op instead
   * (`onConflictDoNothing`), so the race has no outcome at all.
   */
  oneAwardPerBadge: uniqueIndex("user_badges_user_badge_unique").on(table.userId, table.badgeId),
}));

export const contests = pgTable("contests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  difficulty: text("difficulty", { enum: ["beginner", "intermediate", "advanced"] }).notNull().default("intermediate"),
  status: text("status", { enum: ["upcoming", "active", "judging", "completed"] }).notNull().default("upcoming"),
  prize: text("prize"),
  badgeId: varchar("badge_id").references(() => badges.id),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  maxParticipants: integer("max_participants"),
  promoted: boolean("promoted").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const contestParticipants = pgTable("contest_participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contestId: varchar("contest_id").notNull().references(() => contests.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  submissionUrl: text("submission_url"),
  submissionNote: text("submission_note"),
  score: integer("score"),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
}, (table) => ({
  /*
   * One entry per person per contest.
   *
   * Joining was a check-then-insert with nothing underneath it: read "are they
   * already in?", read the participant count against `maxParticipants`, then
   * insert. A double-clicked button — or two tabs — ran both reads before
   * either insert, so one person could end up in the table twice. That
   * double-counted the entrants shown on the contest, let a contest overfill
   * past its own maximum, and would have given one person two places in the
   * judging. The database is now the thing that answers, and `joinContest`
   * inserts with `onConflictDoNothing` and enforces the cap in the insert's
   * own WHERE rather than in a read before it.
   */
  oneEntry: unique("contest_participants_contest_user_unique").on(table.contestId, table.userId),
}));

export const connections = pgTable("connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  requesterId: varchar("requester_id").notNull().references(() => users.id),
  receiverId: varchar("receiver_id").notNull().references(() => users.id),
  status: text("status", { enum: ["pending", "accepted", "rejected"] }).default("pending").notNull(),
  /**
   * An optional hello with the request — why you'd like to connect. The only
   * way to say anything to someone before they accept, since messages wait for
   * that. Capped at CONNECTION_NOTE_MAX.
   */
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
/*
 * There is one more constraint on this table than drizzle can describe:
 *
 *   create unique index connections_pair_unique
 *     on connections (least(requester_id, receiver_id), greatest(requester_id, receiver_id));
 *
 * It is an expression index, so it lives in the migration (0042) rather than
 * here. It is the thing that makes a connection a fact about a *pair* rather
 * than about a direction. Without it `sendConnectionRequest` was a
 * check-then-insert with nothing underneath it: a double-submitted button, or
 * A and B pressing "connect" on each other in the same second, left two rows
 * for one pair. From then on `getConnectionStatus` returned whichever row the
 * planner handed back first, so messaging between the two 403'd on some
 * requests and worked on others — the shape of bug nobody can reproduce.
 *
 * drizzle-kit doesn't know about it, which is fine: it only drops what it
 * knows. Don't add a plain unique on (requester_id, receiver_id) as well — it
 * would allow exactly the reversed-pair duplicate this one exists to stop.
 */

export const directMessages = pgTable("direct_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  senderId: varchar("sender_id").notNull().references(() => users.id),
  receiverId: varchar("receiver_id").notNull().references(() => users.id),
  content: text("content").notNull(),
  read: boolean("read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectApplications = pgTable("project_applications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  status: text("status", { enum: ["pending", "accepted", "rejected"] }).default("pending").notNull(),
  resumeUrl: text("resume_url"),
  answers: jsonb("answers").default([]),
  message: text("message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectFollows = pgTable("project_follows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  /*
   * Listed project-then-user to match the order the columns are declared in
   * above. drizzle-kit reads a constraint's columns back in table order, so a
   * composite unique written in any other order never matches what it finds and
   * it offers to re-add the constraint on every push — the prompt that used to
   * block this schema entirely.
   */
  projectUserUnique: unique().on(table.projectId, table.userId),
  /* The unique covers project-first lookups; this covers "what am I following". */
  userIdx: index("project_follows_user_idx").on(table.userId),
}));

/**
 * One builder following another. One-way and instant — unlike a connection,
 * which is mutual and waits on the other person — because following is how
 * someone says "show me what they're doing" without asking anything of them.
 * With project follows, it's what the Following feed is made of.
 */
export const userFollows = pgTable("user_follows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  followerId: varchar("follower_id").notNull().references(() => users.id),
  followeeId: varchar("followee_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  /* In column order, for the same drizzle-kit reason as project_follows above. */
  followerFolloweeUnique: unique().on(table.followerId, table.followeeId),
  /* The unique covers "who do I follow"; this covers "who follows them". */
  followeeIdx: index("user_follows_followee_idx").on(table.followeeId),
}));

export type UserFollow = typeof userFollows.$inferSelect;

/**
 * One person deciding they never want to hear from another again.
 *
 * Reporting was the only tool anyone had, and a report changes nothing
 * between two people: it opens a queue item for a reviewer and, in the
 * meantime, the person being harassed still gets connection requests with a
 * 280-character note attached, still sees their harasser in matches and
 * search, and still gets a bell ping every time they react to something. The
 * block is the part the person being harassed controls, and it takes effect
 * the moment it's made.
 *
 * Deliberately one-directional as a row and two-directional in effect: `a`
 * blocking `b` means neither can reach the other, but only `a` is ever told
 * the block exists. The blocked person sees a profile that is simply absent
 * and requests that simply don't arrive — telling them "you were blocked" is
 * how a block turns into the next argument.
 *
 * `reason` is for the blocker's own memory when they review the list months
 * later. It is never shown to the blocked person and never leaves this row.
 */
export const userBlocks = pgTable("user_blocks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  blockerId: varchar("blocker_id").notNull().references(() => users.id),
  blockedId: varchar("blocked_id").notNull().references(() => users.id),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  /*
   * In column order, for the same drizzle-kit reason as project_follows above.
   * Blocking twice (a double-tap on the confirm) must be the same block, not
   * two rows that then need two unblocks to undo.
   */
  blockerBlockedUnique: unique().on(table.blockerId, table.blockedId),
  /*
   * The unique covers "who have I blocked"; this covers the question every
   * reach check actually asks — "who has blocked me" — which otherwise
   * sequentially scans the table on every notification fan-out.
   */
  blockedIdx: index("user_blocks_blocked_idx").on(table.blockedId),
}));

export type UserBlock = typeof userBlocks.$inferSelect;
export type InsertUserBlock = typeof userBlocks.$inferInsert;

export const projectKanbanTasks = pgTable("project_kanban_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status", { enum: ["todo", "in-progress", "review", "done"] }).default("todo").notNull(),
  assigneeId: varchar("assignee_id").references(() => users.id),
  priority: text("priority", { enum: ["low", "medium", "high"] }).default("medium").notNull(),
  dueDate: timestamp("due_date"),
  order: integer("order").default(0).notNull(),
  tags: varchar("tags").array().default([]),
  estimateHours: integer("estimate_hours"),
  blockedByTaskId: varchar("blocked_by_task_id"),
  subtasks: jsonb("subtasks").default([]),
  /**
   * The milestone this task is work toward.
   *
   * Without it a "milestone → tasks" plan is only a shape in a chat reply:
   * the tasks land on the board with no way to tell which milestone each one
   * serves, so the plan can't be read back or reported on.
   */
  milestoneId: varchar("milestone_id").references(() => projectMilestones.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /**
   * Who moved this into progress and when, and who finished it and when.
   *
   * Set by the task PATCH route on status transitions rather than by clients,
   * so the calendar and the reputation maths both read the same timeline.
   * `completedAt` is also what makes "finished on time" answerable — before it
   * existed, on-time was judged by comparing *now* against the due date, so a
   * task finished early silently became "late" once the date passed.
   */
  startedAt: timestamp("started_at"),
  startedById: varchar("started_by_id").references(() => users.id),
  completedAt: timestamp("completed_at"),
  completedById: varchar("completed_by_id").references(() => users.id),
});

/**
 * Lifetime execution counters that survive task deletion.
 *
 * Reputation reads task counts off the live board, so clearing finished tasks
 * used to erase the execution credit earned for them. These counters only ever
 * ratchet upward: every delete path banks the current live totals here first,
 * and reputation uses max(banked, live). A builder can tidy their board without
 * losing the score they earned.
 */
export const userTaskStats = pgTable("user_task_stats", {
  userId: varchar("user_id").primaryKey().references(() => users.id),
  tasksCompleted: integer("tasks_completed").default(0).notNull(),
  tasksCompletedOnTime: integer("tasks_completed_on_time").default(0).notNull(),
  lastCompletedAt: timestamp("last_completed_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const projectPersonas = pgTable("project_personas", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  age: integer("age"),
  occupation: text("occupation"),
  bio: text("bio"),
  goals: varchar("goals").array().default([]),
  painPoints: varchar("pain_points").array().default([]),
  quote: text("quote"),
  avatarDescription: text("avatar_description"),
  isAiGenerated: boolean("is_ai_generated").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectMilestones = pgTable("project_milestones", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status", { enum: ["planned", "in-progress", "completed"] }).default("planned").notNull(),
  targetDate: timestamp("target_date"),
  /**
   * When it was actually finished. Null while it is open, and null for
   * milestones completed before this column existed — the builder index reads
   * it for punctuality and recency, and treats "finished, date unknown" as
   * finished rather than as late.
   */
  completedAt: timestamp("completed_at"),
  /** Who finished it, so contribution can tell your work from your team's. Null for older rows. */
  completedById: varchar("completed_by_id").references(() => users.id, { onDelete: "set null" }),
  order: integer("order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  /** "What has this project finished, and when" — the execution pillar's question. */
  byCompleted: index("project_milestones_completed_idx").on(table.projectId, table.completedAt),
}));

/**
 * Nova AI Roadmap Builder (Builder tier and above). A roadmap is the plan from
 * "where I am" to "where I want to go", regenerated as the project progresses.
 */
export const projectRoadmaps = pgTable("project_roadmaps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  /** The user's stated destination, e.g. "500 paying users by June". */
  goal: text("goal").notNull(),
  summary: text("summary"),
  startingPoint: text("starting_point"),
  targetDate: timestamp("target_date"),
  status: text("status", { enum: ["active", "archived"] }).default("active").notNull(),
  /** Incremented each time Nova revises the roadmap. */
  version: integer("version").default(1).notNull(),
  generatedOnTier: text("generated_on_tier"),
  lastUpdatedAt: timestamp("last_updated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const roadmapPhases = pgTable("roadmap_phases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  roadmapId: varchar("roadmap_id").notNull().references(() => projectRoadmaps.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  estimatedDuration: text("estimated_duration"),
  /** Concrete deliverables for the phase. */
  outcomes: jsonb("outcomes").default([]),
  /** Skills/roles the user is missing for this phase. */
  skillsNeeded: varchar("skills_needed").array().default([]),
  status: text("status", { enum: ["upcoming", "in-progress", "completed"] }).default("upcoming").notNull(),
  order: integer("order").default(0).notNull(),
  /** Set when a milestone was created from this phase. */
  milestoneId: varchar("milestone_id").references(() => projectMilestones.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Nova's periodic project health assessments (Pro tier). */
export const projectHealthChecks = pgTable("project_health_checks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  status: text("status").notNull(),
  summary: text("summary").notNull(),
  /** [{ area, severity, finding, recommendation }] */
  findings: jsonb("findings").default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Nova's audit of the actual codebase against the stated plan.
 *
 * The point isn't a code review — it's reconciliation. A project's tasks,
 * milestones and MVP scope describe what the builder *intends*; the repository
 * is what exists. Everything else in SparkTower reasons about the plan alone,
 * so a board full of "todo" on work that shipped weeks ago looks identical to
 * a project that has done nothing. This is the only surface that can tell them
 * apart.
 */
/**
 * An audit while it runs. Reading a repository and having Nova assess it
 * takes a minute or two, and the audit row itself is only written at the
 * end — so without this, nobody else looking at the project (a teammate, the
 * dashboard in another tab, the builder who started it from their editor)
 * could tell one was under way. One row per run: started, the stage it's at,
 * and how it ended. A run left unfinished for long (a crashed server) reads
 * as over, not as running forever.
 */
export const codeAuditRuns = pgTable("code_audit_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  startedById: varchar("started_by_id").notNull().references(() => users.id),
  /** "github:owner/repo", "upload:app.zip", "worktree:my-branch". */
  source: text("source").notNull(),
  /** fetching → reading → saving. */
  stage: text("stage", { enum: ["fetching", "reading", "saving"] }).default("fetching").notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  /** The audit it produced, when it succeeded. */
  auditId: varchar("audit_id"),
  /** What went wrong, in words for the builder, when it didn't. */
  error: text("error"),
}, (t) => [index("code_audit_runs_project_idx").on(t.projectId, t.startedAt)]);

export type CodeAuditRun = typeof codeAuditRuns.$inferSelect;

/**
 * One record per batch of project operations that has actually been applied.
 *
 * Every "apply what Nova suggested" route took a raw array of operations and
 * ran it, so a double click, or a client retrying a slow request, applied the
 * whole batch twice: two of every task, two of every milestone, and — worse —
 * an update_scope replaying a stale array, silently discarding everything
 * added to the bucket since. The key is either the caller's Idempotency-Key or
 * a fingerprint of the batch itself, so protection does not depend on the
 * client having been updated to send one. The stored result lets a genuine
 * retry receive the original answer rather than an error.
 */
export const projectOperationApplications = pgTable("project_operation_applications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** The caller's Idempotency-Key, or a hash of the operations when there is none. */
  key: text("key").notNull(),
  /** Which route applied it, for reading the table back. */
  source: text("source").notNull(),
  /** The answer the first apply gave, replayed to a retry. */
  result: jsonb("result").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  unique("project_operation_applications_key_idx").on(t.projectId, t.key),
  index("project_operation_applications_made_idx").on(t.createdAt),
]);

export type ProjectOperationApplication = typeof projectOperationApplications.$inferSelect;

export const projectCodeAudits = pgTable("project_code_audits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  /** "github:owner/repo@main" or "upload:my-project.zip". */
  source: text("source").notNull(),
  sourceKind: text("source_kind", { enum: ["github", "upload"] }).notNull(),
  /** How far along the code says the project is. */
  stage: text("stage"),
  completionPercent: integer("completion_percent"),
  summary: text("summary"),
  /** Deterministic facts from the scan: stack, routes, models, test counts. */
  signals: jsonb("signals").default({}),
  /** The model's assessment: built / missing / partial / risks / reconciliation. */
  findings: jsonb("findings").default({}),
  /** Operations that would bring the board in line with the code. */
  operations: jsonb("operations").default([]),
  /**
   * What changed since the previous audit: routes and tables added or
   * removed, areas that moved between partial and built, coverage deltas.
   * An audit is a snapshot; this is the velocity between two of them, and
   * the code evidence the pace model reads alongside task completions.
   */
  delta: jsonb("delta"),
  /**
   * Runtime facts from a small probe at audit time: does the live URL
   * answer, does the health endpoint, are the surface flags loaded, and
   * which referenced environment variables are set on the instance that
   * ran the audit (names only, never values). Separates "code exists" from
   * "it is running".
   */
  runtime: jsonb("runtime"),
  /**
   * The live database as the audit saw it: tables, columns, keys, row
   * counts, and how that compares with the schema in the code. Rows are
   * how "built" and "built but nobody touches it" are told apart.
   */
  dataShape: jsonb("data_shape"),
  /** Set once the builder applies them, so the same audit can't be applied twice. */
  appliedAt: timestamp("applied_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * A document built with Nova: a spec, a plan, a report, a whole pitch deck's
 * worth of prose.
 *
 * The structure (pages, grid, blocks) is the source of truth and stays
 * editable forever, which is why it lives here rather than being flattened to
 * a file on first save. Publishing writes a `project_files` row pointing back
 * at the document, and an optional PDF render alongside it — so the Files tab
 * shows one thing whether the builder wants to keep editing or hand it over.
 */
export const projectDocuments = pgTable("project_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  /** What the builder asked for, kept so a re-plan has the original intent. */
  prompt: text("prompt"),
  /** The task this document is the deliverable for, when it came from one. */
  sourceTaskId: varchar("source_task_id"),
  kind: text("kind").default("document").notNull(),
  status: text("status", { enum: ["planning", "draft", "published"] }).default("planning").notNull(),
  /** DocumentOutlineEntry[] — one line per planned page. */
  outline: jsonb("outline").default([]),
  /** DocumentPage[] — the real structure and content. */
  pages: jsonb("pages").default([]),
  /** DocumentSettings — header, footer, title page, accent colour. */
  settings: jsonb("settings").default({}),
  /** The Files row created on publish, so the two stay linked. */
  fileId: varchar("file_id"),
  /** Object-storage path of the most recent PDF render, if any. */
  pdfUrl: text("pdf_url"),
  /*
   * The last few versions of `pages`, newest first, stamped before anything
   * that rewrites the whole structure (a re-plan).
   *
   * A restructure is a model call: it can decide a page is redundant and drop
   * it, taking prose the builder wrote with it. Before this there was no way
   * back — the pages column had been overwritten and the only copy of those
   * paragraphs was in the PDF, if one had ever been published. Bounded to a
   * handful of versions because a thirty-page document is a large JSON blob
   * and this is an undo, not an archive.
   */
  pagesHistory: jsonb("pages_history").$type<{ at: string; reason: string; pages: unknown }[]>().default([]).notNull(),
  /*
   * Block ids whose last fill produced nothing, so the failure outlives the
   * one response that mentioned it.
   *
   * A fill that fails on three pages out of twenty used to say so in a single
   * toast and then forget. Reload the editor and those blocks look like blocks
   * nobody has got to yet, indistinguishable from the ones never asked for, so
   * the builder either re-fills the whole document (paying again for the
   * nineteen pages that worked) or ships with holes in it.
   */
  fillFailures: jsonb("fill_failures").$type<string[]>().default([]).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * A permanent record of every task this project has ever finished.
 *
 * The kanban rows are working state — builders clear finished cards to keep
 * the board readable, and the moment they do, the project's whole execution
 * record reads "0 done". Nova then calls a project with real momentum stalled,
 * and the builder can't prove otherwise. So a completion is archived here on
 * the way in, and nothing on the board can take it away.
 *
 * `taskId` is deliberately not a foreign key: the row it points at is expected
 * to be deleted, and outliving it is the entire point.
 */
export const projectTaskCompletions = pgTable("project_task_completions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  /** The kanban row that was finished. Unique, so a done/undone loop can't double-count. */
  taskId: varchar("task_id").notNull().unique(),
  /** Who moved it to done. Null if that user was later removed. */
  completedById: varchar("completed_by_id").references(() => users.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  priority: text("priority"),
  /** Whether it landed by its due date, frozen at completion time. */
  onTime: boolean("on_time").default(true).notNull(),
  completedAt: timestamp("completed_at").defaultNow().notNull(),
});

/**
 * The builder's response to a single health-check finding.
 *
 * Keyed by `area` rather than by the finding's index, because a finding
 * survives re-runs while its position in the list does not — pushback on
 * "Scope" should still apply the next time Nova assesses scope.
 */
export const healthFindingFeedback = pgTable("health_finding_feedback", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  /** The check the pushback was written against, for provenance. */
  checkId: varchar("check_id").references(() => projectHealthChecks.id, { onDelete: "set null" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  /** The finding's `area`, lowercased — how later checks match it. */
  area: text("area").notNull(),
  /** The finding text as it stood when the builder responded. */
  finding: text("finding"),
  stance: text("stance", { enum: ["disagree", "already-handled", "not-a-priority"] }).notNull(),
  /** Why. This is the part Nova has to respect on the next run. */
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * AI-generated showcase storyboards.
 *
 * Deliberately NOT part of projects.mediaUrls — the media gallery is for media
 * the user uploaded themselves. A storyboard is private working output visible
 * only to the account that generated it.
 */
export const projectStoryboards = pgTable("project_storyboards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  /** The account that generated it — the only account that can view it. */
  userId: varchar("user_id").notNull().references(() => users.id),
  style: text("style").notNull(),
  prompt: text("prompt"),
  storyboard: text("storyboard").notNull(),
  /** [{ caption, prompt, imagePath, contentType, inlineImage }] */
  scenes: jsonb("scenes").default([]).notNull(),
  imageModel: text("image_model"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** One frame of a storyboard, as stored in projectStoryboards.scenes. */
export interface StoryboardScene {
  caption: string;
  prompt?: string;
  /** Private object-storage path. Served only via the authenticated route. */
  imagePath?: string;
  /** MIME type of `imagePath`, since local-dev storage drops object metadata. */
  contentType?: string;
  /** SVG data URI, used when image generation fell back to vector art. */
  inlineImage?: string;
}

/**
 * Investor-readiness artifacts: deck outlines, readiness scores, pitch
 * critiques, and pricing analyses. One table because they share a shape.
 */
export const investorArtifacts = pgTable("investor_artifacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  kind: text("kind", { enum: ["deck_outline", "readiness_score", "pitch_critique", "pricing_analysis"] }).notNull(),
  /** 0-100 for scores and critiques. Null for deck outlines. */
  score: integer("score"),
  summary: text("summary"),
  content: jsonb("content").default({}).notNull(),
  creditsCharged: integer("credits_charged").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Mock investor interview. Nova asks progressively harder questions and grades
 * each answer, so a session is a sequence of graded exchanges.
 */
export const mockInterviews = pgTable("mock_interviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  /** The investor archetype Nova is playing. */
  persona: text("persona").notNull(),
  difficulty: text("difficulty", { enum: ["friendly", "skeptical", "brutal"] }).default("skeptical").notNull(),
  status: text("status", { enum: ["active", "completed"] }).default("active").notNull(),
  /** Rolling average of answer grades, 0-100. */
  averageScore: integer("average_score"),
  verdict: text("verdict"),
  creditsCharged: integer("credits_charged").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const mockInterviewTurns = pgTable("mock_interview_turns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  interviewId: varchar("interview_id").notNull().references(() => mockInterviews.id, { onDelete: "cascade" }),
  order: integer("order").default(0).notNull(),
  question: text("question").notNull(),
  answer: text("answer"),
  score: integer("score"),
  /** What was strong, what was weak, and what a real investor would push on. */
  feedback: jsonb("feedback"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  answeredAt: timestamp("answered_at"),
});

/**
 * Comments on a project's milestones and updates — the "building in public"
 * layer. Anyone who can see the project can weigh in.
 */
export const projectComments = pgTable("project_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  authorId: varchar("author_id").notNull().references(() => users.id),
  targetType: text("target_type", { enum: ["milestone", "project", "roadmap_phase"] }).notNull(),
  targetId: varchar("target_id").notNull(),
  content: text("content").notNull(),
  mentions: jsonb("mentions").default([]),
  parentCommentId: varchar("parent_comment_id"),
  reactionCount: integer("reaction_count").default(0).notNull(),
  /** Taken down by a reviewer: hidden from every read, with who and why. Null means visible. */
  hiddenAt: timestamp("hidden_at"),
  hiddenById: varchar("hidden_by_id"),
  hiddenReason: text("hidden_reason"),
  /**
   * How it's hidden, when it is. "removed": gone for everyone, its author
   * included. "shadow": gone for everyone but its author, who still sees it as
   * posted. Hidden with no mode is an older takedown, read as removed.
   */
  hiddenMode: text("hidden_mode", { enum: ["removed", "shadow"] }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectCommentReactions = pgTable("project_comment_reactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  commentId: varchar("comment_id").notNull().references(() => projectComments.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  reaction: text("reaction").default("like").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  oneReactionPerUser: unique().on(table.commentId, table.userId),
}));

// ---------------------------------------------------------------------------
// Founder feed
// ---------------------------------------------------------------------------

/**
 * Post types. Each gives the composer a prompt and the card a label, so a
 * founder never faces an empty box wondering what to write.
 */
export const FEED_POST_TYPES = [
  "project_update", "looking_for_help", "looking_for_cofounder", "seeking_feedback",
  "milestone", "idea_validation", "launch", "investor_update",
] as const;
export type FeedPostType = (typeof FEED_POST_TYPES)[number];

/** LinkedIn-style reactions rather than a single like. */
export const FEED_REACTIONS = ["like", "celebrate", "support", "insightful", "funny"] as const;
export type FeedReaction = (typeof FEED_REACTIONS)[number];

export const feedPosts = pgTable("feed_posts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  authorId: varchar("author_id").notNull().references(() => users.id),
  /** The project this post is about. Null for general founder chatter. */
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  /**
   * Posted as a company rather than as the person. The person who wrote it is
   * still `authorId` — for moderation, and so a company can see who posted in
   * its name — but the feed shows the company. Only somebody the company has
   * given the "post as the company" power can set it.
   */
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "set null" }),
  postType: text("post_type", { enum: FEED_POST_TYPES }).notNull(),
  content: text("content").notNull(),
  mediaUrls: varchar("media_urls").array().default([]),
  /** Tagged users resolved at post time: [{ userId, name }]. */
  mentions: jsonb("mentions").default([]),
  /** True for posts the system created from an event. */
  isSystemGenerated: boolean("is_system_generated").default(false).notNull(),
  entityType: text("entity_type"),
  entityId: varchar("entity_id"),
  /** Denormalized so the feed doesn't need a count per post per render. */
  reactionCount: integer("reaction_count").default(0).notNull(),
  commentCount: integer("comment_count").default(0).notNull(),
  /** The specific questions a progress post asks its readers (0–4). Vague posts get vague feedback. */
  asks: jsonb("asks").$type<string[]>().default([]).notNull(),
  /** When the project's team last read the feedback on this post; comments after it are new. */
  feedbackSeenAt: timestamp("feedback_seen_at"),
  editedAt: timestamp("edited_at"),
  /**
   * Deleted by its author while other people were replying: the author's words
   * and images go, the row stays so the thread they wrote under doesn't
   * vanish with it. A post nobody replied to is deleted outright and has no
   * row at all. Same rule as a comment with replies under it.
   */
  deletedAt: timestamp("deleted_at"),
  /** Taken down by a reviewer: hidden from every read, with who and why. Null means visible. */
  hiddenAt: timestamp("hidden_at"),
  hiddenById: varchar("hidden_by_id"),
  hiddenReason: text("hidden_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const feedReactions = pgTable("feed_reactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  postId: varchar("post_id").notNull().references(() => feedPosts.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  reaction: text("reaction", { enum: FEED_REACTIONS }).default("like").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // One reaction per person per post; changing it updates in place.
  oneReactionPerUser: unique().on(table.postId, table.userId),
}));

export const feedComments = pgTable("feed_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  postId: varchar("post_id").notNull().references(() => feedPosts.id, { onDelete: "cascade" }),
  authorId: varchar("author_id").notNull().references(() => users.id),
  content: text("content").notNull(),
  mentions: jsonb("mentions").default([]),
  parentCommentId: varchar("parent_comment_id"),
  /**
   * The feedback loop on a project's post: a teammate turned this comment into
   * work (a task), and a later update from the project said it acted on it.
   * The commenter hears about that once, then `closureSeenAt` is stamped.
   */
  appliedAt: timestamp("applied_at"),
  appliedById: varchar("applied_by_id"),
  appliedTaskId: varchar("applied_task_id"),
  closedByPostId: varchar("closed_by_post_id"),
  closureSeenAt: timestamp("closure_seen_at"),
  /** Denormalized like the post's, so a thread doesn't count per comment per render. */
  reactionCount: integer("reaction_count").default(0).notNull(),
  /** Taken down by a reviewer: hidden from everyone but its author, with who and why. */
  hiddenAt: timestamp("hidden_at"),
  hiddenById: varchar("hidden_by_id"),
  hiddenReason: text("hidden_reason"),
  /**
   * Deleted by its author while it had replies. The text goes; the row stays
   * so the replies under it keep their place in the thread.
   */
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  byPost: index("feed_comments_post_idx").on(table.postId, table.createdAt),
}));

/** Reactions on a comment: the same set as on posts, one per person per comment. */
export const feedCommentReactions = pgTable("feed_comment_reactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  commentId: varchar("comment_id").notNull().references(() => feedComments.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  reaction: text("reaction", { enum: FEED_REACTIONS }).default("like").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  oneReactionPerUser: unique().on(table.commentId, table.userId),
}));

/**
 * What a finished path step produced, kept as its own thing so it can be
 * published: a public page at /a/:id, a feed post, and a way for a stranger to
 * start their own path from it. One per step; regenerating refreshes the body
 * and keeps the title and tags someone chose.
 */
export const pathArtifacts = pgTable("path_artifacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  taskId: varchar("task_id").notNull(),
  backboneId: text("backbone_id"),
  authorId: varchar("author_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  body: text("body").notNull().default(""),
  /** For a build step: the files it produced, by path and purpose (never their contents). */
  files: jsonb("files").$type<{ path: string; purpose?: string }[]>().default([]).notNull(),
  tags: text("tags").array().default([]).notNull(),
  visibility: text("visibility", { enum: ["private", "public"] }).default("private").notNull(),
  /*
   * A re-assembled version of a page that is already live, held back until
   * somebody publishes it.
   *
   * Regenerating an artifact re-reads the step it came from, and that step is
   * a working surface: a builder pastes a customer's name, a price they
   * haven't announced or a note to themselves into the step's answer while
   * thinking. Writing that straight over `body` put it on /a/<id> the instant
   * the dialog opened — no button pressed, no warning, and no way to know it
   * had happened. So a refresh of a public artifact lands here instead, and
   * the publish route is what moves it across.
   */
  draftSummary: text("draft_summary"),
  draftBody: text("draft_body"),
  draftFiles: jsonb("draft_files").$type<{ path: string; purpose?: string }[]>(),
  /** When the held-back draft was assembled. Null means there isn't one. */
  draftAt: timestamp("draft_at"),
  publishedPostId: varchar("published_post_id"),
  publishedAt: timestamp("published_at"),
  views: integer("views").default(0).notNull(),
  /** People who signed up having landed on this artifact first. */
  signups: integer("signups").default(0).notNull(),
  /*
   * Taken down by a reviewer.
   *
   * These three columns did not exist, and their absence was the widest hole
   * in the moderation chain. `/a/:id` is the one page built for people who
   * have never signed in — it previews on social, it is in the sitemap, it is
   * what a stranger's first contact with SparkTower looks like — and there was
   * no way to take one down. The only lever was hiding its *published feed
   * post*, which `publicArtifact` happened to check; an artifact published
   * without a post, or one whose post was restored, stayed up regardless, and
   * a reviewer looking at an abusive public page had nothing to press.
   *
   * Same three columns, same names, as every other takedown target (projects,
   * feed posts, both kinds of comment), so `TAKEDOWN_TABLES`, the queue's
   * decide route, the undo path and the moderation log treat a published page
   * exactly like a post. No `hidden_mode`: shadow-hiding a public page would
   * mean showing its author a page strangers cannot reach, which is a lie the
   * growth loop would then measure views on.
   */
  hiddenAt: timestamp("hidden_at"),
  hiddenById: varchar("hidden_by_id").references(() => users.id),
  hiddenReason: text("hidden_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  oncePerStep: unique().on(table.taskId),
  byProject: index("path_artifacts_project_idx").on(table.projectId),
}));
export type PathArtifact = typeof pathArtifacts.$inferSelect;

/**
 * Something that happened to someone: the hook that brings them back. A post
 * from a builder or project they follow, a comment or reply or reaction on
 * their work, a mention, a follow, a connection. In-app only — SparkTower
 * sends no email or push — so this is what the bell and the "new since you
 * last looked" counts read.
 *
 * One row per (recipient, actor, kind, target): a second reaction from the
 * same person refreshes the row rather than stacking a duplicate.
 */
export const NOTIFICATION_KINDS = [
  "followed_post", "comment", "reply", "post_reaction", "comment_reaction", "mention",
  "follow", "project_follow", "connection_request", "connection_accepted",
  // The build loop's last step: a project credited your feedback in an update.
  "feedback_used",
  // The retention loop: a step on a project's path was finished, and the next one is ready.
  "path_step_done", "next_step",
  // The weekly progress update: steps finished this week that haven't been shared yet.
  "weekly_update",
  // The growth loop: someone joined SparkTower from a published artifact.
  "artifact_signup",
  // Someone accepted an invite to your project.
  "invite_accepted",
  // Your sprint partner left. The sprint is over for both of you, and you're free to look again.
  "sprint_left",
  // A teammate in a simulated season is waiting on your seat to file this year.
  "sim_nudge",
  // A company would like to talk to you, having seen your track record.
  "recruit_invite",
  // Somebody answered your company's invitation to talk.
  "recruit_answer",
  // Your company invited you to a private training season.
  "season_invite",
  // Somebody entered your company's challenge.
  "challenge_entry",
  // Your challenge entry was shortlisted, or won.
  "challenge_result",
  // A project your company follows moved: a milestone, an update.
  "scout_update",
  // New projects in an industry your company watches.
  "scout_new_project",
  // A company leader added you to their company, or changed what you can do there.
  "company_added",
  "company_powers",
  // A recurring job of yours is due or overdue.
  "job_due",
  // It's check-in day for the company you help run.
  "checkin_due",
  // Money: somebody backed your project, a reviewer decided, a pledge was released or refunded.
  "pledge_received", "campaign_decision", "pledge_refunding", "pledge_released", "pledge_refunded",
  // Someone applied to your project; the owner decided on your application.
  "project_application", "application_accepted", "application_rejected",
  // The owner removed you from their project's team.
  "project_removed",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  recipientId: varchar("recipient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  actorId: varchar("actor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: NOTIFICATION_KINDS }).notNull(),
  /** What it's about: a post, a comment, a project, a user, a connection. */
  targetId: varchar("target_id").notNull(),
  /** The post to open, when there is one. */
  postId: varchar("post_id"),
  projectId: varchar("project_id"),
  /** A line of what was said, taken at the time. */
  excerpt: text("excerpt"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  byRecipient: index("notifications_recipient_idx").on(table.recipientId, table.createdAt),
  oncePerThing: unique().on(table.recipientId, table.actorId, table.kind, table.targetId),
}));
export type Notification = typeof notifications.$inferSelect;

/** A user tagged in a post or comment, captured at write time. */
export interface FeedMention {
  userId: string;
  name: string;
}

export const projectActivityLog = pgTable("project_activity_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectDecisions = pgTable("project_decisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  decision: text("decision").notNull(),
  context: text("context"),
  status: text("status", { enum: ["proposed", "accepted", "revisited"] }).default("proposed").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Every moderation action, appended and never edited.
 *
 * Reports and suspensions are mutable rows — a report gets resolved, a
 * suspension gets lifted — and a mutable row is a poor record of what a
 * moderator did and when. This table is only ever inserted into. It is what
 * you read when someone asks "who suspended me, and why", and what an audit
 * reads when it asks whether the answer to that is honest.
 */
export const moderationLog = pgTable("moderation_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** suspend, reinstate, report_actioned, report_dismissed, surface_toggled … */
  action: varchar("action").notNull(),
  /** The moderator. Null only for automated actions. */
  actorId: varchar("actor_id"),
  /** The account acted on, where there is one. */
  targetUserId: varchar("target_user_id"),
  /** The report, surface, or content the action was about. */
  targetType: varchar("target_type"),
  targetId: varchar("target_id"),
  reason: text("reason"),
  /** One of MODERATION_REASON_CODES (shared/moderation.ts). Required for actions taken from the queue. */
  reasonCode: varchar("reason_code"),
  /**
   * What the target looked like just before, and just after. The pair is the
   * change; the first half is what an undo puts back, exactly.
   */
  previousState: jsonb("previous_state"),
  resultingState: jsonb("resulting_state"),
  /** Anything else worth keeping, small and non-sensitive. */
  details: jsonb("details").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  byTarget: index("moderation_log_target_idx").on(table.targetUserId, table.createdAt),
  byActor: index("moderation_log_actor_idx").on(table.actorId, table.createdAt),
  /** "Everything that happened to this comment." */
  byContent: index("moderation_log_content_idx").on(table.targetType, table.targetId, table.createdAt),
}));

/**
 * Rate-limit hits for actions that leave no row of their own.
 *
 * Most limits count the content itself — comments, check-ins, projects — which
 * is exact and needs no bookkeeping. Three actions can't be counted that way:
 * a reaction is a toggle (un-reacting deletes the row, so the count goes down),
 * an upload presign writes nothing until the file lands, and an AI call leaves
 * its result in a dozen different places. Those record a hit here instead.
 *
 * In Postgres rather than memory so a limit survives a restart and holds
 * across instances — an in-memory counter on autoscale is one counter per
 * instance, which is N times the limit. Swept after a day.
 */
export const rateLimitHits = pgTable("rate_limit_hits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  action: varchar("action").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  /* The only query: this person, this action, inside the window. */
  lookup: index("rate_limit_hits_lookup_idx").on(table.userId, table.action, table.createdAt),
}));

/**
 * The behaviour stream — every write the API takes and every page anyone opens.
 *
 * High volume and read by a person watching the site, not by a metric. See
 * shared/analytics.ts.
 *
 * No request body is ever written here. A row says someone sent a message; it
 * never says what the message was.
 */

/**
 * Pace, per project on a path. One row, rewritten on every recalculation;
 * the rules that write it live in shared/phase-trees/pace.ts. Kept apart
 * from the project row because it is derived state with its own clock.
 */
export const pathPace = pgTable("path_pace", {
  projectId: varchar("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  state: text("state", { enum: ["active", "nudge", "decaying", "dormant"] }).default("active").notNull(),
  multiplier: real("multiplier"),
  projectedAt: timestamp("projected_at"),
  projectedLow: timestamp("projected_low"),
  projectedHigh: timestamp("projected_high"),
  lastActivityAt: timestamp("last_activity_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * The recalculation log: every "estimated 3h, took 40m" as an event the
 * builder can scroll back through. The history of getting faster is the
 * hook; the current number is only its latest line.
 */
export const pathPaceEvents = pgTable("path_pace_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  taskId: varchar("task_id"),
  backboneId: text("backbone_id"),
  title: text("title").notNull(),
  estimateMinutes: integer("estimate_minutes"),
  actualMinutes: integer("actual_minutes"),
  projectedBefore: timestamp("projected_before"),
  projectedAfter: timestamp("projected_after"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type PathPace = typeof pathPace.$inferSelect;
export type PathPaceEvent = typeof pathPaceEvents.$inferSelect;


/**
 * What Nova produced for a task on the path: options to pick from, a build
 * packet (files, run steps), or a template for something only the builder
 * can do. One row per attempt; the latest is what the dashboard shows.
 * A chosen option becomes the task's written answer — the artifact the
 * rest of the path reads.
 */
export const pathWork = pgTable("path_work", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  taskId: varchar("task_id").notNull(),
  /** "loop-audit" is Nova's competitive read of the loops, kept on the core-loop task; not a work packet. */
  kind: text("kind", { enum: ["options", "build", "template", "plan", "intake", "loop-audit"] }).notNull(),
  payload: jsonb("payload").notNull(),
  chosenIndex: integer("chosen_index"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("path_work_task_idx").on(t.taskId, t.createdAt)]);
export type PathWork = typeof pathWork.$inferSelect;

/**
 * The latest read of a project's live database, kept on its own so the
 * data map exists the moment a source is set, not after the next audit.
 * Audits refresh it and copy it onto themselves for history.
 */
export const projectDataShapes = pgTable("project_data_shapes", {
  projectId: varchar("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  shape: jsonb("shape").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type ProjectDataShape = typeof projectDataShapes.$inferSelect;

/**
 * Every Stripe event we have seen, by Stripe's own id. Idempotency and
 * retry in one place: a delivery of an id already processed is a no-op, a
 * delivery of one that failed is retried, and a delivery in flight is not
 * processed twice. Stripe retries on a 5xx; this is what makes that safe.
 */
export const stripeEvents = pgTable("stripe_events", {
  id: varchar("id").primaryKey(),
  type: text("type").notNull(),
  status: text("status", { enum: ["processing", "processed", "failed"] }).notNull(),
  error: text("error"),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
  /**
   * When the current attempt claimed the event. A claim still "processing"
   * long after this is an attempt that died mid-way (a crash, a deploy), and
   * the next delivery takes it over instead of being told it's a duplicate.
   */
  claimedAt: timestamp("claimed_at").defaultNow().notNull(),
});

export const activityEvents = pgTable("activity_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /**
   * Strictly increasing, and the cursor the live feed pages on. `created_at`
   * can't do this job: two events in the same millisecond tie, and a tie means
   * the tail either repeats a row or skips one.
   */
  seq: bigserial("seq", { mode: "number" }).notNull(),
  /** One of ACTIVITY_EVENTS. */
  name: text("name").notNull(),
  /** Null when nobody is signed in — see `visitorId`, which is never null. */
  userId: varchar("user_id").references(() => users.id),
  /**
   * Follows the browser, not the account. It's what makes a signed-out visitor
   * a "who" rather than a series of unrelated rows, and what connects the
   * pages someone read before signing up to the account they then created.
   */
  visitorId: varchar("visitor_id").notNull(),
  /** One visit. A new one starts after SESSION_IDLE_MINUTES of quiet. */
  sessionId: varchar("session_id").notNull(),
  /** Raw path, ids and all. */
  path: text("path").notNull(),
  /** `path` with ids replaced by `:id`, so totals can be grouped. */
  pattern: text("pattern").notNull(),
  /** Absent on page views, which aren't requests. */
  method: varchar("method"),
  status: integer("status"),
  durationMs: integer("duration_ms"),
  projectId: varchar("project_id"),
  referrer: text("referrer"),
  userAgent: text("user_agent"),
  /** Small, non-sensitive extras. Never request bodies. */
  props: jsonb("props").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  /* The live tail's only query: everything after a cursor. */
  seqIdx: index("activity_events_seq_idx").on(table.seq),
  /* Windowed aggregates — "the last hour", "today", "who's here now". */
  createdIdx: index("activity_events_created_idx").on(table.createdAt),
  /* One person's trail, newest first. */
  visitorIdx: index("activity_events_visitor_idx").on(table.visitorId, table.createdAt),
}));
/*
 * One more index than drizzle can describe here:
 *
 *   create index activity_events_view_dedupe_idx
 *     on activity_events (name, (props->>'targetId'), coalesce(user_id, visitor_id), created_at)
 *     where name in ('project.view', 'profile.view');
 *
 * It is a partial expression index, so it lives in its migration rather than
 * in this table definition. It exists for exactly one query: the "have I
 * already counted this viewer for this thing today?" check in server/views.ts,
 * which runs on every anonymous GET of a public project page or profile. With
 * no index that check was a sequential scan of the whole behaviour stream —
 * the busiest table in the database, on the cheapest-to-call surface there is,
 * with no rate limit in front of it because it is a GET. The table grows, the
 * scan grows with it, and the page a stranger lands on gets slower every week.
 */

/**
 * Which feature areas are switched on.
 *
 * One row per surface that has been changed from its shipped default; absent
 * rows mean "as shipped". See shared/surfaces.ts for the registry and
 * server/surfaces.ts for the middleware that enforces it.
 */
/**
 * Something a person flagged for a human to look at.
 *
 * One table for every reportable thing rather than a table per type: the queue
 * is worked as one list, and a moderator triaging by severity doesn't care
 * whether the offending object was a comment or a project.
 */
/**
 * Someone asking to invest in a project, through its public page.
 *
 * An application to talk, not an investment: no money moves through
 * SparkTower, and nothing here is an offer or sale of securities. It carries
 * what the founder needs to decide whether to reply — how much, in what form,
 * who the investor is — and the investor's consent to share their contact.
 */
export const investmentApplications = pgTable("investment_applications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  investorId: varchar("investor_id").notNull().references(() => users.id),
  /** One of INVESTMENT_AMOUNTS. */
  amount: text("amount").notNull(),
  /** One of INVESTMENT_INSTRUMENTS. */
  instrument: text("instrument").notNull(),
  /** One of INVESTOR_TYPES. */
  investorType: text("investor_type").notNull(),
  /** "yes", "no" or "unsure" — whether they're an accredited investor. */
  accredited: text("accredited").notNull(),
  message: text("message").notNull(),
  phone: text("phone"),
  linkedinUrl: text("linkedin_url"),
  status: text("status", { enum: ["new", "reviewing", "accepted", "declined", "withdrawn"] }).default("new").notNull(),
  /** The founder's private note. */
  ownerNote: text("owner_note"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("investment_applications_project_idx").on(t.projectId, t.createdAt),
  index("investment_applications_investor_idx").on(t.investorId, t.createdAt),
]);
export type InvestmentApplication = typeof investmentApplications.$inferSelect;

/**
 * What someone has looked at in the Explore loop, and when — the "since" in
 * "3 new posts since you last looked" — kept on the server so it's the same on
 * every device, and so the app's badge can be worked out without a browser.
 *
 * `kind` is "builder" or "project" for a thing they interacted with (opened,
 * followed, connected, messaged), or "discover" with target "visit" for the
 * last time they opened Discover. `seenMs` is epoch milliseconds from the
 * server's clock, compared inside the database — never a timestamp read back
 * into JS, which shifts by the server's timezone.
 */
/**
 * Communities people join around what they're building — AI builders, SaaS
 * founders, first-time founders. Listed under Contests and Communities; the
 * starting set is seeded by slug at boot (server/community-routes.ts), so
 * editing a seed's copy updates it without duplicating the community.
 */
export const communities = pgTable("communities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  tagline: text("tagline").notNull(),
  description: text("description").notNull().default(""),
  /** A lucide icon name the clients map to a glyph. */
  icon: text("icon").notNull().default("users"),
  /** Hex accent for the card. */
  color: text("color").notNull().default("#9745B5"),
  /** Display order in the list. */
  sort: integer("sort").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const communityMembers = pgTable("community_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  communityId: varchar("community_id").notNull().references(() => communities.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
}, (t) => [
  unique("community_members_community_user").on(t.communityId, t.userId),
  index("community_members_user_idx").on(t.userId),
]);

export type Community = typeof communities.$inferSelect;

/**
 * The paths a project works besides its primary one.
 *
 * A project runs all three sections side by side — Ship an MVP, Systemize the
 * business, Raise funds — each its own path on the same board. The primary
 * path's state stays on `projects` (goal, subcategory, capital_route,
 * active_branch), where everything that predates sections reads it; each
 * other section the project has started keeps the same fields here, plus its
 * own pace, which the primary keeps in `path_pace`.
 */
export const projectTracks = pgTable("project_tracks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  goal: text("goal", { enum: PROJECT_GOAL_IDS }).notNull(),
  subcategory: text("subcategory").notNull(),
  capitalRoute: text("capital_route"),
  activeBranch: text("active_branch"),
  /** Pace for this section: the same shape as a `path_pace` row, without its keys. */
  pace: jsonb("pace"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("project_tracks_project_goal").on(t.projectId, t.goal),
]);

export type ProjectTrack = typeof projectTracks.$inferSelect;

export const exploreSeen = pgTable("explore_seen", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["builder", "project", "discover"] }).notNull(),
  targetId: varchar("target_id").notNull(),
  seenMs: bigint("seen_ms", { mode: "number" }).notNull(),
}, (t) => [
  unique("explore_seen_user_target").on(t.userId, t.kind, t.targetId),
  index("explore_seen_recent_idx").on(t.userId, t.seenMs),
]);

export const contentReports = pgTable("content_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /**
   * Null for a report filed with no account.
   *
   * A public artifact page is the one surface built for people who have never
   * signed in, and until now it had no way to report anything: the only report
   * route required an account, so a stranger who landed on something abusive
   * could close the tab and that was the whole of it. Requiring a signup before
   * someone can tell you about abuse is asking for the abuse not to be
   * reported. `reporterAddressHash` stands in for the reporter on those rows.
   */
  reporterId: varchar("reporter_id").references(() => users.id),
  /**
   * SHA-256 of the reporting address, on anonymous reports only.
   *
   * Hashed rather than stored: this only has to answer "is this the same
   * reporter as that one?", which a hash does, and keeping visitors' addresses
   * in a table that lives forever is a cost with no matching benefit. It makes
   * "one report per reporter per thing" true for anonymous reports too — the
   * unique index below can't do it, because in SQL one null is never equal to
   * another and every anonymous row would slip past it.
   */
  reporterAddressHash: varchar("reporter_address_hash"),
  /** One of REPORT_TARGETS — see shared/moderation.ts. */
  targetType: text("target_type").notNull(),
  targetId: varchar("target_id").notNull(),
  /** Denormalised so the queue can show context without five joins. */
  targetOwnerId: varchar("target_owner_id").references(() => users.id),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  note: text("note"),
  /**
   * A copy of what was reported, taken at report time.
   *
   * Without it, deleting the offending content also destroys the evidence for
   * the report about it — and the obvious move for someone caught is to delete
   * and carry on.
   */
  snapshot: text("snapshot"),
  status: text("status", { enum: ["open", "actioned", "dismissed"] })
    .default("open").notNull(),
  reviewedById: varchar("reviewed_by_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  /** One report per person per thing — re-reporting shouldn't inflate a queue. */
  oneReportPerPerson: unique().on(table.reporterId, table.targetType, table.targetId),
}));
/*
 * And the same rule for reports with no account behind them, which the index
 * above cannot express:
 *
 *   create unique index content_reports_anon_unique
 *     on content_reports (reporter_address_hash, target_type, target_id)
 *     where reporter_id is null;
 *
 * A partial index, so it lives in its migration. Without it every anonymous
 * report is unique as far as the database is concerned — `null <> null` — and
 * one reader pressing the button twice would be two rows in the queue.
 */

export const surfaceFlags = pgTable("surface_flags", {
  surfaceId: varchar("surface_id").primaryKey(),
  enabled: boolean("enabled").notNull(),
  updatedById: varchar("updated_by_id").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const projectFiles = pgTable("project_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  /** The section it was added in, or null when it's shared across all three. */
  track: text("track"),
  uploaderId: varchar("uploader_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  url: text("url").notNull(),
  folder: text("folder").default("general"),
  fileType: text("file_type"),
  size: integer("size"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectLinks = pgTable("project_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  url: text("url").notNull(),
  category: text("category", { enum: ["repo", "docs", "design", "drive", "notes", "other"] }).default("other").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// === PROJECT CHAT (AI - Nova) ===

export const projectChatMessages = pgTable("project_chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// === PROJECT LIVE CHAT (Team) ===

export const projectLiveChatMessages = pgTable("project_live_chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// === PROJECT MANAGER EXTENDED TABLES ===

export const projectWaitlistEntries = pgTable("project_waitlist_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  name: text("name"),
  source: text("source"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectInterviews = pgTable("project_interviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  intervieweeName: text("interviewee_name").notNull(),
  intervieweeRole: text("interviewee_role"),
  date: timestamp("date"),
  notes: text("notes"),
  keyInsights: text("key_insights"),
  sentiment: text("sentiment").default("neutral"),
  status: text("status").default("planned"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectExperiments = pgTable("project_experiments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  hypothesis: text("hypothesis").notNull(),
  method: text("method"),
  status: text("status").default("planned"),
  result: text("result"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  metrics: text("metrics"),
  learnings: text("learnings"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectPricingTiers = pgTable("project_pricing_tiers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  price: integer("price").default(0),
  billingPeriod: text("billing_period").default("monthly"),
  features: jsonb("features").default([]),
  limits: jsonb("limits").default({}),
  isFeatured: boolean("is_featured").default(false),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * A creator's list of the metrics they plan to track (name, category, status:
 * planned → tracking), edited on the project's Analytics tab
 * (client/src/components/analytics/analytics-tab.tsx →
 * GET/POST/PATCH/DELETE /api/projects/:id/analytics-events). Definitions, not
 * telemetry: nothing is emitted into it, and it's empty until a creator adds
 * one. The event stream is `activity_events`, which is swept.
 */
export const projectAnalyticsEvents = pgTable("project_analytics_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  /** The section it belongs to (ship_mvp, systemize_business, run_company), or null when it's project-wide. */
  track: text("track"),
  eventName: text("event_name").notNull(),
  category: text("category").default("activation"),
  description: text("description"),
  trackingStatus: text("tracking_status").default("planned"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectLegalDocs = pgTable("project_legal_docs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  docType: text("doc_type").notNull(),
  title: text("title").notNull(),
  content: text("content"),
  status: text("status").default("draft"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectDeployChecklistItems = pgTable("project_deploy_checklist_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  item: text("item").notNull(),
  category: text("category").default("other"),
  isCompleted: boolean("is_completed").default(false),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectSupportTickets = pgTable("project_support_tickets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  submitterEmail: text("submitter_email"),
  submitterName: text("submitter_name"),
  subject: text("subject").notNull(),
  description: text("description"),
  status: text("status").default("open"),
  priority: text("priority").default("medium"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const projectLaunchTasks = pgTable("project_launch_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  task: text("task").notNull(),
  status: text("status").default("planned"),
  targetDate: timestamp("target_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ===========================================================================
// Retired — kept so existing data isn't dropped; no code reads or writes these.
//
// Weekly check-ins (and their Needs feedback queue), the check-in loop's event
// stream, and the games arena were retired. Their tables stay defined here so
// `drizzle-kit generate` doesn't emit a DROP for rows people already wrote.
// There are no insert schemas or types for them on purpose: nothing should
// start using them again. Dropping them is a deliberate, separate migration.
// ===========================================================================

/**
 * One weekly check-in — the artifact the whole loop is built around.
 *
 * The fields are the spec's, not a general-purpose status update: a goal you
 * set, proof it happened, what's in the way, and the single next step. The old
 * shape (did / doing / blockers) had nowhere to put proof and nowhere to put a
 * next step, which is what broke steps 3 through 6 of the loop.
 */
export const projectCheckIns = pgTable("project_check_ins", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  /**
   * Monday of the week this covers, at UTC midnight.
   *
   * Part of the check-in's identity — it's in the public page's heading — so
   * it's stored rather than derived from `createdAt`, which would move the
   * week for anyone reading from a different timezone.
   */
  weekStart: timestamp("week_start").notNull(),
  /** 5-120 chars, one sentence. */
  goal: text("goal").notNull(),
  /** 10-400 chars, must carry a link or name something shipped. */
  proof: text("proof").notNull(),
  /** Optional — plenty of good weeks have nothing in the way. */
  blocker: text("blocker"),
  /** 5-140 chars, starts with a verb. Carried into next week's composer. */
  nextStep: text("next_step").notNull(),
  /**
   * Unlisted by default: reachable by anyone holding the link, listed nowhere.
   * "Too public → posting anxiety" is the loop's first named risk, so going
   * public is a decision the builder makes, not a default they discover.
   */
  visibility: text("visibility", { enum: ["unlisted", "public"] })
    .default("unlisted").notNull(),
  /** Set when a builder asked for feedback (the retired Needs feedback queue). */
  needsFeedback: boolean("needs_feedback").default(false).notNull(),
  /** Taken down by a reviewer: hidden from every read, with who and why. Null means visible. */
  hiddenAt: timestamp("hidden_at"),
  hiddenById: varchar("hidden_by_id"),
  hiddenReason: text("hidden_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  /** One check-in per person per project per week. */
  onePerWeek: unique().on(table.projectId, table.userId, table.weekStart),
}));

/**
 * What an admin has set for one featured tool in the feed (shared/promotions.ts
 * holds the catalog): its video, referral link and perk, a "what's new"
 * headline, a logo, and whether it's shown. A catalog entry with no row here is
 * shown as it is, without video or offer.
 */
export const promotionSettings = pgTable("promotion_settings", {
  promotionId: varchar("promotion_id").primaryKey(),
  headline: text("headline"),
  videoUrl: text("video_url"),
  referralUrl: text("referral_url"),
  logoUrl: text("logo_url"),
  perk: text("perk"),
  /** The company's YouTube channel, when its site doesn't link one (or links the wrong one). */
  youtubeChannelUrl: text("youtube_channel_url"),
  active: boolean("active").default(true).notNull(),
  updatedById: varchar("updated_by_id").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * What the daily sync read from a company's own public pages
 * (server/promotion-sync.ts): its logo, stored here and served from our origin
 * so viewers never load it from theirs, and a recent embeddable video from the
 * YouTube channel its site links. An admin's settings take precedence.
 */
export const promotionSources = pgTable("promotion_sources", {
  promotionId: varchar("promotion_id").primaryKey(),
  logoData: text("logo_data"),
  logoContentType: text("logo_content_type"),
  logoSourceUrl: text("logo_source_url"),
  youtubeChannelId: text("youtube_channel_id"),
  videoId: text("video_id"),
  videoTitle: text("video_title"),
  videoPublishedAt: timestamp("video_published_at"),
  fetchedAt: timestamp("fetched_at"),
  error: text("error"),
});

/**
 * The loop's event stream.
 *
 * Separate from `project_analytics_events`, which is a creator-managed list of
 * metric definitions rather than telemetry — conflating the two is how the
 * spec's numbers ended up unmeasurable while a table called "analytics" sat
 * there looking like it held them.
 *
 * Append-only and deliberately narrow. `sessionId` is what links a composer
 * opening to the check-in it produced, which is the only way time-to-post can
 * be computed at all.
 */
export const loopEvents = pgTable("loop_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** A `check_in.*` event name from the retired loop instrumentation. */
  name: text("name").notNull(),
  /** Null for events from someone who isn't signed in. */
  userId: varchar("user_id").references(() => users.id),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  checkInId: varchar("check_in_id"),
  /** Correlates `started` with `submitted` for one composing session. */
  sessionId: varchar("session_id"),
  /** Anything a specific metric needs and nothing more. */
  props: jsonb("props").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Games arena

export const gameLeaderboard = pgTable("game_leaderboard", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gameType: text("game_type", { enum: ["typing", "signal"] }).notNull(),
  userId: varchar("user_id").notNull().references(() => users.id),
  score: integer("score").notNull().default(0),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tacticsGames = pgTable("tactics_games", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  status: text("status", { enum: ["waiting", "discussion", "resolving", "completed"] }).notNull().default("waiting"),
  mapSize: integer("map_size").notNull().default(8),
  mapData: jsonb("map_data").default({}),
  currentRound: integer("current_round").notNull().default(0),
  maxRounds: integer("max_rounds").notNull().default(10),
  winnerId: text("winner_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tacticsPlayers = pgTable("tactics_players", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gameId: varchar("game_id").notNull().references(() => tacticsGames.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  teamId: integer("team_id").notNull(),
  role: text("role", { enum: ["commander", "warrior", "strategist", "scout", "engineer"] }).notNull(),
  health: integer("health").notNull().default(100),
  position: jsonb("position").default({ x: 0, y: 0 }),
  resources: integer("resources").notNull().default(50),
  isAlive: boolean("is_alive").notNull().default(true),
  buffs: jsonb("buffs").default([]),
});

export const tacticsMoves = pgTable("tactics_moves", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gameId: varchar("game_id").notNull().references(() => tacticsGames.id),
  round: integer("round").notNull(),
  playerId: varchar("player_id").notNull().references(() => tacticsPlayers.id),
  actionType: text("action_type", { enum: ["move", "attack", "ability", "defend"] }).notNull(),
  targetPosition: jsonb("target_position"),
  targetPlayerId: varchar("target_player_id"),
  resolved: boolean("resolved").notNull().default(false),
  result: jsonb("result"),
});

export const typingRaces = pgTable("typing_races", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  status: text("status", { enum: ["waiting", "countdown", "active", "finished"] }).notNull().default("waiting"),
  promptText: text("prompt_text").notNull(),
  promptCategory: text("prompt_category").notNull(),
  maxPlayers: integer("max_players").notNull().default(6),
  startedAt: timestamp("started_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const typingRacePlayers = pgTable("typing_race_players", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  raceId: varchar("race_id").notNull().references(() => typingRaces.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  wpm: integer("wpm").default(0),
  accuracy: integer("accuracy").default(100),
  progress: integer("progress").default(0),
  charsTyped: integer("chars_typed").default(0),
  errors: integer("errors").default(0),
  finishTimeMs: integer("finish_time_ms"),
  status: text("status", { enum: ["waiting", "racing", "finished", "dnf"] }).notNull().default("waiting"),
  score: integer("score").default(0),
});

export const signalNoiseGames = pgTable("signal_noise_games", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  scenario: text("scenario").notNull(),
  difficulty: text("difficulty", { enum: ["beginner", "intermediate", "advanced"] }).notNull().default("intermediate"),
  cards: jsonb("cards").default([]),
  decisions: jsonb("decisions").default([]),
  score: integer("score").default(0),
  streak: integer("streak").default(0),
  accuracy: integer("accuracy").default(0),
  avgReactionMs: integer("avg_reaction_ms").default(0),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Schemas
export const insertUserProfileSchema = createInsertSchema(userProfiles).omit({
  id: true,
});

/**
 * The plain object schema, for partial updates. `.partial()` only exists on a
 * ZodObject, and the pair check below turns the full schema into a ZodEffects
 * — so an update validates its fields here and checks the (goal, subcategory)
 * pair against the merged row itself, where both halves are known.
 */
export const insertProjectBase = createInsertSchema(projects).omit({
  id: true,
  views: true,
  totalDonations: true,
  createdAt: true,
  // Sealed; set only through its own route, never by a plain project patch.
  dataSource: true,
  // Generated images; set by POST /api/projects/:id/visuals, never patched in.
  profileVisuals: true,
  // Chosen on the path, and opened from the investment settings — each through its own route.
  capitalRoute: true,
  investmentOpen: true,
  investmentAsk: true,
}).extend({
  // Re-required here: the column's DB default is for backfill, not for
  // letting a new project skip the question.
  // errorMap rather than required_error/invalid_type_error: those cover a
  // missing or wrongly-typed value, and a *wrong* value ("get_rich") still got
  // zod's stock "Invalid enum value. Expected …". One sentence for all three.
  goal: z.enum(PROJECT_GOAL_IDS, {
    errorMap: () => ({ message: "Pick a goal: ship an MVP, systemize a business, or run a company." }),
  }),
  subcategory: z.string({ required_error: "Pick what kind of project it is for that goal.", invalid_type_error: "Pick what kind of project it is for that goal." }).min(1, "Pick what kind of project it is for that goal."),
});

export const insertProjectSchema = insertProjectBase.superRefine((v, ctx) => {
  // The pair, not the id: "other" is valid everywhere, "restaurant" only when
  // systemizing. Validating the id alone would let a mismatched pair through.
  if (!isValidSubcategory(v.goal, v.subcategory)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["subcategory"],
      message: `"${v.subcategory}" isn't one of the kinds of project for that goal — pick one from its list.`,
    });
  }
});

export const insertProjectMemberSchema = createInsertSchema(projectMembers).omit({
  id: true,
});

export const insertProjectChatMessageSchema = createInsertSchema(projectChatMessages).omit({
  id: true,
  createdAt: true,
});

export const insertDonationSchema = createInsertSchema(donations).omit({
  id: true,
  createdAt: true,
});

export const insertBackingCampaignSchema = createInsertSchema(projectBackingCampaigns).omit({
  id: true,
  createdAt: true,
  believerCount: true,
  reviewedAt: true,
  reviewedById: true,
});

export const insertBackerTierSchema = createInsertSchema(projectBackerTiers).omit({
  id: true,
  createdAt: true,
});

export const insertBackingSchema = createInsertSchema(projectBackings).omit({
  id: true,
  createdAt: true,
  believerNumber: true,
});

export const insertMerchOrderSchema = createInsertSchema(projectMerchOrders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserMatchSchema = createInsertSchema(userMatches).omit({
  id: true,
  createdAt: true,
});

export const insertBadgeSchema = createInsertSchema(badges).omit({
  id: true,
});

export const insertUserBadgeSchema = createInsertSchema(userBadges).omit({
  id: true,
  awardedAt: true,
});

export const insertContestSchema = createInsertSchema(contests).omit({
  id: true,
  createdAt: true,
});

export const insertContestParticipantSchema = createInsertSchema(contestParticipants).omit({
  id: true,
  joinedAt: true,
});

export const insertConnectionSchema = createInsertSchema(connections).omit({
  id: true,
  createdAt: true,
});

export const insertDirectMessageSchema = createInsertSchema(directMessages).omit({
  id: true,
  createdAt: true,
});

export const insertProjectApplicationSchema = createInsertSchema(projectApplications).omit({
  id: true,
  createdAt: true,
});

export const insertProjectFollowSchema = createInsertSchema(projectFollows).omit({
  id: true,
  createdAt: true,
});

export const insertProjectKanbanTaskSchema = createInsertSchema(projectKanbanTasks).omit({
  id: true,
  createdAt: true,
});

export const insertProjectPersonaSchema = createInsertSchema(projectPersonas).omit({
  id: true,
  createdAt: true,
});

export const insertProjectMilestoneSchema = createInsertSchema(projectMilestones).omit({
  id: true,
  createdAt: true,
});

export const insertProjectRoadmapSchema = createInsertSchema(projectRoadmaps).omit({
  id: true, createdAt: true, lastUpdatedAt: true, version: true,
});
export const insertRoadmapPhaseSchema = createInsertSchema(roadmapPhases).omit({ id: true, createdAt: true });
export const insertProjectHealthCheckSchema = createInsertSchema(projectHealthChecks).omit({ id: true, createdAt: true });
export const insertHealthFindingFeedbackSchema = createInsertSchema(healthFindingFeedback).omit({ id: true, createdAt: true });
export const insertProjectTaskCompletionSchema = createInsertSchema(projectTaskCompletions).omit({ id: true });
export const insertProjectDocumentSchema = createInsertSchema(projectDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export const insertProjectCodeAuditSchema = createInsertSchema(projectCodeAudits).omit({ id: true, createdAt: true });
export const insertProjectStoryboardSchema = createInsertSchema(projectStoryboards).omit({ id: true, createdAt: true });
export const insertInvestorArtifactSchema = createInsertSchema(investorArtifacts).omit({ id: true, createdAt: true });
export const insertMockInterviewSchema = createInsertSchema(mockInterviews).omit({ id: true, createdAt: true });
export const insertMockInterviewTurnSchema = createInsertSchema(mockInterviewTurns).omit({ id: true, createdAt: true });
export const insertProjectCommentSchema = createInsertSchema(projectComments).omit({
  id: true, createdAt: true, reactionCount: true,
});
export const insertFeedPostSchema = createInsertSchema(feedPosts).omit({
  id: true, createdAt: true, reactionCount: true, commentCount: true, editedAt: true,
});
export const insertFeedCommentSchema = createInsertSchema(feedComments).omit({ id: true, createdAt: true });

export const insertProjectActivityLogSchema = createInsertSchema(projectActivityLog).omit({
  id: true,
  createdAt: true,
});

export const insertProjectDecisionSchema = createInsertSchema(projectDecisions).omit({
  id: true,
  createdAt: true,
});

export const insertProjectFileSchema = createInsertSchema(projectFiles).omit({
  id: true,
  createdAt: true,
});

export const insertProjectLinkSchema = createInsertSchema(projectLinks).omit({
  id: true,
  createdAt: true,
});

export const insertProjectLiveChatMessageSchema = createInsertSchema(projectLiveChatMessages).omit({
  id: true,
  createdAt: true,
});

// PM Extended insert schemas
export const insertWaitlistEntrySchema = createInsertSchema(projectWaitlistEntries).omit({ id: true, createdAt: true });
export const insertInterviewSchema = createInsertSchema(projectInterviews).omit({ id: true, createdAt: true });
export const insertExperimentSchema = createInsertSchema(projectExperiments).omit({ id: true, createdAt: true });
export const insertPricingTierSchema = createInsertSchema(projectPricingTiers).omit({ id: true, createdAt: true });
export const insertAnalyticsEventSchema = createInsertSchema(projectAnalyticsEvents).omit({ id: true, createdAt: true });
export const insertLegalDocSchema = createInsertSchema(projectLegalDocs).omit({ id: true, createdAt: true });
export const insertDeployChecklistItemSchema = createInsertSchema(projectDeployChecklistItems).omit({ id: true, createdAt: true });
export const insertSupportTicketSchema = createInsertSchema(projectSupportTickets).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLaunchTaskSchema = createInsertSchema(projectLaunchTasks).omit({ id: true, createdAt: true });

export const insertNovaGuideMessageSchema = createInsertSchema(novaGuideMessages).omit({ id: true, createdAt: true });

export const userReputationScores = pgTable("user_reputation_scores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id).unique(),
  executionScore: integer("execution_score").default(0).notNull(),
  contributionScore: integer("contribution_score").default(0).notNull(),
  marketSignalScore: integer("market_signal_score").default(0).notNull(),
  strategicThinkingScore: integer("strategic_thinking_score").default(0).notNull(),
  builderIndex: integer("builder_index").default(0).notNull(),
  details: jsonb("details"),
  /**
   * The two parts that are worked out on their own clocks, kept here so the
   * hourly pass can fold them in without paying for them again: how the
   * builder's companies did in the simulation (daily), and Nova's reading of
   * how they are going about it (weekly). Null until each has first run.
   */
  simScore: integer("sim_score"),
  simScoredAt: timestamp("sim_scored_at"),
  aiScore: integer("ai_score"),
  aiScoredAt: timestamp("ai_scored_at"),
  /** One line from Nova on what it saw, shown under the strategy pillar. */
  aiSummary: text("ai_summary"),
  lastCalculatedAt: timestamp("last_calculated_at").defaultNow().notNull(),
}, (table) => ({
  /** The hourly sweep takes the stalest rows first, so it reads this in order. */
  byCalculated: index("user_reputation_last_calculated_idx").on(table.lastCalculatedAt),
}));

export const insertUserReputationSchema = createInsertSchema(userReputationScores).omit({ id: true, lastCalculatedAt: true });

// Co-Founder Sprint Tables
export const cofounderSprints = pgTable("cofounder_sprints", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  user1Id: varchar("user1_id").notNull().references(() => users.id),
  user2Id: varchar("user2_id").notNull().references(() => users.id),
  duration: text("duration", { enum: ["24h", "72h"] }).notNull(),
  /**
   * `abandoned` is an ending, not a stage: it means somebody left, and the
   * sprint stops there. It is deliberately not a stage in the sequence — a
   * sprint never advances *into* it, and nothing advances out of it.
   */
  status: text("status", { enum: ["setup", "ideation", "alignment", "building", "validation", "review", "completed", "abandoned"] }).default("setup").notNull(),
  productStyle: text("product_style", { enum: ["past", "modern", "futuristic"] }),
  productName: text("product_name"),
  productDescription: text("product_description"),
  user1ProposedName: text("user1_proposed_name"),
  user2ProposedName: text("user2_proposed_name"),
  isPractice: boolean("is_practice").default(false).notNull(),
  /** Set when the sprint is working on an existing project rather than a new idea. */
  sourceProjectId: varchar("source_project_id").references(() => projects.id, { onDelete: "cascade" }),
  agreedProblem: text("agreed_problem"),
  agreedIcp: text("agreed_icp"),
  agreedValueProp: text("agreed_value_prop"),
  validationQuestions: jsonb("validation_questions"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  /**
   * Who left, when, and — if they said — why.
   *
   * Kept rather than deleting the sprint: the other person spent hours in it,
   * and a sprint that vanishes reads as a bug rather than as someone leaving.
   * `abandonedById` is also what lets the remaining partner be told which of
   * them it was, without inferring it from a status alone.
   */
  abandonedAt: timestamp("abandoned_at"),
  abandonedById: varchar("abandoned_by_id").references(() => users.id),
  abandonReason: text("abandon_reason"),
});

export const sprintResponses = pgTable("sprint_responses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sprintId: varchar("sprint_id").notNull().references(() => cofounderSprints.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  questionKey: text("question_key").notNull(),
  answer: text("answer").notNull(),
  /** True when Nova answered as the practice partner. See sprintMessages.isNova. */
  isNova: boolean("is_nova").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sprintDeliverables = pgTable("sprint_deliverables", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sprintId: varchar("sprint_id").notNull().references(() => cofounderSprints.id),
  type: text("type").notNull(),
  content: jsonb("content").notNull(),
  userId: varchar("user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sprintRatings = pgTable("sprint_ratings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sprintId: varchar("sprint_id").notNull().references(() => cofounderSprints.id),
  raterId: varchar("rater_id").notNull().references(() => users.id),
  rateeId: varchar("ratee_id").notNull().references(() => users.id),
  communicationClarity: integer("communication_clarity").notNull(),
  reliability: integer("reliability").notNull(),
  wouldBuildLongTerm: boolean("would_build_long_term").notNull(),
  stressLevel: integer("stress_level").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sprintDecisions = pgTable("sprint_decisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sprintId: varchar("sprint_id").notNull().references(() => cofounderSprints.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  decision: text("decision", { enum: ["pivot", "proceed", "kill"] }).notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sprintMessages = pgTable("sprint_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sprintId: varchar("sprint_id").notNull().references(() => cofounderSprints.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  content: text("content").notNull(),
  /**
   * True when Nova wrote this as the practice partner. userId still points at
   * the human (the column is NOT NULL and practice sprints have no second
   * user), so this flag is what distinguishes the two speakers.
   */
  isNova: boolean("is_nova").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sprintKanbanTasks = pgTable("sprint_kanban_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sprintId: varchar("sprint_id").notNull().references(() => cofounderSprints.id),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status", { enum: ["todo", "in-progress", "done"] }).default("todo").notNull(),
  assigneeId: varchar("assignee_id").references(() => users.id),
  order: integer("order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sprintBehavioralMetrics = pgTable("sprint_behavioral_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sprintId: varchar("sprint_id").notNull().references(() => cofounderSprints.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  avgResponseTimeMinutes: integer("avg_response_time_minutes").default(0),
  tasksCompleted: integer("tasks_completed").default(0),
  totalTasks: integer("total_tasks").default(0),
  initiativeScore: integer("initiative_score").default(0),
  deadlinesRespected: integer("deadlines_respected").default(0),
  deadlinesTotal: integer("deadlines_total").default(0),
  conflictMarkers: integer("conflict_markers").default(0),
  decisionLatencyMinutes: integer("decision_latency_minutes").default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const sprintCompatibilityReports = pgTable("sprint_compatibility_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sprintId: varchar("sprint_id").notNull().references(() => cofounderSprints.id).unique(),
  overallScore: integer("overall_score").default(0).notNull(),
  strengths: jsonb("strengths").default([]),
  risks: jsonb("risks").default([]),
  recommendation: text("recommendation"),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
});

export const sprintMatchmakingQueue = pgTable("sprint_matchmaking_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id).unique(),
  duration: text("duration", { enum: ["24h", "72h"] }).notNull(),
  productStyle: text("product_style", { enum: ["past", "modern", "futuristic"] }),
  /**
   * "waiting" until paired. On a match BOTH rows flip to "matched" with the
   * new sprint id, rather than being deleted — otherwise the partner who
   * didn't initiate has no way to learn which sprint they were put into.
   */
  status: text("status", { enum: ["waiting", "matched"] }).default("waiting").notNull(),
  matchedSprintId: varchar("matched_sprint_id"),
  /**
   * Optional project the builder wants to sprint on, so the sprint works on
   * something real instead of a throwaway idea.
   */
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  /** Bumped by the client heartbeat; stale rows are swept. */
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  /*
   * Named by hand rather than left to `.references()`. The name drizzle would
   * generate — sprint_matchmaking_queue_matched_sprint_id_cofounder_sprints_id_fk
   * — is 66 characters, and Postgres silently truncates identifiers at 63,
   * cutting off the "_fk". Drizzle then can't find the constraint it just
   * created and drops and re-adds it on every single push.
   */
  matchedSprintFk: foreignKey({
    columns: [table.matchedSprintId],
    foreignColumns: [cofounderSprints.id],
    name: "sprint_matchmaking_queue_matched_sprint_fk",
  }),
}));

/* ── Ten Years From Now: the startup game ────────────────────────────────── */

/**
 * One game of Ten Years From Now.
 *
 * Two strangers get half an hour to invent a startup, and then a model says
 * what it thinks the thing is worth in a decade. It replaces the questionnaire
 * sprint, which asked people to type paragraphs into boxes alone — a
 * reasonable set of questions and a poor thing to do with another person.
 *
 * Kept separate from `cofounder_sprints` rather than bolted onto it. That
 * table's columns are the questionnaire's shape (`agreed_problem`,
 * `validation_questions`) and its status enum is the questionnaire's phases;
 * reusing it would mean every column on both being nullable and neither game
 * being readable from the schema. A row here is a whole game.
 *
 * The decisions live on the game rather than in the submissions table because
 * they are what the game *is*: a settled customer is a fact about this
 * company, and reconstructing it by replaying votes every time somebody opens
 * the screen would be a second source of truth waiting to disagree.
 */
export const startupGames = pgTable("startup_games", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  player1Id: varchar("player1_id").notNull().references(() => users.id),
  player2Id: varchar("player2_id").notNull().references(() => users.id),
  /**
   * Which round is open. `verdict` is the result screen; `abandoned` is an
   * ending rather than a stage, and nothing advances out of it.
   */
  round: text("round", { enum: ["idea", "customer", "model", "product", "spend", "verdict", "abandoned"] })
    .default("idea").notNull(),
  /** When the open round stops waiting and settles itself. */
  roundEndsAt: timestamp("round_ends_at"),
  /** past | modern | futuristic — the flavour both players' ideas are drawn in. */
  era: text("era", { enum: ["past", "modern", "futuristic"] }),

  /* What they settled on, round by round. Null until that round closes. */
  /** The chosen idea, whole: name, pitch, the twist. */
  idea: jsonb("idea"),
  /** Card id, plus the label, so a custom card survives the deck changing. */
  customerCardId: varchar("customer_card_id"),
  customerLabel: text("customer_label"),
  modelCardId: varchar("model_card_id"),
  modelLabel: text("model_label"),
  /** Up to ten ways it beats what exists, each flagged core or not. */
  productClaims: jsonb("product_claims"),
  /** The committed allocation of the million: option id → dollars. */
  budget: jsonb("budget"),
  /**
   * How each round ended — agreed, coin, unopposed or nobody — keyed by round.
   *
   * Stored because the screen has to be able to say "the coin went your
   * partner's way". A player whose pick vanished with no explanation writes in
   * to complain; one who is told they lost a toss does not.
   */
  settledBy: jsonb("settled_by"),

  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  abandonedAt: timestamp("abandoned_at"),
  abandonedById: varchar("abandoned_by_id").references(() => users.id),
}, (table) => ({
  byPlayer1: index("startup_games_player1_idx").on(table.player1Id, table.round),
  byPlayer2: index("startup_games_player2_idx").on(table.player2Id, table.round),
  /** The sweep that settles rounds nobody is watching reads exactly this. */
  byDeadline: index("startup_games_deadline_idx").on(table.round, table.roundEndsAt),
}));

/**
 * What one player put forward in one round, before it settled.
 *
 * Kept after the round closes rather than deleted. The results screen is much
 * better for being able to say what each of you wanted — "you both said night
 * nurses" and "you wanted the marketplace" are the sentences that make this
 * feel like something you did together rather than a form that produced a
 * number.
 */
export const startupGameSubmissions = pgTable("startup_game_submissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gameId: varchar("game_id").notNull().references(() => startupGames.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  round: text("round").notNull(),
  /** Whatever that round collects: an idea, a card id, claims, an allocation. */
  payload: jsonb("payload").notNull(),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
}, (table) => ({
  /** One standing submission per player per round; changing your mind replaces it. */
  once: unique("startup_game_submissions_once").on(table.gameId, table.userId, table.round),
}));

// ─── Companies ───────────────────────────────────────────────────────────────

/**
 * An existing business with an account of its own.
 *
 * Distinct from a project. A project is something being built; a company is an
 * organisation that already exists, has people, and comes here for things only
 * a company needs: private simulation seasons to train its staff, a way to find
 * people who have shown commercial judgement, challenges it sponsors, and
 * startups it wants to keep an eye on. A company can also run itself on the
 * "Run a company" path, through a project it owns (`projectId`).
 */
export const companies = pgTable("companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  website: text("website"),
  industry: text("industry"),
  size: text("size"),
  description: text("description"),
  /** The project it runs itself through, on the Run a company path, if any. */
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  /*
   * Who did it, for the record — and only for the record. Set null, not
   * cascade, when that account goes: one person closing their account must
   * never take the company's work with it while its other people remain.
   */
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  /**
   * Which generation of invite links is valid. Every link carries the number
   * it was made under; raising it (a leader's "reset invite links", and every
   * removal) makes every earlier link stop working at once.
   */
  inviteKeyVersion: integer("invite_key_version").default(0).notNull(),
  createdAt: timestamp("created_at").notNull(),
}, (t) => ({
  bySlug: unique("companies_slug").on(t.slug),
}));
export type Company = typeof companies.$inferSelect;

/** Who acts for a company. An owner can do anything; an admin everything but delete it; a member can see and join. */
export const companyMembers = pgTable("company_members", {
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["owner", "admin", "member"] }).notNull(),
  /**
   * Powers given to this member on top of what their role carries — see
   * COMPANY_PERMISSIONS in shared/companies.ts. Owners and admins hold every
   * power by virtue of the role; a member holds only what is listed here, so
   * a leader can let one person run training seasons and another post for the
   * company without making either of them an admin.
   */
  permissions: text("permissions").array().default(sql`'{}'::text[]`).notNull(),
  joinedAt: timestamp("joined_at").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.companyId, t.userId] }),
  byUser: index("company_members_user_idx").on(t.userId),
}));

/**
 * A person who has said companies may look at their record and approach them.
 *
 * Opt-in, and off by default. A season records how somebody decided in a seat
 * under pressure — that is exactly what makes it valuable to an employer, and
 * exactly why it must never be shown to one without the person choosing it.
 */
export const talentProfiles = pgTable("talent_profiles", {
  userId: varchar("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  open: boolean("open").default(false).notNull(),
  headline: text("headline"),
  /** Roles they would take: "operations", "finance", "product", "sales", "general management"… */
  roles: text("roles").array(),
  location: text("location"),
  remote: boolean("remote").default(true).notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

/** A company asking somebody to talk. One per company per person; the person answers yes or no. */
export const recruitInvites = pgTable("recruit_invites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Who at the company sent it. Set null if their account goes; the invite is the company's. */
  sentBy: varchar("sent_by").references(() => users.id, { onDelete: "set null" }),
  role: text("role"),
  message: text("message").notNull(),
  status: text("status", { enum: ["sent", "accepted", "declined"] }).default("sent").notNull(),
  createdAt: timestamp("created_at").notNull(),
  answeredAt: timestamp("answered_at"),
}, (t) => ({
  once: unique("recruit_invites_once").on(t.companyId, t.userId),
  byUser: index("recruit_invites_user_idx").on(t.userId),
}));

/**
 * A real problem a company puts up, for founders to answer.
 *
 * The prize is stated, not held: no money moves through SparkTower. The
 * company pays its winners directly under its own terms, which entrants accept
 * when they enter — the same stance the investor introductions take.
 */
export const companyChallenges = pgTable("company_challenges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  brief: text("brief").notNull(),
  /** What a good answer looks like — how entries are judged. */
  criteria: text("criteria"),
  prize: text("prize"),
  /** The company's own terms for the challenge, which an entrant accepts to enter. */
  terms: text("terms"),
  industry: text("industry"),
  deadline: timestamp("deadline").notNull(),
  status: text("status", { enum: ["open", "judging", "closed"] }).default("open").notNull(),
  /*
   * Who did it, for the record — and only for the record. Set null, not
   * cascade, when that account goes: one person closing their account must
   * never take the company's work with it while its other people remain.
   */
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull(),
}, (t) => ({
  byStatus: index("company_challenges_status_idx").on(t.status, t.deadline),
}));

export const challengeEntries = pgTable("challenge_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  challengeId: varchar("challenge_id").notNull().references(() => companyChallenges.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** The project the answer is built in, if it is one. */
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  pitch: text("pitch").notNull(),
  link: text("link"),
  status: text("status", { enum: ["entered", "shortlisted", "winner", "withdrawn"] }).default("entered").notNull(),
  /** A line of feedback from the company, which the entrant sees. */
  feedback: text("feedback"),
  createdAt: timestamp("created_at").notNull(),
}, (t) => ({
  once: unique("challenge_entries_once").on(t.challengeId, t.userId),
}));

/**
 * Everything done to a company's people and powers, and by whom.
 *
 * Leaders can add, remove and empower people freely, which is the point — and
 * exactly why it is written down. "Who removed Sam, and when" should never be
 * a matter of memory.
 */
export const companyAuditLog = pgTable("company_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  actorId: varchar("actor_id").references(() => users.id, { onDelete: "set null" }),
  /** "member_added", "member_removed", "role_changed", "permissions_changed", "post_published", … */
  action: text("action").notNull(),
  targetUserId: varchar("target_user_id").references(() => users.id, { onDelete: "set null" }),
  detail: jsonb("detail"),
  createdAt: timestamp("created_at").notNull(),
}, (t) => ({
  byCompany: index("company_audit_log_company_idx").on(t.companyId, t.createdAt),
}));

/** Startups a company is keeping an eye on. */
export const companyFollows = pgTable("company_follows", {
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  note: text("note"),
  /** Who followed it. Set null if their account goes; the company still follows the project. */
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.companyId, t.projectId] }),
  byProject: index("company_follows_project_idx").on(t.projectId),
}));

/** Industries a company watches for new projects. */
export const companyWatches = pgTable("company_watches", {
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  industry: text("industry").notNull(),
  createdAt: timestamp("created_at").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.companyId, t.industry] }),
}));

// ─── The company rhythm (the Run a company path) ─────────────────────────────

/**
 * One week's check-in on a project running the Run a company path.
 *
 * `weekOf` is the Monday of the week, as YYYY-MM-DD text rather than a
 * timestamp, so "which week is this" never depends on a timezone.
 */
export const projectCheckins = pgTable("project_checkins", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  weekOf: text("week_of").notNull(),
  /** metric id → value, for the numbers the company watches. */
  numbers: jsonb("numbers").notNull(),
  wentRight: text("went_right"),
  wentWrong: text("went_wrong"),
  /** Nova's answer: what changed, and the one thing worth doing about it. */
  reply: text("reply"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}, (t) => ({
  once: unique("project_checkins_week").on(t.projectId, t.weekOf),
}));

/** A job that comes round every week, fortnight or month, with somebody's name on it. */
export const recurringJobs = pgTable("recurring_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  notes: text("notes"),
  every: text("every", { enum: ["week", "fortnight", "month"] }).notNull(),
  ownerId: varchar("owner_id").references(() => users.id, { onDelete: "set null" }),
  backupId: varchar("backup_id").references(() => users.id, { onDelete: "set null" }),
  /** YYYY-MM-DD, for the same reason `weekOf` is. */
  nextDue: text("next_due").notNull(),
  /**
   * For a monthly job, the day of the month it belongs on. Without it a job
   * due on the 31st was moved to the 28th by February and stayed there; with
   * it, each month lands on the anchor day or the month's last day if shorter.
   */
  anchorDay: integer("anchor_day"),
  /** The due date a reminder was last sent for, so each occurrence is announced once. */
  remindedFor: text("reminded_for"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").notNull(),
}, (t) => ({
  byProject: index("recurring_jobs_project_idx").on(t.projectId),
}));

/**
 * How a company on the Run path keeps its rhythm: which day the weekly
 * check-in happens and who is reminded. One row per project.
 */
export const rhythmSettings = pgTable("rhythm_settings", {
  projectId: varchar("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  /** 0 = Monday … 6 = Sunday. The day the check-in is due, and the reminder goes out. */
  checkinDay: integer("checkin_day").default(0).notNull(),
  /** Who is reminded; empty means every project member. */
  remindUserIds: text("remind_user_ids").array().default(sql`'{}'::text[]`).notNull(),
  /** The week a check-in reminder was last sent for. */
  remindedWeek: text("reminded_week"),
  updatedAt: timestamp("updated_at").notNull(),
});

/**
 * The quarter's goals (RUN.S4.3), tracked against the numbers the weekly
 * check-ins record rather than ticked by hand.
 */
export const quarterGoals = pgTable("quarter_goals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  /** "2026-Q3". */
  quarter: text("quarter").notNull(),
  title: text("title").notNull(),
  /** A check-in metric id the goal is measured by, or null for a goal ticked by hand. */
  metricId: text("metric_id"),
  /** The value that means done, and whether above or below it is good. */
  target: real("target"),
  direction: text("direction", { enum: ["up", "down"] }),
  ownerId: varchar("owner_id").references(() => users.id, { onDelete: "set null" }),
  status: text("status", { enum: ["active", "done", "dropped"] }).default("active").notNull(),
  createdAt: timestamp("created_at").notNull(),
}, (t) => ({
  byProject: index("quarter_goals_project_idx").on(t.projectId, t.quarter),
}));

/** Every time a recurring job was done, and whether it was on time — what the monthly report counts. */
export const recurringJobRuns = pgTable("recurring_job_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull().references(() => recurringJobs.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  dueOn: text("due_on").notNull(),
  doneOn: text("done_on").notNull(),
  doneBy: varchar("done_by").references(() => users.id, { onDelete: "set null" }),
  onTime: boolean("on_time").notNull(),
  createdAt: timestamp("created_at").notNull(),
}, (t) => ({
  once: unique("recurring_job_runs_once").on(t.jobId, t.dueOn),
  byProject: index("recurring_job_runs_project_idx").on(t.projectId, t.doneOn),
}));

/**
 * One "What would it take?" roadmap: a company's route from where it is to
 * $1m, $100m, $1bn or $50bn a year.
 *
 * Every run is kept, not just the latest. The point of the feature is that a
 * company runs it again in six months and sees whether the gap moved, and that
 * comparison is only possible because each row carries `grounding` — the
 * revenue, the week and the check-in count the roadmap was built from. A row
 * that stored only the answer would leave "is this better than last time?"
 * unanswerable, which is the question that makes it worth coming back to.
 *
 * `generated_at` is a zoneless timestamp holding UTC, written from JS.
 */
export const whatWouldItTakeRoadmaps = pgTable("what_would_it_take_roadmaps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  /** One of shared/what-would-it-take.ts's target ids: m1, m100, b1, b50. */
  target: text("target").notNull(),
  /** The numbers it was built from (WwitGrounding). */
  grounding: jsonb("grounding").notNull(),
  /** The roadmap itself (WwitRoadmapBody), plus the computed gap. */
  roadmap: jsonb("roadmap").notNull(),
  /** Kept for the comparison view, so "how big was the gap then" needs no re-derivation. */
  annualRevenue: real("annual_revenue"),
  /** Who ran it. Set null if their account goes; the company keeps its roadmap. */
  generatedBy: varchar("generated_by").references(() => users.id, { onDelete: "set null" }),
  generatedAt: timestamp("generated_at").notNull(),
}, (t) => ({
  /** Every read is "this project's runs for this target, newest first". */
  byTarget: index("wwit_project_target_idx").on(t.projectId, t.target, t.generatedAt),
}));

/**
 * What a player has typed and not yet put forward.
 *
 * Kept apart from submissions on purpose. A submission is a decision — against
 * a bot partner it closes a pick round the moment it lands — so saving a
 * half-written idea as one would commit it before the person had finished.
 * A draft is only ever read when the round's clock runs out and that player
 * never submitted: then it stands in for them.
 *
 * Without it, the clock running out threw away everything on the screen that
 * had not been sent. A player halfway through writing their company's name,
 * tagline and pitch found the game had moved on to a company with no name and
 * no description, because the only copy of their work was in their browser.
 */
export const startupGameDrafts = pgTable("startup_game_drafts", {
  gameId: varchar("game_id").notNull().references(() => startupGames.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  round: text("round").notNull(),
  payload: jsonb("payload").notNull(),
  savedAt: timestamp("saved_at").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.gameId, table.userId, table.round] }),
}));

/** The argument. A round is settled by picking; this is where it gets decided. */
export const startupGameMessages = pgTable("startup_game_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gameId: varchar("game_id").notNull().references(() => startupGames.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Which round it was said in, so the transcript reads as the game did. */
  round: text("round").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  byGame: index("startup_game_messages_game_idx").on(table.gameId, table.createdAt),
}));

/**
 * What the model made of it.
 *
 * One row per game, written once. The five scores are 0–1000 and are what the
 * leaderboards rank; `risk` is the one where lower is better, which the
 * dimension list in @shared/sprints/scoring owns so that nothing sorts it by
 * guessing.
 *
 * The valuations are stored in whole dollars as `bigint` — a ten-year
 * valuation of a few hundred billion overflows a 32-bit integer, and finding
 * that out in production is a poor way to find it out.
 */
export const startupGameVerdicts = pgTable("startup_game_verdicts", {
  gameId: varchar("game_id").primaryKey().references(() => startupGames.id, { onDelete: "cascade" }),
  growth: integer("growth").notNull(),
  capital: integer("capital").notNull(),
  product: integer("product").notNull(),
  acquisition: integer("acquisition").notNull(),
  /** Higher means riskier. The board is "lowest risk" and sorts ascending. */
  risk: integer("risk").notNull(),
  /** Mean of the five with risk inverted, so every board points the same way. */
  overall: integer("overall").notNull(),
  tenYear: bigint("ten_year", { mode: "number" }).notNull(),
  peak: bigint("peak", { mode: "number" }).notNull(),
  peakYear: integer("peak_year").notNull(),
  summary: text("summary").notNull(),
  notes: jsonb("notes"),
  advice: jsonb("advice"),
  /**
   * False when the model could not be reached and the verdict is the honest
   * fallback rather than a judgement. The screen says so; the leaderboard
   * leaves these out, because a placeholder that ranks is a lie.
   */
  fromModel: boolean("from_model").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  /** Every leaderboard is this index, read five ways. */
  byOverall: index("startup_game_verdicts_overall_idx").on(table.overall),
}));

export const insertStartupGameSchema = createInsertSchema(startupGames).omit({ id: true, startedAt: true });
export type StartupGame = typeof startupGames.$inferSelect;
export type StartupGameSubmission = typeof startupGameSubmissions.$inferSelect;
export type StartupGameMessage = typeof startupGameMessages.$inferSelect;
export type StartupGameVerdict = typeof startupGameVerdicts.$inferSelect;

// Sprint insert schemas
export const insertCofounderSprintSchema = createInsertSchema(cofounderSprints).omit({ id: true, createdAt: true });
export const insertSprintResponseSchema = createInsertSchema(sprintResponses).omit({ id: true, createdAt: true });
export const insertSprintDeliverableSchema = createInsertSchema(sprintDeliverables).omit({ id: true, createdAt: true });
export const insertSprintRatingSchema = createInsertSchema(sprintRatings).omit({ id: true, createdAt: true });
export const insertSprintDecisionSchema = createInsertSchema(sprintDecisions).omit({ id: true, createdAt: true });
export const insertSprintMessageSchema = createInsertSchema(sprintMessages).omit({ id: true, createdAt: true });
export const insertSprintKanbanTaskSchema = createInsertSchema(sprintKanbanTasks).omit({ id: true, createdAt: true });
export const insertSprintBehavioralMetricsSchema = createInsertSchema(sprintBehavioralMetrics).omit({ id: true, updatedAt: true });
export const insertSprintCompatibilityReportSchema = createInsertSchema(sprintCompatibilityReports).omit({ id: true, generatedAt: true });

// Types
export type UserProfile = typeof userProfiles.$inferSelect;
export type InsertUserProfile = z.infer<typeof insertUserProfileSchema>;
export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type InsertProjectMember = z.infer<typeof insertProjectMemberSchema>;
export type Donation = typeof donations.$inferSelect;
export type InsertDonation = z.infer<typeof insertDonationSchema>;

export type BackingCampaign = typeof projectBackingCampaigns.$inferSelect;
export type InsertBackingCampaign = z.infer<typeof insertBackingCampaignSchema>;
export type BackerTier = typeof projectBackerTiers.$inferSelect;
export type InsertBackerTier = z.infer<typeof insertBackerTierSchema>;
export type Backing = typeof projectBackings.$inferSelect;
export type InsertBacking = z.infer<typeof insertBackingSchema>;
export type MerchOrder = typeof projectMerchOrders.$inferSelect;
export type InsertMerchOrder = z.infer<typeof insertMerchOrderSchema>;
export type BackerBadge = typeof backerBadges.$inferSelect;
export type UserMatch = typeof userMatches.$inferSelect;
export type InsertUserMatch = z.infer<typeof insertUserMatchSchema>;
export type Badge = typeof badges.$inferSelect;
export type InsertBadge = z.infer<typeof insertBadgeSchema>;
export type UserBadge = typeof userBadges.$inferSelect;
export type InsertUserBadge = z.infer<typeof insertUserBadgeSchema>;
export type Contest = typeof contests.$inferSelect;
export type InsertContest = z.infer<typeof insertContestSchema>;
export type ContestParticipant = typeof contestParticipants.$inferSelect;
export type InsertContestParticipant = z.infer<typeof insertContestParticipantSchema>;
export type Connection = typeof connections.$inferSelect;
export type InsertConnection = z.infer<typeof insertConnectionSchema>;
export type DirectMessage = typeof directMessages.$inferSelect;
export type InsertDirectMessage = z.infer<typeof insertDirectMessageSchema>;
export type ProjectApplication = typeof projectApplications.$inferSelect;
export type InsertProjectApplication = z.infer<typeof insertProjectApplicationSchema>;
export type ProjectFollow = typeof projectFollows.$inferSelect;
export type InsertProjectFollow = z.infer<typeof insertProjectFollowSchema>;
export type ProjectKanbanTask = typeof projectKanbanTasks.$inferSelect;
export type UserTaskStats = typeof userTaskStats.$inferSelect;
export type InsertProjectKanbanTask = z.infer<typeof insertProjectKanbanTaskSchema>;
export type ProjectPersona = typeof projectPersonas.$inferSelect;
export type InsertProjectPersona = z.infer<typeof insertProjectPersonaSchema>;
export type ProjectRoadmap = typeof projectRoadmaps.$inferSelect;
export type InsertProjectRoadmap = z.infer<typeof insertProjectRoadmapSchema>;
export type RoadmapPhase = typeof roadmapPhases.$inferSelect;
export type InsertRoadmapPhase = z.infer<typeof insertRoadmapPhaseSchema>;
export type ProjectHealthCheck = typeof projectHealthChecks.$inferSelect;
export type InsertProjectHealthCheck = z.infer<typeof insertProjectHealthCheckSchema>;
export type ProjectCodeAudit = typeof projectCodeAudits.$inferSelect;
export type InsertProjectCodeAudit = z.infer<typeof insertProjectCodeAuditSchema>;
export type ProjectDocument = typeof projectDocuments.$inferSelect;
export type InsertProjectDocument = z.infer<typeof insertProjectDocumentSchema>;
export type ProjectTaskCompletion = typeof projectTaskCompletions.$inferSelect;
export type InsertProjectTaskCompletion = z.infer<typeof insertProjectTaskCompletionSchema>;
export type HealthFindingFeedback = typeof healthFindingFeedback.$inferSelect;
export type InsertHealthFindingFeedback = z.infer<typeof insertHealthFindingFeedbackSchema>;
export type ProjectStoryboard = typeof projectStoryboards.$inferSelect;
export type InsertProjectStoryboard = z.infer<typeof insertProjectStoryboardSchema>;
export type InvestorArtifact = typeof investorArtifacts.$inferSelect;
export type InsertInvestorArtifact = z.infer<typeof insertInvestorArtifactSchema>;
export type MockInterview = typeof mockInterviews.$inferSelect;
export type InsertMockInterview = z.infer<typeof insertMockInterviewSchema>;
export type MockInterviewTurn = typeof mockInterviewTurns.$inferSelect;
export type InsertMockInterviewTurn = z.infer<typeof insertMockInterviewTurnSchema>;
export type ProjectComment = typeof projectComments.$inferSelect;
export type InsertProjectComment = z.infer<typeof insertProjectCommentSchema>;
export type FeedPost = typeof feedPosts.$inferSelect;
export type InsertFeedPost = z.infer<typeof insertFeedPostSchema>;
export type FeedComment = typeof feedComments.$inferSelect;
export type InsertFeedComment = z.infer<typeof insertFeedCommentSchema>;
export type FeedReactionRow = typeof feedReactions.$inferSelect;
export type ProjectMilestone = typeof projectMilestones.$inferSelect;
export type InsertProjectMilestone = z.infer<typeof insertProjectMilestoneSchema>;
export type ProjectActivityLog = typeof projectActivityLog.$inferSelect;
export type InsertProjectActivityLog = z.infer<typeof insertProjectActivityLogSchema>;
export type ProjectDecision = typeof projectDecisions.$inferSelect;
export type InsertProjectDecision = z.infer<typeof insertProjectDecisionSchema>;
export type ProjectFile = typeof projectFiles.$inferSelect;
export type InsertProjectFile = z.infer<typeof insertProjectFileSchema>;
export type ProjectLink = typeof projectLinks.$inferSelect;
export type InsertProjectLink = z.infer<typeof insertProjectLinkSchema>;
export type ProjectChatMessage = typeof projectChatMessages.$inferSelect;
export type InsertProjectChatMessage = z.infer<typeof insertProjectChatMessageSchema>;
export type ProjectLiveChatMessage = typeof projectLiveChatMessages.$inferSelect;
export type InsertProjectLiveChatMessage = z.infer<typeof insertProjectLiveChatMessageSchema>;
export type WaitlistEntry = typeof projectWaitlistEntries.$inferSelect;
export type InsertWaitlistEntry = z.infer<typeof insertWaitlistEntrySchema>;
export type ProjectInterview = typeof projectInterviews.$inferSelect;
export type InsertProjectInterview = z.infer<typeof insertInterviewSchema>;
export type ProjectExperiment = typeof projectExperiments.$inferSelect;
export type InsertProjectExperiment = z.infer<typeof insertExperimentSchema>;
export type PricingTier = typeof projectPricingTiers.$inferSelect;
export type InsertPricingTier = z.infer<typeof insertPricingTierSchema>;
export type AnalyticsEvent = typeof projectAnalyticsEvents.$inferSelect;
export type InsertAnalyticsEvent = z.infer<typeof insertAnalyticsEventSchema>;
export type LegalDoc = typeof projectLegalDocs.$inferSelect;
export type InsertLegalDoc = z.infer<typeof insertLegalDocSchema>;
export type DeployChecklistItem = typeof projectDeployChecklistItems.$inferSelect;
export type InsertDeployChecklistItem = z.infer<typeof insertDeployChecklistItemSchema>;
export type SupportTicket = typeof projectSupportTickets.$inferSelect;
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type LaunchTask = typeof projectLaunchTasks.$inferSelect;
export type InsertLaunchTask = z.infer<typeof insertLaunchTaskSchema>;
export type NovaGuideMessage = typeof novaGuideMessages.$inferSelect;
export type InsertNovaGuideMessage = z.infer<typeof insertNovaGuideMessageSchema>;
export type UserReputation = typeof userReputationScores.$inferSelect;
export type InsertUserReputation = z.infer<typeof insertUserReputationSchema>;
export type CofounderSprint = typeof cofounderSprints.$inferSelect;
export type InsertCofounderSprint = z.infer<typeof insertCofounderSprintSchema>;
export type SprintResponse = typeof sprintResponses.$inferSelect;
export type InsertSprintResponse = z.infer<typeof insertSprintResponseSchema>;
export type SprintDeliverable = typeof sprintDeliverables.$inferSelect;
export type InsertSprintDeliverable = z.infer<typeof insertSprintDeliverableSchema>;
export type SprintRating = typeof sprintRatings.$inferSelect;
export type InsertSprintRating = z.infer<typeof insertSprintRatingSchema>;
export type SprintDecision = typeof sprintDecisions.$inferSelect;
export type InsertSprintDecision = z.infer<typeof insertSprintDecisionSchema>;
export type SprintMessage = typeof sprintMessages.$inferSelect;
export type InsertSprintMessage = z.infer<typeof insertSprintMessageSchema>;
export type SprintKanbanTask = typeof sprintKanbanTasks.$inferSelect;
export type InsertSprintKanbanTask = z.infer<typeof insertSprintKanbanTaskSchema>;
export type SprintBehavioralMetrics = typeof sprintBehavioralMetrics.$inferSelect;
export type InsertSprintBehavioralMetrics = z.infer<typeof insertSprintBehavioralMetricsSchema>;
export type SprintCompatibilityReport = typeof sprintCompatibilityReports.$inferSelect;
export type InsertSprintCompatibilityReport = z.infer<typeof insertSprintCompatibilityReportSchema>;
export type SprintMatchmakingQueueEntry = typeof sprintMatchmakingQueue.$inferSelect;

/* ── Market simulation: seasons, ventures and the lobby ──────────────────── */

/**
 * A run of the market simulation: one niche, fourteen days, one day per
 * simulated year.
 *
 * A season is the unit everything else hangs off, and it is per-niche because
 * the whole point of the game is competing against the other teams in your
 * market. Two ventures in different niches never meet.
 */
export const simSeasons = pgTable("sim_seasons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Which market — an id from @shared/simulation/niches. */
  nicheId: varchar("niche_id").notNull(),
  name: text("name").notNull(),
  status: text("status", { enum: ["forming", "running", "finished", "abandoned"] }).default("forming").notNull(),
  /** 1-based. The year the next tick will resolve. */
  year: integer("year").default(1).notNull(),
  totalYears: integer("total_years").default(14).notNull(),
  /** When the next year resolves. One day apart in a real season, minutes in a test one. */
  nextTickAt: timestamp("next_tick_at"),
  /**
   * The engine's World after the last resolved year: incumbents, economy,
   * every company, whole.
   *
   * The season owns this rather than the ventures, because a year is resolved
   * for everyone at once — the players' customers are the ones the incumbents
   * did not keep. Split across five rows it would be five half-truths that can
   * disagree; here there is one state, written once per tick.
   */
  world: jsonb("world"),
  startsAt: timestamp("starts_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /**
   * A private season a company runs for its own people — leadership training,
   * a workshop, an away day. Null for the public seasons everyone else joins.
   *
   * A private season is invisible to matchmaking: joining a market never lands
   * a stranger in one, and its rooms are reached only with `inviteCode`.
   */
  companyId: varchar("company_id"),
  inviteCode: text("invite_code"),
  /**
   * How long a year lasts, in minutes, when it isn't a real day. A public
   * season is one year a day because people play it over a fortnight; a
   * company running one in an afternoon workshop needs it to move while the
   * room is still there. Null means a day. The company can also resolve the
   * year early — see server/company-season-routes.ts.
   */
  yearMinutes: integer("year_minutes"),
  /**
   * How much of the world this season plays on: "home" for the market's own
   * regions, "world" for the whole map, or a continent's id for that continent
   * alone (see shared/simulation/geography.ts).
   *
   * Every public season is "home", which is the game as it has always been.
   * A company running its own season can widen it, because "where in the world
   * do we go next" is the question a company season is for.
   */
  scope: text("scope").default("home").notNull(),
  /**
   * How many companies to fill the season with, run entirely by bots.
   *
   * A season with one real team in it is a company with no competition, which
   * teaches the wrong lesson about every decision in it. Rather than wait for
   * nine other tables to exist, a company can seat them.
   */
  botTeams: integer("bot_teams").default(0).notNull(),
}, (table) => ({
  byStatus: index("sim_seasons_status_idx").on(table.status, table.nicheId),
  byInvite: unique("sim_seasons_invite_code").on(table.inviteCode),
}));

/**
 * One company, run by up to five people.
 *
 * `state` is the world's view of this company between ticks — the shape in
 * @shared/simulation/types. It is stored whole rather than as columns because
 * the engine owns its meaning: a column per score would be two definitions of
 * the same thing, and the one in the database would quietly go stale.
 */
export const simVentures = pgTable("sim_ventures", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  seasonId: varchar("season_id").notNull().references(() => simSeasons.id, { onDelete: "cascade" }),
  /** Null until the CEO names it — naming is the CEO's, and the lobby waits for it. */
  name: text("name"),
  /** What they've decided to sell. The CEO's call, with the table shouting. */
  product: text("product"),
  /**
   * Where this venture is in the lobby.
   *
   * filling → claiming → naming → running. Each step has a deadline, because a
   * lobby with no clock is a lobby where one absent person holds four others
   * hostage.
   */
  phase: text("phase", { enum: ["filling", "claiming", "naming", "running", "retired"] }).default("filling").notNull(),
  /**
   * A company with nobody in it: every chair a bot, seated to fill out a
   * season that would otherwise have one table in it and no competition.
   *
   * Distinct from a room where bots took the seats nobody claimed — that room
   * has a person in it, and the bots are colleagues. This one is a rival.
   */
  botOnly: boolean("bot_only").default(false).notNull(),
  /** When the current phase stops waiting and resolves itself. */
  phaseEndsAt: timestamp("phase_ends_at"),
  /** The engine's Company for this venture, after the last resolved year. */
  state: jsonb("state"),
  /**
   * When the room left the lobby and sat waiting for its season to start.
   *
   * Public matchmaking reads this to stop sending newcomers into a season one
   * of whose rooms has been ready for a while: every new room pushes year one
   * back for the rooms already waiting, and without a limit a steady trickle
   * of joiners could keep a season from ever starting. Null for rooms that
   * reached `running` before this was recorded; readers fall back to
   * `createdAt`, which is earlier and so errs towards closing the season.
   */
  runningSince: timestamp("running_since"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  bySeason: index("sim_ventures_season_idx").on(table.seasonId, table.phase),
}));

/**
 * A seat at a table.
 *
 * The unique indexes are the feature, not bookkeeping. Five people claim five
 * seats at the same moment on five phones, and the database is the only place
 * that can settle it: one row per (venture, role) means a second CEO is a
 * constraint violation rather than a race nobody notices until the season is
 * running. One row per (venture, user) means nobody quietly holds two seats.
 *
 * `role` is null between joining and claiming — a person in the room who
 * hasn't taken a seat yet is a real state, and the one the whole lobby screen
 * is about.
 */
export const simSeats = pgTable("sim_seats", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ventureId: varchar("venture_id").notNull().references(() => simVentures.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** ceo | cmo | cfo | cto | coo, or null while they're still arguing about it. */
  role: varchar("role"),
  /** Set when the lobby's clock ran out and the seat was assigned rather than chosen. */
  assigned: boolean("assigned").default(false).notNull(),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
  claimedAt: timestamp("claimed_at"),
}, (table) => ({
  /** One person, one seat. */
  onePerPerson: unique("sim_seats_venture_user").on(table.ventureId, table.userId),
  /**
   * One person per role — the constraint the whole lobby rests on.
   *
   * Postgres treats NULLs as distinct, which is exactly what is wanted here:
   * any number of people can be sitting in the room without a seat, and the
   * moment two of them reach for "ceo" the second one is a unique violation
   * rather than a second chief executive nobody notices until the season runs.
   */
  oneRolePerVenture: unique("sim_seats_venture_role").on(table.ventureId, table.role),
  bySeat: index("sim_seats_venture_idx").on(table.ventureId),
}));

/** What each seat decided in a given year — the input to the engine's tick. */
export const simDecisions = pgTable("sim_decisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ventureId: varchar("venture_id").notNull().references(() => simVentures.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: varchar("role").notNull(),
  year: integer("year").notNull(),
  /** The role's decision object from @shared/simulation/decisions. */
  payload: jsonb("payload").notNull(),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
}, (table) => ({
  /** One submission per seat per year; a later one replaces it rather than stacking. */
  once: unique("sim_decisions_once").on(table.ventureId, table.role, table.year),
}));

/**
 * One person's objective for one year.
 *
 * Stored rather than recomputed on read, even though `challengeFor` is
 * deterministic: the challenge is written against the company's position at
 * the moment it was set, and that position changes the instant the year
 * resolves. Recomputed later it would quietly become a different challenge,
 * and a player would be marked against a target they were never shown.
 */
export const simChallenges = pgTable("sim_challenges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ventureId: varchar("venture_id").notNull().references(() => simVentures.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: varchar("role").notNull(),
  year: integer("year").notNull(),
  /** The Challenge from @shared/simulation/challenges, as it was set. */
  challenge: jsonb("challenge").notNull(),
  /** The ChallengeResult, once the year has run. Null while it is still being played. */
  result: jsonb("result"),
  outcome: text("outcome", { enum: ["met", "partial", "missed"] }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  /** One challenge per seat per year. */
  once: unique("sim_challenges_once").on(table.ventureId, table.role, table.year),
  byPerson: index("sim_challenges_user_idx").on(table.userId, table.year),
}));

/**
 * Something a team has put up for sale.
 *
 * The open market's listings are generated deterministically from the season
 * and year and are not stored — they are the same for everyone and can always
 * be recomputed. These are the ones that only exist because a team decided to
 * sell, so there is nothing to derive them from.
 */
export const simListings = pgTable("sim_listings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  seasonId: varchar("season_id").notNull().references(() => simSeasons.id, { onDelete: "cascade" }),
  /** The venture selling it. */
  sellerId: varchar("seller_id").notNull().references(() => simVentures.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  /** The CompanyAsset being sold, whole. */
  asset: jsonb("asset").notNull(),
  reserve: integer("reserve").notNull(),
  /**
   * Put on the market by a fire sale rather than by the seller's choice.
   *
   * The company was paid for these at the forced price when the fire sale ran
   * and no longer owns them, so this listing is the market's copy of something
   * already sold: settlement must not look for it in the seller's assets (it
   * is not there, and never will be) and must not pay the seller a second
   * time when somebody buys it. The seller is kept as `sellerId` so the lot
   * can say whose collapse it came from.
   */
  forced: boolean("forced").default(false).notNull(),
  status: text("status", { enum: ["open", "sold", "unsold", "withdrawn"] }).default("open").notNull(),
  buyerId: varchar("buyer_id").references(() => simVentures.id, { onDelete: "set null" }),
  soldFor: integer("sold_for"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  bySeason: index("sim_listings_season_idx").on(table.seasonId, table.year, table.status),
}));

/**
 * A sealed bid.
 *
 * Sealed is the whole point: nobody sees anyone else's number until the tick
 * resolves them, which is what makes the marketplace a judgement about what a
 * thing is worth to you rather than a race to press a button first.
 */
export const simBids = pgTable("sim_bids", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ventureId: varchar("venture_id").notNull().references(() => simVentures.id, { onDelete: "cascade" }),
  /** Either a generated market listing id or a row in sim_listings. */
  listingId: varchar("listing_id").notNull(),
  year: integer("year").notNull(),
  amount: integer("amount").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  /** One bid per venture per listing — a team bids once, and may revise it. */
  once: unique("sim_bids_once").on(table.ventureId, table.listingId, table.year),
}));

/**
 * One team's offer to buy another.
 *
 * An offer lives for one year. If the other team has not answered by the time
 * the year resolves it lapses, which is deliberate: an offer that sat open
 * indefinitely would let a buyer tie up a rival's decision-making for a
 * fortnight at no cost, and the answer to "do you want to sell" changes every
 * time the market does.
 */
export const simOffers = pgTable("sim_offers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  seasonId: varchar("season_id").notNull().references(() => simSeasons.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  fromVentureId: varchar("from_venture_id").notNull().references(() => simVentures.id, { onDelete: "cascade" }),
  toVentureId: varchar("to_venture_id").notNull().references(() => simVentures.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  /** A note from the buyer, because this is a negotiation between people. */
  message: text("message"),
  status: text("status", { enum: ["pending", "accepted", "declined", "lapsed", "withdrawn"] })
    .default("pending").notNull(),
  respondedById: varchar("responded_by_id").references(() => users.id, { onDelete: "set null" }),
  respondedAt: timestamp("responded_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  /** One live offer from a buyer to a target in a year. */
  once: unique("sim_offers_once").on(table.fromVentureId, table.toVentureId, table.year),
  byTarget: index("sim_offers_target_idx").on(table.toVentureId, table.status),
}));

/** A recovery move a team has committed to, applied at the start of the next tick. */
export const simRecoveryMoves = pgTable("sim_recovery_moves", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ventureId: varchar("venture_id").notNull().references(() => simVentures.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  kind: text("kind", { enum: ["restructure", "fire_sale", "dissolve_seat", "rescue_raise"] }).notNull(),
  /** Which seat, for dissolve_seat. */
  seat: varchar("seat"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  /** One move per year. These are not decisions you take several of at once. */
  once: unique("sim_recovery_once").on(table.ventureId, table.year),
}));

/** What the engine said happened, kept so a season can be read back year by year. */
export const simReports = pgTable("sim_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  seasonId: varchar("season_id").notNull().references(() => simSeasons.id, { onDelete: "cascade" }),
  /** Null for the AI-run incumbents, which have no venture behind them. */
  ventureId: varchar("venture_id").references(() => simVentures.id, { onDelete: "cascade" }),
  companyId: varchar("company_id").notNull(),
  year: integer("year").notNull(),
  report: jsonb("report").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  bySeasonYear: index("sim_reports_season_year_idx").on(table.seasonId, table.year),
  /**
   * One report per company per year, enforced rather than assumed.
   *
   * The tick is built to be safely re-runnable — a process that dies between
   * writing reports and advancing the year must be able to pick the year up
   * again — and this is what makes re-running it harmless instead of a season
   * with two conflicting accounts of year six.
   */
  once: unique("sim_reports_once").on(table.seasonId, table.companyId, table.year),
}));
