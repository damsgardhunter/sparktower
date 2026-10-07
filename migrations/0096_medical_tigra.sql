CREATE TABLE "seller_agreements" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"version" integer NOT NULL,
	"accepted_ip" varchar,
	"accepted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "simulation_listings" ADD COLUMN "taken_down_at" timestamp;--> statement-breakpoint
ALTER TABLE "simulation_listings" ADD COLUMN "taken_down_reason" text;--> statement-breakpoint
ALTER TABLE "simulation_listings" ADD COLUMN "taken_down_by" varchar;--> statement-breakpoint
ALTER TABLE "simulation_purchases" ADD COLUMN "refunded_at" timestamp;--> statement-breakpoint
ALTER TABLE "simulation_purchases" ADD COLUMN "releasable_at" timestamp;--> statement-breakpoint
ALTER TABLE "simulation_purchases" ADD COLUMN "released_at" timestamp;--> statement-breakpoint
ALTER TABLE "seller_agreements" ADD CONSTRAINT "seller_agreements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seller_agreements_user_idx" ON "seller_agreements" USING btree ("user_id","version");--> statement-breakpoint
ALTER TABLE "simulation_listings" ADD CONSTRAINT "simulation_listings_taken_down_by_users_id_fk" FOREIGN KEY ("taken_down_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sim_purchases_release_idx" ON "simulation_purchases" USING btree ("released_at","releasable_at");