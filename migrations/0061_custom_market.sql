-- A market Nova wrote for one company. The seven hand-made ones stay in code,
-- where they can be rebalanced; this one exists for a single company and has
-- nowhere else to live.
ALTER TABLE "sim_seasons" ADD COLUMN "custom_market" jsonb;
