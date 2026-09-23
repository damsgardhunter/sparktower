-- A company is sold once a year, and the database is what says so.
--
-- Accepting an offer was conditional on that offer still being pending, which
-- makes each offer atomic with itself and says nothing about the company. Two
-- offers to the same company are two different rows, so both acceptances
-- matched, both won, and each went on to decline "the other pendings" — by
-- which point neither was pending. The company was paid for twice and handed
-- over once, which is the exact failure the code above that update says was
-- fixed.
--
-- A `not exists (…)` in the WHERE would not close it either: under READ
-- COMMITTED both statements evaluate that subquery against their own snapshot
-- and both find nothing. Only an index makes the second one fail.
CREATE UNIQUE INDEX IF NOT EXISTS "sim_offers_one_sale_per_year"
	ON "sim_offers" ("to_venture_id", "year")
	WHERE "status" = 'accepted';
