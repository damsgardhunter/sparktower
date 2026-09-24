-- A marketing scheme for a product that already exists, and Nova's read of it.
--
-- The simulator could answer "what if I spend £1,000 a month on marketing" and
-- had nothing to say about whether the plan behind the budget was any good —
-- who it is aimed at, what it offers, how anybody would know it worked. A
-- scheme is scored here, and one worth testing can be run for a year against
-- the business's own numbers.
CREATE TABLE IF NOT EXISTS "marketing_schemes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"author_id" varchar,
	"scheme" text NOT NULL,
	"monthly_budget" integer NOT NULL,
	"months" integer DEFAULT 12 NOT NULL,
	"expected_monthly_return" integer DEFAULT 0 NOT NULL,
	"evaluation" jsonb NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"worth_testing" boolean DEFAULT false NOT NULL,
	"test" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "marketing_schemes" ADD CONSTRAINT "marketing_schemes_project_id_projects_id_fk"
		FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "marketing_schemes" ADD CONSTRAINT "marketing_schemes_author_id_users_id_fk"
		FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_schemes_project_idx" ON "marketing_schemes" USING btree ("project_id","created_at");
