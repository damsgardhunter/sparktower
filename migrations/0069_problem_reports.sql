-- "Is there a problem? Report it" — what somebody writes when a screen is
-- broken, and where it stands afterwards.
--
-- Its own table rather than content_reports: that one is about people and
-- posts and ends in moderation, this is about the product and ends in a fix.
-- Sharing would have put a screen that won't load in the same queue as an
-- abuse report, triaged by whoever was on safety duty.
--
-- user_id is nullable and set null on delete: the landing page takes reports
-- too, and a report outlives the account that sent it — the bug does not stop
-- existing because somebody left.
CREATE TABLE IF NOT EXISTS "problem_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"message" text NOT NULL,
	"path" text,
	"user_agent" text,
	"status" text DEFAULT 'new' NOT NULL,
	"note" text,
	"handled_by_id" varchar,
	"handled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "problem_reports" ADD CONSTRAINT "problem_reports_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "problem_reports" ADD CONSTRAINT "problem_reports_handled_by_id_users_id_fk"
		FOREIGN KEY ("handled_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
-- The queue is read newest-first, filtered by status.
CREATE INDEX IF NOT EXISTS "problem_reports_status_idx" ON "problem_reports" USING btree ("status","created_at");
