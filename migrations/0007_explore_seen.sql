CREATE TABLE "explore_seen" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"kind" text NOT NULL,
	"target_id" varchar NOT NULL,
	"seen_ms" bigint NOT NULL,
	CONSTRAINT "explore_seen_user_target" UNIQUE("user_id","kind","target_id")
);
--> statement-breakpoint
ALTER TABLE "explore_seen" ADD CONSTRAINT "explore_seen_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "explore_seen_recent_idx" ON "explore_seen" USING btree ("user_id","seen_ms");