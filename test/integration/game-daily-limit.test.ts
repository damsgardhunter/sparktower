/**
 * One game a day, against a real database.
 *
 * The pure rule is tested elsewhere. What is left to get wrong is everything
 * around it, and the two things worth guarding are opposites:
 *
 * **It has to actually hold.** Including against two taps in the same second
 * from two devices, which is exactly the shape of request that walks past a
 * check made before a transaction. The advisory lock inside `startGameFor` is
 * what makes it true, and a concurrent pair is the only way to prove it.
 *
 * **It must never strand anybody.** A game still in progress is not a
 * refusal — you can always go back to it — and the screen has to be told which
 * of the two situations it is in, because "come back tomorrow" and "here's
 * your game" are different sentences and only one of them is right.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { startupGames } from "@shared/schema";
import { GAME_COOLDOWN_MS } from "@shared/sprints/game";

afterAll(async () => { await closeTestApp(); });

/* A range no other spec registers from: sign-ups count against a per-address budget. */
let n = 0;
async function player(app: any) {
  n += 1;
  const agent = request.agent(app);
  const ip = `198.51.203.${(n % 200) + 20}`;
  const email = `daily-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `D${n}` });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  await verifyEmail(app, email, ip);
  await agent.post("/api/profile/complete-onboarding").send({ displayName: `D${n}` });
  return { agent, id: res.body.id as string };
}

/** Finish whatever game they're in, so only the daily limit can refuse the next one. */
const endTheirGame = (userId: string) =>
  db.update(startupGames).set({ round: "verdict", completedAt: new Date() })
    .where(sql`(${startupGames.player1Id} = ${userId} or ${startupGames.player2Id} = ${userId})`);

/** Wind their games back beyond the window, as though they were played yesterday. */
const playedYesterday = (userId: string) =>
  db.update(startupGames).set({ startedAt: new Date(Date.now() - GAME_COOLDOWN_MS - 60_000) })
    .where(sql`(${startupGames.player1Id} = ${userId} or ${startupGames.player2Id} = ${userId})`);

describe("the day's game", () => {
  it("is offered once, then refused with the time it opens again", async () => {
    const app = await getTestApp();
    const me = await player(app);

    const first = await me.agent.post("/api/games/solo").send({});
    expect(first.status, first.text).toBe(201);
    await endTheirGame(me.id);

    const second = await me.agent.post("/api/games/solo").send({});
    expect(second.status).toBe(429);
    expect(second.body.code).toBe("played_today");
    // The end of the limit is on screen, or it reads as the product being broken.
    expect(second.body.unlocksAt).toBeTruthy();
    expect(second.body.message).toMatch(/opens in about \d+ hour/);

    // And only the one game exists.
    const rows = await db.select().from(startupGames)
      .where(sql`(${startupGames.player1Id} = ${me.id} or ${startupGames.player2Id} = ${me.id})`);
    expect(rows).toHaveLength(1);
  });

  it("comes back once the day has passed", async () => {
    const app = await getTestApp();
    const me = await player(app);

    expect((await me.agent.post("/api/games/solo").send({})).status).toBe(201);
    await endTheirGame(me.id);
    expect((await me.agent.post("/api/games/solo").send({})).status).toBe(429);

    await playedYesterday(me.id);

    const again = await me.agent.post("/api/games/solo").send({});
    expect(again.status, again.text).toBe(201);
  });

  it("cannot be beaten by tapping twice at once", async () => {
    const app = await getTestApp();
    const me = await player(app);

    /*
     * Both in flight together, which is what a phone and a laptop look like
     * and what walks past any check made before the transaction. One 201, one
     * refusal, and exactly one game in the table.
     */
    const [a, b] = await Promise.all([
      me.agent.post("/api/games/solo").send({}),
      me.agent.post("/api/games/solo").send({}),
    ]);
    const codes = [a.status, b.status].sort();
    expect(codes[0]).toBe(201);
    expect([409, 429]).toContain(codes[1]);

    const rows = await db.select().from(startupGames)
      .where(sql`(${startupGames.player1Id} = ${me.id} or ${startupGames.player2Id} = ${me.id})`);
    expect(rows).toHaveLength(1);
  });

  it("never strands somebody mid-game: an open game is a way back, not a refusal", async () => {
    const app = await getTestApp();
    const me = await player(app);

    const started = await me.agent.post("/api/games/solo").send({});
    expect(started.status).toBe(201);

    // Still playing: the refusal names the game rather than the clock.
    const again = await me.agent.post("/api/games/solo").send({});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("already_playing");
    expect(again.body.gameId).toBe(started.body.id);

    // And the card is told to send them back to it, not to say "come back tomorrow".
    const active = await me.agent.get("/api/games/active");
    expect(active.status).toBe(200);
    expect(active.body.games[0].id).toBe(started.body.id);
    expect(active.body.daily.canStart).toBe(false);
  });
});

describe("what the entry card is told", () => {
  it("says a game is available before one has been played", async () => {
    const app = await getTestApp();
    const me = await player(app);

    const res = await me.agent.get("/api/games/active");
    expect(res.status).toBe(200);
    expect(res.body.daily).toMatchObject({ perDay: 1, startedToday: 0, canStart: true });
    expect(res.body.daily.unlocksAt).toBeNull();
    // Nothing to count down to, so nothing to say.
    expect(res.body.daily.opensIn).toBeNull();
  });

  it("says when it opens once it has been used", async () => {
    const app = await getTestApp();
    const me = await player(app);

    expect((await me.agent.post("/api/games/solo").send({})).status).toBe(201);
    await endTheirGame(me.id);

    const res = await me.agent.get("/api/games/active");
    expect(res.body.games).toHaveLength(0);
    expect(res.body.daily.canStart).toBe(false);
    expect(res.body.daily.startedToday).toBe(1);
    expect(res.body.daily.opensIn).toMatch(/hour|minute/);
  });

  it("counts the day per person, not for everybody at once", async () => {
    const app = await getTestApp();
    const me = await player(app);
    const them = await player(app);

    expect((await me.agent.post("/api/games/solo").send({})).status).toBe(201);
    await endTheirGame(me.id);
    expect((await me.agent.post("/api/games/solo").send({})).status).toBe(429);

    // Somebody else's allowance is untouched by mine.
    const theirs = await them.agent.get("/api/games/active");
    expect(theirs.body.daily.canStart).toBe(true);
    expect((await them.agent.post("/api/games/solo").send({})).status).toBe(201);
  });
});
