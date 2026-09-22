CREATE TABLE "challenge_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" varchar,
	"title" text NOT NULL,
	"pitch" text NOT NULL,
	"link" text,
	"status" text DEFAULT 'entered' NOT NULL,
	"feedback" text,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "challenge_entries_once" UNIQUE("challenge_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"website" text,
	"industry" text,
	"size" text,
	"description" text,
	"project_id" varchar,
	"created_by" varchar NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "companies_slug" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "company_challenges" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"title" text NOT NULL,
	"brief" text NOT NULL,
	"criteria" text,
	"prize" text,
	"terms" text,
	"industry" text,
	"deadline" timestamp NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_follows" (
	"company_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"note" text,
	"created_by" varchar NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "company_follows_company_id_project_id_pk" PRIMARY KEY("company_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "company_members" (
	"company_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp NOT NULL,
	CONSTRAINT "company_members_company_id_user_id_pk" PRIMARY KEY("company_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "company_watches" (
	"company_id" varchar NOT NULL,
	"industry" text NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "company_watches_company_id_industry_pk" PRIMARY KEY("company_id","industry")
);
--> statement-breakpoint
CREATE TABLE "project_checkins" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"week_of" text NOT NULL,
	"numbers" jsonb NOT NULL,
	"went_right" text,
	"went_wrong" text,
	"reply" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "project_checkins_week" UNIQUE("project_id","week_of")
);
--> statement-breakpoint
CREATE TABLE "recruit_invites" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"sent_by" varchar NOT NULL,
	"role" text,
	"message" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"created_at" timestamp NOT NULL,
	"answered_at" timestamp,
	CONSTRAINT "recruit_invites_once" UNIQUE("company_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "recurring_job_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"due_on" text NOT NULL,
	"done_on" text NOT NULL,
	"done_by" varchar,
	"on_time" boolean NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "recurring_job_runs_once" UNIQUE("job_id","due_on")
);
--> statement-breakpoint
CREATE TABLE "recurring_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"every" text NOT NULL,
	"owner_id" varchar,
	"backup_id" varchar,
	"next_due" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_profiles" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"open" boolean DEFAULT false NOT NULL,
	"headline" text,
	"roles" text[],
	"location" text,
	"remote" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sim_seasons" ADD COLUMN "company_id" varchar;--> statement-breakpoint
ALTER TABLE "sim_seasons" ADD COLUMN "invite_code" text;--> statement-breakpoint
ALTER TABLE "sim_seasons" ADD COLUMN "year_minutes" integer;--> statement-breakpoint
ALTER TABLE "challenge_entries" ADD CONSTRAINT "challenge_entries_challenge_id_company_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."company_challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_entries" ADD CONSTRAINT "challenge_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_entries" ADD CONSTRAINT "challenge_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_challenges" ADD CONSTRAINT "company_challenges_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_challenges" ADD CONSTRAINT "company_challenges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_follows" ADD CONSTRAINT "company_follows_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_follows" ADD CONSTRAINT "company_follows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_follows" ADD CONSTRAINT "company_follows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_watches" ADD CONSTRAINT "company_watches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_checkins" ADD CONSTRAINT "project_checkins_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_checkins" ADD CONSTRAINT "project_checkins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruit_invites" ADD CONSTRAINT "recruit_invites_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruit_invites" ADD CONSTRAINT "recruit_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruit_invites" ADD CONSTRAINT "recruit_invites_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_job_runs" ADD CONSTRAINT "recurring_job_runs_job_id_recurring_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."recurring_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_job_runs" ADD CONSTRAINT "recurring_job_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_job_runs" ADD CONSTRAINT "recurring_job_runs_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_jobs" ADD CONSTRAINT "recurring_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_jobs" ADD CONSTRAINT "recurring_jobs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_jobs" ADD CONSTRAINT "recurring_jobs_backup_id_users_id_fk" FOREIGN KEY ("backup_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD CONSTRAINT "talent_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_challenges_status_idx" ON "company_challenges" USING btree ("status","deadline");--> statement-breakpoint
CREATE INDEX "company_follows_project_idx" ON "company_follows" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "company_members_user_idx" ON "company_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recruit_invites_user_idx" ON "recruit_invites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recurring_job_runs_project_idx" ON "recurring_job_runs" USING btree ("project_id","done_on");--> statement-breakpoint
CREATE INDEX "recurring_jobs_project_idx" ON "recurring_jobs" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "sim_seasons" ADD CONSTRAINT "sim_seasons_invite_code" UNIQUE("invite_code");