/**
 * Running a game of Ten Years From Now.
 *
 * The rules are pure and live in `@shared/sprints/*`. This is the part that
 * touches a database: reading what two people submitted, settling the round,
 * opening the next one, and making sure none of that happens twice.
 *
 * ## The one invariant everything else serves
 *
 * **A round always ends.** Either both players settle it, or its clock does.
 * Two strangers playing a half-hour game cannot have a step that waits for
 * somebody who has closed the tab — that is how you get a graveyard of
 * half-finished startups and nobody playing twice.
 *
 * So every advance is conditional on the round it expects to find. Three
 * things race to settle a round routinely — both players' polls and the sweep
 * — and the `where` clause is what makes the second and third no-ops rather
 * than a game that skips a round.
 */
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "./db";
import {
  startupGames, startupGameSubmissions, startupGameDrafts, startupGameMessages, startupGameVerdicts, users,
} from "@shared/schema";
import {
  ROUND_SECONDS, nextRound, roundCanSettleEarly, settleChoice,
  type Round, type Submission,
} from "@shared/sprints/game";
import { DECKS, MAX_CUSTOM_CARDS, cardById, customCard, isCustomCard } from "@shared/sprints/cards";
import { botMove } from "@shared/sprints/partner";
import { cleanAllocation, mergeAllocations, budgetIsReady } from "@shared/sprints/budget";
import { cleanClaims, mergeClaims, claimsAreReady, type Claim } from "@shared/sprints/product";

export type GameRound = Round | "abandoned";

const deadlineFor = (round: Round): Date | null => {
  const seconds = (ROUND_SECONDS as Record<string, number>)[round];
  return seconds ? new Date(Date.now() + seconds * 1000) : null;
};

/** A game's two players, in a stable order. */
const playersOf = (game: { player1Id: string; player2Id: string }) => [game.player1Id, game.player2Id];

export const isPlayer = (game: { player1Id: string; player2Id: string }, userId: string) =>
  playersOf(game).includes(userId);

/** Start one. */
export async function createGame(input: {
  player1Id: string;
  player2Id: string;
  era?: "past" | "modern" | "futuristic";
}): Promise<string> {
  const [game] = await db.insert(startupGames).values({
    player1Id: input.player1Id,
    player2Id: input.player2Id,
    era: input.era ?? null,
    round: "idea",
    roundEndsAt: deadlineFor("idea"),
    /*
     * Written explicitly rather than left to the column default. `started_at`
     * is a zoneless timestamp and Postgres casts `now()` into one using the
     * session's zone, which lands hours away from every value Drizzle writes.
     * Nothing notices until something measures elapsed time — and this whole
     * game is a stack of clocks.
     */
    startedAt: new Date(),
  } as any).returning({ id: startupGames.id });
  return game.id;
}

// ─── Submissions ─────────────────────────────────────────────────────────────

/**
 * Clean one player's submission for the round it belongs to.
 *
 * Taken from the round rather than from the request, and every round's cleaner
 * drops anything it didn't ask for. Without this the budget round would accept
 * a line called `free-money`, and the product round would store whatever
 * somebody felt like pasting.
 *
 * Returns null when the submission has nothing usable in it, which is
 * different from an empty one: a player who submits nothing is a player who
 * hasn't decided yet, and the round's clock is what handles them.
 */
export function cleanSubmission(round: Round, raw: any, userId: string): any | null {
  switch (round) {
    case "idea": {
      const idea = raw?.idea ?? raw;
      const name = String(idea?.name ?? "").trim().slice(0, 80);
      if (!name) return null;
      return {
        name,
        tagline: String(idea?.tagline ?? "").trim().slice(0, 160),
        pitch: String(idea?.pitch ?? "").trim().slice(0, 600),
        twist: String(idea?.twist ?? "").trim().slice(0, 300),
        whoItsFor: String(idea?.whoItsFor ?? "").trim().slice(0, 200),
        /** Whose idea it originally was, so the results screen can say. */
        proposedBy: String(idea?.proposedBy ?? userId),
      };
    }

    case "customer":
    case "model": {
      const deck = DECKS[round];
      const id = String(raw?.cardId ?? "").trim();
      if (!id) return null;

      if (isCustomCard(id)) {
        const label = String(raw?.label ?? "").trim();
        if (!label) return null;
        /*
         * The id is rebuilt from the submitting player rather than trusted,
         * so one player cannot file a card under the other's name and make a
         * disagreement look like agreement.
         */
        const index = Number(id.split(":").pop());
        if (!Number.isInteger(index) || index < 0 || index >= MAX_CUSTOM_CARDS) return null;
        const card = customCard({ label, detail: String(raw?.detail ?? ""), index, owner: userId });
        return { cardId: card.id, label: card.label, detail: card.detail };
      }

      const card = cardById(deck, id);
      if (!card) return null;
      return { cardId: card.id, label: card.label, detail: card.detail };
    }

    case "product": {
      const claims = cleanClaims(raw?.claims, userId);
      return claims.length > 0 ? { claims } : null;
    }

    case "spend": {
      const allocation = cleanAllocation(raw?.allocation ?? raw);
      return budgetIsReady(allocation).ok ? { allocation } : null;
    }

    default:
      return null;
  }
}

/**
 * What a player has typed so far, cleaned the way a submission would be.
 *
 * The same cleaner as a submission, with one allowance: an idea with a pitch
 * but no name yet is still worth keeping. Somebody who has written three
 * paragraphs and not got round to naming the thing has not decided nothing —
 * and if the clock runs out on them, a company called "Untitled company" with
 * their pitch is a far better outcome than a company with neither.
 */
export function cleanDraft(round: Round, raw: any, userId: string): any | null {
  if (round === "idea") {
    const idea = raw?.idea ?? raw;
    const written = ["tagline", "pitch", "twist", "whoItsFor"].some((k) => String(idea?.[k] ?? "").trim());
    if (!String(idea?.name ?? "").trim() && written) {
      return cleanSubmission(round, { ...idea, name: "Untitled company" }, userId);
    }
  }
  return cleanSubmission(round, raw, userId);
}

/** At most one draft write per player per game every this many milliseconds. */
const DRAFT_EVERY_MS = 1_000;
const lastDraft = new Map<string, number>();

/**
 * Keep what a player has typed, without putting it forward.
 *
 * See `startupGameDrafts`: a draft is read only when the round's clock runs
 * out and the player never submitted. It is never a decision, never seen by
 * the partner, and never ends a round early.
 *
 * Paced here rather than by the shared limiters, which allow sixty requests in
 * ten minutes — an autosave during a six-minute round of typing would exhaust
 * that and then start eating the player's real submissions. The cost of a
 * write is one row per player per round, overwritten, so the only thing worth
 * bounding is the rate.
 */
export async function saveDraft(input: { gameId: string; userId: string; payload: any }):
  Promise<{ ok: true; saved: boolean } | { ok: false; code: string; message: string }> {
  const { gameId, userId, payload } = input;
  const key = `${gameId}:${userId}`;
  if (Date.now() - (lastDraft.get(key) ?? 0) < DRAFT_EVERY_MS) return { ok: true, saved: false };
  lastDraft.set(key, Date.now());

  const [game] = await db.select().from(startupGames).where(eq(startupGames.id, gameId));
  if (!game) return { ok: false, code: "not_found", message: "No such game." };
  if (!isPlayer(game, userId)) return { ok: false, code: "not_a_player", message: "You're not in this game." };
  if (game.round === "abandoned" || game.round === "verdict") return { ok: true, saved: false };

  const round = game.round as Round;
  const clean = cleanDraft(round, payload, userId);
  if (!clean) {
    // They cleared the form. A stale draft must not stand in for a blank one.
    await db.delete(startupGameDrafts).where(and(
      eq(startupGameDrafts.gameId, gameId), eq(startupGameDrafts.userId, userId), eq(startupGameDrafts.round, round)));
    return { ok: true, saved: false };
  }

  await db.insert(startupGameDrafts)
    .values({ gameId, userId, round, payload: clean, savedAt: new Date() })
    .onConflictDoUpdate({
      target: [startupGameDrafts.gameId, startupGameDrafts.userId, startupGameDrafts.round],
      set: { payload: clean, savedAt: new Date() },
    });
  return { ok: true, saved: true };
}

/**
 * Put a player's answer in, replacing whatever was there.
 *
 * Changing your mind right up to the deadline is the point: the argument that
 * makes this worth playing with another person usually happens after somebody
 * has already picked.
 */
export async function submitRound(input: {
  gameId: string;
  userId: string;
  payload: any;
}): Promise<{ ok: true; settled: boolean } | { ok: false; code: string; message: string }> {
  const { gameId, userId, payload } = input;

  const [game] = await db.select().from(startupGames).where(eq(startupGames.id, gameId));
  if (!game) return { ok: false, code: "not_found", message: "No such game." };
  if (!isPlayer(game, userId)) return { ok: false, code: "not_a_player", message: "You're not in this game." };
  if (game.round === "abandoned") return { ok: false, code: "over", message: "That game ended." };
  if (game.round === "verdict") return { ok: false, code: "over", message: "That game is finished." };

  const round = game.round as Round;
  const clean = cleanSubmission(round, payload, userId);
  if (!clean) return { ok: false, code: "unusable", message: "That isn't a valid answer for this round." };

  /*
   * The round is re-checked under a lock before the answer is stored.
   *
   * Between reading the game above and writing below, the round can close —
   * the sweep runs every twenty seconds and the other player's poll settles
   * too. Without the lock, an answer submitted on the buzzer was written
   * against a round that had already been resolved: stored, never read,
   * silently dropped, and the player told it had worked. Losing somebody's
   * last-second decision is bad; telling them it landed is worse.
   *
   * `settleIfReady` takes the same lock, so the two serialise: either this
   * answer is in before the round closes, or the round has closed and the
   * player is told so.
   */
  const stored = await db.transaction(async (tx) => {
    const [held] = await tx.select({ round: startupGames.round })
      .from(startupGames).where(eq(startupGames.id, gameId)).for("update");
    if (!held || held.round !== round) return false;

    await tx.insert(startupGameSubmissions)
      .values({ gameId, userId, round, payload: clean, submittedAt: new Date() } as any)
      .onConflictDoUpdate({
        target: [startupGameSubmissions.gameId, startupGameSubmissions.userId, startupGameSubmissions.round],
        set: { payload: clean, submittedAt: new Date() },
      });
    // A real answer supersedes whatever was being typed.
    await tx.delete(startupGameDrafts).where(and(
      eq(startupGameDrafts.gameId, gameId), eq(startupGameDrafts.userId, userId), eq(startupGameDrafts.round, round)));

    /*
     * A bot partner answers in the same breath, under the same lock.
     *
     * It used to answer nothing, which broke the game in its only mode: a pick
     * round ends early only when both agree, so every round of a solo game
     * ran its full clock and closed with "only one of you answered". See
     * `@shared/sprints/partner` for what it chooses and why.
     */
    const partnerId = game.player1Id === userId ? game.player2Id : game.player1Id;
    const [partner] = await tx.select({ isBot: users.isBot }).from(users).where(eq(users.id, partnerId));
    if (!partner?.isBot) return "stored";

    const move = botMove({ round, gameId, human: clean, deck: (DECKS as any)[round] });
    if (!move) return "stored";
    // After yours, so the two read back in the order they were made.
    const at = new Date(Date.now() + 1);
    await tx.insert(startupGameSubmissions)
      .values({ gameId, userId: partnerId, round, payload: move, submittedAt: at } as any)
      .onConflictDoUpdate({
        target: [startupGameSubmissions.gameId, startupGameSubmissions.userId, startupGameSubmissions.round],
        set: { payload: move, submittedAt: at },
      });
    return "against-bot";
  });

  if (!stored) {
    return { ok: false, code: "round_over", message: "That round just ended — you're on the next one." };
  }

  /*
   * Against a bot there is nobody left to persuade, so the round closes now
   * rather than on its clock. Pinned to the round just answered: if the sweep
   * advanced the game in the moment between, forcing unpinned would close the
   * *next* round with nothing in it.
   */
  if (stored === "against-bot") {
    const settled = await settleIfReady(gameId, true, round);
    return { ok: true, settled };
  }

  /*
   * Agreement should feel instant. A round where both have picked the same
   * thing has nothing left to decide, and making them watch the rest of a
   * four-minute clock is the game wasting their half hour.
   *
   * A disagreement keeps its clock on purpose — see `roundCanSettleEarly`.
   */
  const settled = await settleIfReady(gameId);
  return { ok: true, settled };
}

/** Both players' answers for a round, oldest first. */
async function submissionsFor(gameId: string, round: Round) {
  return db.select().from(startupGameSubmissions)
    .where(and(eq(startupGameSubmissions.gameId, gameId), eq(startupGameSubmissions.round, round)));
}

// ─── Settling ────────────────────────────────────────────────────────────────

/**
 * Rounds where the two of them pick one of something, as opposed to keeping
 * both answers.
 *
 * The distinction decides whether a round can end early, so it is named once
 * here rather than inferred. It was inferred, and the inference was wrong:
 * `sameChoice` compared `cardId`, which a product or budget submission does
 * not have, so `undefined === undefined` read as agreement and both of those
 * rounds ended the instant the second player submitted.
 */
const PICK_ROUNDS = new Set<Round>(["idea", "customer", "model"]);

/** Two submissions are "the same pick" when they name the same card or idea. */
const sameChoice = (round: Round) => (a: any, b: any) => {
  if (round === "idea") return String(a?.name ?? "").toLowerCase() === String(b?.name ?? "").toLowerCase();
  if (round === "customer" || round === "model") return a?.cardId === b?.cardId;
  // A merge round has no notion of the same answer; see `canEndEarly`.
  return false;
};

/**
 * Settle the open round if it is ready, and open the next one.
 *
 * Ready means either both players agree, or the clock has run out. Everything
 * here is conditional on the round still being the one we read, so the two
 * players' polls and the sweep racing each other produce one advance.
 */
export async function settleIfReady(gameId: string, force = false, onlyRound?: Round): Promise<boolean> {
  /*
   * Everything from here to the advance happens under a lock on the game row,
   * which `submitRound` also takes. Reading the submissions outside one meant
   * an answer could land after the read and before the update, and the round
   * would close without it even though the player submitted in time.
   */
  return db.transaction(async (tx) => settleLocked(tx, gameId, force, onlyRound));
}

async function settleLocked(tx: any, gameId: string, force: boolean, onlyRound?: Round): Promise<boolean> {
  const [game] = await tx.select().from(startupGames)
    .where(eq(startupGames.id, gameId)).for("update");
  if (!game || game.round === "verdict" || game.round === "abandoned") return false;
  // A forced settle aimed at one round must not land on the one after it.
  if (onlyRound && game.round !== onlyRound) return false;

  const round = game.round as Round;
  const rows = await tx.select().from(startupGameSubmissions)
    .where(and(eq(startupGameSubmissions.gameId, gameId), eq(startupGameSubmissions.round, round)));
  const expired = !!game.roundEndsAt && new Date(game.roundEndsAt).getTime() <= Date.now();

  const submissions: Submission<any>[] = rows.map((r: any) => ({
    userId: r.userId,
    choice: r.payload,
    at: new Date(r.submittedAt).getTime(),
  }));

  /*
   * Only a pick round can end early.
   *
   * A merge round keeps both answers, so there is always something left to
   * change: the budget screen tells the pair in as many words that what gets
   * spent is the average of their two budgets and that they should talk to
   * each other, and ending the round the moment the second one submits gives
   * neither of them a chance to move after seeing the other's number. That is
   * the whole negotiation, and it happens after the first submission.
   */
  const everyoneAgrees = PICK_ROUNDS.has(round) && roundCanSettleEarly({
    submissions, playerCount: 2, same: sameChoice(round),
  });

  if (!force && !expired && !everyoneAgrees) return false;

  /*
   * The clock ran out on somebody who was still typing: what they typed
   * stands in for them.
   *
   * Only here, after the early-settle check. A draft is not a decision and
   * must never be what ends a round early or what an agreement is measured
   * against — it only fills the gap the clock would otherwise leave. Before
   * this, that gap was filled with nothing: the idea round closed on a
   * company with no name and no description while the player's name, tagline
   * and pitch sat in their text boxes, never sent.
   */
  if (expired || force) {
    const answered = new Set(submissions.map((s) => s.userId));
    const drafts = await tx.select().from(startupGameDrafts)
      .where(and(eq(startupGameDrafts.gameId, gameId), eq(startupGameDrafts.round, round)));
    for (const d of drafts) {
      if (answered.has(d.userId)) continue;
      submissions.push({ userId: d.userId, choice: d.payload, at: new Date(d.savedAt).getTime() });
    }
  }

  const outcome = resolveRound(gameId, round, submissions);

  /*
   * Conditional on the round we read. Two polls and a sweep reach this line
   * together all the time; without the condition a game would skip a round
   * every time they did.
   */
  const after = nextRound(round)!;
  const settledBy = { ...(game.settledBy as Record<string, string> ?? {}), [round]: outcome.reason };

  const advanced = await tx.update(startupGames)
    .set({
      ...outcome.columns,
      settledBy,
      round: after,
      roundEndsAt: after === "verdict" ? null : deadlineFor(after),
      completedAt: after === "verdict" ? new Date() : null,
    })
    .where(and(eq(startupGames.id, gameId), eq(startupGames.round, round)))
    .returning({ id: startupGames.id });

  return advanced.length > 0;
}

/**
 * What a round's submissions become on the game row.
 *
 * Three rounds pick one of something and two merge both answers — see
 * `mergeClaims` and `mergeAllocations` for why those two keep both.
 */
function resolveRound(gameId: string, round: Round, submissions: Submission<any>[]) {
  const seed = `game:${gameId}:${round}`;

  if (round === "product") {
    const lists = submissions.map((s) => (s.choice?.claims ?? []) as Claim[]);
    const claims = mergeClaims(lists);
    return {
      reason: submissions.length === 0 ? "nobody" : submissions.length === 1 ? "unopposed" : "merged",
      columns: { productClaims: claims },
    };
  }

  if (round === "spend") {
    const allocations = submissions.map((s) => s.choice?.allocation ?? {});
    return {
      reason: submissions.length === 0 ? "nobody" : submissions.length === 1 ? "unopposed" : "merged",
      // The average of the two, so neither player is a spectator in the round
      // the valuation leans on hardest.
      columns: { budget: allocations.length ? mergeAllocations(allocations) : null },
    };
  }

  const settled = settleChoice({ submissions, seed, same: sameChoice(round) });

  if (round === "idea") return { reason: settled.reason, columns: { idea: settled.choice } };
  if (round === "customer") {
    return {
      reason: settled.reason,
      columns: {
        customerCardId: settled.choice?.cardId ?? null,
        customerLabel: settled.choice?.label ?? null,
      },
    };
  }
  return {
    reason: settled.reason,
    columns: {
      modelCardId: settled.choice?.cardId ?? null,
      modelLabel: settled.choice?.label ?? null,
    },
  };
}

/**
 * Push every round whose clock has run out.
 *
 * The screens call `settleIfReady` on every poll, which covers every game
 * somebody is watching. This covers the rest — the game where both players
 * closed the tab — which otherwise sits on a deadline nothing is checking.
 */
export async function sweepDueRounds(): Promise<number> {
  const due = await db.select({ id: startupGames.id })
    .from(startupGames)
    .where(and(
      inArray(startupGames.round, ["idea", "customer", "model", "product", "spend"]),
      /*
       * A Date compared through the column, not SQL's `now()`. A zoneless
       * `timestamp` holds the UTC time Drizzle wrote into it; `now()` is
       * rendered in the database session's zone, so the comparison is out by
       * that offset and every deadline looks hours away on a database that
       * isn't running in UTC. Passing the Date to `lte` puts both sides
       * through the same mapper. Same reasoning, at length, in
       * server/simulation-tick.ts — including the one form that looks
       * identical and isn't.
       */
      lte(startupGames.roundEndsAt, new Date()),
    ))
    .limit(200);

  let advanced = 0;
  for (const game of due) {
    try {
      if (await settleIfReady(game.id)) advanced += 1;
    } catch (err) {
      console.error(`[game] settling ${game.id} failed:`, err);
    }
  }
  return advanced;
}

// ─── Leaving ─────────────────────────────────────────────────────────────────

/**
 * Walk out.
 *
 * Ends the game for both rather than removing one player, for the same reason
 * a sprint did: a two-person game with one person in it is not a shorter game,
 * it is a broken one. The row stays, marked abandoned with who left — the
 * other person spent twenty minutes in it, and a game that vanishes reads as a
 * bug rather than as somebody leaving.
 */
export async function leaveGame(gameId: string, userId: string): Promise<
  { ok: true; partnerId: string | null } | { ok: false; code: string }
> {
  const [game] = await db.select().from(startupGames).where(eq(startupGames.id, gameId));
  if (!game) return { ok: false, code: "not_found" };
  if (!isPlayer(game, userId)) return { ok: false, code: "not_a_player" };
  if (game.round === "abandoned" || game.round === "verdict") return { ok: false, code: "already_over" };

  const ended = await db.update(startupGames)
    .set({ round: "abandoned", abandonedAt: new Date(), abandonedById: userId, roundEndsAt: null })
    .where(and(
      eq(startupGames.id, gameId),
      // Both pressing Leave at the same moment: the first lands, the second is
      // told it is over rather than overwriting who left.
      inArray(startupGames.round, ["idea", "customer", "model", "product", "spend"]),
    ))
    .returning({ id: startupGames.id });

  if (ended.length === 0) return { ok: false, code: "already_over" };

  const partnerId = playersOf(game).find((id) => id !== userId) ?? null;
  return { ok: true, partnerId: partnerId === userId ? null : partnerId };
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/** Everything one player's screen needs for the round they are in. */
export async function gameState(gameId: string, viewerId: string) {
  const [game] = await db.select().from(startupGames).where(eq(startupGames.id, gameId));
  if (!game || !isPlayer(game, viewerId)) return null;

  const round = game.round as GameRound;
  const people = await db.select({
    id: users.id, firstName: users.firstName, lastName: users.lastName,
    avatar: users.profileImageUrl, isBot: users.isBot,
  }).from(users).where(inArray(users.id, playersOf(game)));

  const rows = round === "verdict" || round === "abandoned" ? [] : await submissionsFor(gameId, round as Round);

  const [verdict] = round === "verdict"
    ? await db.select().from(startupGameVerdicts).where(eq(startupGameVerdicts.gameId, gameId))
    : [];

  /*
   * What you had typed and not sent, so a reload puts it back in the boxes.
   * Yours only: a partner's draft is not an answer and they have not shown it.
   */
  const [draft] = round === "verdict" || round === "abandoned"
    ? []
    : await db.select({ payload: startupGameDrafts.payload }).from(startupGameDrafts).where(and(
        eq(startupGameDrafts.gameId, gameId), eq(startupGameDrafts.userId, viewerId), eq(startupGameDrafts.round, round)));

  const partnerId = playersOf(game).find((id) => id !== viewerId)!;

  return {
    game,
    round,
    secondsLeft: game.roundEndsAt
      ? Math.max(0, Math.floor((new Date(game.roundEndsAt).getTime() - Date.now()) / 1000))
      : null,
    players: playersOf(game).map((id) => {
      const p = people.find((x) => x.id === id);
      return {
        id,
        name: [p?.firstName, p?.lastName].filter(Boolean).join(" ") || "Someone",
        avatar: p?.avatar ?? null,
        isBot: !!p?.isBot,
        isYou: id === viewerId,
      };
    }),
    /** Your own answer, whole. */
    yours: rows.find((r) => r.userId === viewerId)?.payload ?? null,
    /** Typed but not put forward. Null once you submit. */
    yourDraft: draft?.payload ?? null,
    /**
     * Your partner's answer.
     *
     * Shown rather than hidden until the round closes, deliberately. This is a
     * game about arguing somebody round, and you cannot argue with a choice
     * you can't see — a sealed vote would turn every round into two people
     * guessing in a chat window.
     */
    theirs: rows.find((r) => r.userId === partnerId)?.payload ?? null,
    verdict: verdict ?? null,
  };
}

/** Games this person is in the middle of. */
export async function activeGamesFor(userId: string) {
  return db.select().from(startupGames)
    .where(and(
      sql`(${startupGames.player1Id} = ${userId} or ${startupGames.player2Id} = ${userId})`,
      inArray(startupGames.round, ["idea", "customer", "model", "product", "spend"]),
    ));
}

// ─── Chat ────────────────────────────────────────────────────────────────────

export async function postMessage(input: { gameId: string; userId: string; body: string }) {
  const body = input.body.trim().slice(0, 1000);
  if (!body) return null;
  const [game] = await db.select().from(startupGames).where(eq(startupGames.id, input.gameId));
  if (!game || !isPlayer(game, input.userId)) return null;

  const [row] = await db.insert(startupGameMessages)
    .values({ gameId: input.gameId, userId: input.userId, round: game.round, body, createdAt: new Date() } as any)
    .returning();
  return row;
}

export async function messagesOf(gameId: string, viewerId: string) {
  const [game] = await db.select().from(startupGames).where(eq(startupGames.id, gameId));
  if (!game || !isPlayer(game, viewerId)) return null;
  return db.select().from(startupGameMessages)
    .where(eq(startupGameMessages.gameId, gameId))
    .orderBy(startupGameMessages.createdAt);
}

export { claimsAreReady, budgetIsReady };

/**
 * Starts the clock.
 *
 * Every twenty seconds, which is far more eager than the simulation's minute
 * and has to be: a round here is four to six minutes, and a game that sat a
 * full minute past its deadline before moving would spend a twentieth of
 * itself frozen. The pass does nothing at all when no round is due.
 */
/**
 * The Postgres error code for "that table isn't there", wherever the driver
 * buried it. Drizzle wraps driver errors, so the code is one level down.
 */
const undefinedTable = (err: any) => (err?.code ?? err?.cause?.code) === "42P01";

export function startStartupGameJobs(): void {
  /*
   * A missing table is reported once, not sixty times an hour.
   *
   * It means one thing — the migration that creates these tables has not been
   * applied — and it will still mean that on the next pass twenty seconds
   * later. Logging the full query, parameters and stack each time buries every
   * other line in the log under the same repeated page, which is precisely
   * when somebody is trying to read the log to find out what is wrong.
   */
  let toldAboutMissingTables = false;

  const pass = () => {
    sweepDueRounds()
      .then((n) => (n > 0 ? console.log(`[game] settled ${n} round(s) nobody was watching`) : undefined))
      .catch((err) => {
        if (undefinedTable(err)) {
          if (!toldAboutMissingTables) {
            toldAboutMissingTables = true;
            console.error("[game] startup_games is missing — run `npm run db:migrate`. Games are off until then.");
          }
          return;
        }
        toldAboutMissingTables = false;
        console.error("[game] sweep failed:", err);
      });
  };

  setTimeout(pass, 15_000);
  setInterval(pass, 20_000).unref();
}
