import { pgTable, text, varchar, timestamp, integer, boolean, index, jsonb, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

// Re-exporting from auth models as requested
export { sessions, users, mobileRefreshTokens, type User, type UpsertUser, type MobileRefreshToken } from "./models/auth";
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
  status: text("status", { enum: ["planning", "active", "completed"] }).default("planning").notNull(),
  teamSize: integer("team_size"),
  estimatedWeeks: integer("estimated_weeks"),
  views: integer("views").default(0).notNull(),
  totalDonations: integer("total_donations").default(0).notNull(),
  mediaUrls: varchar("media_urls").array().default([]),
  rolesNeeded: varchar("roles_needed").array().default([]),
  techStack: varchar("tech_stack").array().default([]),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const novaGuideMessages = pgTable("nova_guide_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  actionsTaken: jsonb("actions_taken").default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectMembers = pgTable("project_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  role: text("role").notNull(),
  timezone: text("timezone"),
  availability: text("availability"),
  hoursPerWeek: integer("hours_per_week"),
  skills: varchar("skills").array(),
});

export const donations = pgTable("donations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  donorId: varchar("donor_id").notNull().references(() => users.id),
  amount: integer("amount").notNull(), // in cents
  message: text("message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userMatches = pgTable("user_matches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  matchedUserId: varchar("matched_user_id").notNull().references(() => users.id),
  score: integer("score").notNull(),
  reasons: varchar("reasons").array(),
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
});

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
});

export const connections = pgTable("connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  requesterId: varchar("requester_id").notNull().references(() => users.id),
  receiverId: varchar("receiver_id").notNull().references(() => users.id),
  status: text("status", { enum: ["pending", "accepted", "rejected"] }).default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
  projectId: varchar("project_id").notNull().references(() => projects.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  status: text("status", { enum: ["pending", "accepted", "rejected"] }).default("pending").notNull(),
  resumeUrl: text("resume_url"),
  answers: jsonb("answers").default([]),
  message: text("message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectFollows = pgTable("project_follows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userProjectUnique: unique().on(table.userId, table.projectId),
}));

export const projectKanbanTasks = pgTable("project_kanban_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
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
  projectId: varchar("project_id").notNull().references(() => projects.id),
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
  projectId: varchar("project_id").notNull().references(() => projects.id),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status", { enum: ["planned", "in-progress", "completed"] }).default("planned").notNull(),
  targetDate: timestamp("target_date"),
  order: integer("order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Nova AI Roadmap Builder (Builder tier and above). A roadmap is the plan from
 * "where I am" to "where I want to go", regenerated as the project progresses.
 */
export const projectRoadmaps = pgTable("project_roadmaps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
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
  projectId: varchar("project_id").notNull().references(() => projects.id),
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
export const projectCodeAudits = pgTable("project_code_audits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
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
  projectId: varchar("project_id").notNull().references(() => projects.id),
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
  projectId: varchar("project_id").notNull().references(() => projects.id),
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
  projectId: varchar("project_id").notNull().references(() => projects.id),
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
  projectId: varchar("project_id").notNull().references(() => projects.id),
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
  projectId: varchar("project_id").notNull().references(() => projects.id),
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
  projectId: varchar("project_id").notNull().references(() => projects.id),
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
  projectId: varchar("project_id").notNull().references(() => projects.id),
  authorId: varchar("author_id").notNull().references(() => users.id),
  targetType: text("target_type", { enum: ["milestone", "project", "roadmap_phase"] }).notNull(),
  targetId: varchar("target_id").notNull(),
  content: text("content").notNull(),
  mentions: jsonb("mentions").default([]),
  parentCommentId: varchar("parent_comment_id"),
  reactionCount: integer("reaction_count").default(0).notNull(),
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
  projectId: varchar("project_id").references(() => projects.id),
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
  editedAt: timestamp("edited_at"),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** A user tagged in a post or comment, captured at write time. */
export interface FeedMention {
  userId: string;
  name: string;
}

export const projectActivityLog = pgTable("project_activity_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  userId: varchar("user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectDecisions = pgTable("project_decisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  decision: text("decision").notNull(),
  context: text("context"),
  status: text("status", { enum: ["proposed", "accepted", "revisited"] }).default("proposed").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectCheckIns = pgTable("project_check_ins", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  did: text("did").notNull(),
  doing: text("doing").notNull(),
  blockers: text("blockers"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectFiles = pgTable("project_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
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
  projectId: varchar("project_id").notNull().references(() => projects.id),
  label: text("label").notNull(),
  url: text("url").notNull(),
  category: text("category", { enum: ["repo", "docs", "design", "drive", "notes", "other"] }).default("other").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// === PROJECT CHAT (AI - Nova) ===

export const projectChatMessages = pgTable("project_chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// === PROJECT LIVE CHAT (Team) ===

export const projectLiveChatMessages = pgTable("project_live_chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// === PROJECT MANAGER EXTENDED TABLES ===

export const projectWaitlistEntries = pgTable("project_waitlist_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  email: text("email").notNull(),
  name: text("name"),
  source: text("source"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectInterviews = pgTable("project_interviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
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
  projectId: varchar("project_id").notNull().references(() => projects.id),
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
  projectId: varchar("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  price: integer("price").default(0),
  billingPeriod: text("billing_period").default("monthly"),
  features: jsonb("features").default([]),
  limits: jsonb("limits").default({}),
  isFeatured: boolean("is_featured").default(false),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectAnalyticsEvents = pgTable("project_analytics_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  eventName: text("event_name").notNull(),
  category: text("category").default("activation"),
  description: text("description"),
  trackingStatus: text("tracking_status").default("planned"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectLegalDocs = pgTable("project_legal_docs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  docType: text("doc_type").notNull(),
  title: text("title").notNull(),
  content: text("content"),
  status: text("status").default("draft"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectDeployChecklistItems = pgTable("project_deploy_checklist_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  item: text("item").notNull(),
  category: text("category").default("other"),
  isCompleted: boolean("is_completed").default(false),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectSupportTickets = pgTable("project_support_tickets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
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
  projectId: varchar("project_id").notNull().references(() => projects.id),
  channel: text("channel").notNull(),
  task: text("task").notNull(),
  status: text("status").default("planned"),
  targetDate: timestamp("target_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// === GAME TABLES ===

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

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  views: true,
  totalDonations: true,
  createdAt: true,
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

export const insertProjectCheckInSchema = createInsertSchema(projectCheckIns).omit({
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
  lastCalculatedAt: timestamp("last_calculated_at").defaultNow().notNull(),
});

export const insertUserReputationSchema = createInsertSchema(userReputationScores).omit({ id: true, lastCalculatedAt: true });

// Co-Founder Sprint Tables
export const cofounderSprints = pgTable("cofounder_sprints", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  user1Id: varchar("user1_id").notNull().references(() => users.id),
  user2Id: varchar("user2_id").notNull().references(() => users.id),
  duration: text("duration", { enum: ["24h", "72h"] }).notNull(),
  status: text("status", { enum: ["setup", "ideation", "alignment", "building", "validation", "review", "completed"] }).default("setup").notNull(),
  productStyle: text("product_style", { enum: ["past", "modern", "futuristic"] }),
  productName: text("product_name"),
  productDescription: text("product_description"),
  user1ProposedName: text("user1_proposed_name"),
  user2ProposedName: text("user2_proposed_name"),
  isPractice: boolean("is_practice").default(false).notNull(),
  /** Set when the sprint is working on an existing project rather than a new idea. */
  sourceProjectId: varchar("source_project_id").references(() => projects.id),
  agreedProblem: text("agreed_problem"),
  agreedIcp: text("agreed_icp"),
  agreedValueProp: text("agreed_value_prop"),
  validationQuestions: jsonb("validation_questions"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
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
  matchedSprintId: varchar("matched_sprint_id").references(() => cofounderSprints.id),
  /**
   * Optional project the builder wants to sprint on, so the sprint works on
   * something real instead of a throwaway idea.
   */
  projectId: varchar("project_id").references(() => projects.id),
  /** Bumped by the client heartbeat; stale rows are swept. */
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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

// Game insert schemas
export const insertGameLeaderboardSchema = createInsertSchema(gameLeaderboard).omit({
  id: true,
  createdAt: true,
});

export const insertTacticsGameSchema = createInsertSchema(tacticsGames).omit({
  id: true,
  createdAt: true,
});

export const insertTacticsPlayerSchema = createInsertSchema(tacticsPlayers).omit({
  id: true,
});

export const insertTacticsMoveSchema = createInsertSchema(tacticsMoves).omit({
  id: true,
});

export const insertTypingRaceSchema = createInsertSchema(typingRaces).omit({
  id: true,
  createdAt: true,
});

export const insertTypingRacePlayerSchema = createInsertSchema(typingRacePlayers).omit({
  id: true,
});

export const insertSignalNoiseGameSchema = createInsertSchema(signalNoiseGames).omit({
  id: true,
  createdAt: true,
});

// Types
export type UserProfile = typeof userProfiles.$inferSelect;
export type InsertUserProfile = z.infer<typeof insertUserProfileSchema>;
export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type InsertProjectMember = z.infer<typeof insertProjectMemberSchema>;
export type Donation = typeof donations.$inferSelect;
export type InsertDonation = z.infer<typeof insertDonationSchema>;
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
export type ProjectCheckIn = typeof projectCheckIns.$inferSelect;
export type InsertProjectCheckIn = z.infer<typeof insertProjectCheckInSchema>;
export type ProjectFile = typeof projectFiles.$inferSelect;
export type InsertProjectFile = z.infer<typeof insertProjectFileSchema>;
export type ProjectLink = typeof projectLinks.$inferSelect;
export type InsertProjectLink = z.infer<typeof insertProjectLinkSchema>;
export type ProjectChatMessage = typeof projectChatMessages.$inferSelect;
export type InsertProjectChatMessage = z.infer<typeof insertProjectChatMessageSchema>;
export type ProjectLiveChatMessage = typeof projectLiveChatMessages.$inferSelect;
export type InsertProjectLiveChatMessage = z.infer<typeof insertProjectLiveChatMessageSchema>;
export type GameLeaderboardEntry = typeof gameLeaderboard.$inferSelect;
export type InsertGameLeaderboardEntry = z.infer<typeof insertGameLeaderboardSchema>;
export type TacticsGame = typeof tacticsGames.$inferSelect;
export type InsertTacticsGame = z.infer<typeof insertTacticsGameSchema>;
export type TacticsPlayer = typeof tacticsPlayers.$inferSelect;
export type InsertTacticsPlayer = z.infer<typeof insertTacticsPlayerSchema>;
export type TacticsMove = typeof tacticsMoves.$inferSelect;
export type InsertTacticsMove = z.infer<typeof insertTacticsMoveSchema>;
export type TypingRace = typeof typingRaces.$inferSelect;
export type InsertTypingRace = z.infer<typeof insertTypingRaceSchema>;
export type TypingRacePlayer = typeof typingRacePlayers.$inferSelect;
export type InsertTypingRacePlayer = z.infer<typeof insertTypingRacePlayerSchema>;
export type SignalNoiseGame = typeof signalNoiseGames.$inferSelect;
export type InsertSignalNoiseGame = z.infer<typeof insertSignalNoiseGameSchema>;
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
