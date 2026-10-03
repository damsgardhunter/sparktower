/**
 * The indexes the simulation's hot paths depend on.
 *
 * An index is the easiest thing in a schema to lose by accident and the hardest
 * to miss when it goes: nothing fails, nothing looks wrong, and a query that was
 * a lookup becomes a scan that grows for ever. Both of the ones below were
 * missing until 1 Oct 2026 and neither had broken anything — they had just made
 * the product a little slower every month.
 *
 * Asserted against the schema rather than against a live database, so this runs
 * without one and fails in the pull request that removes an index rather than in
 * production six months later. What it cannot check is that Postgres *chooses*
 * them; that was verified by hand with `explain analyze` on a copy holding real
 * volume, and the figures are in the comments beside each declaration.
 */
import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { simSeats, simVentures } from "@shared/schema";

/** The columns an index leads with, in order, as plain strings. */
const columnsOf = (index: { config: { columns: readonly unknown[] } }): string[] =>
  index.config.columns.map((c: any) => c?.name ?? String(c));

describe("the indexes a simulation at scale needs", () => {
  it("can find which rooms a person is in, without reading every seat", () => {
    /*
     * `sim_seats` is keyed on the pair (venture, person), which answers "is this
     * person in this room" and cannot answer "which rooms is this person in" —
     * a composite index is no use to a query that does not know its leading
     * column. That second question is the rooms list both clients poll, the
     * rejoin check at the top of `POST /api/sim/join`, and the seated check
     * behind an invite code.
     *
     * Measured before this index existed, on 2,405 seats: a sequential scan of
     * all of them, 3.2ms, to return one row. The 3.2ms was the part that grows —
     * seats are never deleted, because a seat is a person's place in a season
     * that happened.
     */
    const { indexes } = getTableConfig(simSeats);
    const byPerson = indexes.filter((i) => columnsOf(i)[0] === "user_id");
    expect(byPerson.length, "sim_seats needs an index leading on user_id").toBeGreaterThan(0);
  });

  it("can find the lobbies a sweep must move, without reading every venture", () => {
    /*
     * `settleLobbies` and `fillWaitingLobbies` run every sixty seconds for ever
     * and both ask which rooms are in a lobby phase with a clock that is up. The
     * season index leads on `season_id` and these queries know no season, so the
     * sweep was a sequential scan of every venture ever created, once a minute:
     * 22ms at 481 ventures, 0.14ms once this index existed.
     */
    const { indexes } = getTableConfig(simVentures);
    const byPhase = indexes.filter((i) => columnsOf(i)[0] === "phase");
    expect(byPhase.length, "sim_ventures needs an index leading on phase").toBeGreaterThan(0);

    /*
     * And it must stay partial.
     *
     * This is the whole value of it rather than a detail. A room leaves the lobby
     * phases once and never returns, so a partial index holds only the rooms
     * currently in one — a few dozen — while the table itself grows without
     * limit. Drop the predicate and the index grows with history, which is the
     * cost this was added to remove. Measured: 8kB against the season index's
     * 32kB on the same data.
     */
    const partial = byPhase.filter((i) => !!i.config.where);
    expect(partial.length, "the lobby index must be partial, or it grows with history").toBeGreaterThan(0);

    /*
     * Covering the three phases a sweep looks at.
     *
     * The predicate is a drizzle `SQL` object rather than a string, so this reads
     * the literal chunks it was built from — `StringChunk.value` is an array of
     * the raw fragments, with the column interpolated between them. Flattening
     * them is enough to see which phases are named, and it does not depend on
     * where the column sits in the expression.
     */
    const fragments = ((partial[0].config.where as any)?.queryChunks ?? [])
      .flatMap((chunk: any) => (Array.isArray(chunk?.value) ? chunk.value : []))
      .join(" ");
    for (const phase of ["filling", "claiming", "naming"]) {
      expect(fragments, `the sweep looks at ${phase}, so the index has to include it`).toContain(phase);
    }
    /* And not the two it never sweeps, which is what keeps the index small. */
    for (const phase of ["running", "retired"]) {
      expect(fragments, `${phase} rooms are never swept, so including them would defeat the point`)
        .not.toContain(phase);
    }
  });

  it("still keeps the per-season index, which answers a different question", () => {
    /*
     * Lest the above read as a replacement. Everything that works on one season
     * — the tick resolving a year, the room search inside the join lock, the
     * count that caps a season at eight tables — asks by `season_id`, and that
     * is the index for it.
     */
    const { indexes } = getTableConfig(simVentures);
    expect(indexes.some((i) => columnsOf(i)[0] === "season_id"), "sim_ventures still needs its season index").toBe(true);
  });
});
