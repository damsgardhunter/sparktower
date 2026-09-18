/**
 * Five people, five seats, one second.
 *
 * The lobby's whole job is to settle an argument fairly and then get out of
 * the way, and the way it fails is not subtle: two people tap "CEO" at the
 * same instant, both requests read the seat as free, both write, and the
 * season runs with two chief executives and a screen that disagrees with
 * itself. Nobody notices until day three.
 *
 * So the important test here fires genuinely concurrent claims at a real
 * database and insists exactly one wins. The rest cover the clock: a lobby
 * where one person wanders off must not hold the other four forever.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { simSeats, simVentures } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function player(app: any) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.150.${(n % 200) + 20}`;
  const email = `sim-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `P${n}` });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string, email };
}

const NICHE = "fitness_app";

/** Five players into one room. */
async function roomOfFive(app: any) {
  const players = [];
  let ventureId = "";
  for (let i = 0; i < 5; i++) {
    const p = await player(app);
    const join = await p.agent.post("/api/sim/join").send({ nicheId: NICHE });
    expect(join.status, JSON.stringify(join.body)).toBe(200);
    ventureId = join.body.ventureId;
    players.push(p);
  }
  return { players, ventureId };
}

describe("joining a market", () => {
  it("puts five people in the same room and then starts a new one", async () => {
    const app = await getTestApp();
    const { players, ventureId } = await roomOfFive(app);

    const room = await players[0].agent.get(`/api/sim/ventures/${ventureId}`);
    expect(room.status).toBe(200);
    expect(room.body.seats).toHaveLength(5);
    // A full room stops filling and starts the argument.
    expect(room.body.phase).toBe("claiming");

    // The sixth person gets a room of their own rather than a sixth chair.
    const sixth = await player(app);
    const join = await sixth.agent.post("/api/sim/join").send({ nicheId: NICHE });
    expect(join.body.ventureId).not.toBe(ventureId);
  }, 120_000);

  it("takes you back to your room rather than making a second one", async () => {
    const app = await getTestApp();
    const p = await player(app);
    const first = await p.agent.post("/api/sim/join").send({ nicheId: NICHE });
    const again = await p.agent.post("/api/sim/join").send({ nicheId: NICHE });
    expect(again.body.ventureId).toBe(first.body.ventureId);

    const seats = await db.select().from(simSeats).where(eq(simSeats.userId, p.id));
    expect(seats, "a second join should not be a second seat").toHaveLength(1);
  }, 60_000);

  it("refuses a market that doesn't exist", async () => {
    const app = await getTestApp();
    const p = await player(app);
    const res = await p.agent.post("/api/sim/join").send({ nicheId: "underwater_basket_weaving" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("unknown_niche");
  }, 30_000);
});

describe("claiming a seat", () => {
  it("gives the chief executive's chair to exactly one of five people who grab it together", async () => {
    /*
     * The race, run for real. Five requests in flight at once against one
     * database, all for the same seat. Anything other than exactly one winner
     * is a broken lobby — and a check-then-write would produce two or three
     * here, which is precisely why the claim is a single conditional statement.
     */
    const app = await getTestApp();
    const { players, ventureId } = await roomOfFive(app);

    const results = await Promise.all(
      players.map((p) => p.agent.post(`/api/sim/ventures/${ventureId}/claim`).send({ role: "ceo" })),
    );

    const winners = results.filter((r) => r.status === 200);
    const losers = results.filter((r) => r.status === 409);
    expect(winners, "exactly one chief executive").toHaveLength(1);
    expect(losers).toHaveLength(4);

    // The database agrees, which is the claim that actually matters.
    const held = await db.select().from(simSeats)
      .where(and(eq(simSeats.ventureId, ventureId), eq(simSeats.role, "ceo")));
    expect(held).toHaveLength(1);

    // And the four who lost are told who beat them, not shown an error.
    for (const loser of losers) {
      expect(loser.body.code).toBe("role_taken");
      expect(loser.body.message).toMatch(/first|before you/i);
    }
  }, 120_000);

  it("moves the room on once every seat is taken", async () => {
    const app = await getTestApp();
    const { players, ventureId } = await roomOfFive(app);
    const roles = ["ceo", "cmo", "cfo", "cto", "coo"];

    for (const [i, p] of players.entries()) {
      const res = await p.agent.post(`/api/sim/ventures/${ventureId}/claim`).send({ role: roles[i] });
      expect(res.status, `${roles[i]} should have been free`).toBe(200);
    }

    const room = await players[0].agent.get(`/api/sim/ventures/${ventureId}`);
    expect(room.body.phase).toBe("naming");
    expect(room.body.openRoles).toHaveLength(0);
  }, 120_000);

  it("lets someone change their mind while the argument is still open", async () => {
    const app = await getTestApp();
    const { players, ventureId } = await roomOfFive(app);

    expect((await players[0].agent.post(`/api/sim/ventures/${ventureId}/claim`).send({ role: "cto" })).status).toBe(200);
    expect((await players[0].agent.post(`/api/sim/ventures/${ventureId}/release`).send({})).status).toBe(200);
    // Now free for someone else.
    expect((await players[1].agent.post(`/api/sim/ventures/${ventureId}/claim`).send({ role: "cto" })).status).toBe(200);
  }, 120_000);
});

describe("naming the company", () => {
  async function seatedRoom(app: any) {
    const { players, ventureId } = await roomOfFive(app);
    const roles = ["ceo", "cmo", "cfo", "cto", "coo"];
    for (const [i, p] of players.entries()) {
      await p.agent.post(`/api/sim/ventures/${ventureId}/claim`).send({ role: roles[i] });
    }
    return { players, ventureId };
  }

  it("is the chief executive's call and nobody else's", async () => {
    const app = await getTestApp();
    const { players, ventureId } = await seatedRoom(app);

    const notCeo = await players[1].agent.post(`/api/sim/ventures/${ventureId}/name`).send({ name: "Mine Now" });
    expect(notCeo.status).toBe(403);
    expect(notCeo.body.code).toBe("not_ceo");

    const ceo = await players[0].agent.post(`/api/sim/ventures/${ventureId}/name`)
      .send({ name: "Northbound", product: "A training app for people who hate training apps" });
    expect(ceo.status, JSON.stringify(ceo.body)).toBe(200);

    const room = await players[2].agent.get(`/api/sim/ventures/${ventureId}`);
    expect(room.body.name).toBe("Northbound");
    // Named, so the season starts.
    expect(room.body.phase).toBe("running");
  }, 120_000);
});

describe("a lobby nobody is looking after", () => {
  it("deals out the seats nobody claimed rather than waiting forever", async () => {
    /*
     * One person claims, the rest wander off. The clock has to finish the job:
     * four people held hostage by a fifth who closed the tab is the failure
     * this whole phase machine exists to prevent.
     */
    const app = await getTestApp();
    const { players, ventureId } = await roomOfFive(app);
    await players[0].agent.post(`/api/sim/ventures/${ventureId}/claim`).send({ role: "cmo" });

    // Wind the clock forward rather than waiting three minutes.
    await db.update(simVentures).set({ phaseEndsAt: new Date(Date.now() - 1000) }).where(eq(simVentures.id, ventureId));

    const room = await players[1].agent.get(`/api/sim/ventures/${ventureId}`);
    expect(room.body.phase).toBe("naming");

    const seats = await db.select().from(simSeats).where(eq(simSeats.ventureId, ventureId));
    expect(seats.every((s) => !!s.role), "everyone should have a seat").toBe(true);
    // The one they chose is still theirs, and marked as chosen.
    const chosen = seats.find((s) => s.userId === players[0].id)!;
    expect(chosen.role).toBe("cmo");
    expect(chosen.assigned).toBe(false);
    // The rest were dealt, and say so.
    expect(seats.filter((s) => s.assigned)).toHaveLength(4);
    expect(new Set(seats.map((s) => s.role)).size, "no duplicate seats").toBe(5);
  }, 120_000);

  it("starts anyway when the chief executive never names the company", async () => {
    const app = await getTestApp();
    const { players, ventureId } = await roomOfFive(app);
    const roles = ["ceo", "cmo", "cfo", "cto", "coo"];
    for (const [i, p] of players.entries()) {
      await p.agent.post(`/api/sim/ventures/${ventureId}/claim`).send({ role: roles[i] });
    }

    await db.update(simVentures).set({ phaseEndsAt: new Date(Date.now() - 1000) }).where(eq(simVentures.id, ventureId));
    const room = await players[3].agent.get(`/api/sim/ventures/${ventureId}`);

    expect(room.body.phase).toBe("running");
    // Named something rather than nothing: a blank row in a league table is worse.
    expect(room.body.name).toBeTruthy();
  }, 120_000);
});

describe("a room you are not in", () => {
  it("tells you nothing about who is in it", async () => {
    const app = await getTestApp();
    const { ventureId } = await roomOfFive(app);
    const stranger = await player(app);

    const res = await stranger.agent.get(`/api/sim/ventures/${ventureId}`);
    // 404 rather than 403: the existence of a room is not a stranger's business.
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/seats|userId/);
  }, 120_000);
});
