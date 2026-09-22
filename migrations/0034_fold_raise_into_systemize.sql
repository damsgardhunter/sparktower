-- The "Raise funding" path is retired; Systemize took over everything it did.
--
-- Its milestones kept their FUND. ids and now belong to Systemize (see
-- goalOfBackboneId in shared/goals.ts), so finished funding work needs no
-- rewriting — only the places that name the old goal do. Four cases, because a
-- project holds its primary path on its own row and any others as tracks:
--
--   1. Raise was a track, and the project has no Systemize anywhere: the track
--      simply becomes the Systemize track, keeping its chosen funding route.
--   2. Raise was a track, and Systemize already exists (primary or track): the
--      chosen route is carried onto the Systemize holder if it has none, and
--      the Raise track goes.
--   3. Raise was the primary, and a Systemize track exists: that track becomes
--      the primary (its type and branch move onto the project row), keeping
--      the Raise route if it had none, and the track row goes.
--   4. Raise was the primary and there is no Systemize: the project becomes
--      Systemize, keeping its route.
--
-- A Raise type ("startup equity", "local community", "loan or grant") means
-- nothing on Systemize, so it becomes "other" — a real answer the builder can
-- change, not a guess on their behalf.

-- 2. Raise track beside an existing Systemize (primary): route to the project row.
UPDATE "projects" p SET "capital_route" = t."capital_route"
FROM "project_tracks" t
WHERE t."project_id" = p."id" AND t."goal" = 'raise_funding'
  AND p."goal" = 'systemize_business' AND p."capital_route" IS NULL AND t."capital_route" IS NOT NULL;
--> statement-breakpoint

-- 2. Raise track beside an existing Systemize track: route to that track.
UPDATE "project_tracks" s SET "capital_route" = r."capital_route"
FROM "project_tracks" r
WHERE r."project_id" = s."project_id" AND r."goal" = 'raise_funding' AND s."goal" = 'systemize_business'
  AND s."capital_route" IS NULL AND r."capital_route" IS NOT NULL;
--> statement-breakpoint

-- 2. …and the Raise track goes.
DELETE FROM "project_tracks" r
WHERE r."goal" = 'raise_funding' AND (
  EXISTS (SELECT 1 FROM "projects" p WHERE p."id" = r."project_id" AND p."goal" = 'systemize_business')
  OR EXISTS (SELECT 1 FROM "project_tracks" s WHERE s."project_id" = r."project_id" AND s."goal" = 'systemize_business')
);
--> statement-breakpoint

-- 1. A Raise track with no Systemize anywhere becomes the Systemize track.
UPDATE "project_tracks" SET "goal" = 'systemize_business', "subcategory" = 'other', "updated_at" = now()
WHERE "goal" = 'raise_funding';
--> statement-breakpoint

-- 3. Raise primary with a Systemize track: the track's type, branch and pace move up…
UPDATE "projects" p SET
  "goal" = 'systemize_business',
  "subcategory" = s."subcategory",
  "capital_route" = COALESCE(s."capital_route", p."capital_route"),
  "active_branch" = s."active_branch"
FROM "project_tracks" s
WHERE s."project_id" = p."id" AND s."goal" = 'systemize_business' AND p."goal" = 'raise_funding';
--> statement-breakpoint

-- 3. …and the track row goes, since the primary now holds it.
DELETE FROM "project_tracks" s
WHERE s."goal" = 'systemize_business'
  AND EXISTS (SELECT 1 FROM "projects" p WHERE p."id" = s."project_id" AND p."goal" = 'systemize_business');
--> statement-breakpoint

-- 4. Raise primary, no Systemize: the project becomes Systemize, route kept.
UPDATE "projects" SET "goal" = 'systemize_business', "subcategory" = 'other'
WHERE "goal" = 'raise_funding';
--> statement-breakpoint

-- Board tasks that name the section by tag.
UPDATE "project_kanban_tasks" SET "tags" = array_replace("tags", 'track:raise_funding', 'track:systemize_business')
WHERE 'track:raise_funding' = ANY("tags");
--> statement-breakpoint
UPDATE "project_kanban_tasks" SET "tags" = array_replace("tags", 'archived:raise_funding', 'archived:systemize_business')
WHERE 'archived:raise_funding' = ANY("tags");
--> statement-breakpoint

-- A project's own analytics events, filed under a section.
UPDATE "project_analytics_events" SET "track" = 'systemize_business' WHERE "track" = 'raise_funding';
--> statement-breakpoint

-- Files filed under a section. The files list matches a section exactly, so a
-- file left under the old name would drop out of every section.
UPDATE "project_files" SET "track" = 'systemize_business' WHERE "track" = 'raise_funding';
