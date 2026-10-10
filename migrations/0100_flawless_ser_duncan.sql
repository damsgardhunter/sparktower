ALTER TABLE "seller_agreements" DROP CONSTRAINT "seller_agreements_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "simulation_listings" DROP CONSTRAINT "simulation_listings_author_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "simulation_purchases" DROP CONSTRAINT "simulation_purchases_listing_id_simulation_listings_id_fk";
--> statement-breakpoint
ALTER TABLE "simulation_purchases" DROP CONSTRAINT "simulation_purchases_buyer_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "simulation_purchases" DROP CONSTRAINT "simulation_purchases_seller_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "seller_agreements" ADD CONSTRAINT "seller_agreements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_listings" ADD CONSTRAINT "simulation_listings_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_purchases" ADD CONSTRAINT "simulation_purchases_listing_id_simulation_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."simulation_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_purchases" ADD CONSTRAINT "simulation_purchases_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_purchases" ADD CONSTRAINT "simulation_purchases_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;