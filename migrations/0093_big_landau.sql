CREATE TABLE "project_brand_kits" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"primary_color" text,
	"background_color" text,
	"accent_color" text,
	"logo_path" text,
	"font_family" text,
	"display_name" text,
	"tagline" text,
	"voice" text,
	"avoid_words" text[],
	"call_to_action" text,
	"website_url" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_brand_kit_once" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "project_brand_kits" ADD CONSTRAINT "project_brand_kits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;