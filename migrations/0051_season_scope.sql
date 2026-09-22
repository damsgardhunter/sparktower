ALTER TABLE "sim_seasons" ADD COLUMN "scope" text DEFAULT 'home' NOT NULL;--> statement-breakpoint
ALTER TABLE "sim_seasons" ADD COLUMN "bot_teams" integer DEFAULT 0 NOT NULL;