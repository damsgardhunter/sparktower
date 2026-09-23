-- A season's clock is measured in periods, not years.
--
-- A period is a year, a quarter or a month depending on the season's cadence,
-- and how much real time the table gets to answer is a separate thing from how
-- much simulated time passes. For a yearly season a period *is* a year, so
-- every existing value keeps exactly the meaning it had.
ALTER TABLE "sim_seasons" RENAME COLUMN "year_minutes" TO "period_minutes";
