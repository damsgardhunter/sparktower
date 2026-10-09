CREATE TABLE "simulation_listing_players" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"first_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sim_listing_players_once" UNIQUE("listing_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "simulation_listings" ADD COLUMN "players" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_listing_players" ADD CONSTRAINT "simulation_listing_players_listing_id_simulation_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."simulation_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_listing_players" ADD CONSTRAINT "simulation_listing_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Hand-added. The counter and its set are new, so without this every listing
-- that has already been played reads "Not yet" — and the `popular` sort would
-- rank the whole marketplace at zero until somebody played each one again.
--
-- Rebuilt from what already records who started what: season starts, and share
-- redemptions through their link. The author is excluded, because `players`
-- answers "have other people chosen this". `min(created_at)` so `first_at`
-- says when they actually first played rather than when this ran.
INSERT INTO "simulation_listing_players" ("listing_id", "user_id", "first_at")
SELECT s."listing_id", s."started_by", min(s."created_at")
FROM "simulation_season_starts" s
JOIN "simulation_listings" l ON l."id" = s."listing_id"
WHERE s."started_by" <> l."author_id"
GROUP BY s."listing_id", s."started_by"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "simulation_listing_players" ("listing_id", "user_id", "first_at")
SELECT k."listing_id", u."claimed_by", min(u."created_at")
FROM "simulation_share_uses" u
JOIN "simulation_share_links" k ON k."id" = u."link_id"
JOIN "simulation_listings" l ON l."id" = k."listing_id"
WHERE u."claimed_by" <> l."author_id"
GROUP BY k."listing_id", u."claimed_by"
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "simulation_listings" l
SET "players" = (SELECT count(*) FROM "simulation_listing_players" p WHERE p."listing_id" = l."id");
