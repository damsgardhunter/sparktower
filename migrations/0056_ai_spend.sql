-- What Nova actually spent, per call: the daily ceiling reads it, and so does
-- anyone asking whether a subscription costs more to serve than it sells for.
CREATE TABLE "ai_spend" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"action" varchar NOT NULL,
	"credits" integer NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"model" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "ai_spend_user_idx" ON "ai_spend" ("user_id","created_at");
CREATE INDEX "ai_spend_action_idx" ON "ai_spend" ("user_id","action","created_at");
