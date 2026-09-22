/**
 * Getting away from someone.
 *
 * Before this, the only thing a person being harassed could do was file a
 * report — and a report changes nothing *between the two of them*. It opens a
 * queue item for a reviewer, and while that queue item sits there the same
 * account can still send connection requests carrying a 280-character note,
 * still turns up in matches and in people search, still appears on the
 * profile's followers, and still rings the bell every time it reacts to
 * something. The person on the receiving end had no lever at all. This is that
 * lever, and it takes effect the moment it's pulled.
 *
 * Two rules run through everything here:
 *
 *   1. **A block cuts both directions of reach.** The row is one-directional
 *      (`blocker` → `blocked`) because somebody has to be able to undo it, but
 *      every check asks "is there a row either way round". Otherwise blocking
 *      your harasser would stop you writing to them and leave them free to
 *      write to you, which is precisely backwards.
 *
 *   2. **The blocked person is never told.** No "you have been blocked"
 *      screen, no 403 that reads differently from a 404, no absence where
 *      there was obviously something a moment ago that we can help. A block
 *      that announces itself is an invitation to make a new account and come
 *      back angrier. So reaching a blocker looks like reaching somebody who
 *      isn't there: the profile 404s, the request "sends" and lands nowhere,
 *      the match never appears.
 *
 * `blockedIdsFor` is the one helper every reach path calls. It is deliberately
 * a single set of "people I can't reach and who can't reach me", so that a new
 * surface that wants to show one person to another has exactly one thing to
 * remember.
 */
import type { Express } from "express";
import { and, desc, eq, or } from "drizzle-orm";
import { db } from "./db";
import {
  connections, userBlocks, userFollows, userMatches, users, userProfiles,
} from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
// The SQL form of the same test, for read paths inside storage. See server/block-sql.ts.
export { notBlockedSql } from "./block-sql";

/** A block reason is the blocker's own note to themselves; nobody else ever reads it. */
export const BLOCK_REASON_MAX = 280;

/**
 * Everyone this viewer must not see and must not be seen by — blocks they made
 * and blocks made against them, in one set.
 *
 * Callers get a `Set` rather than a list because every use is a membership
 * test inside a filter. An empty set is the overwhelmingly common answer and
 * costs one indexed query; that is cheap enough that no caller needs to decide
 * whether to bother asking, and a caller that decides not to ask is how a
 * blocked person reappears on one screen out of six.
 */
export async function blockedIdsFor(viewerId: string | null | undefined): Promise<Set<string>> {
  if (!viewerId) return new Set();
  const rows = await db
    .select({ blockerId: userBlocks.blockerId, blockedId: userBlocks.blockedId })
    .from(userBlocks)
    .where(or(eq(userBlocks.blockerId, viewerId), eq(userBlocks.blockedId, viewerId)));
  const out = new Set<string>();
  for (const r of rows) out.add(r.blockerId === viewerId ? r.blockedId : r.blockerId);
  return out;
}

/**
 * Is there a block either way round between these two?
 *
 * The single-pair question, for the routes that already know both ids and
 * would otherwise load a whole set to ask about one person.
 */
export async function isBlockedBetween(a: string, b: string): Promise<boolean> {
  if (!a || !b || a === b) return false;
  const [row] = await db
    .select({ id: userBlocks.id })
    .from(userBlocks)
    .where(or(
      and(eq(userBlocks.blockerId, a), eq(userBlocks.blockedId, b)),
      and(eq(userBlocks.blockerId, b), eq(userBlocks.blockedId, a)),
    ))
    .limit(1);
  return !!row;
}

/**
 * Makes the block real, in one transaction.
 *
 * Recording the row is the easy half. The half that matters is that a block
 * has to undo what already exists between the two: an accepted connection is a
 * standing permission to send direct messages, a pending request is a message
 * waiting to be read, a follow puts their posts in your feed, and a stored
 * match row puts their face back on Discover on the next page load. Leaving
 * any of those behind means the person blocks their harasser and the harasser
 * is still in their messages list tomorrow.
 *
 * Idempotent: blocking twice is one block (the unique index), so a
 * double-tapped confirm button doesn't need two unblocks to undo.
 */
export async function blockUser(blockerId: string, blockedId: string, reason?: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(userBlocks)
      .values({ blockerId, blockedId, reason: reason?.trim().slice(0, BLOCK_REASON_MAX) || null })
      .onConflictDoNothing();

    // Any connection between the two, whichever way it was requested and
    // whatever state it's in — accepted, pending, or a stale rejected row.
    await tx.delete(connections).where(or(
      and(eq(connections.requesterId, blockerId), eq(connections.receiverId, blockedId)),
      and(eq(connections.requesterId, blockedId), eq(connections.receiverId, blockerId)),
    ));

    // Follows in both directions: a follow is a standing subscription to
    // somebody's posts, and leaving it in place keeps the blocked account in
    // the blocker's feed even though they can't be reached.
    await tx.delete(userFollows).where(or(
      and(eq(userFollows.followerId, blockerId), eq(userFollows.followeeId, blockedId)),
      and(eq(userFollows.followerId, blockedId), eq(userFollows.followeeId, blockerId)),
    ));

    // Stored match rows. The read path filters blocks too, but a stored row is
    // a row that comes back the instant somebody unblocks *and* a row the
    // rotation counts as "recently shown"; clearing it is the honest state.
    await tx.delete(userMatches).where(or(
      and(eq(userMatches.userId, blockerId), eq(userMatches.matchedUserId, blockedId)),
      and(eq(userMatches.userId, blockedId), eq(userMatches.matchedUserId, blockerId)),
    ));
  });
}

/**
 * Lifts a block. Deliberately does *not* restore anything it tore down: the
 * connection has to be asked for again, the follow re-made. Silently
 * reconnecting two people because one of them changed their mind about a block
 * is a surprise in the wrong direction.
 */
export async function unblockUser(blockerId: string, blockedId: string): Promise<boolean> {
  const gone = await db.delete(userBlocks)
    .where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)))
    .returning({ id: userBlocks.id });
  return gone.length > 0;
}

export function registerBlockRoutes(app: Express) {
  /**
   * The blocked list, for the "Blocked people" screen in settings. Only ever
   * the blocks *you* made: the blocks made against you are not yours to see,
   * and showing them would hand every account a list of who is avoiding it.
   */
  app.get("/api/blocks", isAuthenticated, async (req: any, res) => {
    try {
      const me = req.user.id as string;
      const rows = await db
        .select({
          userId: userBlocks.blockedId,
          reason: userBlocks.reason,
          createdAt: userBlocks.createdAt,
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl,
          displayName: userProfiles.displayName,
          username: userProfiles.username,
          avatarUrl: userProfiles.avatarUrl,
        })
        .from(userBlocks)
        .innerJoin(users, eq(users.id, userBlocks.blockedId))
        .leftJoin(userProfiles, eq(userProfiles.userId, userBlocks.blockedId))
        .where(eq(userBlocks.blockerId, me))
        .orderBy(desc(userBlocks.createdAt))
        .limit(500);

      res.json(rows.map((r) => ({
        userId: r.userId,
        name: r.displayName || [r.firstName, r.lastName].filter(Boolean).join(" ") || "Someone",
        username: r.username ?? null,
        avatarUrl: r.avatarUrl || r.profileImageUrl || null,
        reason: r.reason,
        blockedAt: r.createdAt,
      })));
    } catch (error) {
      console.error("Blocked list error:", error);
      res.status(500).json({ message: "Couldn't load your blocked list" });
    }
  });

  /** Blocks someone. */
  app.post("/api/blocks", isAuthenticated, rateLimit("block"), async (req: any, res) => {
    try {
      const me = req.user.id as string;
      const target = typeof req.body?.userId === "string" ? req.body.userId : "";
      if (!target) return res.status(400).json({ message: "userId is required", code: "invalid_input" });
      if (target === me) return res.status(400).json({ message: "You can't block yourself.", code: "invalid_input" });

      const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.id, target));
      if (!exists) return res.status(404).json({ message: "No such person." });

      const reason = typeof req.body?.reason === "string" ? req.body.reason : null;
      await blockUser(me, target, reason);
      res.json({ ok: true, blocked: true });
    } catch (error) {
      console.error("Block error:", error);
      res.status(500).json({ message: "Couldn't block that person" });
    }
  });

  /**
   * Unblocks. Answers the same whether or not a block was there: the client's
   * job is to end up in the unblocked state, and "you hadn't blocked them" is
   * not an error worth a red banner.
   */
  app.delete("/api/blocks/:userId", isAuthenticated, rateLimit("block"), async (req: any, res) => {
    try {
      await unblockUser(req.user.id as string, String(req.params.userId));
      res.json({ ok: true, blocked: false });
    } catch (error) {
      console.error("Unblock error:", error);
      res.status(500).json({ message: "Couldn't unblock that person" });
    }
  });

  /**
   * Whether the viewer has blocked one person — what a profile and a
   * conversation header need to decide between "Block" and "Unblock".
   *
   * Answers only about blocks the viewer made. A block held *against* the
   * viewer reads as `false` here, deliberately: this endpoint must never
   * become the way somebody discovers they were blocked.
   */
  app.get("/api/blocks/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const [row] = await db.select({ reason: userBlocks.reason }).from(userBlocks)
        .where(and(eq(userBlocks.blockerId, req.user.id), eq(userBlocks.blockedId, String(req.params.userId))))
        .limit(1);
      res.json({ blocked: !!row, reason: row?.reason ?? null });
    } catch (error) {
      console.error("Block status error:", error);
      res.status(500).json({ message: "Couldn't check that" });
    }
  });
}
