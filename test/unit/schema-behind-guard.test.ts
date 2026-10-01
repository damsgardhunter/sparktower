/**
 * The background loops, while the database is behind the build.
 *
 * `warnIfMigrationsPending` already says the right thing at boot, once, and
 * even predicts the symptom: "anything reading them will fail with 'column
 * does not exist'". It was right, and nobody saw it, because the simulation's
 * clock then buried it — one missing column on `sim_seasons` made every pass
 * read twenty-two running seasons, each throwing a DrizzleQueryError carrying
 * the whole hundred-column SELECT. A screen of stack traces a minute, on a
 * loop, on top of the one line that had already named the cause and the fix.
 *
 * So a loop that cannot succeed no longer runs. What is tested here is the
 * decision, not the loop: whether the answer is cached, what happens when the
 * question cannot be answered, and that the complaint is throttled rather than
 * printed every pass — which would simply move the noise.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { forgetSchemaMatch, schemaMatchesBuild, type MigrationState } from "../../server/migration-state";

const state = (over: Partial<MigrationState>): MigrationState =>
  ({ expected: 88, applied: 88, pending: 0, ok: true, ...over });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  forgetSchemaMatch();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { warn.mockRestore(); });

describe("whether the background loops may run", () => {
  it("lets them run when the database matches the build", async () => {
    expect(await schemaMatchesBuild(async () => state({}))).toBe(true);
  });

  it("holds them when a migration has not been applied, and says which command fixes it", async () => {
    const behind = state({ applied: 87, pending: 1, ok: false });
    expect(await schemaMatchesBuild(async () => behind)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/db:migrate/);
    expect(String(warn.mock.calls[0][0]), "and how far behind it is").toMatch(/87 of 88|1 migration/);
  });

  /*
   * Moving a screen of stack traces to a screen of warnings is not a fix.
   */
  it("complains at most once in five minutes, not once a pass", async () => {
    const behind = state({ applied: 87, pending: 1, ok: false });
    let clock = 1_000_000;
    const read = async () => behind;
    const now = () => clock;

    for (let i = 0; i < 10; i++) { await schemaMatchesBuild(read, now); clock += 60_000; }
    expect(warn.mock.calls.length, "ten passes over nine minutes").toBe(2);
  });

  /*
   * Once the database has caught up the question stops being asked, so the
   * steady state costs nothing.
   */
  it("stops asking once the answer is yes", async () => {
    let asked = 0;
    const read = async () => { asked += 1; return state({}); };
    for (let i = 0; i < 5; i++) expect(await schemaMatchesBuild(read)).toBe(true);
    expect(asked, "asked once, then cached").toBe(1);
  });

  it("keeps asking while the answer is no, so it notices the migration landing", async () => {
    let applied = 87;
    const read = async () => (applied === 88 ? state({}) : state({ applied, pending: 88 - applied, ok: false }));
    expect(await schemaMatchesBuild(read)).toBe(false);
    applied = 88;
    expect(await schemaMatchesBuild(read), "the loops resume without a restart").toBe(true);
  });

  /*
   * An unreadable journal, or a deploy shipped without the folder. Refusing to
   * run on "don't know" would take a working deployment down over missing
   * bookkeeping.
   */
  it("treats a question it cannot answer as no objection", async () => {
    expect(await schemaMatchesBuild(async () => state({ expected: -1, ok: null }))).toBe(true);
    expect(warn, "and does not complain about it every pass").not.toHaveBeenCalled();
  });
});
