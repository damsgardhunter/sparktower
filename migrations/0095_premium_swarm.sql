CREATE TABLE "simulation_listings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" varchar NOT NULL,
	"project_id" varchar,
	"title" text NOT NULL,
	"summary" text,
	"description" text,
	"tags" text[],
	"custom_market" jsonb,
	"niche_id" varchar,
	"cadence" text DEFAULT 'yearly' NOT NULL,
	"bot_skill" text DEFAULT 'survivor' NOT NULL,
	"total_years" integer DEFAULT 14 NOT NULL,
	"pricing" text DEFAULT 'free' NOT NULL,
	"seat_price_cents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp,
	"seats_sold" integer DEFAULT 0 NOT NULL,
	"seasons_started" integer DEFAULT 0 NOT NULL,
	"gross_cents" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulation_purchases" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" varchar NOT NULL,
	"buyer_id" varchar NOT NULL,
	"seller_id" varchar NOT NULL,
	"seats" integer NOT NULL,
	"paid_cents" integer NOT NULL,
	"platform_cents" integer DEFAULT 0 NOT NULL,
	"seller_cents" integer DEFAULT 0 NOT NULL,
	"seats_left" integer NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "simulation_listings" ADD CONSTRAINT "simulation_listings_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_listings" ADD CONSTRAINT "simulation_listings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_purchases" ADD CONSTRAINT "simulation_purchases_listing_id_simulation_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."simulation_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_purchases" ADD CONSTRAINT "simulation_purchases_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_purchases" ADD CONSTRAINT "simulation_purchases_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sim_listings_author_idx" ON "simulation_listings" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "sim_listings_status_idx" ON "simulation_listings" USING btree ("status","published_at");--> statement-breakpoint
CREATE INDEX "sim_purchases_buyer_idx" ON "simulation_purchases" USING btree ("buyer_id","created_at");--> statement-breakpoint
CREATE INDEX "sim_purchases_seller_idx" ON "simulation_purchases" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE INDEX "sim_purchases_listing_idx" ON "simulation_purchases" USING btree ("listing_id");