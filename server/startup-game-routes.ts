/**
 * Ten Years From Now, over HTTP.
 *
 * Thin on purpose: the rules are pure (`@shared/sprints/*`) and the writing is
 * in `startup-game.ts`. What is left here is who is allowed to ask, and the
 * one thing a route is genuinely the right place for — settling the open round
 * on every read, so a game moves forward for anybody watching it without
 * depending on a background job having run.
 */
import type { Express } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { startupGames, startupGameVerdicts, users } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import {
  activeGamesFor, createGame, gameState, isPlayer, leaveGame,
  messagesOf, postMessage, settleIfReady, submitRound,
} from "./startup-game";
import { valueGame } from "./startup-game-verdict";
import { ensureBotUser } from "./bot-accounts";
import { botsFor } from "@shared/bots";
import { DECKS, SPEND_OPTIONS, MAX_CUSTOM_CARDS } from "@shared/sprints/cards";
import { BUDGET_TOTAL } from "@shared/sprints/budget";
import { MAX_CLAIMS, MAX_CORE_CLAIMS } from "@shared/sprints/product";
import {
  DIMENSIONS, rankBy, rankOn, scoreBand, type DimensionId, type Scores,
} from "@shared/sprints/scoring";
import { ROUND_COPY, ROUND_SECONDS, TOTAL_SECONDS, dealOrder } from "@shared/sprints/game";

export function registerStartupGameRoutes(app: Express) {
  /**
   * Everything static the client needs to render a round.
   *
   * Sent whole rather than per round, because it is a few kilobytes that never
   * changes and the alternative is four more round-trips during a game with a
   * clock running.
   */
  app.get("/api/games/rules", isAuthenticated, async (_req, res) => {
    res.json({
      rounds: ROUND_COPY,
      roundSeconds: ROUND_SECONDS,
      totalSeconds: TOTAL_SECONDS,
      budgetTotal: BUDGET_TOTAL,
      spendOptions: SPEND_OPTIONS,
      maxClaims: MAX_CLAIMS,
      maxCoreClaims: MAX_CORE_CLAIMS,
      maxCustomCards: MAX_CUSTOM_CARDS,
      dimensions: DIMENSIONS,
    });
  });

  /**
   * The two decks, shuffled for this game.
   *
   * Dealt per game rather than sent in a fixed order so that the first three
   * cards are not the first three cards every single time — the top of a list
   * gets picked far more often than the bottom, and a deck that always opens
   * the same way quietly decides the round.
   */
  app.get("/api/games/:id/deck/:round", isAuthenticated, async (req: any, res) => {
    const round = String(req.params.round);
    /*
     * `hasOwnProperty`, not a truthy check on the lookup.
     *
     * `DECKS` is a plain object, so `DECKS["constructor"]` is the Object
     * constructor — truthy, past the guard, and then a TypeError the moment
     * the "deck" is spread. An inherited key is not a deck.
     */
    if (!Object.prototype.hasOwnProperty.call(DECKS, round)) {
      return res.status(404).json({ message: "No such deck." });
    }
    const deck = DECKS[round as keyof typeof DECKS];

    const [game] = await db.select().from(startupGames).where(eq(startupGames.id, req.params.id));
    if (!game || !isPlayer(game, req.user.id)) return res.status(404).json({ message: "No such game." });

    res.json({ cards: dealOrder(`${game.id}:${round}`, deck) });
  });

  /*
   * Everything with a literal path is registered before anything with an `:id`
   * in it.
   *
   * Express matches in registration order, so `/api/games/:id` declared first
   * swallows `/api/games/leaderboard` — the board is looked up as a game whose
   * id is the word "leaderboard" and answers 404 to everybody, forever. It is
   * invisible in the route file (both lines look right) and only shows up by
   * asking the running server.
   */
  /**
   * The boards.
   *
   * Five of them, one per dimension, plus the overall. Games whose verdict did
   * not come from the model are excluded: a fallback score is a placeholder,
   * and a placeholder that ranks alongside real ones is a lie told to everyone
   * above and below it.
   */
  app.get("/api/games/leaderboard", isAuthenticated, async (req: any, res) => {
    const board = String(req.query.board ?? "overall");
    const limit = Math.min(50, Math.max(5, Number(req.query.limit) || 20));

    const rows = await db
      .select({
        gameId: startupGameVerdicts.gameId,
        growth: startupGameVerdicts.growth,
        capital: startupGameVerdicts.capital,
        product: startupGameVerdicts.product,
        acquisition: startupGameVerdicts.acquisition,
        risk: startupGameVerdicts.risk,
        overall: startupGameVerdicts.overall,
        tenYear: startupGameVerdicts.tenYear,
        peak: startupGameVerdicts.peak,
        name: sql<string>`${startupGames.idea}->>'name'`,
        player1Id: startupGames.player1Id,
        player2Id: startupGames.player2Id,
      })
      .from(startupGameVerdicts)
      .innerJoin(startupGames, eq(startupGames.id, startupGameVerdicts.gameId))
      .where(eq(startupGameVerdicts.fromModel, true))
      .orderBy(desc(startupGameVerdicts.overall))
      .limit(500);

    const scoresOf = (r: typeof rows[number]): Scores => ({
      growth: r.growth, capital: r.capital, product: r.product,
      acquisition: r.acquisition, risk: r.risk,
    });

    const dimension = DIMENSIONS.find((d) => d.id === board);
    const standings = dimension
      ? rankBy(rows, dimension.id as DimensionId, scoresOf)
      // The overall board is not a dimension, but it shares the tie rule: two
      // identical results are identical, and ranking them 1st and 2nd by array
      // position invents a difference and then shows it to both of them.
      : rankOn(rows, (r) => r.overall);

    const names = await playerNames(rows.flatMap((r) => [r.player1Id, r.player2Id]));

    res.json({
      board: dimension ? dimension.id : "overall",
      title: dimension ? dimension.title : "Overall",
      boards: [
        { id: "overall", title: "Overall", blurb: "All five, with risk counted the right way round." },
        ...DIMENSIONS,
      ],
      standings: standings.slice(0, limit).map((s) => ({
        rank: s.rank,
        of: s.of,
        score: s.score,
        band: scoreBand(dimension?.betterIs === "lower" ? 1000 - s.score : s.score),
        name: s.entry.name || "Unnamed",
        tenYear: s.entry.tenYear,
        peak: s.entry.peak,
        players: [s.entry.player1Id, s.entry.player2Id].map((id) => {
          const who = names.get(id);
          return { name: who?.name ?? "Someone", isBot: !!who?.isBot };
        }),
        isYours: [s.entry.player1Id, s.entry.player2Id].includes(req.user.id),
      })),
    });
  });

  /*
   * There is deliberately no "start a game with this person" route.
   *
   * There was one, and it was a mistake: it took any user id and created a
   * game with them on the spot. Nobody had to agree to play, the person named
   * got a running clock they never asked for, and — because a player may only
   * be in one game at a time — being conscripted into one blocked them from
   * starting their own. It also never checked whether they were already
   * playing, so it could put somebody in two games at once, which the rest of
   * this file is written to prevent.
   *
   * Pairing two real people needs an invitation they accept or a queue they
   * join. Until one of those exists, `/api/games/solo` is the way in and the
   * partner is a bot, which can't be dragged anywhere against its will.
   */

  /**
   * Start one against a bot, now.
   *
   * The way in while real matchmaking is still to be designed — and it earns
   * its place regardless of what replaces it. At four in the morning, or on a
   * quiet week, the alternative to a bot partner is a spinner, and a game you
   * cannot start is not a game. The bot is labelled everywhere it appears.
   */
  app.post("/api/games/solo", isAuthenticated, rateLimit("sprint"), async (req: any, res) => {
    const era = req.body?.era;
    if (era && !["past", "modern", "futuristic"].includes(era)) {
      return res.status(400).json({ message: "Pick an era." });
    }

    const open = await activeGamesFor(req.user.id);
    if (open.length > 0) {
      return res.status(409).json({ message: "You're already in a game.", code: "already_playing", gameId: open[0].id });
    }

    // Seeded on the player, so somebody replaying gets a different partner
    // rather than the same name every time.
    const bot = botsFor(`solo:${req.user.id}:${Date.now()}`, 1)[0];
    const botUserId = await ensureBotUser(bot);
    if (!botUserId) return res.status(503).json({ message: "Couldn't find you a partner." });

    const id = await createGame({ player1Id: req.user.id, player2Id: botUserId, era });
    res.status(201).json({ id });
  });

  /** Whatever game you're in the middle of, if any. */
  app.get("/api/games/active", isAuthenticated, async (req: any, res) => {
    const open = await activeGamesFor(req.user.id);
    res.json({ games: open });
  });

  /**
   * The round, as it stands. Polled by both players, so it also moves the
   * clock on — a game whose rounds only advance when a job runs is a game that
   * hangs whenever the job is slow.
   */
  app.get("/api/games/:id", isAuthenticated, async (req: any, res) => {
    await settleIfReady(req.params.id).catch((e) => console.error("[game] settle on read failed:", e));

    const state = await gameState(req.params.id, req.user.id);
    if (!state) return res.status(404).json({ message: "No such game." });

    /*
     * The last round has closed and nobody has valued it yet. Kicked off here
     * rather than in the settle, so that the request which closes the round
     * doesn't sit waiting on a model call — the screen shows the results page
     * with the number still landing, which is the right feel for a reveal
     * anyway.
     */
    if (state.round === "verdict" && !state.verdict) {
      void valueGame(req.params.id).catch((e) => console.error("[game] valuation failed:", e));
    }

    res.json(state);
  });

  /** Your answer for the open round. Changeable right up to the deadline. */
  app.post("/api/games/:id/submit", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    const out = await submitRound({ gameId: req.params.id, userId: req.user.id, payload: req.body });
    if (!out.ok) {
      const status = out.code === "not_found" ? 404 : out.code === "not_a_player" ? 403 : 400;
      return res.status(status).json({ message: out.message, code: out.code });
    }
    const state = await gameState(req.params.id, req.user.id);
    res.json({ settled: out.settled, state });
  });

  app.post("/api/games/:id/leave", isAuthenticated, rateLimit("sprint"), async (req: any, res) => {
    const out = await leaveGame(req.params.id, req.user.id);
    if (!out.ok) {
      const status = out.code === "not_found" ? 404 : out.code === "not_a_player" ? 403 : 400;
      return res.status(status).json({ code: out.code, message: status === 400 ? "That game already ended." : "No such game." });
    }
    res.json({ ok: true, partnerId: out.partnerId });
  });

  app.get("/api/games/:id/messages", isAuthenticated, async (req: any, res) => {
    const rows = await messagesOf(req.params.id, req.user.id);
    if (!rows) return res.status(404).json({ message: "No such game." });
    res.json({ messages: rows });
  });

  app.post("/api/games/:id/messages", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    const row = await postMessage({ gameId: req.params.id, userId: req.user.id, body: String(req.body?.body ?? "") });
    if (!row) return res.status(400).json({ message: "Couldn't send that." });
    res.status(201).json(row);
  });

  /** Where one finished game landed on every board. */
  app.get("/api/games/:id/standings", isAuthenticated, async (req: any, res) => {
    const [game] = await db.select().from(startupGames).where(eq(startupGames.id, req.params.id));
    if (!game || !isPlayer(game, req.user.id)) return res.status(404).json({ message: "No such game." });

    const rows = await db.select().from(startupGameVerdicts)
      .where(eq(startupGameVerdicts.fromModel, true));
    const mine = rows.find((r) => r.gameId === req.params.id);
    if (!mine) return res.json({ scored: false, standings: null });

    const scoresOf = (r: typeof rows[number]): Scores => ({
      growth: r.growth, capital: r.capital, product: r.product,
      acquisition: r.acquisition, risk: r.risk,
    });

    const standings = DIMENSIONS.map((d) => {
      const place = rankBy(rows, d.id, scoresOf).find((s) => s.entry.gameId === mine.gameId)!;
      return {
        id: d.id, title: d.title, blurb: d.blurb,
        score: place.score,
        band: scoreBand(d.betterIs === "lower" ? 1000 - place.score : place.score),
        rank: place.rank, of: place.of,
      };
    });

    res.json({ scored: true, overall: mine.overall, standings });
  });
}

/**
 * Who played, and which of them was a bot.
 *
 * The label matters most here, of all places. A bot carries an ordinary name
 * so a lobby reads like a lobby, and this is a public ranking — a row reading
 * "Dana & Ada Fournier" with no further word implies two people beat you when
 * one of them was the product filling a seat. Every surface that shows a bot
 * says what it is; a leaderboard is a surface.
 */
async function playerNames(ids: string[]): Promise<Map<string, { name: string; isBot: boolean }>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db.select({
    id: users.id, firstName: users.firstName, lastName: users.lastName, isBot: users.isBot,
  }).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, {
    name: [r.firstName, r.lastName].filter(Boolean).join(" ") || "Someone",
    isBot: !!r.isBot,
  }]));
}
