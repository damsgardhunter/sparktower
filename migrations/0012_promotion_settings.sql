CREATE TABLE "promotion_settings" (
	"promotion_id" varchar PRIMARY KEY NOT NULL,
	"headline" text,
	"video_url" text,
	"referral_url" text,
	"logo_url" text,
	"perk" text,
	"active" boolean DEFAULT true NOT NULL,
	"updated_by_id" varchar,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "promotion_settings" ADD CONSTRAINT "promotion_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;