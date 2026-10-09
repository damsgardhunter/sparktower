-- Hand-corrected. drizzle-kit generated a DROP for
-- "game_play_purchases_user_id_users_id_fk", which has never existed: the table
-- was created by 0057_game_plays.sql, written by hand with an inline
-- `REFERENCES ... ON DELETE CASCADE`, so Postgres named the constraint itself —
-- "game_play_purchases_user_id_fkey". The snapshot assumed drizzle's own
-- convention, so the generated statement failed on any database built from
-- migrations.
--
-- Both names are dropped IF EXISTS, so this applies to a database built from
-- scratch and to one that already carries the other name. The ADD then brings
-- the constraint onto the convention the snapshot expects.
ALTER TABLE "game_play_purchases" DROP CONSTRAINT IF EXISTS "game_play_purchases_user_id_fkey";--> statement-breakpoint
ALTER TABLE "game_play_purchases" DROP CONSTRAINT IF EXISTS "game_play_purchases_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "game_play_purchases" ADD CONSTRAINT "game_play_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
