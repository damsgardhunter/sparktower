CREATE TABLE "project_tracks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"goal" text NOT NULL,
	"subcategory" text NOT NULL,
	"capital_route" text,
	"active_branch" text,
	"pace" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_tracks_project_goal" UNIQUE("project_id","goal")
);
--> statement-breakpoint
ALTER TABLE "project_analytics_events" ADD COLUMN "track" text;--> statement-breakpoint
ALTER TABLE "project_files" ADD COLUMN "track" text;--> statement-breakpoint
ALTER TABLE "project_tracks" ADD CONSTRAINT "project_tracks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;