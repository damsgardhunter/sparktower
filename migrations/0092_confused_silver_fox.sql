CREATE TABLE "backer_reward_fulfilments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backing_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"reward_key" text NOT NULL,
	"asset_path" text,
	"note" text,
	"delivered_by" varchar,
	"delivered_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "backer_reward_once" UNIQUE("backing_id","reward_key")
);
--> statement-breakpoint
ALTER TABLE "backer_reward_fulfilments" ADD CONSTRAINT "backer_reward_fulfilments_backing_id_project_backings_id_fk" FOREIGN KEY ("backing_id") REFERENCES "public"."project_backings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backer_reward_fulfilments" ADD CONSTRAINT "backer_reward_fulfilments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backer_reward_fulfilments" ADD CONSTRAINT "backer_reward_fulfilments_delivered_by_users_id_fk" FOREIGN KEY ("delivered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backer_reward_fulfilments_project_idx" ON "backer_reward_fulfilments" USING btree ("project_id");