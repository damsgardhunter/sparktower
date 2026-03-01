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
  skills: text("skills").array(),
  interests: text("interests").array(),
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
  mediaUrls: text("media_urls").array().default([]),
  rolesNeeded: text("roles_needed").array().default([]),
  techStack: text("tech_stack").array().default([]),
  liveUrl: text("live_url"),
  repoUrl: text("repo_url"),
  businessPlanUrl: text("business_plan_url"),
  applicationQuestions: jsonb("application_questions").default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectMembers = pgTable("project_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  role: text("role").notNull(),
});

export const projectChatMessages = pgTable("project_chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
  reasons: text("reasons").array(),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectPersonas = pgTable("project_personas", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  age: integer("age"),
  occupation: text("occupation"),
  bio: text("bio"),
  goals: text("goals").array().default([]),
  painPoints: text("pain_points").array().default([]),
  quote: text("quote"),
  avatarDescription: text("avatar_description"),
  isAiGenerated: boolean("is_ai_generated").default(false).notNull(),
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

// Types
export type UserProfile = typeof userProfiles.$inferSelect;
export type InsertUserProfile = z.infer<typeof insertUserProfileSchema>;
export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type InsertProjectMember = z.infer<typeof insertProjectMemberSchema>;
export type ProjectChatMessage = typeof projectChatMessages.$inferSelect;
export type InsertProjectChatMessage = z.infer<typeof insertProjectChatMessageSchema>;
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
