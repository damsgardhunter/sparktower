CREATE TABLE "what_would_it_take_roadmaps" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"target" text NOT NULL,
	"grounding" jsonb NOT NULL,
	"roadmap" jsonb NOT NULL,
	"annual_revenue" real,
	"generated_by" varchar,
	"generated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "what_would_it_take_roadmaps" ADD CONSTRAINT "what_would_it_take_roadmaps_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "what_would_it_take_roadmaps" ADD CONSTRAINT "what_would_it_take_roadmaps_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wwit_project_target_idx" ON "what_would_it_take_roadmaps" USING btree ("project_id","target","generated_at");