ALTER TABLE "sim_seasons" ADD COLUMN "world" jsonb;--> statement-breakpoint
ALTER TABLE "sim_reports" ADD CONSTRAINT "sim_reports_once" UNIQUE("season_id","company_id","year");