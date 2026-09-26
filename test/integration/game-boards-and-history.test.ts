/**
 * The boards, the history, and not being in two games at once.
 *
 * Three bugs that all came from the same habit — doing in JavaScript what the
 * database was there to do.
 *
 * 1. The boards took the top 500 rows *by overall score* and then ranked each
 *    dimension inside that slice, so the best result on a dimension could be
 *    missing from its own board, and every standing said "of 500" whatever the
 *    truth was. The game's own results page counted every verdict, so the two
 *    surfaces disagreed about the same game.
 * 2. Starting a game read "are you already playing?" and then inserted, with a
 *    round trip in between — two taps in the same second made two games, and
 *    the unreachable second one still blocked starting a third.
 * 3. A finished game was only reachable from the URL you happened to have
 *    open, because the only listing route returned playable rounds.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { startupGames, startupGameVerdicts } from "@shared/schema";
import { createGame, leaveGame } from "../../server/startup-game";

afterAll(async () => { await closeTestApp(); });

/* A range no other spec uses: registering counts against a per-address budget. */
let n = 0;
async function player(app: any) {
  n += 1;
  const agent = request.agent(app);
  const ip = `198.51.210.${(n % 200) + 20}`;
  const email = `board-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `B${n}` });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  await verifyEmail(app, email, ip);
  await agent.post("/api/profile/complete-onboarding").send({ displayName: `B${n}` });
  return { agent, id: res.body.id as string };
}

/** A finished, model-scored game with the scores this test needs. */
async function scoredGame(
  players: { a: { id: string }; b: { id: string } },
  name: string,
  scores: { growth: number; capital: number; product: number; acquisition: number; risk: number; overall: number },
) {
  const id = await createGame({ player1Id: players.a.id, player2Id: players.b.id, era: "modern" });
  await db.update(startupGames)
    .set({ round: "verdict", roundEndsAt: null, completedAt: new Date(), idea: { name } as any })
    .where(eq(startupGames.id, id));
  await db.insert(startupGameVerdicts).values({
    gameId: id, ...scores,
    tenYear: 1_000_000, peak: 2_000_000, peakYear: 8,
    summary: "A verdict.", fromModel: true,
  } as any);
  return id;
}

const totalScored = async () => {
  const [row] = await db.select({ n: sql<number>`(count(*))::int` })
    .from(startupGameVerdicts).where(eq(startupGameVerdicts.fromModel, true));
  return row.n;
};

describe("the boards", () => {
  it("ranks each board on its own column, over every scored game", async () => {
    const app = await getTestApp();
    const a = await player(app);
    const b = await player(app);

    /*
     * The shape the old code could not represent: `Frugal` is unremarkable
     * overall and the best in the world at capital efficiency. Ranked inside a
     * slice taken by overall score it falls out of the capital board entirely
     * — which is its own board.
     */
    const frugalId = await scoredGame({ a, b }, "Frugal", {
      growth: 120, capital: 998, product: 130, acquisition: 140, risk: 700, overall: 300,
    });
    const flashyId = await scoredGame({ a, b }, "Flashy", {
      growth: 995, capital: 300, product: 990, acquisition: 985, risk: 200, overall: 980,
    });

    const capital = await a.agent.get("/api/games/leaderboard?board=capital&limit=50");
    expect(capital.status).toBe(200);
    const capitalRows = capital.body.standings as any[];
    const frugal = capitalRows.find((r) => r.name === "Frugal");
    const flashy = capitalRows.find((r) => r.name === "Flashy");
    expect(frugal, "the best capital score must be on the capital board").toBeTruthy();
    expect(frugal.rank).toBe(1);
    expect(flashy.rank, "and a better overall score must not outrank it here").toBeGreaterThan(frugal.rank);

    // "Lowest risk" sorts the other way: the low number wins.
    const risk = await a.agent.get("/api/games/leaderboard?board=risk&limit=50");
    const riskRows = risk.body.standings as any[];
    const riskyAt = riskRows.findIndex((r) => r.name === "Frugal");
    const safeAt = riskRows.findIndex((r) => r.name === "Flashy");
    expect(safeAt).toBeGreaterThanOrEqual(0);
    expect(riskyAt === -1 || safeAt < riskyAt, "risk 200 must place above risk 700").toBe(true);

    /*
     * "Of" is the whole field, not the page size and not a 500 that happens to
     * be hard-coded. This is the number printed to people as "4th of 26".
     */
    const scored = await totalScored();
    for (const row of capitalRows) expect(row.of).toBe(scored);

    /*
     * And the game's own results page agrees with the board it claims a place
     * on — the two used to count different populations, so a player could be
     * told two different things about the same result on two screens.
     */
    const standings = await a.agent.get(`/api/games/${frugalId}/standings`);
    expect(standings.status).toBe(200);
    expect(standings.body.scored).toBe(true);
    const capitalStanding = (standings.body.standings as any[]).find((s) => s.id === "capital");
    expect(capitalStanding.of).toBe(scored);
    expect(capitalStanding.rank).toBe(frugal.rank);
    expect(capitalStanding.score).toBe(frugal.score);

    const riskStanding = (standings.body.standings as any[]).find((s) => s.id === "risk");
    const onRiskBoard = riskRows.find((r) => r.name === "Frugal");
    if (onRiskBoard) expect(riskStanding.rank).toBe(onRiskBoard.rank);

    expect(flashyId).toBeTruthy();
  }, 180_000);

  it("gives tied scores the same place", async () => {
    const app = await getTestApp();
    const a = await player(app);
    const b = await player(app);

    const tie = { growth: 999, capital: 111, product: 111, acquisition: 111, risk: 999, overall: 111 };
    await scoredGame({ a, b }, "TiedOne", tie);
    await scoredGame({ a, b }, "TiedTwo", tie);

    const board = await a.agent.get("/api/games/leaderboard?board=growth&limit=50");
    const rows = board.body.standings as any[];
    const tied = rows.filter((r) => r.name === "TiedOne" || r.name === "TiedTwo");
    expect(tied).toHaveLength(2);
    expect(tied[0].rank, "identical results are identical").toBe(tied[1].rank);
  }, 180_000);
});

/**
 * The promise on the screen, checked against the routes.
 *
 * The game's entry card and its play screen both carry a line saying that what
 * you write is seen by you and your partner and nobody else, that it is never
 * published or shown to other players, and that the boards carry only a name, a
 * valuation and who played (client/src/components/game/your-idea.tsx). That is a
 * promise made to somebody about to type their business idea into a box, and the
 * only thing that keeps it true is the routes below.
 *
 * So it is asserted rather than trusted, and asserted from the outside — over
 * HTTP, as a stranger, the way it would actually be broken. `gameState` refusing
 * a non-player is already covered a function call at a time in startup-game.test.ts;
 * what this adds is that no *route* hands the contents out, including the one
 * surface that is deliberately public.
 */
describe("what a stranger can learn about somebody else's game", () => {
  it("is nothing from the game itself — not the rounds, the chat or the standings", async () => {
    const app = await getTestApp();
    const a = await player(app);
    const b = await player(app);
    const stranger = await player(app);

    const gameId = await scoredGame({ a, b }, "Kettle & Fern", {
      growth: 500, capital: 500, product: 500, acquisition: 500, risk: 500, overall: 500,
    });
    /* Something worth protecting, in the round payloads and in the chat. */
    await db.update(startupGames)
      .set({ idea: { name: "Kettle & Fern", pitch: "Bookings for tea rooms, no website needed." } as any })
      .where(eq(startupGames.id, gameId));

    for (const path of [
      `/api/games/${gameId}`,
      `/api/games/${gameId}/standings`,
      `/api/games/${gameId}/messages`,
      `/api/games/${gameId}/deck/idea`,
    ]) {
      const res = await stranger.agent.get(path);
      expect(res.status, `${path} answered ${res.status}`).toBe(404);
      /*
       * And the refusal says nothing either: "no such game" is the same answer a
       * game that does not exist gets, so holding an id tells you nothing about
       * whether it is real.
       */
      expect(JSON.stringify(res.body)).not.toContain("Kettle");
      expect(JSON.stringify(res.body)).not.toContain("tea rooms");
    }

    /* Nor by submitting into it, which is how you would find out what round it is on. */
    const pushed = await stranger.agent.post(`/api/games/${gameId}/submit`).send({ name: "Mine Now" });
    expect([403, 404, 409], `submit answered ${pushed.status}`).toContain(pushed.status);

    /* And their own history is their own: somebody else's finished game is not in it. */
    const history = await stranger.agent.get("/api/games/history");
    expect(history.status).toBe(200);
    expect(JSON.stringify(history.body)).not.toContain("Kettle");
  }, 180_000);

  /*
   * The leaderboard is the one place another player's game is visible at all, so
   * it is the one place a round's contents could leak by accident — a `select *`
   * on the games table would do it, and the row already joins that table for the
   * name. Named fields only, and this is what says so.
   */
  it("is a name, a valuation and who played, from the boards — and nothing from the rounds", async () => {
    const app = await getTestApp();
    const a = await player(app);
    const b = await player(app);
    const stranger = await player(app);

    const gameId = await scoredGame({ a, b }, "Kettle & Fern", {
      growth: 640, capital: 640, product: 640, acquisition: 640, risk: 360, overall: 640,
    });
    await db.update(startupGames)
      .set({ idea: { name: "Kettle & Fern", pitch: "Bookings for tea rooms, no website needed." } as any })
      .where(eq(startupGames.id, gameId));

    const board = await stranger.agent.get("/api/games/leaderboard?limit=50");
    expect(board.status).toBe(200);
    const row = (board.body.standings as any[]).find((r) => r.name === "Kettle & Fern");
    expect(row, "a scored game is on the board").toBeTruthy();

    /* The name is on it, on purpose. The pitch is not, and neither is the id. */
    expect(JSON.stringify(board.body)).not.toContain("tea rooms");
    expect(JSON.stringify(board.body)).not.toContain(gameId);
    expect(Object.keys(row).sort()).toEqual(
      ["band", "isYours", "name", "of", "peak", "players", "rank", "score", "tenYear"],
    );
    /* Whose game it was, by name only — no account ids to look anybody up by. */
    for (const p of row.players) expect(Object.keys(p).sort()).toEqual(["isBot", "name"]);
  }, 180_000);
});

describe("starting a game", () => {
  it("cannot put one player in two games, however fast the button is pressed", async () => {
    const app = await getTestApp();
    const me = await player(app);

    /*
     * Phone and laptop in the same second. Both requests read "no open game"
     * before either has inserted one; only the transaction's advisory lock
     * stops both from inserting.
     */
    const [first, second] = await Promise.all([
      me.agent.post("/api/games/solo").send({}),
      me.agent.post("/api/games/solo").send({}),
    ]);

    const codes = [first.status, second.status].sort();
    expect(codes, "one game started, one told it was already playing").toEqual([201, 409]);

    const open = await db.select({ id: startupGames.id }).from(startupGames).where(sql`
      (${startupGames.player1Id} = ${me.id} or ${startupGames.player2Id} = ${me.id})
      and ${startupGames.round} in ('idea','customer','model','product','spend')
    `);
    expect(open, "a second, unreachable game still blocks starting another").toHaveLength(1);

    // The refusal points at the game that does exist, so the client can open it.
    const refused = first.status === 409 ? first : second;
    expect(refused.body.code).toBe("already_playing");
    expect(refused.body.gameId).toBe(open[0].id);
  }, 180_000);
});

describe("games you have already finished", () => {
  it("are listed with their verdict, so leaving the page doesn't lose them", async () => {
    const app = await getTestApp();
    const a = await player(app);
    const b = await player(app);

    const doneId = await scoredGame({ a, b }, "Remembered", {
      growth: 500, capital: 500, product: 500, acquisition: 500, risk: 500, overall: 512,
    });

    // One walked away from, which has no verdict and never will.
    const walkedId = await createGame({ player1Id: a.id, player2Id: b.id, era: "modern" });
    expect((await leaveGame(walkedId, a.id)).ok).toBe(true);

    // Still in the middle of one: it belongs to /active, not to history.
    const openId = await createGame({ player1Id: a.id, player2Id: b.id, era: "modern" });

    const history = await a.agent.get("/api/games/history");
    expect(history.status).toBe(200);
    const games = history.body.games as any[];
    const byId = new Map(games.map((g) => [g.id, g]));

    expect(byId.has(doneId), "a finished game must be reachable without its URL").toBe(true);
    expect(byId.get(doneId).outcome).toBe("verdict");
    expect(byId.get(doneId).name).toBe("Remembered");
    expect(byId.get(doneId).verdict.overall).toBe(512);

    expect(byId.has(walkedId)).toBe(true);
    expect(byId.get(walkedId).outcome).toBe("abandoned");
    expect(byId.get(walkedId).verdict, "an abandoned game has no score to show").toBeNull();
    expect(byId.get(walkedId).youLeft, "the card must not accuse the partner of leaving").toBe(true);

    expect(byId.has(openId), "a game still being played is not history").toBe(false);

    // The other player sees the same two games, and is not the one who left.
    const theirs = await b.agent.get("/api/games/history");
    const theirWalked = (theirs.body.games as any[]).find((g) => g.id === walkedId);
    expect(theirWalked.youLeft).toBe(false);

    // Somebody else's finished game is not in your history.
    const c = await player(app);
    const stranger = await c.agent.get("/api/games/history");
    expect((stranger.body.games as any[]).some((g) => g.id === doneId)).toBe(false);
  }, 180_000);
});
