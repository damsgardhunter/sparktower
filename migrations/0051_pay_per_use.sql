ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "balance_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "day_pass_until" timestamp;--> statement-breakpoint
ALTER TABLE "sim_seasons" ADD COLUMN IF NOT EXISTS "seats_paid" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sim_seasons" ADD COLUMN IF NOT EXISTS "paid_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nova_ledger" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"kind" text NOT NULL,
	"outcome" text,
	"amount_cents" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"stripe_session_id" varchar,
	"note" text,
	"project_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "nova_ledger_stripe_session" UNIQUE("stripe_session_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nova_build_passes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"paid_cents" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "nova_build_passes_user_project" UNIQUE("user_id","project_id")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "nova_ledger" ADD CONSTRAINT "nova_ledger_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "nova_build_passes" ADD CONSTRAINT "nova_build_passes_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nova_ledger_user_idx" ON "nova_ledger" USING btree ("user_id","created_at");
