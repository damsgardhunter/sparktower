-- Duplicates first, or the constraint can't be added: keep one row per person per project, preferring the one that says "Owner" (the create's), then the one with the most filled in.
DELETE FROM "project_members" pm
USING (
  SELECT id, row_number() OVER (
    PARTITION BY project_id, user_id
    ORDER BY (role = 'Owner') DESC, (timezone IS NOT NULL)::int + (availability IS NOT NULL)::int + (hours_per_week IS NOT NULL)::int + (skills IS NOT NULL)::int DESC, id
  ) AS n
  FROM "project_members"
) ranked
WHERE pm.id = ranked.id AND ranked.n > 1;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_user_unique" UNIQUE("project_id","user_id");
