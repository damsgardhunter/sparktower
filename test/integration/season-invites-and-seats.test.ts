/**
 * A company's own season, from the invitation to two tables competing in it.
 *
 * What was already covered: a company shaping a season, paying for seats, and
 * five colleagues filling one table. What was not, and is what somebody
 * running a workshop actually does:
 *
 *   - invite the room, and have more than five turn up, so the season holds
 *     two companies rather than one, and they compete in the same market
 *   - buy seats once and spend them across several seasons, because seats
 *     belong to the company that bought them and not to a particular season
 *   - arrive late, which today is refused
 *
 * That last one is recorded here as it stands rather than as it should be. A
 * season whose tables have started turns latecomers away, and the person
 * running the session is the one who knows whether there is really no room —
 * see the note on the test itself.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { makeVerifiedCompany } from "../helpers/company";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { companies, simSeasons, simVentures, simSeats, users, notifications } from "@shared/schema";
import { startReadySeasons } from "../../server/simulation-tick";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const NICHE = "dating_apps";
const ROLES = ["ceo", "cmo", "cfo", "cto", "coo"] as const;

async function player(app: any, firstName = `I${n + 1}`) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.181.${(n % 200) + 20}`;
  const email = `invite-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string, email };
}

/** A verified company with `staff` colleagues already accepted into it. */
async function companyWithStaff(app: any, staff: number) {
  const owner = await player(app, "Owner");
  const made = await makeVerifiedCompany(owner.agent, "Northwind Trading");
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const companyId = made.body.company.id as string;
  await db.update(users).set({ balanceCents: 50_000 }).where(eq(users.id, owner.id));
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

/** Seats credited the way a paid Stripe session credits them. */
const giveSeats = (companyId: string, count: number) =>
  db.update(companies).set({ simPlaySeatsPaid: count }).where(eq(companies.id, companyId));

async function privateSeason(owner: any, companyId: string, body: Record<string, unknown> = {}) {
  const made = await owner.agent.post(`/api/companies/${companyId}/seasons`)
    .send({ nicheId: NICHE, name: "Leadership away day", periodMinutes: 30, totalYears: 6, ...body });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  return made.body as { seasonId: string; inviteCode: string; joinUrl: string };
}

/** Everyone joins by code; each full table claims its seats and gets a name. */
async function seatEveryone(people: any[], code: string) {
  const byVenture = new Map<string, any[]>();
  for (const p of people) {
    const join = await p.agent.post("/api/sim/join-code").send({ code });
    expect(join.status, JSON.stringify(join.body)).toBe(200);
    const id = join.body.ventureId as string;
    byVenture.set(id, [...(byVenture.get(id) ?? []), p]);
  }
  for (const [ventureId, table] of byVenture) {
    for (const [i, p] of table.entries()) {
      await p.agent.post(`/api/sim/ventures/${ventureId}/claim`).send({ role: ROLES[i] });
    }
    if (table.length === ROLES.length) {
      await table[0].agent.post(`/api/sim/ventures/${ventureId}/name`).send({ name: `Table ${byVenture.size}-${ventureId.slice(0, 4)}` });
    }
  }
  return byVenture;
}

describe("inviting a room to a company's season", () => {
  it("tells the colleagues there is a seat, and the link leads to the season", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await companyWithStaff(app, 2);
    /*
     * Seats first. Inviting is itself a paywall — it answers 402
     * `seats_required` when there is nowhere to put the people being asked,
     * which is the right way round: a workshop that could invite forty people
     * and seat five would waste everybody's morning.
     */
    await giveSeats(companyId, 5);
    const { seasonId, inviteCode, joinUrl } = await privateSeason(owner, companyId);

    const sent = await owner.agent.post(`/api/companies/${companyId}/seasons/${seasonId}/invite`).send({});
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);

    const told = await db.select().from(notifications).where(eq(notifications.kind, "season_invite"));
    expect(told.length, "both colleagues should have been told").toBeGreaterThanOrEqual(2);
    expect(joinUrl).toBe(`/join-season/${inviteCode}`);

    /* And the code answers for somebody inside the company. */
    const look = await owner.agent.get(`/api/sim/join-code/${inviteCode}`);
    expect(look.status, JSON.stringify(look.body)).toBe(200);
    expect(look.body.company?.name).toBe("Northwind Trading");
    expect(look.body.isMember, "the code is for people inside the company").toBe(true);
    expect(look.body.seasonId).toBe(seasonId);
  }, 180_000);

  /*
   * More than one table in a season is the point of running one: the companies
   * are each other's market, and a workshop with ten people should end with two
   * of them competing rather than one playing against bots.
   */
  it("seats ten colleagues as two companies competing in one market", async () => {
    const app = await getTestApp();
    const { owner, companyId, people } = await companyWithStaff(app, 9);
    await giveSeats(companyId, 10);
    const { seasonId, inviteCode } = await privateSeason(owner, companyId);

    const tables = await seatEveryone(people, inviteCode);
    expect(tables.size, "ten people, five to a table").toBe(2);

    const ventures = await db.select().from(simVentures).where(eq(simVentures.seasonId, seasonId));
    expect(ventures.length).toBe(2);
    expect(ventures.every((v) => v.phase === "running"), "both tables finished their lobby").toBe(true);

    /* Five people, five different chairs, on each table. */
    for (const venture of ventures) {
      const seats = await db.select().from(simSeats).where(eq(simSeats.ventureId, venture.id));
      expect(seats.length).toBe(5);
      expect(new Set(seats.map((s) => s.role)).size, "nobody doubles up on a chair").toBe(5);
    }

    const started = await owner.agent.post(`/api/companies/${companyId}/seasons/${seasonId}/start`).send({});
    expect(started.status, JSON.stringify(started.body)).toBe(200);

    /* And they are in one market, so what one does reaches the other. */
    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    expect(season.status).toBe("running");
    const running = await db.select().from(simVentures)
      .where(and(eq(simVentures.seasonId, seasonId), inArray(simVentures.phase, ["running"])));
    expect(running.length, "both companies are playing the same season").toBe(2);
  }, 300_000);
});

/**
 * A season played one company each.
 *
 * The same room, the other exercise. Five to a table teaches people to run a
 * company with four colleagues who disagree; a company each teaches them to
 * run all of it against colleagues who are trying to win. A workshop should be
 * able to ask for either, and the difference is one number — how many chairs a
 * table has — which is why it went unoffered for so long.
 */
describe("a season played one company each", () => {
  /** Three people, three companies, one market. */
  it("gives every joiner their own company holding all five desks", async () => {
    const app = await getTestApp();
    const { owner, companyId, people } = await companyWithStaff(app, 2);
    await giveSeats(companyId, 3);
    const { seasonId } = await privateSeason(owner, companyId, { name: "Founder's day", mode: "solo" });

    const [opened] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    expect(opened.seatCount, "a table of one").toBe(1);

    /*
     * Everybody joins the same code, as in team mode. Nobody claims a chair,
     * because there is nothing to claim: the lobby deals the one seat out and
     * moves on rather than holding a founder through clocks that exist to give
     * other people time to arrive.
     */
    const mine = new Map<string, string>();
    for (const p of people) {
      const join = await p.agent.post("/api/sim/join-code").send({ code: opened.inviteCode! });
      expect(join.status, JSON.stringify(join.body)).toBe(200);
      mine.set(p.id, join.body.ventureId);
      /* Polling the room is what moves its clock on, exactly as the screen does. */
      for (let i = 0; i < 3; i++) await p.agent.get(`/api/sim/ventures/${join.body.ventureId}`);
    }

    expect(new Set(mine.values()).size, "three founders, three companies — nobody shares a table").toBe(3);

    const ventures = await db.select().from(simVentures).where(eq(simVentures.seasonId, seasonId));
    expect(ventures.length).toBe(3);
    for (const venture of ventures) {
      const seats = await db.select().from(simSeats).where(eq(simSeats.ventureId, venture.id));
      expect(seats.length, "one chair, not five with four bots in them").toBe(1);
      expect(venture.phase, "nothing left to wait for").toBe("running");
      expect(venture.name, "named after the company it was run from").toBeTruthy();
    }

    /*
     * And it starts itself. A team season waits for the person running it,
     * who knows when the room is full; a table of one has nobody to wait for.
     */
    await startReadySeasons();
    const [running] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    expect(running.status).toBe("running");

    /* The desk each of them opens holds every lever, under one title. */
    const desk = await people[1].agent.get(`/api/sim/ventures/${mine.get(people[1].id)}/desk`);
    expect(desk.status, JSON.stringify(desk.body)).toBe(200);
    expect(desk.body.solo).toBe(true);
    expect(desk.body.yourTitle).toBe("Founder");
    expect(desk.body.yourLevers.length, "five desks' levers in one list").toBeGreaterThan(5);
  }, 300_000);

  /* Five or one. Anything else is a team with chairs played by stand-ins. */
  it("refuses a way of playing that is neither", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await companyWithStaff(app, 0);
    await giveSeats(companyId, 5);

    const tried = await owner.agent.post(`/api/companies/${companyId}/seasons`)
      .send({ nicheId: NICHE, name: "Tables of three", periodMinutes: 30, totalYears: 6, mode: "trio" });
    expect(tried.status, JSON.stringify(tried.body)).toBe(400);
    expect(tried.body.field).toBe("mode");
  }, 180_000);

  /* Left out is team mode, so nothing that already worked has to be re-saved. */
  it("still seats five to a table when nobody says", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await companyWithStaff(app, 0);
    await giveSeats(companyId, 5);
    const { seasonId } = await privateSeason(owner, companyId, { name: "As before" });
    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    expect(season.seatCount ?? 5).toBe(5);
  }, 180_000);
});

describe("seats a company has bought", () => {
  /*
   * Seats belong to the company, not to the season they were first spent on.
   * Somebody buying a room's worth for a workshop should be able to run the
   * workshop again next quarter without buying them twice.
   */
  it("stay with the company and pay for more than one season", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await companyWithStaff(app, 0);
    await giveSeats(companyId, 12);

    const first = await privateSeason(owner, companyId, { name: "Spring workshop" });
    const second = await privateSeason(owner, companyId, { name: "Summer workshop" });
    expect(first.seasonId).not.toBe(second.seasonId);
    expect(first.inviteCode).not.toBe(second.inviteCode);

    /*
     * Never fewer than were bought. Opening a season buys any seats it is
     * short of and adds them to the same pool, so the count can rise — what it
     * must never do is fall, because that would mean a season had consumed
     * seats the company paid for and left it to buy them again next quarter.
     */
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
    expect(company.simPlaySeatsPaid ?? 0, "seats bought are still the company's").toBeGreaterThanOrEqual(12);

    const seasons = await db.select().from(simSeasons).where(eq(simSeasons.companyId, companyId));
    expect(seasons.length, "both seasons belong to the company").toBe(2);
  }, 180_000);

  /* And they are the company's, not a member's: a colleague cannot spend them. */
  it("cannot be spent by somebody who only works there", async () => {
    const app = await getTestApp();
    const { companyId, people } = await companyWithStaff(app, 1);
    await giveSeats(companyId, 5);
    const colleague = people[1];

    const tried = await colleague.agent.post(`/api/companies/${companyId}/seasons`)
      .send({ nicheId: NICHE, name: "Not mine to run", periodMinutes: 30, totalYears: 6 });
    expect([403, 404], `a member should not be able to open a season: ${tried.status}`).toContain(tried.status);
  }, 180_000);
});

describe("arriving after the season has started", () => {
  /*
   * As it stands, not as it should be.
   *
   * A latecomer is turned away with `season_started`, which is right for a
   * public season filled by matchmaking and wrong for a workshop: the person
   * running it knows whether there is really no room, and somebody walking in
   * five minutes late is the commonest thing that happens in a room full of
   * people. Recorded here so that when the season's owner can seat them, this
   * test is the one that has to change, deliberately.
   */
  it("is refused today, and says why", async () => {
    const app = await getTestApp();
    const { owner, companyId, people } = await companyWithStaff(app, 5);
    await giveSeats(companyId, 10);
    const { seasonId, inviteCode } = await privateSeason(owner, companyId);

    await seatEveryone(people.slice(0, 5), inviteCode);
    expect((await owner.agent.post(`/api/companies/${companyId}/seasons/${seasonId}/start`).send({})).status).toBe(200);
    await startReadySeasons();

    const latecomer = people[5];
    const late = await latecomer.agent.post("/api/sim/join-code").send({ code: inviteCode });
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("season_started");
  }, 300_000);
});

/**
 * Watching the room while it plays.
 *
 * The report answers "how did that go" once a season is over. This answers the
 * question somebody running a session asks every few minutes with a room in
 * front of them: are we waiting on anybody?
 */
describe("watching a season as it runs", () => {
  it("shows every table, who is in each chair, and who has not filed yet", async () => {
    const app = await getTestApp();
    const { owner, companyId, people } = await companyWithStaff(app, 9);
    await giveSeats(companyId, 10);
    const { seasonId, inviteCode } = await privateSeason(owner, companyId);
    const tables = await seatEveryone(people, inviteCode);
    expect((await owner.agent.post(`/api/companies/${companyId}/seasons/${seasonId}/start`).send({})).status).toBe(200);

    const before = await owner.agent.get(`/api/companies/${companyId}/seasons/${seasonId}/watch`);
    expect(before.status, JSON.stringify(before.body).slice(0, 300)).toBe(200);
    expect(before.body.tables.length, "both tables are being watched").toBe(2);
    expect(before.body.season.year).toBe(1);

    for (const table of before.body.tables) {
      expect(table.of, "five chairs to a table").toBe(5);
      expect(table.filed, "nobody has filed yet").toBe(0);
      expect(table.waitingOn.length, "so the whole table is being waited on").toBe(5);
      expect(new Set(table.chairs.map((c: any) => c.role)).size).toBe(5);
      expect(table.chairs.every((c: any) => c.roleTitle), "every chair says what it is").toBe(true);
    }

    /* One person files, and the room's view moves by exactly one. */
    const [firstVenture] = [...tables.keys()];
    const filer = (tables.get(firstVenture) ?? [])[0];
    const filedRes = await filer.agent.post(`/api/sim/ventures/${firstVenture}/decisions`)
      .send({ decision: { focus: "growth", positioning: "" } });
    expect(filedRes.status, JSON.stringify(filedRes.body).slice(0, 200)).toBe(200);

    const after = await owner.agent.get(`/api/companies/${companyId}/seasons/${seasonId}/watch`);
    const watched = after.body.tables.find((t: any) => t.ventureId === firstVenture);
    expect(watched.filed, "one chair has committed").toBe(1);
    expect(watched.waitingOn.length, "and four are still being waited on").toBe(4);
    const committed = watched.chairs.find((c: any) => c.filed);
    expect(committed.name, "the facilitator can see who it was").toBeTruthy();
  }, 300_000);

  /*
   * The rule that keeps this from being a cheat. A facilitator running a
   * season they are not in can read what each table filed — they are about to
   * debrief it, and the final report shows it anyway. One who is *seated* in
   * it cannot, because that is every rival's plan handed to a player before
   * the year resolves.
   */
  it("hands the decisions to a facilitator who is not playing", async () => {
    const app = await getTestApp();
    const { owner, companyId, people } = await companyWithStaff(app, 5);
    await giveSeats(companyId, 10);
    const { seasonId, inviteCode } = await privateSeason(owner, companyId);
    /* The five colleagues play; the owner runs it and sits out. */
    const tables = await seatEveryone(people.slice(1, 6), inviteCode);
    await owner.agent.post(`/api/companies/${companyId}/seasons/${seasonId}/start`).send({});

    const [ventureId] = [...tables.keys()];
    await (tables.get(ventureId) ?? [])[0].agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { focus: "margin", positioning: "" } });

    const watch = await owner.agent.get(`/api/companies/${companyId}/seasons/${seasonId}/watch`);
    expect(watch.body.playing, "the owner took no seat").toBe(false);
    const filed = watch.body.tables.flatMap((t: any) => t.chairs).find((c: any) => c.filed);
    expect(filed.decision, "a facilitator who is not playing sees what was filed").toBeTruthy();
    expect(filed.decision.focus).toBe("margin");
  }, 300_000);

  it("withholds them from a facilitator who is playing in it", async () => {
    const app = await getTestApp();
    const { owner, companyId, people } = await companyWithStaff(app, 4);
    await giveSeats(companyId, 10);
    const { seasonId, inviteCode } = await privateSeason(owner, companyId);
    /* This time the owner sits down with everybody else. */
    const tables = await seatEveryone(people.slice(0, 5), inviteCode);
    await owner.agent.post(`/api/companies/${companyId}/seasons/${seasonId}/start`).send({});

    const [ventureId] = [...tables.keys()];
    await (tables.get(ventureId) ?? [])[1].agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { price: 19 } });

    const watch = await owner.agent.get(`/api/companies/${companyId}/seasons/${seasonId}/watch`);
    expect(watch.body.playing, "the owner is seated in this season").toBe(true);
    const chairs = watch.body.tables.flatMap((t: any) => t.chairs);
    expect(chairs.some((c: any) => c.filed), "they can still see that somebody filed").toBe(true);
    expect(chairs.every((c: any) => c.decision === null), "but not a single decision's contents").toBe(true);
  }, 300_000);

  it("is not readable by somebody who only works there", async () => {
    const app = await getTestApp();
    const { owner, companyId, people } = await companyWithStaff(app, 1);
    await giveSeats(companyId, 5);
    const { seasonId } = await privateSeason(owner, companyId);
    const colleague = people[1];
    const tried = await colleague.agent.get(`/api/companies/${companyId}/seasons/${seasonId}/watch`);
    expect([403, 404]).toContain(tried.status);
  }, 180_000);
});
