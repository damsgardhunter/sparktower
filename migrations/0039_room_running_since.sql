-- When a room left the lobby. Matchmaking stops sending joiners into a forming
-- season once one of its rooms has waited too long for the rest (see /api/sim/join).
ALTER TABLE "sim_ventures" ADD COLUMN "running_since" timestamp;
