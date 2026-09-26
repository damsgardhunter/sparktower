-- A season's clock is measured in periods, not years.
--
-- A period is a year, a quarter or a month depending on the season's cadence,
-- and how much real time the table gets to answer is a separate thing from how
-- much simulated time passes. For a yearly season a period *is* a year, so
-- every existing value keeps exactly the meaning it had.
-- Guarded so it can be re-run: a rename has no IF NOT EXISTS form, and this
-- has to be safe against a database that already did it.
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM information_schema.columns
	           WHERE table_name = 'sim_seasons' AND column_name = 'year_minutes')
	AND NOT EXISTS (SELECT 1 FROM information_schema.columns
	                WHERE table_name = 'sim_seasons' AND column_name = 'period_minutes')
	THEN
		ALTER TABLE "sim_seasons" RENAME COLUMN "year_minutes" TO "period_minutes";
	END IF;
END $$;
