/**
 * A season for one, and a room that waits for nobody.
 *
 * Two failures of the same kind: the room making a decision it had no business
 * making, and then not telling the truth about its own shape.
 *
 * A season built as a table of one still reported five seats, because the room
 * route returned the catalogue's `LOBBY_SIZE` rather than the season's own
 * `seatCount`. So somebody playing solo was told "waiting for 4 more", shown a
 * countdown to bots filling chairs that do not exist, and handed an invite link
 * offering four seats nobody could ever take.
 *
 * And a room of five offered one outcome with no say in it: bots a minute after
 * the last arrival. The flag that turns that off — set when a buyer holds seats
 * for colleagues — left them with the opposite trap, waiting for people who may
 * not be coming, in a lobby that eventually retires itself with the seat spent
 * either way.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { users, simSeasons, simVentures, simSeats } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const ip = `198.51.121.${(n % 200) + 20}`;
  const email = `solo-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: first });
  expect(res.status).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

/** A season of `seatCount` chairs, with one person already in a room of it. */
async function roomOf(app: any, seatCount: number, opts: { botFill?: boolean } = {}) {
  const who = await person(app, "Solo");
  const [season] = await db.insert(simSeasons).values({
    nicheId: "podcasts", name: `Seat count ${seatCount} — ${++n}`, status: "forming",
    totalYears: 4, cadence: "quarterly", origin: "nova",
    inviteCode: `SC${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    seatCount, botFill: opts.botFill ?? true, botTeams: 0, createdAt: new Date(),
  } as any).returning();

  const [venture] = await db.insert(simVentures).values({
    seasonId: season.id, phase: "filling", createdAt: new Date(),
  } as any).returning();
  await db.insert(simSeats).values({ ventureId: venture.id, userId: who.id, joinedAt: new Date() } as any);

  return { who, season, venture };
}

const room = (agent: any, ventureId: string) => agent.get(`/api/sim/ventures/${ventureId}`);

describe("a season for one", () => {
  it("says it is a room for one, and offers no link to fill it", async () => {
    const app = await getTestApp();
    const { who, venture } = await roomOf(app, 1);

    const res = await room(who.agent, venture.id);
    expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(200);

    /*
     * The whole bug in one assertion. Five here is what put "waiting for 4
     * more" on a solo player's screen.
     */
    expect(res.body.lobbySize, "the season's own seat count, not the catalogue default").toBe(1);

    /*
     * And nothing to send anybody. An invite to a table with no spare chair is
     * an offer that cannot be honoured — whoever followed it would be refused
     * and the sender would not know why.
     */
    expect(res.body.inviteCode, "no seat to invite anybody to").toBeNull();
  }, 90_000);

  it("refuses to be filled, because there is nothing to fill", async () => {
    const app = await getTestApp();
    const { who, venture } = await roomOf(app, 1);

    const res = await who.agent.post(`/api/sim/ventures/${venture.id}/fill`).send({ bots: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("solo");
  }, 90_000);
});

describe("a room of five that is tired of waiting", () => {
  it("fills the empty chairs when somebody in it asks", async () => {
    const app = await getTestApp();
    const { who, season, venture } = await roomOf(app, 5);

    /* Still gathering, one human, four empty. */
    expect((await room(who.agent, venture.id)).body.lobbySize).toBe(5);

    const res = await who.agent.post(`/api/sim/ventures/${venture.id}/fill`).send({ bots: true });
    expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(200);
    expect(res.body.seated, "four players we run took the empty seats").toBe(4);

    const seated = await db.select().from(simSeats).where(eq(simSeats.ventureId, venture.id));
    expect(seated).toHaveLength(5);

    /* And they are marked as what they are, all season. */
    const botIds = seated.map((s) => s.userId);
    const bots = await db.select({ isBot: users.isBot }).from(users)
      .where(and(eq(users.isBot, true)));
    expect(bots.length, "the seats were taken by bot accounts").toBeGreaterThan(0);
    expect(botIds).toContain(seated[1].userId);

    void season;
  }, 120_000);

  it("does it without waiting the minute out, which is the point", async () => {
    const app = await getTestApp();
    const { who, venture } = await roomOf(app, 5);

    /*
     * The automatic fill only acts on a room that has stalled — measured from
     * the most recent arrival, a minute ago. This room was joined a second
     * ago, so nothing would have happened on its own.
     */
    const res = await who.agent.post(`/api/sim/ventures/${venture.id}/fill`).send({ bots: true });
    expect(res.status).toBe(200);
    expect(res.body.seated).toBeGreaterThan(0);
  }, 120_000);

  it("holds the seats for people when asked, and stops the countdown", async () => {
    const app = await getTestApp();
    const { who, season, venture } = await roomOf(app, 5, { botFill: true });

    const res = await who.agent.post(`/api/sim/ventures/${venture.id}/fill`).send({ bots: false });
    expect(res.status).toBe(200);
    expect(res.body.seated).toBe(0);

    /*
     * Written down, not just obeyed once. Pressing "keep them for people" and
     * having the minute job seat bots thirty seconds later would be the product
     * ignoring what it had been told.
     */
    const [after] = await db.select().from(simSeasons).where(eq(simSeasons.id, season.id));
    expect(after.botFill, "the answer sticks").toBe(false);

    const seats = await db.select().from(simSeats).where(eq(simSeats.ventureId, venture.id));
    expect(seats, "still just the one person").toHaveLength(1);
  }, 120_000);

  it("lets somebody who held the seats change their mind", async () => {
    const app = await getTestApp();
    /* A buyer who took seats for colleagues who have not turned up. */
    const { who, venture } = await roomOf(app, 5, { botFill: false });

    /*
     * Previously a dead end: `botFill: false` meant the room waited for people
     * indefinitely, and a lobby that never fills retires itself with the seat
     * spent. Holding seats is a default, not a prohibition.
     */
    const res = await who.agent.post(`/api/sim/ventures/${venture.id}/fill`).send({ bots: true });
    expect(res.status).toBe(200);
    expect(res.body.seated).toBeGreaterThan(0);
  }, 120_000);

  it("is nobody's business but the people in the room", async () => {
    const app = await getTestApp();
    const { venture } = await roomOf(app, 5);
    const stranger = await person(app, "Nosy");

    /* 404, not 403: whose room this is, is not the asker's business. */
    const res = await stranger.agent.post(`/api/sim/ventures/${venture.id}/fill`).send({ bots: true });
    expect(res.status).toBe(404);
  }, 90_000);
});
