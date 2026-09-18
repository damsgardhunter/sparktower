CREATE TABLE "sim_offers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" varchar NOT NULL,
	"year" integer NOT NULL,
	"from_venture_id" varchar NOT NULL,
	"to_venture_id" varchar NOT NULL,
	"amount" integer NOT NULL,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"responded_by_id" varchar,
	"responded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sim_offers_once" UNIQUE("from_venture_id","to_venture_id","year")
);
--> statement-breakpoint
ALTER TABLE "sim_offers" ADD CONSTRAINT "sim_offers_season_id_sim_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."sim_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_offers" ADD CONSTRAINT "sim_offers_from_venture_id_sim_ventures_id_fk" FOREIGN KEY ("from_venture_id") REFERENCES "public"."sim_ventures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_offers" ADD CONSTRAINT "sim_offers_to_venture_id_sim_ventures_id_fk" FOREIGN KEY ("to_venture_id") REFERENCES "public"."sim_ventures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_offers" ADD CONSTRAINT "sim_offers_responded_by_id_users_id_fk" FOREIGN KEY ("responded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sim_offers_target_idx" ON "sim_offers" USING btree ("to_venture_id","status");