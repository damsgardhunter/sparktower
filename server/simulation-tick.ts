/**
 * The clock the simulation runs on: one real day is one simulated year.
 *
 * Two jobs, both idempotent, both safe to run from more than one process:
 *
 *   - **Settling lobbies.** A room only moved forward when somebody looked at
 *     it, which meant a room everyone abandoned sat in "waiting for players"
 *     for ever and its season could never start. Nothing else in the system
 *     was going to notice, because noticing required someone to be there.
 *   - **Resolving years.** Every season whose next tick is due gets its year
 *     run: decisions in, world out, a report per company, the year advanced.
 *
 * ## Why this is written to be re-runnable rather than run-once
 *
 * A tick does several writes — reports for six companies, a new world, a new
 * year — and a process can die in the middle of any of them. The choice is
 * between making that impossible and making it harmless. Impossible is a lie
 * on any system with more than one process, so: the engine is pure and
 * deterministic, reports are unique per company per year, and the year only
 * advances on a conditional update that names the year it expects to find. Run
 * the same tick twice and the second one does nothing.
 */
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db, pool } from "./db";
import { simSeasons, simVentures, simSeats, simDecisions, simReports } from "@shared/schema";
import { nicheById } from "@shared/simulation/niches";
import { resolveYear } from "@shared/simulation/resolve";
import { ROLE_TITLES, type Role, type World } from "@shared/simulation/types";
import type { TeamDecisions } from "@shared/simulation/decisions";
import {
  buildWorld, decisionsForYear, economyFor, absenceNote, tickDueAt, seasonOver,
} from "@shared/simulation/season";
import { advanceVenture } from "./simulation-routes";

/** Distinct from the backing jobs' lock ids so the two never wait on each other. */
const LOCK_SIM_TICK = 918_2711;

/**
 * How long a season waits between finishing its lobbies and year one.
 *
 * Long enough that the five people who just argued about seats are still
 * there to see the market they have walked into, short enough that nobody
 * closes the app first.
 */
const FIRST_YEAR_DELAY_MS = 2 * 60_000;

async function withLock<T>(key: number, run: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [key]);
    if (!rows[0]?.ok) return null; // Another process is already on it.
    try {
      return await run();
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [key]);
    }
  } finally {
    client.release();
  }
}

/**
 * Push every stalled lobby forward.
 *
 * The room screens call this too, on every poll, which covers every room
 * somebody is watching. This covers the rest: the room where all five people
 * closed the tab, which otherwise waits for a deadline that nothing is
 * checking and holds up the season behind it.
 */
export async function settleLobbies(): Promise<number> {
  const stale = await db
    .select({ id: simVentures.id })
    .from(simVentures)
    .where(and(
      inArray(simVentures.phase, ["filling", "claiming", "naming"]),
      /*
       * UTC explicitly, not bare `now()`.
       *
       * `phase_ends_at` is a `timestamp` without a zone, and Drizzle writes JS
       * Dates into it as UTC. `now()` is a `timestamptz`, and comparing the two
       * converts it to the *session's* zone — so on a server running in, say,
       * US Central, every deadline looked five hours further away than it was
       * and abandoned rooms sat there half a day before anything swept them.
       * It passes in a UTC-configured database and fails everywhere else,
       * which is the worst way for a bug like this to behave.
       */
      lte(simVentures.phaseEndsAt, sql`(now() at time zone 'utc')`),
    ))
    .limit(200);

  for (const v of stale) {
    try {
      await advanceVenture(v.id);
    } catch (err) {
      console.error(`[sim] settling lobby ${v.id} failed:`, err);
    }
  }
  return stale.length;
}

/**
 * Start seasons whose rooms have all stopped arguing.
 *
 * A season waits for every one of its rooms to leave the lobby before year one
 * begins, so that everybody in a season lives through the same years. The wait
 * is bounded by the lobby's own deadlines — twenty minutes at the very worst —
 * and `settleLobbies` above guarantees they expire whether or not anyone is
 * watching, so this can never hang on an empty room.
 */
export async function startReadySeasons(): Promise<string[]> {
  const forming = await db
    .select({ id: simSeasons.id, nicheId: simSeasons.nicheId })
    .from(simSeasons)
    .where(eq(simSeasons.status, "forming"))
    .limit(50);

  const started: string[] = [];

  for (const season of forming) {
    const ventures = await db
      .select({ id: simVentures.id, name: simVentures.name, phase: simVentures.phase })
      .from(simVentures)
      .where(eq(simVentures.seasonId, season.id));

    if (ventures.length === 0) continue;
    // Still arguing. Come back next pass.
    if (ventures.some((v) => v.phase !== "running" && v.phase !== "retired")) continue;

    const playing = ventures.filter((v) => v.phase === "running");
    if (playing.length === 0) {
      // Every room fell apart. Nothing to run.
      await db.update(simSeasons).set({ status: "abandoned" }).where(eq(simSeasons.id, season.id));
      continue;
    }

    const niche = nicheById(season.nicheId);
    if (!niche) {
      console.error(`[sim] season ${season.id} names a market that no longer exists: ${season.nicheId}`);
      await db.update(simSeasons).set({ status: "abandoned" }).where(eq(simSeasons.id, season.id));
      continue;
    }

    const seats = await db
      .select({ ventureId: simSeats.ventureId, role: simSeats.role })
      .from(simSeats)
      .where(inArray(simSeats.ventureId, playing.map((v) => v.id)));

    const world = buildWorld({
      seasonId: season.id,
      niche,
      teams: playing.map((v) => ({
        id: v.id,
        name: v.name ?? "Unnamed",
        seats: seats.filter((s) => s.ventureId === v.id && s.role).map((s) => s.role as Role),
      })),
    });

    const startsAt = new Date(Date.now() + FIRST_YEAR_DELAY_MS);
    // Conditional on still being `forming`, so two processes starting the same
    // season at the same moment cannot both seed a world.
    const claimed = await db
      .update(simSeasons)
      .set({ status: "running", year: 1, world, startsAt, nextTickAt: tickDueAt(startsAt, 1) })
      .where(and(eq(simSeasons.id, season.id), eq(simSeasons.status, "forming")))
      .returning({ id: simSeasons.id });

    if (claimed.length > 0) {
      started.push(season.id);
      console.log(`[sim] season ${season.id} (${niche.name}) starts with ${playing.length} team(s)`);
    }
  }

  return started;
}

/**
 * Resolve one year for one season.
 *
 * Returns the year that was resolved, or null if there was nothing to do —
 * which is the normal answer when another process got there first.
 */
export async function tickSeason(seasonId: string, now = new Date()): Promise<number | null> {
  const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
  if (!season || season.status !== "running" || !season.world) return null;
  if (!season.nextTickAt || season.nextTickAt > now) return null;

  const niche = nicheById(season.nicheId);
  if (!niche) return null;

  const year = season.year;
  const stored = season.world as World;
  /*
   * The niche is re-attached from code rather than trusted from the stored
   * world. Segments and incumbent behaviour are balance, and balance gets
   * edited; a season that stored a copy in year one would keep playing last
   * month's balance for a fortnight, and two seasons running side by side
   * would be playing different games.
   */
  const world: World = { ...stored, niche, year };

  const teams = world.companies.filter((c) => c.kind === "player");
  if (teams.length === 0) return null;

  // Everything submitted for this year, and what each team ran last year.
  const rows = await db
    .select({ ventureId: simDecisions.ventureId, role: simDecisions.role, year: simDecisions.year, payload: simDecisions.payload })
    .from(simDecisions)
    .where(and(
      inArray(simDecisions.ventureId, teams.map((t) => t.id)),
      inArray(simDecisions.year, year > 1 ? [year, year - 1] : [year]),
    ));

  const decisions: TeamDecisions[] = [];
  const absences = new Map<string, Role[]>();

  for (const team of teams) {
    const submitted: Partial<Record<Role, any>> = {};
    const previousParts: Partial<Record<Role, any>> = {};
    for (const r of rows) {
      if (r.ventureId !== team.id) continue;
      if (r.year === year) submitted[r.role as Role] = r.payload;
      else previousParts[r.role as Role] = r.payload;
    }

    /*
     * Last year's plan is rebuilt from what was submitted then, not from a
     * stored copy of what the caretaker ran. Otherwise a team that misses two
     * years in a row has its spending multiplied down twice — 60% of 60% — and
     * a fortnight's absence compounds into a company nobody can rescue. One
     * step down from the last real decision is the fair reading of silence,
     * however long the silence goes on.
     */
    const previous: TeamDecisions | undefined = year > 1
      ? { companyId: team.id, ...previousParts } as TeamDecisions
      : undefined;

    const { decisions: theirs, absent } = decisionsForYear({
      company: team,
      niche,
      submitted,
      previous: previous && Object.keys(previousParts).length > 0 ? previous : undefined,
    });
    decisions.push(theirs);
    if (absent.length > 0) absences.set(team.id, absent);
  }

  const economy = economyFor(seasonId, year);
  const { world: nextWorld, reports } = resolveYear(world, decisions, economy);

  // Name the empty chairs, so a thin year has an explanation attached to it.
  for (const report of reports) {
    const absent = absences.get(report.companyId);
    const note = absent ? absenceNote(absent, ROLE_TITLES) : null;
    if (note) report.notes = [note, ...report.notes];
  }

  const finished = seasonOver(year + 1, season.totalYears);
  const nextTickAt = season.startsAt && !finished ? tickDueAt(season.startsAt, year + 1) : null;

  await db.transaction(async (tx) => {
    /*
     * Reports first, then the year. If this dies in between, the next pass
     * resolves the same year again: the engine is deterministic so it produces
     * the same reports, the unique index drops the duplicates, and the year
     * advances on the retry. The other order would lose a year's reports with
     * no way to tell they were missing.
     */
    await tx.insert(simReports).values(reports.map((r) => ({
      seasonId,
      ventureId: teams.some((t) => t.id === r.companyId) ? r.companyId : null,
      companyId: r.companyId,
      year,
      report: r,
    }))).onConflictDoNothing();

    const advanced = await tx
      .update(simSeasons)
      .set({
        world: { ...nextWorld, year: year + 1 },
        year: year + 1,
        nextTickAt,
        status: finished ? "finished" : "running",
      })
      .where(and(eq(simSeasons.id, seasonId), eq(simSeasons.year, year)))
      .returning({ id: simSeasons.id });

    // Another process resolved this year while we were working. Its writes are
    // identical to ours, so there is nothing to correct — just nothing to do.
    if (advanced.length === 0) return;

    /*
     * Each venture keeps a copy of its own company for the screens, written in
     * the same transaction as the world it came from. Derived, never the
     * source: the season's world is what the next tick reads.
     */
    for (const company of nextWorld.companies) {
      if (company.kind !== "player") continue;
      await tx.update(simVentures)
        .set({ state: company, phase: finished ? "retired" : "running" })
        .where(eq(simVentures.id, company.id));
    }
  });

  return year;
}

/** Resolve every season that is due. */
export async function runDueTicks(now = new Date()): Promise<number> {
  const due = await db
    .select({ id: simSeasons.id })
    .from(simSeasons)
    .where(and(eq(simSeasons.status, "running"), lte(simSeasons.nextTickAt, now)))
    .limit(100);

  let resolved = 0;
  for (const season of due) {
    try {
      if (await tickSeason(season.id, now)) resolved++;
    } catch (err) {
      console.error(`[sim] tick for season ${season.id} failed:`, err);
    }
  }
  return resolved;
}

/** One pass of everything, under one lock. Exported so a test can run it directly. */
export async function runSimulationPass(now = new Date()): Promise<{ settled: number; started: number; resolved: number } | null> {
  return withLock(LOCK_SIM_TICK, async () => {
    const settled = await settleLobbies();
    const started = (await startReadySeasons()).length;
    const resolved = await runDueTicks(now);
    if (settled || started || resolved) {
      console.log(`[sim] ${settled} lobbies settled, ${started} seasons started, ${resolved} years resolved`);
    }
    return { settled, started, resolved };
  });
}

/**
 * Starts the clock.
 *
 * Every minute, which sounds eager for a job that resolves one year a day and
 * is not: lobby deadlines are measured in minutes, and a room that sat
 * abandoned for an hour before anybody was told is four people deciding the
 * feature is broken. The pass does nothing at all when nothing is due.
 */
export function startSimulationJobs(): void {
  const pass = () => {
    runSimulationPass().catch((err) => console.error("[sim] pass failed:", err));
  };

  setTimeout(pass, 20_000);
  setInterval(pass, 60_000).unref();
}
