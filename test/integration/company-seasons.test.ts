/**
 * Private training seasons, against the real app and the real clock.
 *
 * The rules worth pinning are the ones about who ends up at whose table: a
 * company's season is for its own people, public matchmaking never finds it,
 * and a code forwarded outside the company seats nobody. Then the clock: a
 * year that is meant to last minutes must not be scheduled a day out, and
 * resolving a year early must actually resolve it. And the report the company
 * reads at the end has to say what its people did.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { companyAuditLog, simSeasons, simVentures, simSeats, simReports, notifications } from "@shared/schema";
import { startReadySeasons, tickSeason } from "../../server/simulation-tick";

afterAll(async () => { await closeTestApp(); });

const NICHE = "dating_apps";

let n = 0;
async function player(app: any, firstName = `S${n + 1}`) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.153.${(n % 200) + 20}`;
  const email = `cs-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

/** A company, its owner, and `staff` more people who joined through the team link. */
async function companyWithStaff(app: any, staff: number) {
  const owner = await player(app, "Owner");
  const made = await owner.agent.post("/api/companies").send({ name: "Northwind Trading" });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const companyId = made.body.company.id as string;
  const people = [owner];
  for (let i = 0; i < staff; i++) {
    const p = await player(app);
    const link = await owner.agent.post(`/api/companies/${companyId}/invite-link`).send({});
    const token = new URL(link.body.url).searchParams.get("invite");
    expect((await p.agent.post("/api/company-invites/accept").send({ token })).status).toBe(200);
    people.push(p);
  }
  return { owner, companyId, people };
}

async function privateSeason(owner: any, companyId: string, body: Record<string, unknown> = {}) {
  const made = await owner.agent.post(`/api/companies/${companyId}/seasons`)
    .send({ nicheId: NICHE, name: "Leadership away day", yearMinutes: 30, totalYears: 6, ...body });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  expect(made.body.inviteCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
  expect(made.body.joinUrl).toBe(`/join-season/${made.body.inviteCode}`);
  return made.body as { seasonId: string; inviteCode: string; joinUrl: string };
}

/** Five colleagues join by code, take the five seats and name the company. */
async function fillTable(people: any[], code: string) {
  let ventureId = "";
  for (const p of people.slice(0, 5)) {
    const join = await p.agent.post("/api/sim/join-code").send({ code });
    expect(join.status, JSON.stringify(join.body)).toBe(200);
    expect(join.body.ventureId, "all five at one table").toBe(ventureId || join.body.ventureId);
    ventureId = join.body.ventureId;
  }
  const roles = ["ceo", "cmo", "cfo", "cto", "coo"];
  for (const [i, p] of people.slice(0, 5).entries()) {
    const claim = await p.agent.post(`/api/sim/ventures/${ventureId}/claim`).send({ role: roles[i] });
    expect(claim.status, `claiming ${roles[i]}: ${JSON.stringify(claim.body)}`).toBe(200);
  }
  const named = await people[0].agent.post(`/api/sim/ventures/${ventureId}/name`).send({ name: "Blue Harbour" });
  expect(named.status, JSON.stringify(named.body)).toBe(200);
  const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));
  expect(venture.phase).toBe("running");
  return ventureId;
}

describe("a season a company shapes for itself", () => {
  /*
   * The two things a company running its own season can change about the world
   * it plays in: how much of it there is, and who else is in it. Both default
   * to the game every public season plays, because a company that just wants a
   * season should get one without answering questions about continents.
   */
  it("defaults to the market's own regions and nobody but the people invited", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await companyWithStaff(app, 1);
    const { seasonId } = await privateSeason(owner, companyId);

    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    expect(season.scope).toBe("home");
    expect(season.botTeams).toBe(0);
  }, 120_000);

  it("takes a continent, or the whole world, and refuses a place that isn't one", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await companyWithStaff(app, 1);

    for (const scope of ["world", "north_america", "asia"]) {
      const { seasonId } = await privateSeason(owner, companyId, { scope });
      const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
      expect(season.scope, scope).toBe(scope);
    }

    const bad = await owner.agent.post(`/api/companies/${companyId}/seasons`)
      .send({ nicheId: NICHE, name: "Nowhere", scope: "atlantis" });
    expect(bad.status).toBe(400);
    expect(bad.body.field).toBe("scope");
  }, 180_000);

  it("plays a scoped season on the map, and a home season on its own regions", async () => {
    const app = await getTestApp();
    const { owner, companyId, people } = await companyWithStaff(app, 5);
    const { seasonId, inviteCode } = await privateSeason(owner, companyId, { scope: "north_america" });
    const ventureId = await fillTable(people, inviteCode);
    expect((await owner.agent.post(`/api/companies/${companyId}/seasons/${seasonId}/start`).send({})).status).toBe(200);

    const desk = await people[0].agent.get(`/api/sim/ventures/${ventureId}/desk`);
    const ids = desk.body.cities.map((c: any) => c.id);
    expect(ids, "an American season is played in America").toContain("us_east");
    expect(ids).not.toContain("leeds");
    // And every region says which continent it is on, so the desk can price
    // being foreign in it.
    for (const city of desk.body.cities) expect(city.continent).toBe("north_america");
  }, 240_000);

  it("seats the rivals a company asked for, and they play the season", async () => {
    /*
     * A season with one real table in it is a company with no competition:
     * every price is the right price, and the lesson the team comes away with
     * is the wrong one.
     */
    const app = await getTestApp();
    const { owner, companyId, people } = await companyWithStaff(app, 5);
    const { seasonId, inviteCode } = await privateSeason(owner, companyId, { botTeams: 3 });
    const ventureId = await fillTable(people, inviteCode);

    const started = await owner.agent.post(`/api/companies/${companyId}/seasons/${seasonId}/start`).send({});
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body.teams, "the table plus the three it asked for").toBe(4);

    const rooms = await db.select().from(simVentures).where(eq(simVentures.seasonId, seasonId));
    const rivals = rooms.filter((v) => v.id !== ventureId);
    expect(rivals).toHaveLength(3);
    for (const rival of rivals) {
      expect(rival.botOnly, "a seated rival is a company of bots").toBe(true);
      expect(rival.name, "and it has a name, not a blank in the standings").toBeTruthy();
      const seats = await db.select().from(simSeats).where(eq(simSeats.ventureId, rival.id));
      expect(seats).toHaveLength(5);
      expect(new Set(seats.map((s) => s.role)).size, "all five chairs").toBe(5);
    }

    // And they are in the world the season plays, not a list beside it.
    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    const players = (season.world as any).companies.filter((c: any) => c.kind === "player");
    expect(players).toHaveLength(4);
  }, 240_000);

  it("refuses more rivals than a market can hold", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await companyWithStaff(app, 1);
    const tooMany = await owner.agent.post(`/api/companies/${companyId}/seasons`)
      .send({ nicheId: NICHE, name: "A crowd", botTeams: 500 });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.field).toBe("botTeams");
  }, 120_000);
});

describe("who can reach a private season", () => {
  it("is never chosen by public matchmaking", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await companyWithStaff(app, 0);
    const { seasonId, inviteCode } = await privateSeason(owner, companyId);

    // The owner joins their own season first, so it has an open room with space in it.
    const inside = await owner.agent.post("/api/sim/join-code").send({ code: inviteCode.toLowerCase() });
    expect(inside.status, JSON.stringify(inside.body)).toBe(200);

    const stranger = await player(app);
    const pub = await stranger.agent.post("/api/sim/join").send({ nicheId: NICHE });
    expect(pub.status).toBe(200);
    expect(pub.body.ventureId).not.toBe(inside.body.ventureId);
    const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, pub.body.ventureId));
    expect(venture.seasonId).not.toBe(seasonId);
    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, venture.seasonId));
    expect(season.companyId).toBeNull();

    // And the owner, in the private room, still gets a public one of their own when they ask for it.
    const ownerPublic = await owner.agent.post("/api/sim/join").send({ nicheId: NICHE });
    expect(ownerPublic.body.ventureId).not.toBe(inside.body.ventureId);
  }, 120_000);

  it("refuses the code to anyone outside the company", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await companyWithStaff(app, 0);
    const { inviteCode } = await privateSeason(owner, companyId);
    const stranger = await player(app);

    const peek = await stranger.agent.get(`/api/sim/join-code/${inviteCode}`);
    expect(peek.status).toBe(200);
    expect(peek.body).toMatchObject({ isMember: false, company: { name: "Northwind Trading" }, niche: { id: NICHE } });

    const join = await stranger.agent.post("/api/sim/join-code").send({ code: inviteCode });
    // Refused exactly as a wrong code is, so a forwarded code confirms nothing by being tried.
    expect(join.status).toBe(404);
    expect(join.body.code).toBe("unknown_code");
    expect((await stranger.agent.post("/api/sim/join-code").send({ code: "ZZZZZZZZ" })).status).toBe(404);
  }, 120_000);

  it("keeps season management to admins, and seasons to their own company", async () => {
    const app = await getTestApp();
    const { owner, companyId, people } = await companyWithStaff(app, 1);
    const member = people[1];
    expect((await member.agent.post(`/api/companies/${companyId}/seasons`).send({ nicheId: NICHE })).status).toBe(403);
    const { seasonId } = await privateSeason(owner, companyId);
    expect((await member.agent.get(`/api/companies/${companyId}/seasons/${seasonId}/report`)).status).toBe(403);

    const other = await companyWithStaff(app, 0);
    expect((await other.owner.agent.get(`/api/companies/${other.companyId}/seasons/${seasonId}/report`)).status).toBe(404);

    const list = await member.agent.get(`/api/companies/${companyId}/seasons`);
    expect(list.status).toBe(200);
    expect(list.body.seasons[0]).toMatchObject({ id: seasonId, status: "forming", rooms: 0, players: 0, yearMinutes: 30, totalYears: 6 });
  }, 120_000);

  it("invites colleagues with a notification that leads to the join page", async () => {
    const app = await getTestApp();
    const { owner, companyId, people } = await companyWithStaff(app, 2);
    const stranger = await player(app);
    const { seasonId, inviteCode } = await privateSeason(owner, companyId);
    const sent = await owner.agent.post(`/api/companies/${companyId}/seasons/${seasonId}/invite`)
      .send({ userIds: [people[1].id, stranger.id] });
    expect(sent.status).toBe(200);
    expect(sent.body.invited).toBe(1);
    const rows = await db.select().from(notifications).where(eq(notifications.kind, "season_invite"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipientId: people[1].id, targetId: `${seasonId}:${inviteCode}` });
    expect(rows[0].excerpt).toContain("Northwind Trading");
    expect(rows[0].excerpt).toContain("Leadership away day");
  }, 120_000);
});

describe("a private season's clock", () => {
  it("starts when the company starts it, a year lasts minutes, and a year can be resolved early", async () => {
    const app = await getTestApp();
    const { owner, companyId, people } = await companyWithStaff(app, 5);
    const { seasonId, inviteCode } = await privateSeason(owner, companyId, { yearMinutes: 30 });

    // Nobody has sat down: nothing to start.
    const empty = await owner.agent.post(`/api/companies/${companyId}/seasons/${seasonId}/start`).send({});
    expect(empty.status).toBe(409);
    expect(empty.body.code).toBe("no_tables");

    // Five of the six; the sixth sits this one out and shows up as not playing.
    const ventureId = await fillTable(people.slice(1), inviteCode);

    /*
     * Every table is ready, and still the clock does not start it: the
     * workshop may not all be in yet, and only the company knows.
     */
    expect(await startReadySeasons()).not.toContain(seasonId);
    const [waiting] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    expect(waiting.status).toBe("forming");

    // Only someone with the power may start it.
    expect((await people[1].agent.post(`/api/companies/${companyId}/seasons/${seasonId}/start`).send({})).status).toBe(403);

    const start = await owner.agent.post(`/api/companies/${companyId}/seasons/${seasonId}/start`).send({});
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    expect(start.body).toMatchObject({ status: "running", year: 1, teams: 1 });
    const startAgain = await owner.agent.post(`/api/companies/${companyId}/seasons/${seasonId}/start`).send({});
    expect(startAgain.status).toBe(409);
    expect(startAgain.body.code).toBe("already_started");
    const [logged] = await db.select().from(companyAuditLog)
      .where(and(eq(companyAuditLog.companyId, companyId), eq(companyAuditLog.action, "season_started")));
    expect(logged).toMatchObject({ actorId: owner.id });

    const [started] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    expect(started.status).toBe("running");
    expect(started.nextTickAt!.getTime() - started.startsAt!.getTime(), "a year of 30 minutes, not a day").toBe(30 * 60_000);

    // Once it's running, nobody else can sit down.
    const late = await owner.agent.post("/api/sim/join-code").send({ code: inviteCode });
    expect(late.status).toBe(409);

    // The marketing seat files year one, then the admin ends the year now.
    const cmo = people[2];
    const filed = await cmo.agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { price: 19, brandSpend: 200_000, performanceSpend: 100_000, celebritySpend: 0 } });
    expect(filed.status, JSON.stringify(filed.body)).toBe(200);

    const early = await owner.agent.post(`/api/companies/${companyId}/seasons/${seasonId}/resolve-year-now`).send({});
    expect(early.status, JSON.stringify(early.body)).toBe(200);
    expect(early.body).toMatchObject({ resolvedYear: 1, year: 2, status: "running" });
    const [after] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    expect(after.year).toBe(2);
    const untilNext = after.nextTickAt!.getTime() - Date.now();
    expect(untilNext, "the next year is a full year away, not overdue").toBeGreaterThan(29 * 60_000);
    expect(untilNext).toBeLessThanOrEqual(30 * 60_000);
    const reports = await db.select().from(simReports).where(eq(simReports.seasonId, seasonId));
    expect(reports.some((r) => r.ventureId === ventureId && r.year === 1)).toBe(true);

    // Running it again resolves nothing: the year isn't due.
    expect(await tickSeason(seasonId)).toBeNull();


    // The staff report.
    const report = await owner.agent.get(`/api/companies/${companyId}/seasons/${seasonId}/report`);
    expect(report.status, JSON.stringify(report.body)).toBe(200);
    expect(report.body.season).toMatchObject({ id: seasonId, yearsResolved: 1 });
    expect(report.body.players).toHaveLength(5);
    const row = report.body.players.find((p: any) => p.userId === cmo.id);
    expect(row).toMatchObject({ role: "cmo", teamName: "Blue Harbour", yearsFiled: 1, yearsPlayed: 1, reportYear: 1 });
    expect(row.rank).toBeGreaterThanOrEqual(1);
    expect(row.companiesInMarket).toBeGreaterThan(1);
    expect(typeof row.marketShare).toBe("number");
    expect(typeof row.priceVsMarket).toBe("number");
    expect(row.read).toMatch(/^Filed all 1 year; .*priced .*team \d+(st|nd|rd|th) of \d+ after year 1\.$/);
    const idle = report.body.players.find((p: any) => p.role === "cfo");
    expect(idle).toMatchObject({ yearsFiled: 0, yearsPlayed: 1 });
    expect(idle.read).toMatch(/^Filed 0 of 1 years/);
    expect(report.body.notPlaying.map((p: any) => p.userId)).toEqual([owner.id]);

    /*
     * Somebody whose first table closed in the lobby and who sat down at
     * another holds two seats in the season. The report shows them once, at
     * the table they actually played — even when the dead seat is the newer.
     */
    const [dead] = await db.insert(simVentures).values({ seasonId, name: "Closed Table", phase: "retired" } as any).returning();
    await db.insert(simSeats).values({ ventureId: dead.id, userId: cmo.id, role: "ceo", joinedAt: new Date(Date.now() + 60_000) });
    const again = (await owner.agent.get(`/api/companies/${companyId}/seasons/${seasonId}/report`).expect(200)).body;
    expect(again.players).toHaveLength(5);
    expect(again.players.filter((p: any) => p.userId === cmo.id)).toEqual([expect.objectContaining({ ventureId, role: "cmo", teamName: "Blue Harbour" })]);

    /*
     * A double-click: two presses at once resolve one year, not two, and the
     * one that lost is told so rather than handed a second result.
     */
    const [a, b] = await Promise.all([
      owner.agent.post(`/api/companies/${companyId}/seasons/${seasonId}/resolve-year-now`).send({}),
      owner.agent.post(`/api/companies/${companyId}/seasons/${seasonId}/resolve-year-now`).send({}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((a.status === 200 ? a : b).body).toMatchObject({ resolvedYear: 2, year: 3 });
    expect((a.status === 409 ? a : b).body.code).toBe("already_resolved");
    const [twice] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    expect(twice.year, "one year resolved, not two").toBe(3);
  }, 180_000);

  it("leaves a public season on a day a year", async () => {
    const app = await getTestApp();
    const people = [];
    for (let i = 0; i < 5; i++) people.push(await player(app));
    let ventureId = "";
    for (const p of people) ventureId = (await p.agent.post("/api/sim/join").send({ nicheId: NICHE })).body.ventureId;
    const roles = ["ceo", "cmo", "cfo", "cto", "coo"];
    for (const [i, p] of people.entries()) await p.agent.post(`/api/sim/ventures/${ventureId}/claim`).send({ role: roles[i] });
    await people[0].agent.post(`/api/sim/ventures/${ventureId}/name`).send({ name: "Public Co" });
    const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));
    expect(await startReadySeasons()).toContain(venture.seasonId);
    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, venture.seasonId));
    expect(season.nextTickAt!.getTime() - season.startsAt!.getTime()).toBe(24 * 60 * 60_000);
  }, 180_000);
});
