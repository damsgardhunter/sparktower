CREATE TABLE "simulation_share_links" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" varchar NOT NULL,
	"created_by" varchar NOT NULL,
	"token" text NOT NULL,
	"note" text,
	"uses" integer DEFAULT 1 NOT NULL,
	"uses_spent" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sim_share_links_token" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "simulation_share_uses" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" varchar NOT NULL,
	"claimed_by" varchar NOT NULL,
	"season_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sim_share_uses_season_once" UNIQUE("season_id")
);
--> statement-breakpoint
ALTER TABLE "simulation_purchases" ADD COLUMN "buyer_terms_version" integer;--> statement-breakpoint
ALTER TABLE "simulation_share_links" ADD CONSTRAINT "simulation_share_links_listing_id_simulation_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."simulation_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_share_links" ADD CONSTRAINT "simulation_share_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_share_uses" ADD CONSTRAINT "simulation_share_uses_link_id_simulation_share_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."simulation_share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_share_uses" ADD CONSTRAINT "simulation_share_uses_claimed_by_users_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sim_share_links_listing_idx" ON "simulation_share_links" USING btree ("listing_id","created_at");--> statement-breakpoint
CREATE INDEX "sim_share_uses_link_idx" ON "simulation_share_uses" USING btree ("link_id","created_at");