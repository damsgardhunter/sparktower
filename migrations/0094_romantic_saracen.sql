CREATE TABLE "ad_renders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"requested_by" varchar NOT NULL,
	"duration_seconds" integer NOT NULL,
	"format" text NOT NULL,
	"style" text NOT NULL,
	"brief" text NOT NULL,
	"script" jsonb,
	"plan" jsonb,
	"brand" jsonb,
	"status" text DEFAULT 'queued' NOT NULL,
	"plates" jsonb,
	"output_path" text,
	"failure" text,
	"charged_cents" integer NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"provider_cents" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_renders" ADD CONSTRAINT "ad_renders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_renders" ADD CONSTRAINT "ad_renders_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_renders_project_idx" ON "ad_renders" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "ad_renders_status_idx" ON "ad_renders" USING btree ("status");