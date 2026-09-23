-- What a credit costs and what a day may cost, where they can be changed by
-- whoever is watching the bill rather than by whoever last deployed.
CREATE TABLE "ai_settings" (
	"id" varchar PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"cost_per_credit_micros" integer NOT NULL,
	"daily_spend_cap_usd" integer NOT NULL,
	"updated_by" varchar REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
