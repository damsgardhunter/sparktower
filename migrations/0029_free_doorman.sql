ALTER TABLE "cofounder_sprints" ADD COLUMN "abandoned_at" timestamp;--> statement-breakpoint
ALTER TABLE "cofounder_sprints" ADD COLUMN "abandoned_by_id" varchar;--> statement-breakpoint
ALTER TABLE "cofounder_sprints" ADD COLUMN "abandon_reason" text;--> statement-breakpoint
ALTER TABLE "cofounder_sprints" ADD CONSTRAINT "cofounder_sprints_abandoned_by_id_users_id_fk" FOREIGN KEY ("abandoned_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;