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
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { startupGames, startupGameVerdicts, users } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import {
  activeGamesFor, dailyGameStatus, gameState, isPlayer, leaveGame,
  messagesOf, pastGamesFor, postMessage, settleIfReady, startGameFor, submitRound, saveDraft,
} from "./startup-game";
import { valueGame } from "./startup-game-verdict";
import { ensureBotUser } from "./bot-accounts";
import { botsFor } from "@shared/bots";
import { DECKS, SPEND_OPTIONS, MAX_CUSTOM_CARDS } from "@shared/sprints/cards";
import { BUDGET_TOTAL } from "@shared/sprints/budget";
import { MAX_CLAIMS, MAX_CORE_CLAIMS } from "@shared/sprints/product";
import {
  DIMENSIONS, scoreBand,
} from "@shared/sprints/scoring";
import { GAMES_PER_DAY, ROUND_COPY, ROUND_SECONDS, TOTAL_SECONDS, dealOrder, playAgainIn } from "@shared/sprints/game";

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

    const dimension = DIMENSIONS.find((d) => d.id === board);

    /*
     * Ranked in the database, on the column this board is actually about.
     *
     * This used to pull the top 500 rows *by overall score* and then rank each
     * dimension inside that slice. Every part of that is wrong once there are
     * more than 500 scored games: the best capital-efficiency result in the
     * world is missing from the capital board if its overall was mediocre, the
     * ranks are positions within an arbitrary sample, and every standing reads
     * "of 500" — a number that is neither how many games were played nor how
     * many were ranked. The game's own results page, which counted every
     * verdict, then disagreed with the board it claimed a place on.
     *
     * `rank()` gives the same tie rule `rankOn` does — equal scores share a
     * rank and the next one skips — and both window functions are evaluated
     * over the whole set before LIMIT, so `count(*) over ()` is the true
     * total, not the page size.
     */
    const scoreCol = dimension
      ? (startupGameVerdicts as any)[dimension.id]
      : startupGameVerdicts.overall;
    const ordering = dimension?.betterIs === "lower" ? sql`${scoreCol} asc` : sql`${scoreCol} desc`;

    const rows = await db
      .select({
        gameId: startupGameVerdicts.gameId,
        score: scoreCol as any,
        tenYear: startupGameVerdicts.tenYear,
        peak: startupGameVerdicts.peak,
        name: sql<string>`${startupGames.idea}->>'name'`,
        player1Id: startupGames.player1Id,
        player2Id: startupGames.player2Id,
        rank: sql<number>`(rank() over (order by ${ordering}))::int`,
        of: sql<number>`(count(*) over ())::int`,
      })
      .from(startupGameVerdicts)
      .innerJoin(startupGames, eq(startupGames.id, startupGameVerdicts.gameId))
      .where(eq(startupGameVerdicts.fromModel, true))
      .orderBy(ordering)
      .limit(limit);

    const names = await playerNames(rows.flatMap((r) => [r.player1Id, r.player2Id]));

    res.json({
      board: dimension ? dimension.id : "overall",
      title: dimension ? dimension.title : "Overall",
      boards: [
        { id: "overall", title: "Overall", blurb: "All five, with risk counted the right way round." },
        ...DIMENSIONS,
      ],
      standings: rows.map((s) => ({
        rank: s.rank,
        of: s.of,
        score: s.score,
        band: scoreBand(dimension?.betterIs === "lower" ? 1000 - s.score : s.score),
        name: s.name || "Unnamed",
        tenYear: s.tenYear,
        peak: s.peak,
        players: [s.player1Id, s.player2Id].map((id) => {
          const who = names.get(id);
          return { name: who?.name ?? "Someone", isBot: !!who?.isBot };
        }),
        isYours: [s.player1Id, s.player2Id].includes(req.user.id),
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

    /*
     * Answered early so the common case costs nothing, but it is *not* the
     * guard — `startGameFor` re-checks under an advisory lock inside the
     * insert's transaction. Two taps in the same second (phone and laptop) got
     * past a check up here every time, and the loser of that race was left
     * with a second game nobody could open which still blocked them from
     * starting another.
     */
    const open = await activeGamesFor(req.user.id);
    if (open.length > 0) {
      return res.status(409).json({ message: "You're already in a game.", code: "already_playing", gameId: open[0].id });
    }

    /*
     * One a day. Checked here, and checked again inside `startGameFor`'s
     * transaction under the same advisory lock that stops two taps making two
     * games — this one is the sentence, that one is the guarantee.
     *
     * Refused with the exact time it opens rather than a bare "come back
     * later", because a limit whose end nobody can see reads as the product
     * being broken. See GAME_COOLDOWN_MS for why a rolling day and not
     * midnight.
     */
    const daily = await dailyGameStatus(req.user.id);
    if (daily.spent) {
      return res.status(429).json({
        code: "played_today",
        message: `You've had today's game. The next one opens ${playAgainIn(daily.unlocksAt) ?? "shortly"} — one a day, so the number at the end is worth something.`,
        unlocksAt: daily.unlocksAt,
      });
    }

    // Seeded on the player, so somebody replaying gets a different partner
    // rather than the same name every time.
    const bot = botsFor(`solo:${req.user.id}:${Date.now()}`, 1)[0];
    const botUserId = await ensureBotUser(bot);
    if (!botUserId) return res.status(503).json({ message: "Couldn't find you a partner." });

    const started = await startGameFor({ playerId: req.user.id, partnerId: botUserId, era });
    if (!started.ok) {
      /*
       * Two ways to lose the race, and they are different sentences: somebody
       * already has a game open (go to it), or they used the day's allowance
       * between the check above and this one (come back, at this time).
       */
      if ("spent" in started) {
        return res.status(429).json({
          code: "played_today",
          message: `You've had today's game. The next one opens ${playAgainIn(started.unlocksAt) ?? "shortly"}.`,
          unlocksAt: started.unlocksAt,
        });
      }
      return res.status(409).json({ message: "You're already in a game.", code: "already_playing", gameId: started.existingId });
    }
    res.status(201).json({ id: started.id });
  });

  /**
   * Whatever game you're in the middle of, and whether you may start another.
   *
   * The allowance rides along with the active game because the entry card
   * needs both to decide what its one button says, and two requests to answer
   * one question is two chances for the screen to show a "Play now" that the
   * server is about to refuse.
   */
  app.get("/api/games/active", isAuthenticated, async (req: any, res) => {
    const open = await activeGamesFor(req.user.id);
    const daily = await dailyGameStatus(req.user.id);
    res.json({
      games: open,
      daily: {
        perDay: GAMES_PER_DAY,
        startedToday: daily.startedToday,
        /** False when a new game would be refused. A game in progress is not a refusal. */
        canStart: !daily.spent,
        unlocksAt: daily.unlocksAt,
        /** "in about 9 hours", or null when one is available now. */
        opensIn: playAgainIn(daily.unlocksAt),
      },
    });
  });

  /**
   * The ones you already finished.
   *
   * Registered before `/api/games/:id` for the reason written above the
   * leaderboard: Express matches in registration order, and `:id` declared
   * first would swallow this whole and 404 it forever.
   *
   * It exists because a finished game used to vanish the moment you navigated
   * away. `/api/games/active` returns playable rounds only, so the verdict —
   * the entire point of playing — was reachable from exactly one URL, the one
   * you happened to still have open.
   */
  app.get("/api/games/history", isAuthenticated, async (req: any, res) => {
    res.json({ games: await pastGamesFor(req.user.id, Number(req.query.limit) || 20) });
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
    /*
     * And again while the verdict is only a placeholder from a failed attempt.
     * `valueGame` decides whether it is worth asking and paces it, so the
     * five-second poll costs at most one model call a minute.
     */
    if (state.round === "verdict" && (!state.verdict || (state.verdict as any).fromModel === false)) {
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

  /**
   * Save what you have typed, without putting it forward. Used only if the
   * round's clock runs out before you submit — see `saveDraft`.
   */
  app.post("/api/games/:id/draft", isAuthenticated, async (req: any, res) => {
    const out = await saveDraft({ gameId: req.params.id, userId: req.user.id, payload: req.body });
    if (!out.ok) {
      const status = out.code === "not_found" ? 404 : out.code === "not_a_player" ? 403 : 400;
      return res.status(status).json({ message: out.message, code: out.code });
    }
    res.json(out);
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

    /*
     * Only this game's verdict, then one aggregate query for the places.
     *
     * This used to `select *` every scored verdict on the site and rank them
     * all in memory — on a page that polls every five seconds, per viewer.
     * Counting how many beat you answers the same question in one row, and it
     * is the same arithmetic `rank()` does on the boards (ties share a place,
     * so the rank is "how many are strictly better, plus one"). Both surfaces
     * now count over every scored game, which is why they finally agree: the
     * board used to rank inside a 500-row slice while this counted the lot.
     */
    const [mine] = await db.select().from(startupGameVerdicts)
      .where(and(eq(startupGameVerdicts.gameId, req.params.id), eq(startupGameVerdicts.fromModel, true)));
    if (!mine) return res.json({ scored: false, standings: null });

    const beats = (col: any, value: number, betterIs: "higher" | "lower") =>
      sql<number>`(count(*) filter (where ${col} ${betterIs === "lower" ? sql`<` : sql`>`} ${value}))::int`;

    const [counts] = await db.select({
      of: sql<number>`(count(*))::int`,
      growth: beats(startupGameVerdicts.growth, mine.growth, "higher"),
      capital: beats(startupGameVerdicts.capital, mine.capital, "higher"),
      product: beats(startupGameVerdicts.product, mine.product, "higher"),
      acquisition: beats(startupGameVerdicts.acquisition, mine.acquisition, "higher"),
      risk: beats(startupGameVerdicts.risk, mine.risk, "lower"),
    }).from(startupGameVerdicts).where(eq(startupGameVerdicts.fromModel, true));

    const standings = DIMENSIONS.map((d) => {
      const score = (mine as any)[d.id] as number;
      return {
        id: d.id, title: d.title, blurb: d.blurb,
        score,
        band: scoreBand(d.betterIs === "lower" ? 1000 - score : score),
        rank: ((counts as any)[d.id] as number) + 1,
        of: counts.of,
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
