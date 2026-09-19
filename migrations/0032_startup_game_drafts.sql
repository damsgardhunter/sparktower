CREATE TABLE "startup_game_drafts" (
	"game_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"round" text NOT NULL,
	"payload" jsonb NOT NULL,
	"saved_at" timestamp NOT NULL,
	CONSTRAINT "startup_game_drafts_game_id_user_id_round_pk" PRIMARY KEY("game_id","user_id","round")
);
--> statement-breakpoint
ALTER TABLE "startup_game_drafts" ADD CONSTRAINT "startup_game_drafts_game_id_startup_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."startup_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startup_game_drafts" ADD CONSTRAINT "startup_game_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;