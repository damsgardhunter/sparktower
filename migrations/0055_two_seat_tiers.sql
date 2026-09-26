-- Two seats, priced differently, held apart.
--
-- Every seat sold so far was sold at five dollars to have Nova build a
-- simulation, so the existing balance is renamed rather than replaced: a
-- company that paid keeps exactly what it paid for.
-- Guarded so it can be re-run: a rename has no IF NOT EXISTS form, and this
-- has to be safe against a database that already did it.
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM information_schema.columns
	           WHERE table_name = 'companies' AND column_name = 'sim_seats_paid')
	AND NOT EXISTS (SELECT 1 FROM information_schema.columns
	                WHERE table_name = 'companies' AND column_name = 'sim_nova_seats_paid')
	THEN
		ALTER TABLE "companies" RENAME COLUMN "sim_seats_paid" TO "sim_nova_seats_paid";
	END IF;
END $$;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "sim_play_seats_paid" integer DEFAULT 0 NOT NULL;

-- Every purchase recorded so far was a Nova seat, which is what the default says.
ALTER TABLE "sim_seat_purchases" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'nova' NOT NULL;

-- Every season that exists was taken from the markets we wrote.
ALTER TABLE "sim_seasons" ADD COLUMN IF NOT EXISTS "origin" text DEFAULT 'catalogue' NOT NULL;
