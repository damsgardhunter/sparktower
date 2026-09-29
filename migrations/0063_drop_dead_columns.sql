-- `sim_ventures.state` was declared with a docstring and never written or read:
-- the engine's world lives on `sim_seasons.world`. A column that has never held
-- anything is easier to drop now than to explain later.
ALTER TABLE "sim_ventures" DROP COLUMN IF EXISTS "state";
