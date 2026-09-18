CREATE TABLE "sim_decisions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venture_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"role" varchar NOT NULL,
	"year" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sim_decisions_once" UNIQUE("venture_id","role","year")
);
--> statement-breakpoint
CREATE TABLE "sim_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" varchar NOT NULL,
	"venture_id" varchar,
	"company_id" varchar NOT NULL,
	"year" integer NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sim_seasons" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"niche_id" varchar NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'forming' NOT NULL,
	"year" integer DEFAULT 1 NOT NULL,
	"total_years" integer DEFAULT 14 NOT NULL,
	"next_tick_at" timestamp,
	"starts_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sim_seats" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venture_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"role" varchar,
	"assigned" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"claimed_at" timestamp,
	CONSTRAINT "sim_seats_venture_user" UNIQUE("venture_id","user_id"),
	CONSTRAINT "sim_seats_venture_role" UNIQUE("venture_id","role")
);
--> statement-breakpoint
CREATE TABLE "sim_ventures" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" varchar NOT NULL,
	"name" text,
	"product" text,
	"phase" text DEFAULT 'filling' NOT NULL,
	"phase_ends_at" timestamp,
	"state" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sim_decisions" ADD CONSTRAINT "sim_decisions_venture_id_sim_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."sim_ventures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_decisions" ADD CONSTRAINT "sim_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_reports" ADD CONSTRAINT "sim_reports_season_id_sim_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."sim_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_reports" ADD CONSTRAINT "sim_reports_venture_id_sim_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."sim_ventures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_seats" ADD CONSTRAINT "sim_seats_venture_id_sim_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."sim_ventures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_seats" ADD CONSTRAINT "sim_seats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_ventures" ADD CONSTRAINT "sim_ventures_season_id_sim_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."sim_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sim_reports_season_year_idx" ON "sim_reports" USING btree ("season_id","year");--> statement-breakpoint
CREATE INDEX "sim_seasons_status_idx" ON "sim_seasons" USING btree ("status","niche_id");--> statement-breakpoint
CREATE INDEX "sim_seats_venture_idx" ON "sim_seats" USING btree ("venture_id");--> statement-breakpoint
CREATE INDEX "sim_ventures_season_idx" ON "sim_ventures" USING btree ("season_id","phase");