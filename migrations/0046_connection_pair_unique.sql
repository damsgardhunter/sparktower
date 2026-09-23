-- One connection per pair of people, whichever way round it was asked.
--
-- `sendConnectionRequest` was a check-then-insert: read the pair, and if
-- nothing came back, insert. A double-submitted button, or A and B pressing
-- "connect" on each other inside the same second, slipped through the gap and
-- left two rows for the same two people. After that `getConnectionStatus`
-- returned whichever row the planner handed back first, so messaging between
-- the two answered 403 on some requests and 200 on others.
--
-- An ordinary UNIQUE(requester_id, receiver_id) would not have helped: the
-- reversed pair is a different tuple, and the reversed pair is exactly the
-- case. So the index is on the unordered pair.
--
-- Duplicates first, or the index can't be created. Keep one row per pair,
-- preferring the settled state over the tentative one — an accepted connection
-- is a fact two people agreed on and must survive; a pending one is a request
-- still in flight; a rejected one is about to be deleted by the new decline
-- path anyway. Oldest wins the remaining ties, so the row people have been
-- looking at is the row that stays.
-- Every request declined before today, released.
--
-- A declined request left a `rejected` row behind, and `sendConnectionRequest`
-- refused while any row existed in either direction — so one mis-tapped
-- decline sealed that pair forever. The requester saw "Requested", greyed out,
-- for good and was never told why; the person who declined saw no button at
-- all. Declining deletes the row now (see `rejectConnection`), and these are
-- the ones already stuck. Nothing reads them: they are shown nowhere and are
-- not moderation evidence — a report is.
DELETE FROM "connections" WHERE status = 'rejected';--> statement-breakpoint

DELETE FROM "connections" c
USING (
  SELECT id, row_number() OVER (
    PARTITION BY least(requester_id, receiver_id), greatest(requester_id, receiver_id)
    ORDER BY (CASE status WHEN 'accepted' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END), created_at, id
  ) AS n
  FROM "connections"
) ranked
WHERE c.id = ranked.id AND ranked.n > 1;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "connections_pair_unique"
  ON "connections" (least("requester_id", "receiver_id"), greatest("requester_id", "receiver_id"));--> statement-breakpoint

-- The blocked list. Normally created by 0043, which carried it because
-- drizzle-kit generates against one shared snapshot and this table was in
-- shared/schema.ts when that file was written. Repeated here, idempotently, so
-- this migration stands on its own if that one is ever reordered or dropped:
-- the table is the whole of a person's ability to get away from someone, and
-- it must not depend on another builder's file surviving review.
CREATE TABLE IF NOT EXISTS "user_blocks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blocker_id" varchar NOT NULL,
	"blocked_id" varchar NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_blocker_id_blocked_id_unique" UNIQUE("blocker_id","blocked_id")
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_blocks_blocked_idx" ON "user_blocks" USING btree ("blocked_id");
