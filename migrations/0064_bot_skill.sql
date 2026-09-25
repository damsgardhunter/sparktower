-- How well the bot companies in a season play. "filler" is the warm body a
-- season has always had; "survivor" works out what to charge and who to aim at.
ALTER TABLE "sim_seasons" ADD COLUMN "bot_skill" text DEFAULT 'filler' NOT NULL;
