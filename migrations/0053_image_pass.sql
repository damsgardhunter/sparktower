-- Pictures get their own price.
--
-- An image is the most expensive thing in the product per press, and some
-- routes make five of them in one request, so the dollar day pass — which
-- makes small actions unlimited — would have made images unlimited too. They
-- are split out: the first generation for a project (and for each badge) is
-- free, and after that it is five dollars for a day of them, capped by the
-- hour so that "unlimited" can never mean a script.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "image_pass_until" timestamp;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_image_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"scope" text NOT NULL,
	"scope_id" varchar NOT NULL,
	"images" integer DEFAULT 1 NOT NULL,
	"free" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_image_runs" ADD CONSTRAINT "ai_image_runs_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_image_runs_scope_idx" ON "ai_image_runs" USING btree ("scope","scope_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_image_runs_user_idx" ON "ai_image_runs" USING btree ("user_id","created_at");
