/**
 * Housekeeping the simulation specs need and the product deliberately does not
 * offer.
 *
 * ## Why stray lobbies break unrelated tests
 *
 * A season holds every room in its market and does not start until all of
 * them have left the lobby. So one person left sitting alone in a market holds
 * up the next season there for as long as their room takes to expire — up to
 * fifteen minutes in the filling phase — and five people who join that market
 * afterwards are split between the stray room and a new one, so neither ever
 * fills.
 *
 * The desk specs leave exactly such a person behind (the sealed-bid test's
 * rival joins after the season has started, which opens a new lobby), and there
 * is no route to leave a lobby. The first run of a spec passes because the
 * database is fresh; run it again, or run another spec in the same market
 * after it, and every test downstream waits out its whole season-start budget
 * and fails. Under `--repeat-each=3` the desk tests failed on every repetition
 * after the first, at 2.6 minutes each.
 *
 * The integration tests have always cleared these before forming a room
 * (test/integration/sim-tick.test.ts); the browser specs never did.
 *
 * ## Why this goes through the database
 *
 * There is nothing a player can do to close somebody else's lobby, and there
 * should not be. Tests reach past the API here the same way the year spec
 * reaches past the clock: to set up a world, not to exercise one.
 */
import pg from "pg";
import { loadEnvFile } from "../test/setup/env";
import { testDatabaseUrl } from "../test/setup/database";

loadEnvFile();

export async function sql(text: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: testDatabaseUrl("_e2e") });
  await client.connect();
  try { return await client.query(text, params); } finally { await client.end(); }
}

/**
 * Close every room still in a lobby in this market, and the seasons they were
 * holding open.
 *
 * Rooms first, then seasons, for the same reason the integration helper gives:
 * the starter treats `abandoned` as overturnable if a room in it is still
 * alive, so abandoning a season around a live lobby undoes itself on the next
 * sweep. Only seasons that are still forming are touched — a running season is
 * somebody's game.
 */
export async function clearStrayLobbies(nicheId: string): Promise<void> {
  await sql(
    `UPDATE sim_ventures SET phase = 'retired'
     WHERE phase IN ('filling', 'claiming', 'naming')
       AND season_id IN (SELECT id FROM sim_seasons WHERE niche_id = $1 AND status = 'forming')`,
    [nicheId],
  );
  await sql(
    `UPDATE sim_seasons SET status = 'abandoned'
     WHERE niche_id = $1 AND status = 'forming'
       AND NOT EXISTS (SELECT 1 FROM sim_ventures v WHERE v.season_id = sim_seasons.id AND v.phase = 'running')`,
    [nicheId],
  );
}

/**
 * Make a venture's season due now, so the background job resolves its year on
 * its next pass instead of tomorrow.
 *
 * `(now() at time zone 'utc')` rather than `now()`: these columns are zoneless
 * timestamps holding UTC, which is Drizzle's convention, and hand-written SQL
 * has to build the UTC clock itself. See server/simulation-tick.ts.
 */
export async function pullYearForward(ventureId: string): Promise<number> {
  const moved = await sql(
    `UPDATE sim_seasons SET next_tick_at = (now() at time zone 'utc') - interval '1 minute'
     WHERE id = (SELECT season_id FROM sim_ventures WHERE id = $1)`,
    [ventureId],
  );
  return moved.rowCount ?? 0;
}
