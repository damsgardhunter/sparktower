-- What a business counts its money in.
--
-- Every figure about the business was written in dollars: a café in Leeds was
-- asked for its turnover in "$100k–$500k" bands and told it had "$22k in the
-- bank". What SparkTower charges stays in dollars, because Stripe takes
-- dollars; this is the owner's own money.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "currency" text DEFAULT 'USD' NOT NULL;
