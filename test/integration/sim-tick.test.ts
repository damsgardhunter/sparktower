/**
 * The clock, against a real database.
 *
 * The engine is pure and tested on its own; what is left to get wrong is
 * everything around it. A tick writes reports for six companies, a new world
 * and a new year, and a process can die between any two of those writes — so
 * the tests that matter here are the ones that run the same tick twice and
 * insist the second one changes nothing.
 *
 * The other half is the lobby that nobody is watching. A room only moved
 * forward when somebody looked at it, which meant five people who all closed
 * the tab left a room that could never start and a season stuck behind it.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { pgTable, timestamp } from "drizzle-orm/pg-core";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { simSeasons, simSeats, simVentures, simDecisions, simReports } from "@shared/schema";
import { settleLobbies, startReadySeasons, tickSeason, runSimulationPass } from "../../server/simulation-tick";
import type { World } from "@shared/simulation/types";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function player(app: any) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.151.${(n % 200) + 20}`;
  const email = `tick-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `T${n}` });
  /*
   * The raw text, not just the parsed body.
   *
   * A long combined run occasionally answers this with a 404 whose body is not
   * JSON — so `res.body` is `{}` and the failure says nothing at all. The app
   * is fully built when it happens (the helper checks), it is not the /api
   * catch-all (that answers in JSON) and auth is behind no kill switch, so
   * what actually came back is the next thing worth knowing.
   */
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

const NICHE = "dating_apps";

/** Five players, seated, named, and running — a room ready for year one. */
async function readyRoom(app: any) {
  /*
   * Close any room still standing open from an earlier test first.
   *
   * Joining puts you in whichever room in the market has space, which is the
   * product behaving correctly and a trap for a helper that assumes its five
   * players get a room to themselves: a half-filled room left by the lobby
   * tests swallows the first few, the rest start a second room, and the seats
   * get claimed across two ventures that then never reach `running`. It failed
   * about one combined run in three and passed every time each file was run on
   * its own, which is the most annoying shape a test failure has.
   */
  await db.update(simVentures).set({ phase: "retired" })
    .where(inArray(simVentures.phase, ["filling", "claiming", "naming"]));
  /*
   * And close any season still taking rooms, so this one gets its own.
   *
   * A season holds every room in its market and a tick moves all of them.
   * Sharing one across tests meant a test that resolved a year quietly
   * advanced another test's company — which passed alone and failed in a full
   * run, on whichever test happened to be downstream.
   */
  /*
   * Its rooms are closed first, then the season.
   *
   * `abandoned` is no longer the last word on a season: the starter treats it
   * as a conclusion and overturns it if a company in that season is still
   * running, which is what rescues a room whose season was closed around it.
   * A cleanup that only set the status would therefore undo itself on the next
   * sweep. Retiring the rooms makes the conclusion true.
   */
  const stale = await db.select({ id: simSeasons.id }).from(simSeasons).where(eq(simSeasons.status, "forming"));
  if (stale.length > 0) {
    await db.update(simVentures).set({ phase: "retired" })
      .where(inArray(simVentures.seasonId, stale.map((s) => s.id)));
    await db.update(simSeasons).set({ status: "abandoned" })
      .where(inArray(simSeasons.id, stale.map((s) => s.id)));
  }

  const players = [];
  let ventureId = "";
  for (let i = 0; i < 5; i++) {
    const p = await player(app);
    const join = await p.agent.post("/api/sim/join").send({ nicheId: NICHE });
    expect(join.body.ventureId, "all five should land in one room").toBe(ventureId || join.body.ventureId);
    ventureId = join.body.ventureId;
    players.push(p);
  }
  const roles = ["ceo", "cmo", "cfo", "cto", "coo"];
  for (const [i, p] of players.entries()) {
    await p.agent.post(`/api/sim/ventures/${ventureId}/claim`).send({ role: roles[i] });
  }
  await players[0].agent.post(`/api/sim/ventures/${ventureId}/name`)
    .send({ name: "Northbound", product: "Training for people who hate training apps" });

  const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));
  expect(venture.phase).toBe("running");
  return { players, ventureId, seasonId: venture.seasonId };
}

/** Wind a season's clock back so its next tick is due. */
async function makeDue(seasonId: string) {
  await db.update(simSeasons)
    .set({ nextTickAt: new Date(Date.now() - 1000), startsAt: new Date(Date.now() - 60_000) })
    .where(eq(simSeasons.id, seasonId));
}

describe("a lobby nobody is watching", () => {
  it("moves on without anyone opening the screen", async () => {
    /*
     * Five people join and all close the tab. Before the job existed this room
     * sat in "waiting for players" for ever, because the only thing that ever
     * advanced a phase was somebody polling it — and nobody was.
     */
    const app = await getTestApp();
    const p = await player(app);
    const join = await p.agent.post("/api/sim/join").send({ nicheId: NICHE });
    const ventureId = join.body.ventureId;

    await db.update(simVentures)
      .set({ phaseEndsAt: new Date(Date.now() - 1000) })
      .where(eq(simVentures.id, ventureId));

    await settleLobbies();

    const [after] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));
    // One person is not a company. The room closes rather than waiting on.
    expect(after.phase).toBe("retired");
  }, 120_000);

  it("leaves a room alone while its clock is still running", async () => {
    /*
     * The other half of the sweep, which had nothing holding it.
     *
     * The test above proves an abandoned room does get closed. Nothing proved
     * that a room still arguing does not, and that is the worse failure of the
     * two: a room swept late is five people waiting, a room swept early is
     * five people having the decision taken off them mid-sentence, with the
     * countdown still showing on screen.
     *
     * It is a timezone away from happening at any moment — see the long note
     * at the predicate in server/simulation-tick.ts, and the test below it
     * here for why the comparison is written the way it is.
     */
    const app = await getTestApp();
    const p = await player(app);
    const join = await p.agent.post("/api/sim/join").send({ nicheId: NICHE });
    const ventureId = join.body.ventureId;

    const [before] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));
    await db.update(simVentures)
      .set({ phaseEndsAt: new Date(Date.now() + 15 * 60_000) })
      .where(eq(simVentures.id, ventureId));

    await settleLobbies();

    const [after] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));
    expect(after.phase, "a room with time left is not swept").toBe(before.phase);
  }, 120_000);
});

describe("the clock the whole schema runs on", () => {
  /*
   * Not a test of this feature so much as of the assumption underneath it, and
   * underneath all hundred and seventy-odd timestamp columns in the schema.
   *
   * Every one of them is `timestamp` without a zone, which stores a wall clock
   * and no indication of whose. Drizzle's convention is that the wall clock is
   * UTC. Nothing enforces that, nothing announces it, and a deadline compared
   * against the wrong clock is wrong by a whole timezone offset — which is how
   * abandoned lobbies came to sit half a day past a countdown that had visibly
   * reached zero.
   *
   * So it is pinned here, against a real column, with the two near-misses that
   * look like they would do the same job and do not.
   */
  const probe = pgTable("clock_probe", { t: timestamp("t") });

  it("stores a Date as UTC, and only some ways of asking agree", async () => {
    await getTestApp();
    await db.execute(sql`create table if not exists clock_probe (t timestamp)`);
    try {
      await db.execute(sql`delete from clock_probe`);
      // Comfortably in the future: nothing honest should call this due.
      const future = new Date(Date.now() + 15 * 60_000);
      await db.insert(probe).values({ t: future });

      const raw: any = await db.execute(sql`
        select t::text as stored,
               (t <= now()) as due_now,
               (t <= (now() at time zone 'utc')) as due_utc,
               (t <= ${future}) as due_raw_param,
               extract(timezone from now()) as session_offset_seconds
        from clock_probe
      `);
      const row = (raw.rows ?? raw)[0];

      // The convention itself: what is in the column is the UTC clock.
      expect(row.stored.replace(" ", "T") + "Z").toBe(future.toISOString());

      // And it reads back as the same instant, whatever zone reads it.
      const [back] = await db.select().from(probe);
      expect(back.t?.toISOString()).toBe(future.toISOString());

      /*
       * The form the code uses. Drizzle sends the Date through the column's
       * own mapper, so both sides are UTC by construction.
       */
      const due = await db.select().from(probe).where(lte(probe.t, new Date()));
      expect(due, "a deadline fifteen minutes out is not due").toHaveLength(0);

      // Correct for the same reason, and what stood in the code before.
      expect(row.due_utc, "explicit UTC agrees with the column").toBe(false);

      /*
       * The first near-miss. `now()` is rendered in the database session's
       * zone, so it is a different clock from the one in the column. Only
       * provable when that zone has an offset — on a UTC database the two
       * happen to coincide, which is precisely why this bug survived so long.
       */
      const offset = Number(row.session_offset_seconds);
      if (offset !== 0) {
        expect(row.due_now, `bare now() misreads the column at offset ${offset}s`).toBe(offset > 0);
      }

      /*
       * The second near-miss, and the one I actually wrote by accident: the
       * *same Date*, interpolated into a raw `sql` fragment instead of handed
       * to `lte`. It never reaches the column's mapper — the driver serialises
       * it as this process's local wall clock — so a value that is equal to
       * the stored one by definition does not compare equal to it.
       *
       * Only visible when this process is not in UTC, for the same reason.
       */
      const processOffset = -new Date().getTimezoneOffset();
      if (processOffset !== 0) {
        expect(
          row.due_raw_param,
          "a Date in raw SQL bypasses the column mapper and is out by the process offset",
        ).toBe(processOffset > 0);
      }
    } finally {
      await db.execute(sql`drop table if exists clock_probe`);
    }
  }, 60_000);
});

describe("starting a season", () => {
  it("seeds a world with the incumbents and everyone who turned up", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId } = await readyRoom(app);

    await startReadySeasons();

    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    expect(season.status).toBe("running");
    expect(season.year).toBe(1);
    expect(season.world).toBeTruthy();

    const world = season.world as World;
    const team = world.companies.find((c) => c.id === ventureId);
    expect(team, "the team that named itself should be in the world").toBeTruthy();
    expect(team!.name).toBe("Northbound");
    expect(team!.debt, "nobody starts a season in debt").toBe(0);
    expect(world.companies.filter((c) => c.kind === "incumbent").length).toBeGreaterThan(0);
  }, 120_000);

  it("waits for the rooms that are still arguing", async () => {
    /*
     * Everyone in a season must live through the same years, so year one does
     * not begin while somebody is still choosing a seat.
     */
    const app = await getTestApp();
    const { seasonId } = await readyRoom(app);

    // A second room in the same season, still filling.
    const latecomer = await player(app);
    await latecomer.agent.post("/api/sim/join").send({ nicheId: NICHE });

    await startReadySeasons();

    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    expect(season.status).toBe("forming");
  }, 120_000);

  it("starts a season that was abandoned while a company was still running", async () => {
    /*
     * The state this fixes was real: one room, one chief executive, four bots,
     * the company running, and the season around it marked abandoned. Nothing
     * read that status except the starter, so nothing could ever start it, and
     * the person in the chief executive's chair saw "waiting for year one"
     * with no end and no explanation.
     */
    const app = await getTestApp();
    const { seasonId, ventureId } = await readyRoom(app);
    await db.update(simSeasons).set({ status: "abandoned" }).where(eq(simSeasons.id, seasonId));

    await startReadySeasons();

    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    expect(season.status, "the running room outranks the conclusion").toBe("running");
    expect(season.world, "and it got a world, not just a status").toBeTruthy();
    expect((season.world as any).companies.some((c: any) => c.id === ventureId)).toBe(true);
  }, 120_000);

  it("leaves an abandoned season alone when nothing in it is running", async () => {
    const app = await getTestApp();
    const p = await player(app);
    const join = await p.agent.post("/api/sim/join").send({ nicheId: NICHE });
    const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, join.body.ventureId));
    await db.update(simVentures).set({ phase: "retired" }).where(eq(simVentures.id, venture.id));
    await db.update(simSeasons).set({ status: "abandoned" }).where(eq(simSeasons.id, venture.seasonId));

    await startReadySeasons();

    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, venture.seasonId));
    expect(season.status).toBe("abandoned");
    expect(season.world).toBeFalsy();
  }, 120_000);

  it("gives up on a season where every room fell apart", async () => {
    const app = await getTestApp();
    const p = await player(app);
    const join = await p.agent.post("/api/sim/join").send({ nicheId: NICHE });
    const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, join.body.ventureId));

    await db.update(simVentures).set({ phase: "retired" }).where(eq(simVentures.id, venture.id));
    await startReadySeasons();

    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, venture.seasonId));
    expect(season.status).toBe("abandoned");
  }, 120_000);
});

describe("resolving a year", () => {
  it("writes a report for every company and moves the season on", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId } = await readyRoom(app);
    await startReadySeasons();
    await makeDue(seasonId);

    const resolved = await tickSeason(seasonId);
    expect(resolved).toBe(1);

    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    expect(season.year).toBe(2);

    const reports = await db.select().from(simReports)
      .where(and(eq(simReports.seasonId, seasonId), eq(simReports.year, 1)));
    // Four incumbents and the team.
    expect(reports.length).toBeGreaterThanOrEqual(5);

    const ours = reports.find((r) => r.ventureId === ventureId);
    expect(ours, "the team's own year should be readable back").toBeTruthy();
    expect((ours!.report as any).rank).toBeGreaterThan(0);

    // And the venture carries its own company for the screens.
    const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));
    expect(venture.state).toBeTruthy();
  }, 120_000);

  it("does nothing the second time", async () => {
    /*
     * The heart of it. A tick is several writes and a process can die between
     * any two, so the recovery is to run it again — which is only safe if
     * running it again is a no-op.
     */
    const app = await getTestApp();
    const { seasonId } = await readyRoom(app);
    await startReadySeasons();
    await makeDue(seasonId);

    expect(await tickSeason(seasonId)).toBe(1);
    const after = await db.select().from(simReports).where(eq(simReports.seasonId, seasonId));

    // Due again, same year already resolved.
    expect(await tickSeason(seasonId)).toBeNull();

    const later = await db.select().from(simReports).where(eq(simReports.seasonId, seasonId));
    expect(later.length, "a repeated tick must not write a second set of reports").toBe(after.length);

    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    expect(season.year, "and must not skip a year").toBe(2);
  }, 120_000);

  it("is not due until it is due", async () => {
    const app = await getTestApp();
    const { seasonId } = await readyRoom(app);
    await startReadySeasons();

    // startReadySeasons sets the first tick in the future.
    expect(await tickSeason(seasonId)).toBeNull();
    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    expect(season.year).toBe(1);
  }, 120_000);

  it("uses what a player submitted, and covers the chairs nobody sat in", async () => {
    const app = await getTestApp();
    const { players, ventureId, seasonId } = await readyRoom(app);
    await startReadySeasons();

    // The CMO files a plan; nobody else does.
    await db.insert(simDecisions).values({
      ventureId,
      userId: players[1].id,
      role: "cmo",
      year: 1,
      payload: { price: 19, brandSpend: 400_000, performanceSpend: 200_000, celebritySpend: 0, targetCities: [] },
    });

    await makeDue(seasonId);
    expect(await tickSeason(seasonId)).toBe(1);

    const [report] = await db.select().from(simReports)
      .where(and(eq(simReports.seasonId, seasonId), eq(simReports.ventureId, ventureId), eq(simReports.year, 1)));
    const body = report.report as any;

    // The price the CMO actually chose.
    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    const team = (season.world as World).companies.find((c) => c.id === ventureId)!;
    expect(team.price).toBe(19);

    // And the four empty chairs are named, so a thin year has an explanation.
    expect(body.notes.join(" "), JSON.stringify(body.notes)).toMatch(/no decisions came in|nobody filed/i);
  }, 120_000);

  it("plays out a whole season and stops at the end of it", async () => {
    const app = await getTestApp();
    const { seasonId } = await readyRoom(app);
    await startReadySeasons();

    for (let year = 1; year <= 14; year++) {
      await makeDue(seasonId);
      expect(await tickSeason(seasonId), `year ${year} should resolve`).toBe(year);
    }

    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    expect(season.status).toBe("finished");
    expect(season.nextTickAt, "a finished season has no next tick").toBeNull();

    // Nothing more happens, however often the job runs.
    await makeDue(seasonId);
    expect(await tickSeason(seasonId)).toBeNull();

    const reports = await db.select().from(simReports).where(eq(simReports.seasonId, seasonId));
    expect(reports.length).toBeGreaterThanOrEqual(14);
  }, 300_000);
});

describe("a season that was already broken", () => {
  it("repairs a world holding numbers that are not numbers", async () => {
    /*
     * Before the engine refused to spread a NaN, one malformed decision could
     * turn every company's cash into one — the incumbents included — and the
     * world was written back that way. Nothing recovered on its own: each tick
     * read the broken figure, produced another, and saved it again, so a team
     * saw "£NaN" until somebody edited the row by hand.
     *
     * Any season saved during that window is still out there, which is why the
     * repair happens on the way in rather than only at the boundary.
     */
    const app = await getTestApp();
    const { ventureId, seasonId } = await readyRoom(app);
    await startReadySeasons();

    const [before] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    const broken = before.world as World;
    broken.companies = broken.companies.map((c) => ({
      ...c,
      cash: Number.NaN,
      reputation: Number.NaN,
      customers: Object.fromEntries(Object.keys(c.customers).map((s) => [s, Number.NaN])),
    }));
    await db.update(simSeasons).set({ world: broken }).where(eq(simSeasons.id, seasonId));

    await makeDue(seasonId);
    expect(await tickSeason(seasonId), "a broken season should still resolve").toBe(1);

    const [after] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    for (const company of (after.world as World).companies) {
      expect(Number.isFinite(company.cash), `${company.name} cash is still ${company.cash}`).toBe(true);
      expect(Number.isFinite(company.reputation), `${company.name} reputation`).toBe(true);
      for (const held of Object.values(company.customers)) {
        expect(Number.isFinite(held), `${company.name} customers`).toBe(true);
      }
    }

    const [report] = await db.select().from(simReports)
      .where(and(eq(simReports.ventureId, ventureId), eq(simReports.year, 1)));
    expect(Number.isFinite((report.report as any).cash), "the year's report is readable").toBe(true);
  }, 180_000);
});

describe("the pass", () => {
  it("settles, starts and resolves in one go", async () => {
    const app = await getTestApp();
    const { seasonId } = await readyRoom(app);

    const first = await runSimulationPass();
    expect(first, "the pass should have taken the lock").not.toBeNull();
    expect(first!.started).toBeGreaterThanOrEqual(1);

    await makeDue(seasonId);
    const second = await runSimulationPass();
    expect(second!.resolved).toBeGreaterThanOrEqual(1);
  }, 180_000);
});
