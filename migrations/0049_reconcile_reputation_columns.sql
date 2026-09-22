-- Where the two lines of work met.
--
-- The company/run/audit work branched from 0032 and grew a chain of its own
-- while the builder-index work added 0033 on main. Both are now in the
-- journal, so on a database that has already run 0033 these columns exist and
-- on one that hasn't they don't — and the same file has to be right either
-- way. Hence the guards: this says "make sure the union is there", not "add
-- these", and it is a no-op wherever the work already landed.

ALTER TABLE "project_milestones" ADD COLUMN IF NOT EXISTS "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD COLUMN IF NOT EXISTS "completed_by_id" varchar;--> statement-breakpoint
ALTER TABLE "user_reputation_scores" ADD COLUMN IF NOT EXISTS "sim_score" integer;--> statement-breakpoint
ALTER TABLE "user_reputation_scores" ADD COLUMN IF NOT EXISTS "sim_scored_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_reputation_scores" ADD COLUMN IF NOT EXISTS "ai_score" integer;--> statement-breakpoint
ALTER TABLE "user_reputation_scores" ADD COLUMN IF NOT EXISTS "ai_scored_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_reputation_scores" ADD COLUMN IF NOT EXISTS "ai_summary" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_milestones_completed_idx" ON "project_milestones" USING btree ("project_id","completed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_reputation_last_calculated_idx" ON "user_reputation_scores" USING btree ("last_calculated_at");