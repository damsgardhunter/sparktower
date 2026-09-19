CREATE TABLE "startup_game_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"round" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "startup_game_submissions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"round" text NOT NULL,
	"payload" jsonb NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "startup_game_submissions_once" UNIQUE("game_id","user_id","round")
);
--> statement-breakpoint
CREATE TABLE "startup_game_verdicts" (
	"game_id" varchar PRIMARY KEY NOT NULL,
	"growth" integer NOT NULL,
	"capital" integer NOT NULL,
	"product" integer NOT NULL,
	"acquisition" integer NOT NULL,
	"risk" integer NOT NULL,
	"overall" integer NOT NULL,
	"ten_year" bigint NOT NULL,
	"peak" bigint NOT NULL,
	"peak_year" integer NOT NULL,
	"summary" text NOT NULL,
	"notes" jsonb,
	"advice" jsonb,
	"from_model" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "startup_games" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player1_id" varchar NOT NULL,
	"player2_id" varchar NOT NULL,
	"round" text DEFAULT 'idea' NOT NULL,
	"round_ends_at" timestamp,
	"era" text,
	"idea" jsonb,
	"customer_card_id" varchar,
	"customer_label" text,
	"model_card_id" varchar,
	"model_label" text,
	"product_claims" jsonb,
	"budget" jsonb,
	"settled_by" jsonb,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"abandoned_at" timestamp,
	"abandoned_by_id" varchar
);
--> statement-breakpoint
ALTER TABLE "startup_game_messages" ADD CONSTRAINT "startup_game_messages_game_id_startup_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."startup_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startup_game_messages" ADD CONSTRAINT "startup_game_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startup_game_submissions" ADD CONSTRAINT "startup_game_submissions_game_id_startup_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."startup_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startup_game_submissions" ADD CONSTRAINT "startup_game_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startup_game_verdicts" ADD CONSTRAINT "startup_game_verdicts_game_id_startup_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."startup_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startup_games" ADD CONSTRAINT "startup_games_player1_id_users_id_fk" FOREIGN KEY ("player1_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startup_games" ADD CONSTRAINT "startup_games_player2_id_users_id_fk" FOREIGN KEY ("player2_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startup_games" ADD CONSTRAINT "startup_games_abandoned_by_id_users_id_fk" FOREIGN KEY ("abandoned_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "startup_game_messages_game_idx" ON "startup_game_messages" USING btree ("game_id","created_at");--> statement-breakpoint
CREATE INDEX "startup_game_verdicts_overall_idx" ON "startup_game_verdicts" USING btree ("overall");--> statement-breakpoint
CREATE INDEX "startup_games_player1_idx" ON "startup_games" USING btree ("player1_id","round");--> statement-breakpoint
CREATE INDEX "startup_games_player2_idx" ON "startup_games" USING btree ("player2_id","round");--> statement-breakpoint
CREATE INDEX "startup_games_deadline_idx" ON "startup_games" USING btree ("round","round_ends_at");