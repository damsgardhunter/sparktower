/**
 * Your past games, and where each of them placed.
 *
 * The list used to be a name and a number out of a thousand, which is not a
 * result — nobody knows whether 612 is good. It now carries a placing on each
 * of the five boards, and the thing worth guarding is that those placings are
 * the *same* ones the leaderboard shows. Two surfaces computing a rank from
 * the same rows in two places is two surfaces that eventually disagree, and
 * the one somebody checks is not the one they would believe.
 *
 * The other rule: only games the model actually scored are ranked, and only
 * against each other. A placeholder written during an outage is not a result,
 * and ranking against one moves everybody else's position for a number nobody
 * earned.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { startupGames, startupGameVerdicts } from "@shared/schema";
import { createGame } from "../../server/startup-game";

afterAll(async () => { await closeTestApp(); });

/* A range no other spec registers from: sign-ups count against a per-address budget. */
let n = 0;
async function player(app: any) {
  n += 1;
  const agent = request.agent(app);
  const ip = `198.51.205.${(n % 200) + 20}`;
  const email = `hist-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `H${n}` });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  await verifyEmail(app, email, ip);
  await agent.post("/api/profile/complete-onboarding").send({ displayName: `H${n}` });
  return { agent, id: res.body.id as string };
}

/** A finished, scored game belonging to `owner`. */
async function scoredGame(owner: { id: string }, partnerId: string, name: string, scores: {
  growth: number; capital: number; product: number; acquisition: number; risk: number; overall: number;
}) {
  const gameId = await createGame({ player1Id: owner.id, player2Id: partnerId, era: "modern" });
  await db.update(startupGames)
    .set({ round: "verdict", completedAt: new Date(), idea: { name } as any })
    .where(eq(startupGames.id, gameId));
  await db.insert(startupGameVerdicts).values({
    gameId, ...scores, tenYear: 5_000_000, peak: 9_000_000, peakYear: 8, summary: "ok", fromModel: true,
  } as any);
  return gameId;
}

describe("a past game", () => {
  it("carries a placing on every board, and the same one the leaderboard gives", async () => {
    const app = await getTestApp();
    const me = await player(app);
    const other = await player(app);

    /*
     * Mine is the best on capital and the worst on growth, against one rival.
     * Risk is the interesting column: the board is "lowest risk", so my 200
     * beats their 800 and the rank has to come out first — a naive "higher is
     * better" would put me last on the one board I won.
     */
    const mine = await scoredGame(me, other.id, "Mine",
      { growth: 300, capital: 900, product: 500, acquisition: 500, risk: 200, overall: 600 });
    await scoredGame(other, me.id, "Theirs",
      { growth: 900, capital: 300, product: 500, acquisition: 500, risk: 800, overall: 500 });

    const res = await me.agent.get("/api/games/history");
    expect(res.status).toBe(200);
    const row = res.body.games.find((g: any) => g.id === mine);
    expect(row, "my game is in my history").toBeTruthy();

    // The five scores travel with it, so the card can draw a bar per board.
    expect(row.verdict.scores).toMatchObject({ growth: 300, capital: 900, risk: 200 });

    expect(row.places.capital).toEqual({ rank: 1, of: 2 });
    expect(row.places.growth).toEqual({ rank: 2, of: 2 });
    // Lowest risk wins: a low score is a good result and must rank as one.
    expect(row.places.risk).toEqual({ rank: 1, of: 2 });
    // A tie shares a rank, the way finishing positions work.
    expect(row.places.product).toEqual({ rank: 1, of: 2 });
    expect(row.places.overall).toEqual({ rank: 1, of: 2 });

    // And the board agrees, which is the whole point of counting it once.
    const board = await me.agent.get("/api/games/leaderboard?board=capital");
    const onBoard = board.body.standings.find((s: any) => s.name === "Mine");
    expect(onBoard.rank).toBe(row.places.capital.rank);
    expect(onBoard.of).toBe(row.places.capital.of);
  }, 60_000);

  it("is not ranked at all when the model never scored it", async () => {
    const app = await getTestApp();
    const me = await player(app);
    const other = await player(app);

    const gameId = await createGame({ player1Id: me.id, player2Id: other.id, era: "modern" });
    await db.update(startupGames)
      .set({ round: "verdict", completedAt: new Date(), idea: { name: "Ghost" } as any })
      .where(eq(startupGames.id, gameId));
    /* The outage placeholder: a verdict row that is not a result. */
    await db.insert(startupGameVerdicts).values({
      gameId, growth: 500, capital: 500, product: 500, acquisition: 500, risk: 500,
      overall: 500, tenYear: 0, peak: 0, peakYear: 10, summary: "unscored", fromModel: false,
    } as any);

    const res = await me.agent.get("/api/games/history");
    const row = res.body.games.find((g: any) => g.id === gameId);
    expect(row.verdict.fromModel).toBe(false);
    // No placing, rather than a made-up one against games that were scored.
    expect(row.places).toBeNull();
  }, 60_000);

  it("has no verdict and no placing when somebody walked out", async () => {
    const app = await getTestApp();
    const me = await player(app);
    const other = await player(app);

    const gameId = await createGame({ player1Id: me.id, player2Id: other.id, era: "modern" });
    await db.update(startupGames)
      .set({ round: "abandoned", abandonedAt: new Date(), abandonedById: me.id })
      .where(eq(startupGames.id, gameId));

    const res = await me.agent.get("/api/games/history");
    const row = res.body.games.find((g: any) => g.id === gameId);
    expect(row.outcome).toBe("abandoned");
    // The card has to tell these three apart: scored, being scored, and never will be.
    expect(row.verdict).toBeNull();
    expect(row.places).toBeNull();
    expect(row.youLeft).toBe(true);
  }, 60_000);

  it("shows only your own games", async () => {
    const app = await getTestApp();
    const me = await player(app);
    const stranger = await player(app);
    const partner = await player(app);

    const theirs = await scoredGame(stranger, partner.id, "Not yours",
      { growth: 500, capital: 500, product: 500, acquisition: 500, risk: 500, overall: 500 });

    const res = await me.agent.get("/api/games/history");
    expect(res.body.games.map((g: any) => g.id)).not.toContain(theirs);
  }, 60_000);
});
