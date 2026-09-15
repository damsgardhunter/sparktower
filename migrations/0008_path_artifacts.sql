CREATE TABLE "path_artifacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"task_id" varchar NOT NULL,
	"backbone_id" text,
	"author_id" varchar NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"published_post_id" varchar,
	"published_at" timestamp,
	"views" integer DEFAULT 0 NOT NULL,
	"signups" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "path_artifacts_task_id_unique" UNIQUE("task_id")
);
--> statement-breakpoint
ALTER TABLE "path_artifacts" ADD CONSTRAINT "path_artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "path_artifacts" ADD CONSTRAINT "path_artifacts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "path_artifacts_project_idx" ON "path_artifacts" USING btree ("project_id");