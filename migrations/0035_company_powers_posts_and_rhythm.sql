CREATE TABLE "company_audit_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"actor_id" varchar,
	"action" text NOT NULL,
	"target_user_id" varchar,
	"detail" jsonb,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quarter_goals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"quarter" text NOT NULL,
	"title" text NOT NULL,
	"metric_id" text,
	"target" real,
	"direction" text,
	"owner_id" varchar,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rhythm_settings" (
	"project_id" varchar PRIMARY KEY NOT NULL,
	"checkin_day" integer DEFAULT 0 NOT NULL,
	"remind_user_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"reminded_week" text,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_members" ADD COLUMN "permissions" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "feed_posts" ADD COLUMN "company_id" varchar;--> statement-breakpoint
ALTER TABLE "recurring_jobs" ADD COLUMN "anchor_day" integer;--> statement-breakpoint
ALTER TABLE "recurring_jobs" ADD COLUMN "reminded_for" text;--> statement-breakpoint
ALTER TABLE "company_audit_log" ADD CONSTRAINT "company_audit_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_audit_log" ADD CONSTRAINT "company_audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_audit_log" ADD CONSTRAINT "company_audit_log_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarter_goals" ADD CONSTRAINT "quarter_goals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarter_goals" ADD CONSTRAINT "quarter_goals_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rhythm_settings" ADD CONSTRAINT "rhythm_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_audit_log_company_idx" ON "company_audit_log" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "quarter_goals_project_idx" ON "quarter_goals" USING btree ("project_id","quarter");--> statement-breakpoint
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;