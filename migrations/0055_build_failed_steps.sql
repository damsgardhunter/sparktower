-- A build's failed steps, counted apart from the ones it hands back.
--
-- `steps_for_you` carried both: a step Nova deliberately leaves open with its
-- options researched, and a step whose model call threw. The summary the buyer
-- reads is written from that number, so a build that failed six times told
-- them it had left six decisions "only you can make" — the one sentence that
-- must never describe a failure.
ALTER TABLE "nova_build_runs" ADD COLUMN IF NOT EXISTS "steps_failed" integer DEFAULT 0 NOT NULL;
