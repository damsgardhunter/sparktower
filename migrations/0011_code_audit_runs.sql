CREATE TABLE "code_audit_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"started_by_id" varchar NOT NULL,
	"source" text NOT NULL,
	"stage" text DEFAULT 'fetching' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"audit_id" varchar,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "access_tokens_revoked_at" timestamp;--> statement-breakpoint
ALTER TABLE "code_audit_runs" ADD CONSTRAINT "code_audit_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_audit_runs" ADD CONSTRAINT "code_audit_runs_started_by_id_users_id_fk" FOREIGN KEY ("started_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "code_audit_runs_project_idx" ON "code_audit_runs" USING btree ("project_id","started_at");