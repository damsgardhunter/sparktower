-- How many times the model has been asked about a game and not answered.
-- Asking once a minute for a day was 1,440 calls for one game.
ALTER TABLE "startup_game_verdicts" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;
