-- When a section's path tree was last reconciled, and for which inputs.
--
-- syncPathTree runs from a plain GET that every open dashboard polls every
-- fifteen seconds, and it is a read-modify-write under a per-project advisory
-- lock. It almost always finds nothing to do: the tree only changes when the
-- tree definition changes, or the project's goal, subcategory or capital route
-- does. So the work ran thirteen times a second at two hundred concurrent
-- users to reach the same answer, and it serialised everybody looking at the
-- same project behind one lock.
--
-- Its own table rather than columns on project_tracks, because a track row
-- only exists once a section has been started and this has to work for every
-- project that can be read — bookkeeping that silently does nothing for half
-- its cases is worse than none. Nothing else reads this table; losing it costs
-- one extra reconcile per section.
CREATE TABLE IF NOT EXISTS "path_sync_state" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"goal" text NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"synced_key" text NOT NULL,
	CONSTRAINT "path_sync_state_project_goal" UNIQUE("project_id","goal")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "path_sync_state" ADD CONSTRAINT "path_sync_state_project_id_projects_id_fk"
		FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
