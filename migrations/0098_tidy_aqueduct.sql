CREATE TABLE "simulation_season_starts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" varchar NOT NULL,
	"purchase_id" varchar,
	"season_id" varchar NOT NULL,
	"started_by" varchar NOT NULL,
	"invite_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sim_season_starts_season_once" UNIQUE("season_id")
);
--> statement-breakpoint
ALTER TABLE "simulation_season_starts" ADD CONSTRAINT "simulation_season_starts_listing_id_simulation_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."simulation_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_season_starts" ADD CONSTRAINT "simulation_season_starts_purchase_id_simulation_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."simulation_purchases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_season_starts" ADD CONSTRAINT "simulation_season_starts_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sim_season_starts_starter_idx" ON "simulation_season_starts" USING btree ("started_by","created_at");--> statement-breakpoint
CREATE INDEX "sim_season_starts_listing_idx" ON "simulation_season_starts" USING btree ("listing_id");