ALTER TABLE "user_reputation_scores" ADD COLUMN "sim_score" integer;--> statement-breakpoint
ALTER TABLE "user_reputation_scores" ADD COLUMN "sim_scored_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_reputation_scores" ADD COLUMN "ai_score" integer;--> statement-breakpoint
ALTER TABLE "user_reputation_scores" ADD COLUMN "ai_scored_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_reputation_scores" ADD COLUMN "ai_summary" text;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD COLUMN "completed_by_id" varchar;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_reputation_last_calculated_idx" ON "user_reputation_scores" ("last_calculated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_milestones_completed_idx" ON "project_milestones" ("project_id","completed_at");
