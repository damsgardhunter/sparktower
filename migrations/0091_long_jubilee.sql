ALTER TABLE "contests" ADD COLUMN "scored_by" text;--> statement-breakpoint
CREATE INDEX "startup_game_verdicts_created_idx" ON "startup_game_verdicts" USING btree ("created_at");