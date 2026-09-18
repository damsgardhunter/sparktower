CREATE TABLE "sim_bids" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venture_id" varchar NOT NULL,
	"listing_id" varchar NOT NULL,
	"year" integer NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sim_bids_once" UNIQUE("venture_id","listing_id","year")
);
--> statement-breakpoint
CREATE TABLE "sim_challenges" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venture_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"role" varchar NOT NULL,
	"year" integer NOT NULL,
	"challenge" jsonb NOT NULL,
	"result" jsonb,
	"outcome" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sim_challenges_once" UNIQUE("venture_id","role","year")
);
--> statement-breakpoint
CREATE TABLE "sim_listings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" varchar NOT NULL,
	"seller_id" varchar NOT NULL,
	"year" integer NOT NULL,
	"asset" jsonb NOT NULL,
	"reserve" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"buyer_id" varchar,
	"sold_for" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sim_recovery_moves" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venture_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"year" integer NOT NULL,
	"kind" text NOT NULL,
	"seat" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sim_recovery_once" UNIQUE("venture_id","year")
);
--> statement-breakpoint
ALTER TABLE "sim_bids" ADD CONSTRAINT "sim_bids_venture_id_sim_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."sim_ventures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_challenges" ADD CONSTRAINT "sim_challenges_venture_id_sim_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."sim_ventures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_challenges" ADD CONSTRAINT "sim_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_listings" ADD CONSTRAINT "sim_listings_season_id_sim_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."sim_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_listings" ADD CONSTRAINT "sim_listings_seller_id_sim_ventures_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sim_ventures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_listings" ADD CONSTRAINT "sim_listings_buyer_id_sim_ventures_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."sim_ventures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_recovery_moves" ADD CONSTRAINT "sim_recovery_moves_venture_id_sim_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."sim_ventures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_recovery_moves" ADD CONSTRAINT "sim_recovery_moves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sim_challenges_user_idx" ON "sim_challenges" USING btree ("user_id","year");--> statement-breakpoint
CREATE INDEX "sim_listings_season_idx" ON "sim_listings" USING btree ("season_id","year","status");