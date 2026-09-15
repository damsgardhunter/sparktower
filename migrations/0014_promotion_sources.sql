CREATE TABLE "promotion_sources" (
	"promotion_id" varchar PRIMARY KEY NOT NULL,
	"logo_data" text,
	"logo_content_type" text,
	"logo_source_url" text,
	"youtube_channel_id" text,
	"video_id" text,
	"video_title" text,
	"video_published_at" timestamp,
	"fetched_at" timestamp,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "promotion_settings" ADD COLUMN "youtube_channel_url" text;