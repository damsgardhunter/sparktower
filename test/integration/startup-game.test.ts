/**
 * Ten Years From Now, against a real database.
 *
 * The rules are tested pure elsewhere. What's left to get wrong is everything
 * around them, and it is nearly all the same shape: three things race to
 * settle every round — both players' polls and the sweep — and a game that
 * skips a round because two of them landed together has eaten somebody's
 * decision.
 *
 * The other half is the invariant the whole design serves: **a round always
 * ends**. A game between strangers cannot have a step that waits for somebody
 * who closed the tab.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { startupGames, startupGameSubmissions, startupGameVerdicts } from "@shared/schema";
import {
  createGame, gameState, leaveGame, settleIfReady, submitRound, sweepDueRounds, saveDraft,
} from "../../server/startup-game";
import { CUSTOMER_CARDS, MODEL_CARDS } from "@shared/sprints/cards";
import { BUDGET_TOTAL } from "@shared/sprints/budget";

afterAll(async () => { await closeTestApp(); });

/* A range no other spec uses: registering counts against a per-address budget. */
let n = 0;
async function player(app: any) {
  n += 1;
  const agent = request.agent(app);
  const ip = `198.51.200.${(n % 200) + 20}`;
  const email = `game-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `G${n}` });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  await verifyEmail(app, email, ip);
  await agent.post("/api/profile/complete-onboarding").send({ displayName: `G${n}` });
  return { agent, id: res.body.id as string };
}

async function twoPlayers(app: any) {
  const a = await player(app);
  const b = await player(app);
  const gameId = await createGame({ player1Id: a.id, player2Id: b.id, era: "modern" });
  return { a, b, gameId };
}

const roundOf = async (gameId: string) =>
  (await db.select().from(startupGames).where(eq(startupGames.id, gameId)))[0];

/** Wind the open round's clock past its deadline. */
const expire = (gameId: string) =>
  db.update(startupGames).set({ roundEndsAt: new Date(Date.now() - 1000) })
    .where(eq(startupGames.id, gameId));

const anIdea = (name: string) => ({ idea: { name, tagline: "t", pitch: "p", twist: "w", whoItsFor: "x" } });

describe("starting a game", () => {
  it("opens on the idea round with a clock running", async () => {
    const app = await getTestApp();
    const { gameId } = await twoPlayers(app);
    const game = await roundOf(gameId);
    expect(game.round).toBe("idea");
    expect(game.roundEndsAt, "a round with no deadline is a round that can hang").toBeTruthy();
    expect(new Date(game.roundEndsAt!).getTime()).toBeGreaterThan(Date.now());
  }, 120_000);
});

describe("settling a round", () => {
  it("closes the moment both pick the same thing, without waiting for the clock", async () => {
    const app = await getTestApp();
    const { a, b, gameId } = await twoPlayers(app);

    expect((await submitRound({ gameId, userId: a.id, payload: anIdea("Lighthouse") })).ok).toBe(true);
    const second = await submitRound({ gameId, userId: b.id, payload: anIdea("Lighthouse") });
    expect(second.ok && second.settled, "agreement should be instant").toBe(true);

    const game = await roundOf(gameId);
    expect(game.round).toBe("customer");
    expect((game.idea as any).name).toBe("Lighthouse");
    expect((game.settledBy as any).idea).toBe("agreed");
  }, 120_000);

  /*
   * The argument that makes this worth playing with another person happens
   * after somebody has already picked. Ending the round on their first
   * disagreement throws that away.
   */
  it("keeps the clock running while they disagree", async () => {
    const app = await getTestApp();
    const { a, b, gameId } = await twoPlayers(app);

    await submitRound({ gameId, userId: a.id, payload: anIdea("Lighthouse") });
    const second = await submitRound({ gameId, userId: b.id, payload: anIdea("Foundry") });
    expect(second.ok && second.settled).toBe(false);
    expect((await roundOf(gameId)).round, "still arguing").toBe("idea");
  }, 120_000);

  it("settles a deadlock with a coin when the clock runs out, and records that it did", async () => {
    const app = await getTestApp();
    const { a, b, gameId } = await twoPlayers(app);
    await submitRound({ gameId, userId: a.id, payload: anIdea("Lighthouse") });
    await submitRound({ gameId, userId: b.id, payload: anIdea("Foundry") });

    await expire(gameId);
    expect(await settleIfReady(gameId)).toBe(true);

    const game = await roundOf(gameId);
    expect(game.round).toBe("customer");
    expect(["Lighthouse", "Foundry"]).toContain((game.idea as any).name);
    // The screen has to be able to say "the coin went your partner's way".
    expect((game.settledBy as any).idea).toBe("coin");
  }, 120_000);

  /*
   * Somebody closed the tab. The other person's half hour does not stop.
   */
  it("lets one player's pick stand when the other never answered", async () => {
    const app = await getTestApp();
    const { a, gameId } = await twoPlayers(app);
    await submitRound({ gameId, userId: a.id, payload: anIdea("Lighthouse") });

    await expire(gameId);
    await settleIfReady(gameId);

    const game = await roundOf(gameId);
    expect((game.idea as any).name).toBe("Lighthouse");
    expect((game.settledBy as any).idea).toBe("unopposed");
  }, 120_000);

  it("moves on even when neither of them answered at all", async () => {
    const app = await getTestApp();
    const { gameId } = await twoPlayers(app);
    await expire(gameId);
    await settleIfReady(gameId);

    const game = await roundOf(gameId);
    expect(game.round, "a round nobody answered still has to end").toBe("customer");
    expect(game.idea).toBeNull();
  }, 120_000);

  /*
   * The property that stops two polls and the sweep landing together from
   * eating a round. Every path calls this, constantly.
   */
  it("advances exactly one round however many settles race", async () => {
    const app = await getTestApp();
    const { a, b, gameId } = await twoPlayers(app);
    await submitRound({ gameId, userId: a.id, payload: anIdea("Lighthouse") });
    await submitRound({ gameId, userId: b.id, payload: anIdea("Foundry") });
    await expire(gameId);

    await Promise.all([settleIfReady(gameId), settleIfReady(gameId), settleIfReady(gameId), sweepDueRounds()]);
    expect((await roundOf(gameId)).round, "a skipped round is somebody's decision eaten").toBe("customer");
  }, 120_000);

  it("settles rounds nobody is watching", async () => {
    const app = await getTestApp();
    const { gameId } = await twoPlayers(app);
    await expire(gameId);

    expect(await sweepDueRounds()).toBeGreaterThanOrEqual(1);
    expect((await roundOf(gameId)).round).toBe("customer");
  }, 120_000);
});

/*
 * Submitting at the exact moment a round closes.
 *
 * The sweep runs every twenty seconds and the other player's poll settles too,
 * so a decision made on the buzzer races the thing that ends the round. What
 * must never happen is the middle outcome: the answer accepted, written
 * against a round that has already resolved, and silently ignored. Losing a
 * last-second decision is bad; telling somebody it landed is worse.
 */
describe("submitting on the buzzer", () => {
  it("either counts the answer or says the round ended — never both", async () => {
    const app = await getTestApp();

    for (let attempt = 0; attempt < 6; attempt++) {
      const { a, b, gameId } = await twoPlayers(app);
      await expire(gameId);

      const [submitted, settled] = await Promise.all([
        submitRound({ gameId, userId: a.id, payload: anIdea("Buzzer") }),
        settleIfReady(gameId),
      ]);

      const game = await roundOf(gameId);
      if (submitted.ok) {
        /*
         * Accepted, so it must have been part of what the round decided —
         * either it settled the round itself, or the round is still open and
         * the answer is standing.
         */
        if (game.round !== "idea") {
          expect((game.idea as any)?.name, "an accepted answer must not vanish").toBe("Buzzer");
        }
      } else {
        expect(submitted.code, "the honest refusal").toBe("round_over");
        expect(game.round, "refused because the round had moved on").not.toBe("idea");
      }
      void b;
    }
  }, 120_000);
});

describe("what a round will accept", () => {
  it("refuses a card that isn't in the deck", async () => {
    const app = await getTestApp();
    const { a, b, gameId } = await twoPlayers(app);
    await settleTo(gameId, a.id, b.id, "customer");

    const out = await submitRound({ gameId, userId: a.id, payload: { cardId: "not-a-card" } });
    expect(out.ok).toBe(false);
  }, 120_000);

  it("takes a card the players invented", async () => {
    const app = await getTestApp();
    const { a, b, gameId } = await twoPlayers(app);
    await settleTo(gameId, a.id, b.id, "customer");

    const out = await submitRound({
      gameId, userId: a.id,
      payload: { cardId: "custom:0", label: "My old football coach" },
    });
    expect(out.ok).toBe(true);
    const [row] = await db.select().from(startupGameSubmissions).where(and(
      eq(startupGameSubmissions.gameId, gameId),
      eq(startupGameSubmissions.userId, a.id),
      eq(startupGameSubmissions.round, "customer"),
    ));
    expect((row.payload as any).label).toBe("My old football coach");
  }, 120_000);

  /*
   * The budget round is the one worth crafting a request against: it is a bag
   * of numbers, and the screen is not the authority on what's in it.
   */
  it("drops a budget line that doesn't exist and caps the total at a million", async () => {
    const app = await getTestApp();
    const { a, b, gameId } = await twoPlayers(app);
    await settleTo(gameId, a.id, b.id, "spend");

    const out = await submitRound({
      gameId, userId: a.id,
      payload: { allocation: { marketing: 400_000, "free-money": 9_000_000 } },
    });
    expect(out.ok).toBe(true);

    const [row] = await db.select().from(startupGameSubmissions).where(and(
      eq(startupGameSubmissions.gameId, gameId),
      eq(startupGameSubmissions.userId, a.id),
      eq(startupGameSubmissions.round, "spend"),
    ));
    const allocation = (row.payload as any).allocation;
    expect(allocation["free-money"]).toBeUndefined();
    expect(Object.values(allocation).reduce((x: any, y: any) => x + y, 0)).toBeLessThanOrEqual(BUDGET_TOTAL);
  }, 120_000);

  it("refuses somebody who isn't in the game", async () => {
    const app = await getTestApp();
    const { gameId } = await twoPlayers(app);
    const stranger = await player(app);
    const out = await submitRound({ gameId, userId: stranger.id, payload: anIdea("Mine Now") });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.code).toBe("not_a_player");
  }, 120_000);
});

/*
 * These two rounds keep both answers instead of picking one. Two people
 * listing what their product does better are not in competition, and the
 * budget round would make one of them a spectator if only one allocation
 * counted.
 */
describe("the rounds that merge instead of picking", () => {
  it("keeps both players' product claims", async () => {
    const app = await getTestApp();
    const { a, b, gameId } = await twoPlayers(app);
    await settleTo(gameId, a.id, b.id, "product");

    await submitRound({ gameId, userId: a.id, payload: { claims: [{ text: "Works offline", core: true }] } });
    await submitRound({ gameId, userId: b.id, payload: { claims: [{ text: "Costs half", core: true }] } });
    await expire(gameId);
    await settleIfReady(gameId);

    const claims = (await roundOf(gameId)).productClaims as any[];
    expect(claims.map((c) => c.text).sort()).toEqual(["Costs half", "Works offline"]);
  }, 120_000);

  /*
   * The budget screen says, in as many words, "what gets spent is the average
   * of your two budgets, so talk to them" — and then the round has to actually
   * let them. A merge round that ends the moment both have submitted gives
   * neither player a chance to move after seeing the other's number, which is
   * the entire negotiation.
   *
   * These two rounds keep their clock. The pick rounds end early on agreement
   * because there is genuinely nothing left to decide; here there always is.
   */
  it("keeps the clock running once both have put a budget in", async () => {
    const app = await getTestApp();
    const { a, b, gameId } = await twoPlayers(app);
    await settleTo(gameId, a.id, b.id, "spend");

    await submitRound({ gameId, userId: a.id, payload: { allocation: { marketing: 200_000 } } });
    const second = await submitRound({ gameId, userId: b.id, payload: { allocation: { marketing: 100_000 } } });

    expect(second.ok && second.settled, "nobody gets to negotiate if it ends here").toBe(false);
    expect((await roundOf(gameId)).round).toBe("spend");
  }, 120_000);

  it("keeps the clock running once both have put a product list in", async () => {
    const app = await getTestApp();
    const { a, b, gameId } = await twoPlayers(app);
    await settleTo(gameId, a.id, b.id, "product");

    await submitRound({ gameId, userId: a.id, payload: { claims: [{ text: "Works offline", core: true }] } });
    const second = await submitRound({ gameId, userId: b.id, payload: { claims: [{ text: "Costs half", core: true }] } });

    expect(second.ok && second.settled, "both should still be able to add to the list").toBe(false);
    expect((await roundOf(gameId)).round).toBe("product");
  }, 120_000);

  it("commits the average of the two budgets, so neither is a spectator", async () => {
    const app = await getTestApp();
    const { a, b, gameId } = await twoPlayers(app);
    await settleTo(gameId, a.id, b.id, "spend");

    await submitRound({ gameId, userId: a.id, payload: { allocation: { marketing: 200_000 } } });
    await submitRound({ gameId, userId: b.id, payload: { allocation: { marketing: 100_000 } } });
    await expire(gameId);
    await settleIfReady(gameId);

    const game = await roundOf(gameId);
    expect((game.budget as any).marketing).toBe(150_000);
    expect(game.round, "the last round leads to the verdict").toBe("verdict");
    expect(game.completedAt).toBeTruthy();
  }, 120_000);
});

/*
 * A card a player invents is not in the dealt deck, so the only way the other
 * person can see it — or the inventor can see it again after a reload — is if
 * the submission carries enough to rebuild it. It has to hold the label.
 */
describe("cards the players invent", () => {
  it("carries the label through, so the other player can see what it was", async () => {
    const app = await getTestApp();
    const { a, b, gameId } = await twoPlayers(app);
    await settleTo(gameId, a.id, b.id, "customer");

    await submitRound({
      gameId, userId: a.id,
      payload: { cardId: "custom:0", label: "My old football coach", detail: "Runs a club on Sundays." },
    });

    const theirView = await gameState(gameId, b.id);
    expect(theirView!.theirs.label, "an invisible pick cannot be argued with").toBe("My old football coach");
    expect(theirView!.theirs.detail).toBe("Runs a club on Sundays.");
  }, 120_000);

  /*
   * Both players' first invention used to be `custom:0`, so two different
   * people read as the same pick and the round closed as *agreed* on somebody
   * neither had chosen — and said so on screen.
   */
  it("does not let two different inventions count as agreement", async () => {
    const app = await getTestApp();
    const { a, b, gameId } = await twoPlayers(app);
    await settleTo(gameId, a.id, b.id, "customer");

    await submitRound({ gameId, userId: a.id, payload: { cardId: "custom:0", label: "My old football coach" } });
    const second = await submitRound({ gameId, userId: b.id, payload: { cardId: "custom:0", label: "My landlord" } });

    expect(second.ok && second.settled, "two different people are not an agreement").toBe(false);
    expect((await roundOf(gameId)).round).toBe("customer");
  }, 120_000);

  it("refuses to file a card under the other player's name", async () => {
    const app = await getTestApp();
    const { a, b, gameId } = await twoPlayers(app);
    await settleTo(gameId, a.id, b.id, "customer");

    await submitRound({ gameId, userId: a.id, payload: { cardId: "custom:0", label: "Mine" } });
    // B tries to submit using A's id, to manufacture an agreement.
    await submitRound({ gameId, userId: b.id, payload: { cardId: `custom:${a.id}:0`, label: "Not mine" } });

    const [mine] = await db.select().from(startupGameSubmissions).where(and(
      eq(startupGameSubmissions.gameId, gameId),
      eq(startupGameSubmissions.userId, a.id),
      eq(startupGameSubmissions.round, "customer"),
    ));
    const [theirs] = await db.select().from(startupGameSubmissions).where(and(
      eq(startupGameSubmissions.gameId, gameId),
      eq(startupGameSubmissions.userId, b.id),
      eq(startupGameSubmissions.round, "customer"),
    ));
    expect((mine.payload as any).cardId).not.toBe((theirs.payload as any).cardId);
    expect((await roundOf(gameId)).round, "still an argument, not an agreement").toBe("customer");
  }, 120_000);
});

describe("seeing the game", () => {
  /*
   * Shown rather than sealed, deliberately. This is a game about arguing
   * somebody round, and you cannot argue with a choice you can't see — a
   * sealed vote turns every round into two people guessing in a chat window.
   */
  it("shows you what your partner picked while the round is still open", async () => {
    const app = await getTestApp();
    const { a, b, gameId } = await twoPlayers(app);
    await submitRound({ gameId, userId: b.id, payload: anIdea("Foundry") });

    const state = await gameState(gameId, a.id);
    expect(state!.theirs.name, "you can't argue with a choice you can't see").toBe("Foundry");
    expect(state!.yours).toBeNull();
  }, 120_000);

  it("tells a stranger nothing", async () => {
    const app = await getTestApp();
    const { gameId } = await twoPlayers(app);
    const stranger = await player(app);
    expect(await gameState(gameId, stranger.id)).toBeNull();
  }, 120_000);

  it("says which player is a bot, so a screen can label one", async () => {
    const app = await getTestApp();
    const { a, gameId } = await twoPlayers(app);
    const state = await gameState(gameId, a.id);
    for (const p of state!.players) expect(p).toHaveProperty("isBot");
    expect(state!.players.find((p) => p.isYou)!.id).toBe(a.id);
  }, 120_000);
});

describe("walking out", () => {
  it("ends it for both and records who left", async () => {
    const app = await getTestApp();
    const { a, b, gameId } = await twoPlayers(app);

    const out = await leaveGame(gameId, a.id);
    expect(out.ok && out.partnerId).toBe(b.id);

    const game = await roundOf(gameId);
    expect(game.round).toBe("abandoned");
    expect(game.abandonedById).toBe(a.id);
    expect(game.abandonedAt).toBeTruthy();
  }, 120_000);

  it("keeps the first answer when both leave at once", async () => {
    const app = await getTestApp();
    const { a, b, gameId } = await twoPlayers(app);
    const [one, two] = await Promise.all([leaveGame(gameId, a.id), leaveGame(gameId, b.id)]);
    expect([one.ok, two.ok].filter(Boolean), "exactly one should succeed").toHaveLength(1);
    expect([a.id, b.id]).toContain((await roundOf(gameId)).abandonedById);
  }, 120_000);

  it("stops an abandoned game moving on", async () => {
    const app = await getTestApp();
    const { a, gameId } = await twoPlayers(app);
    await leaveGame(gameId, a.id);
    await expire(gameId);

    expect(await settleIfReady(gameId)).toBe(false);
    expect((await roundOf(gameId)).round).toBe("abandoned");
    expect((await submitRound({ gameId, userId: a.id, payload: anIdea("x") })).ok).toBe(false);
  }, 120_000);
});

/*
 * A game nobody can start is not a game. The last two features built into this
 * area were finished and unreachable because the only route to them was
 * knowing the address, so this is the test that says the door exists.
 */
describe("starting a game from the app", () => {
  it("pairs you with a bot and drops you straight into round one", async () => {
    const app = await getTestApp();
    const one = await player(app);

    const res = await one.agent.post("/api/games/solo").send({ era: "modern" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const state = await one.agent.get(`/api/games/${res.body.id}`);
    expect(state.status).toBe(200);
    expect(state.body.round).toBe("idea");
    expect(state.body.secondsLeft).toBeGreaterThan(0);

    const partner = state.body.players.find((p: any) => !p.isYou);
    expect(partner.isBot, "and it says what it is").toBe(true);
    expect(partner.name, "a partner with no name reads as a broken deployment").toBeTruthy();
  }, 120_000);

  /*
   * Two half-finished startups is nobody's idea of fun, and the answer to
   * "play now" while you are mid-game is to take you back to it rather than
   * refuse — which is what the entry card does with this response.
   */
  it("sends you back to the game you're already in", async () => {
    const app = await getTestApp();
    const one = await player(app);
    const first = await one.agent.post("/api/games/solo").send({});

    const again = await one.agent.post("/api/games/solo").send({});
    expect(again.status).toBe(409);
    expect(again.body.gameId).toBe(first.body.id);
  }, 120_000);

  it("refuses an era that isn't one of the three", async () => {
    const app = await getTestApp();
    const one = await player(app);
    expect((await one.agent.post("/api/games/solo").send({ era: "medieval" })).status).toBe(400);
  }, 120_000);
});

/*
 * A game both players walk away from still reaches the verdict — every round
 * settles on its clock whether or not anybody answered, which is the rule that
 * stops one person holding the other hostage. What comes out is an empty row,
 * and it must not be sent to a model to be valued or ranked against real ones.
 */
describe("a game nobody played", () => {
  it("is not valued, not scored, and says so", async () => {
    const app = await getTestApp();
    const { a, gameId } = await twoPlayers(app);

    // Run every clock out without either of them answering anything.
    for (let i = 0; i < 5; i++) {
      await expire(gameId);
      await settleIfReady(gameId);
    }
    expect((await roundOf(gameId)).round).toBe("verdict");

    const seen = await a.agent.get(`/api/games/${gameId}`);
    expect(seen.status).toBe(200);

    await expect.poll(async () => {
      const [v] = await db.select().from(startupGameVerdicts)
        .where(eq(startupGameVerdicts.gameId, gameId));
      return v?.fromModel;
    }, { timeout: 10_000 }).toBe(false);

    const board = await a.agent.get("/api/games/leaderboard");
    expect(board.body.standings.map((s: any) => s.name), "an empty game must not rank").not.toContain("Unnamed");
  }, 120_000);

  it("still values a game that got as far as an idea and one decision", async () => {
    const { hasSubstance } = await import("../../server/startup-game-verdict");
    expect(hasSubstance({ idea: { name: "Lighthouse" }, customerCardId: "night-nurses" })).toBe(true);
    expect(hasSubstance({ idea: { name: "Lighthouse" } }), "a name alone is not a company").toBe(false);
    expect(hasSubstance({ idea: null, budget: { marketing: 1 } }), "unnamed is not a company").toBe(false);
  }, 120_000);
});

/*
 * The only way into the game today is a solo game against a bot, and the bot
 * used to answer nothing. A pick round only ends early when both agree, so
 * every round ran its full clock — twenty-six minutes, most of it a timer —
 * and every one ended "only one of you answered". The game has to move at the
 * speed of the one person actually playing it.
 */
describe("a game against a bot", () => {
  async function soloGame(app: any) {
    const one = await player(app);
    const made = await one.agent.post("/api/games/solo").send({});
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    return { one, gameId: made.body.id as string };
  }

  it("goes from the idea to the verdict without a single clock running out", async () => {
    const app = await getTestApp();
    const { one, gameId } = await soloGame(app);

    const answers: Array<[string, any]> = [
      ["idea", anIdea("Lighthouse")],
      ["customer", { cardId: CUSTOMER_CARDS[0].id }],
      ["model", { cardId: MODEL_CARDS[0].id }],
      ["product", { claims: [{ text: "Works offline", core: true }] }],
      ["spend", { allocation: { marketing: 300_000, "first-engineer": 200_000 } }],
    ];

    for (const [round, payload] of answers) {
      expect((await roundOf(gameId)).round, "no clock was expired to get here").toBe(round);
      const res = await one.agent.post(`/api/games/${gameId}/submit`).send(payload);
      expect(res.status, `${round}: ${JSON.stringify(res.body)}`).toBe(200);
    }

    const game = await roundOf(gameId);
    expect(game.round).toBe("verdict");
    // Nothing was left to "only one of you answered".
    for (const reason of Object.values(game.settledBy as Record<string, string>)) {
      expect(reason, "the bot answered every round").not.toBe("unopposed");
    }
  }, 120_000);

  it("keeps your idea — the bot backs it rather than pretend to judge it", async () => {
    const app = await getTestApp();
    const { one, gameId } = await soloGame(app);
    await one.agent.post(`/api/games/${gameId}/submit`).send(anIdea("Lighthouse"));

    const game = await roundOf(gameId);
    expect((game.idea as any).name).toBe("Lighthouse");
    expect((game.settledBy as any).idea).toBe("agreed");
  }, 120_000);

  it("lands a budget near yours, never on the other side of the room", async () => {
    const app = await getTestApp();
    const { one, gameId } = await soloGame(app);
    for (const payload of [
      anIdea("Lighthouse"),
      { cardId: CUSTOMER_CARDS[0].id },
      { cardId: MODEL_CARDS[0].id },
      { claims: [{ text: "Works offline", core: true }] },
    ]) await one.agent.post(`/api/games/${gameId}/submit`).send(payload);

    await one.agent.post(`/api/games/${gameId}/submit`).send({ allocation: { marketing: 400_000 } });
    const budget = (await roundOf(gameId)).budget as Record<string, number>;
    // The average of yours and the bot's, which drifts at most 15%.
    expect(budget.marketing).toBeGreaterThan(400_000 * 0.9);
    expect(budget.marketing).toBeLessThan(400_000 * 1.1);
  }, 120_000);

  /*
   * Two people still get their clock: nothing about a bot game may leak into
   * a game between people, where the time after the first answer is the
   * whole argument.
   */
  it("changes nothing about a game between two people", async () => {
    const app = await getTestApp();
    const { a, b, gameId } = await twoPlayers(app);
    await submitRound({ gameId, userId: a.id, payload: anIdea("Lighthouse") });
    expect((await roundOf(gameId)).round, "one person's answer must not end a two-person round").toBe("idea");
    void b;
  }, 120_000);
});

describe("the leaderboard", () => {
  /*
   * A fallback verdict is a placeholder, not a judgement. One that ranks
   * alongside real scores is a lie told to everybody above and below it.
   */
  it("leaves out games the model never actually scored", async () => {
    const app = await getTestApp();
    const { a, gameId } = await twoPlayers(app);
    await db.update(startupGames).set({ round: "verdict", idea: { name: "Ghost" } as any })
      .where(eq(startupGames.id, gameId));
    await db.insert(startupGameVerdicts).values({
      gameId, growth: 500, capital: 500, product: 500, acquisition: 500, risk: 500,
      overall: 500, tenYear: 0, peak: 0, peakYear: 10, summary: "unscored", fromModel: false,
    } as any);

    const res = await a.agent.get("/api/games/leaderboard");
    expect(res.status).toBe(200);
    expect(res.body.standings.map((s: any) => s.name)).not.toContain("Ghost");
  }, 120_000);

  /*
   * A bot carries an ordinary name so a lobby reads like a lobby, which is
   * exactly why a public ranking has to say what it is. A row reading
   * "Dana & Ada Fournier" with no further word implies two people beat you.
   */
  it("says which of the players was a bot", async () => {
    const app = await getTestApp();
    const one = await player(app);
    const made = await one.agent.post("/api/games/solo").send({});
    const gameId = made.body.id;

    await db.update(startupGames).set({ round: "verdict", idea: { name: "Labelled" } as any })
      .where(eq(startupGames.id, gameId));
    await db.insert(startupGameVerdicts).values({
      gameId, growth: 700, capital: 700, product: 700, acquisition: 700, risk: 300,
      overall: 760, tenYear: 5_000_000, peak: 9_000_000, peakYear: 8, summary: "ok", fromModel: true,
    } as any);

    const board = await one.agent.get("/api/games/leaderboard");
    const row = board.body.standings.find((s: any) => s.name === "Labelled");
    expect(row, "a scored game should be on the board").toBeTruthy();
    expect(row.players.some((p: any) => p.isBot), "the bot must be labelled").toBe(true);
    expect(row.players.some((p: any) => !p.isBot), "and the person must not be").toBe(true);
  }, 120_000);

  it("refuses a deck that isn't one, including an inherited key", async () => {
    const app = await getTestApp();
    const one = await player(app);
    const made = await one.agent.post("/api/games/solo").send({});
    for (const bad of ["constructor", "toString", "nonsense"]) {
      const res = await one.agent.get(`/api/games/${made.body.id}/deck/${bad}`);
      expect(res.status, `deck "${bad}"`).toBe(404);
    }
  }, 120_000);

  it("offers a board for every dimension plus an overall", async () => {
    const app = await getTestApp();
    const { a } = await twoPlayers(app);
    const res = await a.agent.get("/api/games/leaderboard");
    const ids = res.body.boards.map((b: any) => b.id);
    expect(ids).toEqual(["overall", "growth", "capital", "product", "acquisition", "risk"]);
  }, 120_000);
});

/**
 * Push a game to the round under test, agreeing on everything on the way.
 *
 * The pick rounds close themselves the moment both players agree. The merge
 * rounds deliberately do not — they keep their clock so the pair can still
 * negotiate — so getting past one in a test means running its clock out.
 */
async function settleTo(gameId: string, aId: string, bId: string, target: string) {
  const answers: Record<string, any> = {
    idea: anIdea("Lighthouse"),
    customer: { cardId: CUSTOMER_CARDS[0].id },
    model: { cardId: MODEL_CARDS[0].id },
    product: { claims: [{ text: "Works offline", core: true }] },
  };
  for (const round of ["idea", "customer", "model", "product"]) {
    if ((await roundOf(gameId)).round === target) return;
    await submitRound({ gameId, userId: aId, payload: answers[round] });
    await submitRound({ gameId, userId: bId, payload: answers[round] });
    // A merge round needs its clock run out; a pick round has already closed.
    if ((await roundOf(gameId)).round === round) {
      await expire(gameId);
      await settleIfReady(gameId);
    }
  }
}


describe("what was typed when the clock ran out", () => {
  /*
   * The bug: the idea round's clock ran out while a player was still typing,
   * and the game carried on with a company that had no name and no
   * description. Everything on their screen existed only in their browser —
   * the round settles from submissions, and nothing had been submitted.
   *
   * Drafts are saved as they type and read only when the clock runs out.
   * These pin both halves of that: the draft is used then, and never before.
   */
  it("uses the draft when the round expires with nothing submitted", async () => {
    const app = await getTestApp();
    const { a, gameId } = await twoPlayers(app);

    const saved = await saveDraft({
      gameId, userId: a.id,
      payload: { idea: { name: "SparkTower", tagline: "Build together", pitch: "Founders meet by building.", twist: "", whoItsFor: "" } },
    });
    expect(saved).toEqual({ ok: true, saved: true });

    await expire(gameId);
    await settleIfReady(gameId);

    const game = await roundOf(gameId);
    expect(game.round, "the round closed on the clock").not.toBe("idea");
    expect((game.idea as any)?.name, "and on what was typed, not on nothing").toBe("SparkTower");
    expect((game.idea as any)?.pitch).toBe("Founders meet by building.");
  });

  it("keeps a pitch that has no name yet, rather than losing it", async () => {
    const app = await getTestApp();
    const { a, gameId } = await twoPlayers(app);
    await saveDraft({ gameId, userId: a.id, payload: { idea: { name: "", tagline: "", pitch: "Three paragraphs, no name.", twist: "", whoItsFor: "" } } });
    await expire(gameId);
    await settleIfReady(gameId);
    const game = await roundOf(gameId);
    expect((game.idea as any)?.name).toBe("Untitled company");
    expect((game.idea as any)?.pitch).toBe("Three paragraphs, no name.");
  });

  it("never lets a draft beat a real answer", async () => {
    const app = await getTestApp();
    const { a, gameId } = await twoPlayers(app);
    await saveDraft({ gameId, userId: a.id, payload: anIdea("Half-typed") });
    // Paced at one save a second per player; wait it out so the second save lands.
    await new Promise((r) => setTimeout(r, 1_100));
    await submitRound({ gameId, userId: a.id, payload: anIdea("Put forward") });
    await saveDraft({ gameId, userId: a.id, payload: anIdea("Edited after") });
    await expire(gameId);
    await settleIfReady(gameId);
    expect(((await roundOf(gameId)).idea as any)?.name).toBe("Put forward");
  });

  it("does not end a round early — a draft is not a decision", async () => {
    const app = await getTestApp();
    const { a, b, gameId } = await twoPlayers(app);
    // Both players have typed the same thing and neither has put it forward.
    await saveDraft({ gameId, userId: a.id, payload: anIdea("Same") });
    await saveDraft({ gameId, userId: b.id, payload: anIdea("Same") });
    await settleIfReady(gameId);
    expect((await roundOf(gameId)).round, "the round is still open").toBe("idea");
  });

  it("comes back on a reload, to its owner only", async () => {
    const app = await getTestApp();
    const { a, b, gameId } = await twoPlayers(app);
    await saveDraft({ gameId, userId: a.id, payload: anIdea("Mine") });
    expect(((await gameState(gameId, a.id)) as any).yourDraft?.name).toBe("Mine");
    expect(((await gameState(gameId, b.id)) as any).yourDraft).toBeNull();
    expect(((await gameState(gameId, b.id)) as any).theirs, "a draft is not shown to a partner").toBeNull();
  });
});
