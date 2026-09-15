CREATE TABLE "investment_applications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"investor_id" varchar NOT NULL,
	"amount" text NOT NULL,
	"instrument" text NOT NULL,
	"investor_type" text NOT NULL,
	"accredited" text NOT NULL,
	"message" text NOT NULL,
	"phone" text,
	"linkedin_url" text,
	"status" text DEFAULT 'new' NOT NULL,
	"owner_note" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "capital_route" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "investment_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "investment_ask" jsonb;--> statement-breakpoint
ALTER TABLE "investment_applications" ADD CONSTRAINT "investment_applications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_applications" ADD CONSTRAINT "investment_applications_investor_id_users_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investment_applications_project_idx" ON "investment_applications" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "investment_applications_investor_idx" ON "investment_applications" USING btree ("investor_id","created_at");