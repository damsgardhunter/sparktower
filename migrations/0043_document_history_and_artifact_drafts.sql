ALTER TABLE "path_artifacts" ADD COLUMN "draft_summary" text;--> statement-breakpoint
ALTER TABLE "path_artifacts" ADD COLUMN "draft_body" text;--> statement-breakpoint
ALTER TABLE "path_artifacts" ADD COLUMN "draft_files" jsonb;--> statement-breakpoint
ALTER TABLE "path_artifacts" ADD COLUMN "draft_at" timestamp;--> statement-breakpoint
ALTER TABLE "project_documents" ADD COLUMN "pages_history" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project_documents" ADD COLUMN "fill_failures" jsonb DEFAULT '[]'::jsonb NOT NULL;