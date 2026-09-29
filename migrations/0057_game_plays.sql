-- The Ten Years valuation is a model call nobody was ever charged for. It stays
-- free once a day; another is a dollar, banked until it is used.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "game_plays_paid" integer DEFAULT 0 NOT NULL;

CREATE TABLE IF NOT EXISTS "game_play_purchases" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"plays" integer NOT NULL,
	"amount" integer NOT NULL,
	"stripe_session_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "game_play_purchases_session" UNIQUE("stripe_session_id")
);
