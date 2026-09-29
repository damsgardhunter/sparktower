-- How often the table decides: once a year, four times, or twelve. The market
-- and the levers are the same; what changes is how quickly a table can answer.
ALTER TABLE "sim_seasons" ADD COLUMN IF NOT EXISTS "cadence" text DEFAULT 'yearly' NOT NULL;

-- And the seats that buy a faster clock.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "sim_quarterly_seats_paid" integer DEFAULT 0 NOT NULL;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "sim_monthly_seats_paid" integer DEFAULT 0 NOT NULL;

-- The purchase ledger learns the two new seats. A text column with a checked
-- enum in the schema, so nothing to alter here beyond what it already accepts.
