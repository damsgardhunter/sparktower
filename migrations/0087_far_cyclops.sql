ALTER TABLE "sim_seasons" ADD COLUMN "opening" text DEFAULT 'competitive' NOT NULL;--> statement-breakpoint
ALTER TABLE "sim_seasons" ADD COLUMN "opening_standing" jsonb;