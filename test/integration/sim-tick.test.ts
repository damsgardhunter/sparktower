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
import { and, eq, inArray } from "drizzle-orm";
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

const NICHE = "fitness_app";

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
  await db.update(simSeasons).set({ status: "abandoned" })
    .where(eq(simSeasons.status, "forming"));

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
