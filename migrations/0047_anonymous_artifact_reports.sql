ALTER TABLE "content_reports" ALTER COLUMN "reporter_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "content_reports" ADD COLUMN "reporter_address_hash" varchar;--> statement-breakpoint
-- "One report per reporter per thing" for reports with no account behind them.
-- The existing UNIQUE(reporter_id, target_type, target_id) cannot do it: in SQL
-- one null is never equal to another, so every anonymous row would slip past it
-- and one reader pressing the button twice would be two rows in the queue.
CREATE UNIQUE INDEX IF NOT EXISTS "content_reports_anon_unique"
	ON "content_reports" ("reporter_address_hash", "target_type", "target_id")
	WHERE "reporter_id" IS NULL;
