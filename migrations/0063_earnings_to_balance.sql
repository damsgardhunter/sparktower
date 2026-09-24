-- Where a person's earnings should land, and exact-once crediting for them.
--
-- Releasing backed funds used to demand a Stripe Connect account and refuse
-- outright without one ("The creator has no connected Stripe account", 422),
-- so a creator who had not been through Stripe's identity checks could never
-- be paid at all. `payout_target` lets the money land in their SparkTower
-- balance instead, which needs no bank and no onboarding.
--
-- Anyone who already connected an account keeps being paid to it: the default
-- is the new behaviour, and the backfill preserves the old one for the people
-- who had already chosen it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS payout_target varchar;

-- What a ledger line was for, when it was for something outside Stripe.
--
-- `stripe_session_id` is already the "this external event credited this
-- account once" key, but it means a Checkout session and reconciles against
-- Stripe. A backing settled into a balance has no session, and writing
-- "backing:<uuid>" into a column named for Stripe would mislead whoever next
-- reconciles this table. Same guarantee, its own column: the unique index is
-- what makes a retried release credit somebody once rather than twice.
ALTER TABLE nova_ledger ADD COLUMN IF NOT EXISTS source_key varchar;
CREATE UNIQUE INDEX IF NOT EXISTS nova_ledger_source_key ON nova_ledger (source_key);
