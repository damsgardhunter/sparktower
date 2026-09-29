-- One run of "Nova builds the whole business", so the work can be watched.
--
-- The build happens outside the request that started it, which means a row it
-- keeps current is the only way anybody — the builder's page, another tab, the
-- phone — can see it happening. Shaped like code_audit_runs down to the stale
-- handling: an unfinished row and a running build look identical from the
-- outside, so the status read stamps a run the server restarted through as
-- over rather than leaving a progress bar turning forever.
CREATE TABLE IF NOT EXISTS "nova_build_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"started_by_id" varchar NOT NULL,
	"stage" text DEFAULT 'starting' NOT NULL,
	"steps_done" integer DEFAULT 0 NOT NULL,
	"steps_total" integer DEFAULT 0 NOT NULL,
	"steps_for_you" integer DEFAULT 0 NOT NULL,
	"current_title" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"error" text
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "nova_build_runs" ADD CONSTRAINT "nova_build_runs_project_id_projects_id_fk"
		FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "nova_build_runs" ADD CONSTRAINT "nova_build_runs_started_by_id_users_id_fk"
		FOREIGN KEY ("started_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nova_build_runs_project_idx" ON "nova_build_runs" USING btree ("project_id","started_at");
