import { pgTable, text, varchar, timestamp, integer, boolean, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

// Re-exporting from auth models as requested
export { sessions, users, type User, type UpsertUser } from "./models/auth";
import { users } from "./models/auth";

export const userProfiles = pgTable("user_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id).unique(),
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
  techStack: text("tech_stack").array(),
  teamSize: integer("team_size"),
  estimatedWeeks: integer("estimated_weeks"),
  views: integer("views").default(0).notNull(),
  totalDonations: integer("total_donations").default(0).notNull(),
  codeSnippet: text("code_snippet"),
  liveUrl: text("live_url"),
  repoUrl: text("repo_url"),
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
