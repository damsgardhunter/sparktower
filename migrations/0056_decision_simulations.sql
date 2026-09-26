-- Simulating one real company: the decision simulator and the ten-year outlook.
--
-- The market season already here runs five people against incumbents in an
-- invented market. None of it can answer "what happens if I hire twelve people
-- right now", because none of the numbers in it are the owner's. These three
-- tables are the other simulation: this company, its own figures, month by
-- month.
CREATE TABLE IF NOT EXISTS "simulation_baselines" (
  "project_id" varchar PRIMARY KEY NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "numbers" jsonb NOT NULL,
  "overridden" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_by" varchar REFERENCES "users"("id") ON DELETE set null,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS "simulation_scenarios" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" varchar NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "question" text NOT NULL,
  "months" integer NOT NULL,
  "baseline" jsonb NOT NULL,
  "levers" jsonb NOT NULL,
  "assumptions" jsonb NOT NULL,
  "result" jsonb NOT NULL,
  "narrative" jsonb NOT NULL,
  "rerun_of" varchar,
  "created_by" varchar REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS "simulation_scenarios_project_idx" ON "simulation_scenarios" ("project_id","created_at");

CREATE TABLE IF NOT EXISTS "ten_year_outlooks" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" varchar NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "allocation" jsonb NOT NULL,
  "profile" jsonb NOT NULL,
  "verdict" jsonb NOT NULL,
  "from_model" boolean DEFAULT true NOT NULL,
  "created_by" varchar REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS "ten_year_outlooks_project_idx" ON "ten_year_outlooks" ("project_id","created_at");
