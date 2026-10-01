/**
 * The three ways out of a company, which almost nothing covered.
 *
 * `release`, `leave` and `standings` had one, three and three references
 * between them across the whole integration suite, against fifty-odd for the
 * desk — and they are the routes that run when somebody changes their mind.
 * Getting them wrong is not a number being slightly off: it is a person stuck
 * in a company they walked away from, or four other people playing a season
 * with an empty chair nobody told them about.
 *
 * What makes them worth testing properly is that the right behaviour *changes*
 * part-way through. Before the first year runs, leaving means the seat is given
 * up and an empty room is retired. Once the season is running, the company
 * cannot be unmade — four other people are playing it — so the chair is handed
 * to one of that venture's own bots and the company carries on.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { simSeasons, simSeats, simVentures, users } from "@shared/schema";
import { startReadySeasons } from "../../server/simulation-tick";

afterAll(async () => { await closeTestApp(); });

const NICHE = "mmos";
const ROLES = ["ceo", "cmo", "cfo", "cto", "coo"] as const;

let n = 0;
async function player(app: any) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.152.${(n % 200) + 20}`;
  const email = `leave-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `L${n}` });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

/**
 * A room of five with every seat claimed, and nothing started yet.
 *
 * Rooms and seasons left open by another file are closed first. Joining puts
 * you in whichever room in the market has space, which is correct and is a trap
 * for a helper that assumes its five players get a room of their own.
 */
async function claimedRoom(app: any, claims = 5) {
  await db.update(simVentures).set({ phase: "retired" })
    .where(inArray(simVentures.phase, ["filling", "claiming", "naming"]));
  const stale = await db.select({ id: simSeasons.id }).from(simSeasons).where(eq(simSeasons.status, "forming"));
  if (stale.length > 0) {
    await db.update(simVentures).set({ phase: "retired" }).where(inArray(simVentures.seasonId, stale.map((s) => s.id)));
    await db.update(simSeasons).set({ status: "abandoned" }).where(inArray(simSeasons.id, stale.map((s) => s.id)));
  }

  const players = [];
  let ventureId = "";
  for (let i = 0; i < 5; i++) {
    const p = await player(app);
    const join = await p.agent.post("/api/sim/join").send({ nicheId: NICHE });
    expect(join.status, JSON.stringify(join.body)).toBe(200);
    ventureId = join.body.ventureId;
    players.push(p);
  }
  for (const [i, p] of players.entries()) {
    if (i >= claims) break;
    const claim = await p.agent.post(`/api/sim/ventures/${ventureId}/claim`).send({ role: ROLES[i] });
    expect(claim.status, JSON.stringify(claim.body)).toBe(200);
  }
  return { players, ventureId };
}

/** The same room, named and started, so the season is actually running. */
async function runningRoom(app: any) {
  const { players, ventureId } = await claimedRoom(app);
  await players[0].agent.post(`/api/sim/ventures/${ventureId}/name`).send({ name: "Sidelong", product: "Raids" });
  await startReadySeasons();
  const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));
  expect(venture.phase, "the season did not start").toBe("running");
  return { players, ventureId, seasonId: venture.seasonId };
}

describe("giving a seat back while the table is still arguing", () => {
  it("hands the seat back, free for somebody else", async () => {
    const app = await getTestApp();
    /*
     * Four of five, deliberately. The fifth claim is what ends the argument —
     * the room leaves `claiming` for `naming` the moment every chair is taken,
     * and `release` is refused from there on. So a seat can only be given back
     * while somebody is still choosing, which is the window this covers.
     */
    const { players, ventureId } = await claimedRoom(app, 4);

    const before = await db.select().from(simSeats)
      .where(and(eq(simSeats.ventureId, ventureId), eq(simSeats.userId, players[1].id)));
    expect(before[0].role, "the claim did not take, so this proves nothing").toBe("cmo");

    const res = await players[1].agent.post(`/api/sim/ventures/${ventureId}/release`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const after = await db.select().from(simSeats)
      .where(and(eq(simSeats.ventureId, ventureId), eq(simSeats.userId, players[1].id)));
    expect(after[0].role, "the seat is still theirs").toBeNull();
    expect(after[0].assigned, "the seat still reads as taken").toBe(false);
    /* And they are still in the room — releasing a seat is not leaving. */
    expect(after).toHaveLength(1);
  });

  it("is too late once the season is running", async () => {
    const app = await getTestApp();
    const { players, ventureId } = await runningRoom(app);

    const res = await players[1].agent.post(`/api/sim/ventures/${ventureId}/release`).send({});
    expect(res.status).toBe(409);
    expect(res.body.code, "the refusal does not say why").toBe("wrong_phase");

    /* And the seat is untouched, which is the thing that matters to the other four. */
    const [seat] = await db.select().from(simSeats)
      .where(and(eq(simSeats.ventureId, ventureId), eq(simSeats.userId, players[1].id)));
    expect(seat.role).toBe("cmo");
  });

  it("says so about a room that does not exist", async () => {
    const app = await getTestApp();
    const p = await player(app);
    const res = await p.agent.post("/api/sim/ventures/00000000-0000-0000-0000-000000000000/release").send({});
    expect(res.status).toBe(404);
  });
});

describe("leaving a company", () => {
  it("gives up the seat before the season starts", async () => {
    const app = await getTestApp();
    const { players, ventureId } = await claimedRoom(app);

    const res = await players[2].agent.post(`/api/sim/ventures/${ventureId}/leave`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.left).toBe(true);
    expect(res.body.handedOver, "nobody needed to take the chair yet").toBe(false);

    const seats = await db.select().from(simSeats)
      .where(and(eq(simSeats.ventureId, ventureId), eq(simSeats.userId, players[2].id)));
    expect(seats, "they are still in a company they left").toHaveLength(0);
  });

  it("retires a room the last person walks out of", async () => {
    const app = await getTestApp();
    const { players, ventureId } = await claimedRoom(app);

    for (const p of players) {
      const res = await p.agent.post(`/api/sim/ventures/${ventureId}/leave`).send({});
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }

    const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));
    expect(venture.phase, "an empty room was left standing").toBe("retired");
  });

  it("treats a room you are not in as one you have already left", async () => {
    const app = await getTestApp();
    const { ventureId } = await claimedRoom(app);
    const outsider = await player(app);

    const res = await outsider.agent.post(`/api/sim/ventures/${ventureId}/leave`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ left: true, handedOver: false });
  });

  it("hands the chair to a bot once the season is running, and the company plays on", async () => {
    const app = await getTestApp();
    const { players, ventureId } = await runningRoom(app);

    const res = await players[3].agent.post(`/api/sim/ventures/${ventureId}/leave`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ left: true, handedOver: true });

    /* The person is out. */
    const theirs = await db.select().from(simSeats)
      .where(and(eq(simSeats.ventureId, ventureId), eq(simSeats.userId, players[3].id)));
    expect(theirs, "they are still sitting in it").toHaveLength(0);

    /*
     * And the chair is filled rather than empty — by a bot, so the other four
     * are playing a company with five seats in it and a name they recognise,
     * not one running on the caretaker rules.
     */
    const seats = await db.select({ userId: simSeats.userId, role: simSeats.role, isBot: users.isBot })
      .from(simSeats).innerJoin(users, eq(users.id, simSeats.userId))
      .where(eq(simSeats.ventureId, ventureId));
    expect(seats, "a seat went missing from a running company").toHaveLength(5);
    const cto = seats.find((s) => s.role === "cto")!;
    expect(cto.isBot, "the chair was left to the caretaker instead of a bot").toBe(true);
  });
});

describe("the standings", () => {
  it("rank every company in the market, the player's among them", async () => {
    const app = await getTestApp();
    const { players, ventureId } = await runningRoom(app);

    const res = await players[0].agent.get(`/api/sim/ventures/${ventureId}/standings`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const rows = res.body.rows ?? res.body.standings ?? res.body;
    expect(Array.isArray(rows), `standings came back as ${typeof rows}`).toBe(true);
    expect(rows.length, "a market with four rivals in it should have more than one row").toBeGreaterThan(1);

    /* Ordered by what each side owns, which is how a year is ranked. */
    const values = rows.map((r: any) => Number(r.founderValue ?? 0));
    expect([...values].sort((a, b) => b - a), "the standings are not in order").toEqual(values);

    /* And the player can find themselves in it. */
    expect(rows.some((r: any) => r.id === ventureId || r.mine === true), "the company is missing from its own standings").toBe(true);
  });

  it("says so about a company that is not yours", async () => {
    const app = await getTestApp();
    const { ventureId } = await runningRoom(app);
    const outsider = await player(app);
    const res = await outsider.agent.get(`/api/sim/ventures/${ventureId}/standings`);
    expect(res.status, "somebody else's standings were handed over").toBe(404);
  });
});
