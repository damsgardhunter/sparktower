ALTER TABLE "path_artifacts" ADD COLUMN "hidden_at" timestamp;--> statement-breakpoint
ALTER TABLE "path_artifacts" ADD COLUMN "hidden_by_id" varchar;--> statement-breakpoint
ALTER TABLE "path_artifacts" ADD COLUMN "hidden_reason" text;--> statement-breakpoint
ALTER TABLE "path_artifacts" ADD CONSTRAINT "path_artifacts_hidden_by_id_users_id_fk" FOREIGN KEY ("hidden_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;