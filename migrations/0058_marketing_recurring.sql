-- A marketing scheme that knows what a customer pays and how long they stay.
--
-- Without those, every scheme was tested as a campaign: a level of trade held
-- up by a level of spending, falling back when it stops. For anything people
-- subscribe to that is wrong by an order of magnitude — those customers
-- accumulate, and what decides the business is churn rather than budget. It
-- also makes the one checkable dimension checkable: what a customer costs to
-- win against what they are worth before they leave.
ALTER TABLE "marketing_schemes" ADD COLUMN IF NOT EXISTS "price_per_month" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "marketing_schemes" ADD COLUMN IF NOT EXISTS "churn_per_mille" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "marketing_schemes" ADD COLUMN IF NOT EXISTS "new_customers_at_full" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "marketing_schemes" ADD COLUMN IF NOT EXISTS "market_size" integer DEFAULT 0 NOT NULL;
