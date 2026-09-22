-- Every statement here is written to be safe to run twice.
--
-- Several people are adding migrations to this checkout at the same time, and
-- drizzle-kit generates against one shared snapshot: this file was generated
-- while two other builders' tables (project_operation_applications,
-- user_blocks) were in shared/schema.ts but not yet in a migration of their
-- own, so it carries them too. If one of those builders lands their own
-- migration as well, the two would otherwise collide on whichever ran second
-- and take the whole migration run down with them. IF NOT EXISTS and the DO
-- blocks below make the loser a no-op instead.

CREATE TABLE IF NOT EXISTS "project_operation_applications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"key" text NOT NULL,
	"source" text NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_operation_applications_key_idx" UNIQUE("project_id","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_blocks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blocker_id" varchar NOT NULL,
	"blocked_id" varchar NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_blocker_id_blocked_id_unique" UNIQUE("blocker_id","blocked_id")
);
--> statement-breakpoint
-- A reviewer can now take a project down. See the comment on `projects` in
-- shared/schema.ts: a reported project had no lever but suspending its owner,
-- which blocks writes and unpublishes nothing.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "hidden_at" timestamp;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "hidden_by_id" varchar;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "hidden_reason" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "project_operation_applications" ADD CONSTRAINT "project_operation_applications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "project_operation_applications" ADD CONSTRAINT "project_operation_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_operation_applications_made_idx" ON "project_operation_applications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_blocks_blocked_idx" ON "user_blocks" USING btree ("blocked_id");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "projects" ADD CONSTRAINT "projects_hidden_by_id_users_id_fk" FOREIGN KEY ("hidden_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
-- One entry per person per contest. Joining was a check-then-insert: a double
-- click made two rows, which double-counted entrants and let a contest fill
-- past its own maximum. Duplicates that already exist are collapsed first, so
-- the constraint can actually be created on a live table — the oldest row
-- (the real join) is the one kept.
DELETE FROM "contest_participants" a
	USING "contest_participants" b
	WHERE a."contest_id" = b."contest_id"
	  AND a."user_id" = b."user_id"
	  AND (a."joined_at" > b."joined_at" OR (a."joined_at" = b."joined_at" AND a."id" > b."id"));--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contest_participants" ADD CONSTRAINT "contest_participants_contest_user_unique" UNIQUE("contest_id","user_id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
-- The index behind the one query server/views.ts runs on every anonymous page
-- view: "has this viewer already been counted for this thing in the last 24
-- hours?". Without it that is a sequential scan of the largest table in the
-- database, triggered by an unauthenticated GET that no rate limit could
-- refuse. Partial, because the two view events are a small slice of the
-- behaviour stream and the rest of it must not pay for this index.
CREATE INDEX IF NOT EXISTS "activity_events_view_dedupe_idx"
	ON "activity_events" USING btree ("name", ("props"->>'targetId'), coalesce("user_id", "visitor_id"), "created_at")
	WHERE "name" IN ('project.view', 'profile.view');--> statement-breakpoint
-- Public listings, the leaderboard, Discover and the sitemap all now filter
-- `hidden_at is null`. Partial so it stays tiny: a taken-down project is rare.
CREATE INDEX IF NOT EXISTS "projects_hidden_idx" ON "projects" USING btree ("hidden_at") WHERE "hidden_at" IS NOT NULL;
