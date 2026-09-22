-- Fire-sold assets are listed under the company that sold them, which no longer
-- owns them. Settlement withdrew every such listing for exactly that reason, so
-- a forced sale never reached a buyer. `forced` marks them, so settlement skips
-- the ownership check and does not pay the seller a second time.
ALTER TABLE "sim_listings" ADD COLUMN "forced" boolean DEFAULT false NOT NULL;
