-- Two seats, priced differently, held apart.
--
-- Every seat sold so far was sold at five dollars to have Nova build a
-- simulation, so the existing balance is renamed rather than replaced: a
-- company that paid keeps exactly what it paid for.
ALTER TABLE "companies" RENAME COLUMN "sim_seats_paid" TO "sim_nova_seats_paid";
ALTER TABLE "companies" ADD COLUMN "sim_play_seats_paid" integer DEFAULT 0 NOT NULL;

-- Every purchase recorded so far was a Nova seat, which is what the default says.
ALTER TABLE "sim_seat_purchases" ADD COLUMN "kind" text DEFAULT 'nova' NOT NULL;

-- Every season that exists was taken from the markets we wrote.
ALTER TABLE "sim_seasons" ADD COLUMN "origin" text DEFAULT 'catalogue' NOT NULL;
