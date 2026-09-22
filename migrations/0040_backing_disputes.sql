-- A chargeback on a held pledge freezes that money at Stripe. `disputed_at` marks
-- the pledge while the dispute is open, so payout release and the refund sweep
-- both skip it: paying the creator or refunding the backer from money the bank
-- may take back would pay for one pledge twice.
ALTER TABLE "project_backings" ADD COLUMN "disputed_at" timestamp;
