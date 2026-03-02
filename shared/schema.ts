import { pgTable, text, varchar, timestamp, integer, boolean, index, jsonb, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

// Re-exporting from auth models as requested
export { sessions, users, type User, type UpsertUser } from "./models/auth";
import { users } from "./models/auth";

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
});

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
  valueProposition: text("value_proposition"),
  targetCustomerProfile: text("target_customer_profile"),
  landingPageConfig: jsonb("landing_page_config"),
  novaOnboardingComplete: boolean("nova_onboarding_complete").default(false),
  soloMode: boolean("solo_mode").default(false),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
  gameType: text("game_type", { enum: ["tactics", "typing", "signal"] }).notNull(),
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
export type InsertProjectKanbanTask = z.infer<typeof insertProjectKanbanTaskSchema>;
export type ProjectPersona = typeof projectPersonas.$inferSelect;
export type InsertProjectPersona = z.infer<typeof insertProjectPersonaSchema>;
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
