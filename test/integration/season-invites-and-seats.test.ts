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
