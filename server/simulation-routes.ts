/**
 * Joining a simulation, and claiming a seat in one.
 *
 * The interesting part of this file is one line of SQL. Five people reach for
 * five seats on five phones inside the same second, and something has to
 * decide who gets "ceo". Checking whether the role is free and then inserting
 * it is the classic two-step that looks correct and is not: both requests read
 * "free", both insert, and the season runs with two chief executives and a
 * lobby screen that disagrees with itself.
 *
 * So the claim is a single conditional statement, and the unique index on
 * (venture, role) is what settles it. The loser is told who beat them, which
 * is a different thing from an error.
 */
import type { Express } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { simSeasons, simSeats, simVentures, users, userProfiles } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { enforceRateLimit, ipKey } from "./moderation";
import { NICHES, nicheById } from "@shared/simulation/niches";
import { ROLES, ROLE_LEVERS, ROLE_TITLES, type Role } from "@shared/simulation/types";
import {
  LOBBY_SIZE, PHASE_SECONDS, assignRemaining, canClaim, nextPhase, openRoles, placeholderName,
  type Phase, type SeatView,
} from "@shared/simulation/lobby";

const secondsLeft = (endsAt: Date | null): number =>
  endsAt ? Math.round((endsAt.getTime() - Date.now()) / 1000) : Number.POSITIVE_INFINITY;

const phaseDeadline = (phase: Phase): Date | null => {
  const seconds = (PHASE_SECONDS as Record<string, number>)[phase];
  return seconds ? new Date(Date.now() + seconds * 1000) : null;
};

/** Everyone in the room, with enough of a face to argue with. */
async function seatsOf(ventureId: string) {
  return db
    .select({
      userId: simSeats.userId,
      role: simSeats.role,
      assigned: simSeats.assigned,
      joinedAt: simSeats.joinedAt,
      firstName: users.firstName,
      displayName: userProfiles.displayName,
      avatarUrl: userProfiles.avatarUrl,
    })
    .from(simSeats)
    .leftJoin(users, eq(users.id, simSeats.userId))
    .leftJoin(userProfiles, eq(userProfiles.userId, simSeats.userId))
    .where(eq(simSeats.ventureId, ventureId))
    .orderBy(asc(simSeats.joinedAt));
}

/**
 * Moves a venture on when its phase is over.
 *
 * Called from every read as well as every write, on purpose: a lobby whose
 * clock only advances when somebody acts is a lobby that hangs forever when
 * everybody is waiting. Reading the screen is enough to move it along.
 */
async function advance(ventureId: string): Promise<void> {
  const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));
  if (!venture || venture.phase === "running" || venture.phase === "retired") return;

  const rows = await seatsOf(ventureId);
  const seats: SeatView[] = rows.map((r) => ({ userId: r.userId, role: r.role as Role | null, assigned: r.assigned }));

  const move = nextPhase({
    phase: venture.phase as Phase,
    seats,
    secondsLeft: secondsLeft(venture.phaseEndsAt),
    named: !!venture.name,
  });
  if (!move) return;

  /*
   * Dealing out unclaimed seats is several writes that must land together: a
   * team that ends up with two COOs because one update failed halfway is worse
   * than one that waits another second for the transaction.
   */
  if (move.assign) {
    const assigned = assignRemaining(seats);
    await db.transaction(async (tx) => {
      for (const seat of assigned) {
        if (!seat.role || seats.find((s) => s.userId === seat.userId)?.role) continue;
        await tx.update(simSeats)
          .set({ role: seat.role, assigned: true, claimedAt: new Date() })
          .where(and(eq(simSeats.ventureId, ventureId), eq(simSeats.userId, seat.userId)));
      }
      await tx.update(simVentures)
        .set({ phase: move.phase, phaseEndsAt: phaseDeadline(move.phase) })
        .where(eq(simVentures.id, ventureId));
    });
    return;
  }

  const name = move.phase === "running" && !venture.name ? placeholderName(ventureId) : venture.name;
  await db.update(simVentures)
    .set({ phase: move.phase, phaseEndsAt: phaseDeadline(move.phase), name })
    .where(eq(simVentures.id, ventureId));
}

export function registerSimulationRoutes(app: Express) {
  /** The markets you can start a company in, and what each one is like. */
  app.get("/api/sim/niches", isAuthenticated, async (_req, res) => {
    res.json({
      niches: NICHES.map((n) => ({
        id: n.id,
        name: n.name,
        premise: n.premise,
        segments: n.segments.map((s) => ({ id: s.id, name: s.name, description: s.description, size: s.size, loyalty: s.loyalty })),
        incumbents: n.incumbents.map((i) => ({ name: i.name, share: i.startingShare, posture: i.posture })),
      })),
      roles: ROLES.map((r) => ({ id: r, title: ROLE_TITLES[r], levers: ROLE_LEVERS[r] })),
      lobbySize: LOBBY_SIZE,
    });
  });

  /**
   * Join a niche — into a room that has space, or a new one.
   *
   * The seat is taken in the same statement that finds the room. Two people
   * joining a four-person lobby at the same moment must not both be told
   * "you're the fifth": the insert is what decides, and the unique index on
   * (venture, user) makes a double-join a no-op rather than two seats.
   */
/**
 * The Postgres error code, wherever the driver buried it.
 *
 * Drizzle wraps driver errors in a `DrizzleQueryError` carrying the query and
 * params, which is genuinely useful in a log and quietly disastrous in a
 * `catch`: the code that says *why* the write failed is on the cause, not on
 * the thing you caught. Checking `err.code` therefore matches nothing and
 * every expected conflict falls through to the 500 branch.
 *
 * That is not a theoretical tidiness point. Five people grabbed the chief
 * executive's chair at once; one won, three were told who beat them, and the
 * fourth got "something went wrong" — the unique index had done exactly its
 * job and the handler for it was reading the wrapper. Walking the chain is
 * what makes a lost race read as a lost race.
 */
function pgErrorCode(err: unknown): string | undefined {
  for (let e: any = err, hops = 0; e && hops < 5; e = e.cause, hops++) {
    if (typeof e.code === "string") return e.code;
  }
  return undefined;
}

  app.post("/api/sim/join", isAuthenticated, async (req: any, res) => {
    if (!(await enforceRateLimit(res, req.user.id, "session"))) return;
    const nicheId = String(req.body?.nicheId ?? "");
    const niche = nicheById(nicheId);
    if (!niche) return res.status(400).json({ message: "That isn't a market we run.", code: "unknown_niche" });

    try {
      const ventureId = await db.transaction(async (tx) => {
        // Already in a room for this niche? Go back to it rather than making a second.
        const [existing] = await tx
          .select({ id: simVentures.id })
          .from(simSeats)
          .innerJoin(simVentures, eq(simVentures.id, simSeats.ventureId))
          .innerJoin(simSeasons, eq(simSeasons.id, simVentures.seasonId))
          .where(and(
            eq(simSeats.userId, req.user.id),
            eq(simSeasons.nicheId, nicheId),
            sql`${simVentures.phase} not in ('retired')`,
          ))
          .limit(1);
        if (existing) return existing.id;

        /*
         * One joiner at a time per market, for the whole choose-or-create step.
         *
         * Row locks cannot carry this, and it is worth being precise about why:
         * `FOR UPDATE` locks rows that exist. Everything below is select-or-
         * create — a season, then a room — so on a quiet market every joiner's
         * select matches nothing, there is nothing to lock, and each one
         * creates their own. Five friends press join together and land in two
         * or three different rooms, which is the single outcome this feature
         * exists to prevent. No row lock can exclude a row nobody has inserted
         * yet.
         *
         * Locking the season is not enough either, for the same reason one
         * level up: two joiners who both find no season both make one, take
         * locks on two different seasons, and never see each other. The lock
         * has to be on the one thing that exists before any row does, which is
         * the market itself.
         *
         * Held for two selects and at most two inserts, released when the
         * transaction ends, and per-market, so a queue for one never waits on
         * another.
         */
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${nicheId}, 0))`);

        const [season] = await tx
          .select()
          .from(simSeasons)
          .where(and(eq(simSeasons.nicheId, nicheId), eq(simSeasons.status, "forming")))
          .orderBy(desc(simSeasons.createdAt))
          .limit(1);

        const seasonId = season?.id ?? (await tx.insert(simSeasons).values({
          nicheId,
          name: `${niche.name} — season ${new Date().toISOString().slice(0, 10)}`,
        }).returning())[0].id;

        /*
         * A room with space, locked while we look at it. Without the lock two
         * people both see four seats, both take the fifth, and the room ends up
         * with six.
         *
         * The count is a subquery rather than a GROUP BY because Postgres
         * refuses `FOR UPDATE` with `GROUP BY` — grouping makes the returned
         * rows no longer correspond to single rows that could be locked. A
         * correlated count keeps one row per venture, so there is something to
         * lock.
         *
         * It waits rather than skipping. `skip locked` was the first instinct —
         * nobody queues, everybody gets a room immediately — and it was wrong
         * for a lobby: five friends pressing join at the same moment skipped
         * past each other's locked rows and landed in three different rooms.
         *
         * With the advisory lock above, this row lock is now belt and braces:
         * it costs nothing and it still holds the line for any future caller
         * that reaches this query without taking the season lock first.
         */
        const rooms = await tx.execute(sql`
          select v.id
          from ${simVentures} v
          where v.season_id = ${seasonId}
            and v.phase = 'filling'
            and (select count(*) from ${simSeats} s where s.venture_id = v.id) < ${LOBBY_SIZE}
          order by (select count(*) from ${simSeats} s where s.venture_id = v.id) desc
          limit 1
          for update
        `);
        const room = (rooms as unknown as { rows?: { id: string }[] }).rows?.[0]
          ?? (rooms as unknown as { id: string }[])[0];

        /*
         * Count again, now that the row is actually locked.
         *
         * The count above cannot be trusted and this is the subtle part: under
         * READ COMMITTED, a `FOR UPDATE` that waits for another transaction
         * re-checks the locked row's own columns against the new version — but
         * the seat count is not one of its columns, it is a subquery over
         * another table. So the second joiner woke up holding the lock and
         * carrying a count from before the first joiner's insert, and a room
         * with four seats took two more people. Six in a five-seat room, which
         * is what the browsers showed and the sequential tests never could.
         *
         * Holding the lock is what makes this second count authoritative: every
         * joiner must hold it before inserting, so nobody can be adding a seat
         * to this room while we look.
         */
        let targetId: string | undefined = room?.id;
        if (targetId) {
          const [{ taken }] = await tx
            .select({ taken: sql<number>`count(*)::int` })
            .from(simSeats)
            .where(eq(simSeats.ventureId, targetId));
          if (taken >= LOBBY_SIZE) targetId = undefined;
        }

        targetId ??= (await tx.insert(simVentures).values({
          seasonId,
          phase: "filling",
          phaseEndsAt: phaseDeadline("filling"),
        }).returning())[0].id;

        await tx.insert(simSeats).values({ ventureId: targetId, userId: req.user.id }).onConflictDoNothing();
        return targetId;
      });

      await advance(ventureId);
      res.json({ ventureId });
    } catch (err) {
      console.error("[sim] join failed:", err);
      res.status(500).json({ message: "Couldn't get you into a room. Try again." });
    }
  });

  /**
   * The rooms you're already in.
   *
   * Without this, someone who closes the app mid-lobby can only get back by
   * joining the same market again — which works, because join returns the room
   * you're in, but it is a rejoin rather than a resume and there is nowhere to
   * show "you're in a room right now" before they think to press it.
   */
  app.get("/api/sim/ventures", isAuthenticated, async (req: any, res) => {
    const rows = await db
      .select({
        id: simVentures.id,
        phase: simVentures.phase,
        name: simVentures.name,
        phaseEndsAt: simVentures.phaseEndsAt,
        nicheId: simSeasons.nicheId,
        role: simSeats.role,
      })
      .from(simSeats)
      .innerJoin(simVentures, eq(simVentures.id, simSeats.ventureId))
      .innerJoin(simSeasons, eq(simSeasons.id, simVentures.seasonId))
      .where(and(eq(simSeats.userId, req.user.id), sql`${simVentures.phase} <> 'retired'`))
      .orderBy(desc(simVentures.createdAt));

    res.json({
      ventures: rows.map((r) => ({
        id: r.id,
        phase: r.phase,
        name: r.name,
        role: r.role,
        niche: { id: r.nicheId, name: nicheById(r.nicheId)?.name ?? r.nicheId },
        secondsLeft: r.phaseEndsAt ? Math.max(0, secondsLeft(r.phaseEndsAt)) : null,
      })),
    });
  });

  /** The room, as it stands. Polled by everyone in it, so it also moves the clock on. */
  app.get("/api/sim/ventures/:id", isAuthenticated, async (req: any, res) => {
    await advance(req.params.id);

    const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, req.params.id));
    if (!venture) return res.status(404).json({ message: "No such room." });

    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, venture.seasonId));
    const rows = await seatsOf(venture.id);
    if (!rows.some((r) => r.userId === req.user.id)) {
      // Not your room: say nothing about who is in it.
      return res.status(404).json({ message: "No such room." });
    }

    const seats: SeatView[] = rows.map((r) => ({ userId: r.userId, role: r.role as Role | null, assigned: r.assigned }));
    res.json({
      id: venture.id,
      phase: venture.phase,
      /*
       * Null rather than Infinity for a phase with no deadline. JSON.stringify
       * turns Infinity into null regardless, so sending it deliberately means
       * the wire format matches what the client actually receives instead of
       * quietly differing from the server's own value.
       */
      secondsLeft: venture.phaseEndsAt ? Math.max(0, secondsLeft(venture.phaseEndsAt)) : null,
      name: venture.name,
      product: venture.product,
      niche: season ? { id: season.nicheId, name: nicheById(season.nicheId)?.name } : null,
      lobbySize: LOBBY_SIZE,
      openRoles: openRoles(seats),
      /** Who's here, what they hold, and whether they chose it. */
      seats: rows.map((r) => ({
        userId: r.userId,
        name: r.displayName || r.firstName || "Someone",
        avatarUrl: r.avatarUrl,
        role: r.role,
        assigned: r.assigned,
        isYou: r.userId === req.user.id,
      })),
      you: {
        role: rows.find((r) => r.userId === req.user.id)?.role ?? null,
        isCeo: rows.find((r) => r.userId === req.user.id)?.role === "ceo",
      },
    });
  });

  /**
   * Take a seat.
   *
   * One statement decides it. The `where` is the check and the write at once,
   * so two claims for the same role cannot both succeed however close together
   * they land — and the one that loses is told by whom.
   */
  app.post("/api/sim/ventures/:id/claim", isAuthenticated, async (req: any, res) => {
    if (!(await enforceRateLimit(res, req.user.id, "session"))) return;
    await advance(req.params.id);

    const role = String(req.body?.role ?? "");
    const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, req.params.id));
    if (!venture) return res.status(404).json({ message: "No such room." });

    const before = await seatsOf(venture.id);
    const seats: SeatView[] = before.map((r) => ({ userId: r.userId, role: r.role as Role | null, assigned: r.assigned }));
    const allowed = canClaim(seats, req.user.id, role, venture.phase as Phase);
    if (!allowed.ok) {
      const held = before.find((r) => r.role === role);
      return res.status(409).json({
        code: allowed.reason,
        message:
          allowed.reason === "role_taken" ? `${held?.displayName || held?.firstName || "Someone"} took ${ROLE_TITLES[role as Role] ?? role} first.`
          : allowed.reason === "wrong_phase" ? "Seats aren't being claimed right now."
          : allowed.reason === "not_in_room" ? "You're not in this room."
          : "That isn't one of the seats.",
      });
    }

    try {
      /*
       * The whole race, settled in one statement: this only updates if the
       * role is still free at the moment it runs. `not exists` inside the
       * `where` is evaluated against the same snapshot as the write, and the
       * unique index catches anything that slips between the two.
       */
      const claimed = await db
        .update(simSeats)
        .set({ role, assigned: false, claimedAt: new Date() })
        .where(and(
          eq(simSeats.ventureId, venture.id),
          eq(simSeats.userId, req.user.id),
          sql`not exists (select 1 from ${simSeats} taken where taken.venture_id = ${venture.id} and taken.role = ${role})`,
        ))
        .returning();

      if (claimed.length === 0) {
        const holder = (await seatsOf(venture.id)).find((r) => r.role === role);
        return res.status(409).json({
          code: "role_taken",
          message: `${holder?.displayName || holder?.firstName || "Someone"} got there first.`,
        });
      }
    } catch (err: any) {
      // The unique index, doing its job.
      if (pgErrorCode(err) === "23505") {
        return res.status(409).json({ code: "role_taken", message: "Someone else claimed that seat a moment before you." });
      }
      console.error("[sim] claim failed:", err);
      return res.status(500).json({ message: "Couldn't take that seat. Try again." });
    }

    await advance(venture.id);
    res.json({ ok: true, role });
  });

  /** Let go of a seat, so the argument can continue. */
  app.post("/api/sim/ventures/:id/release", isAuthenticated, async (req: any, res) => {
    if (!(await enforceRateLimit(res, req.user.id, "session"))) return;
    const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, req.params.id));
    if (!venture) return res.status(404).json({ message: "No such room." });
    if (venture.phase !== "claiming") return res.status(409).json({ message: "Too late to swap seats.", code: "wrong_phase" });

    await db.update(simSeats).set({ role: null, assigned: false, claimedAt: null })
      .where(and(eq(simSeats.ventureId, venture.id), eq(simSeats.userId, req.user.id)));
    res.json({ ok: true });
  });

  /**
   * Name the company and say what it sells. The chief executive's, and only
   * theirs — the brief is explicit, and a naming right four people can
   * overrule is not one.
   */
  app.post("/api/sim/ventures/:id/name", isAuthenticated, async (req: any, res) => {
    if (!(await enforceRateLimit(res, req.user.id, "session"))) return;
    await advance(req.params.id);

    const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, req.params.id));
    if (!venture) return res.status(404).json({ message: "No such room." });

    const [seat] = await db.select().from(simSeats)
      .where(and(eq(simSeats.ventureId, venture.id), eq(simSeats.userId, req.user.id)));
    if (seat?.role !== "ceo") {
      return res.status(403).json({ message: "Naming the company is the chief executive's call.", code: "not_ceo" });
    }
    if (venture.phase !== "naming") return res.status(409).json({ message: "Not right now.", code: "wrong_phase" });

    const name = String(req.body?.name ?? "").trim().slice(0, 60);
    const product = String(req.body?.product ?? "").trim().slice(0, 120);
    if (name.length < 2) return res.status(400).json({ message: "Give it a name with at least two characters.", field: "name" });

    await db.update(simVentures).set({ name, product: product || null }).where(eq(simVentures.id, venture.id));
    await advance(venture.id);
    res.json({ ok: true, name, product });
  });
}
