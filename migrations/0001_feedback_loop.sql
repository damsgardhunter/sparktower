ALTER TABLE "feed_comments" ADD COLUMN "applied_at" timestamp;--> statement-breakpoint
ALTER TABLE "feed_comments" ADD COLUMN "applied_by_id" varchar;--> statement-breakpoint
ALTER TABLE "feed_comments" ADD COLUMN "applied_task_id" varchar;--> statement-breakpoint
ALTER TABLE "feed_comments" ADD COLUMN "closed_by_post_id" varchar;--> statement-breakpoint
ALTER TABLE "feed_comments" ADD COLUMN "closure_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "feed_posts" ADD COLUMN "asks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "feed_posts" ADD COLUMN "feedback_seen_at" timestamp;