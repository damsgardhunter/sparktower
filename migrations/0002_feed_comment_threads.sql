CREATE TABLE "feed_comment_reactions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"reaction" text DEFAULT 'like' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "feed_comment_reactions_comment_id_user_id_unique" UNIQUE("comment_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "feed_comments" ADD COLUMN "reaction_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "feed_comments" ADD COLUMN "hidden_at" timestamp;--> statement-breakpoint
ALTER TABLE "feed_comments" ADD COLUMN "hidden_by_id" varchar;--> statement-breakpoint
ALTER TABLE "feed_comments" ADD COLUMN "hidden_reason" text;--> statement-breakpoint
ALTER TABLE "feed_comments" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "feed_comment_reactions" ADD CONSTRAINT "feed_comment_reactions_comment_id_feed_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."feed_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_comment_reactions" ADD CONSTRAINT "feed_comment_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feed_comments_post_idx" ON "feed_comments" USING btree ("post_id","created_at");