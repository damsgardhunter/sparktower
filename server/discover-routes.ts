/**
 * What's new with the builders and projects you've looked at — the return
 * half of the Explore loop.
 *
 * Someone opens a profile or a project (or follows, connects, messages), goes
 * off, and the question worth answering when they come back is whether
 * anything happened there since. What they looked at, and when, is kept on the
 * server (`explore_seen`) so it's the same on the web and on the phone, and so
 * the sidebar and tab badge — "3 new" on Discover — can be worked out without
 * a browser having remembered anything. Only what was interacted with is
 * remembered: everything scrolled past would turn every return into noise.
 *
 * Counted through `getFeedPosts`, which already owns what a viewer may see —
 * taken-down posts, private projects they're not in — so a badge can never
 * reveal a post the feed itself would hide. Your own posts never count as
 * news to you. Bounded twice: a handful of targets, a handful of posts each
 * ("5+" is as precise as a badge needs).
 */
import type { Express } from "express";
import { and, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { exploreSeen } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";

const MAX_TARGETS = 8;
const PER_TARGET = 5;
/** How many interactions each person keeps remembered. */
const REMEMBER = 30;
/** How far back an imported browser memory may claim to be from. */
const IMPORT_MAX_AGE_MS = 90 * 86_400_000;
/** `builder.<id>.<ms>` or `project.<id>.<ms>` — what an older browser remembers, in the query string. */
const TOKEN = /^(builder|project)\.([A-Za-z0-9_-]{1,64})\.(\d{10,14})$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

type Kind = "builder" | "project";
interface Target { kind: Kind; id: string; seenMs: number }
export interface ExploreUpdate { kind: Kind; id: string; name: string; newPosts: number; more: boolean; latestAt: string }

/** The most recently looked-at builders and projects, newest first. */
async function rememberedTargets(userId: string, limit = MAX_TARGETS): Promise<Target[]> {
  const rows = await db.select().from(exploreSeen)
    .where(and(eq(exploreSeen.userId, userId), ne(exploreSeen.kind, "discover")))
    .orderBy(desc(exploreSeen.seenMs)).limit(limit);
  return rows.map((r) => ({ kind: r.kind as Kind, id: r.targetId, seenMs: Number(r.seenMs) }));
}

async function lastVisitMs(userId: string): Promise<number | null> {
  const [row] = await db.select({ ms: exploreSeen.seenMs }).from(exploreSeen)
    .where(and(eq(exploreSeen.userId, userId), eq(exploreSeen.kind, "discover"), eq(exploreSeen.targetId, "visit")));
  return row ? Number(row.ms) : null;
}

/**
 * Remembers looking at something. `atMs` lets an older browser hand over what
 * it remembered; it never overwrites a newer server record, and never claims
 * a time from the future or from long ago.
 */
export async function rememberSeen(userId: string, kind: Kind | "discover", targetId: string, atMs?: number) {
  const now = Date.now();
  const imported = atMs !== undefined;
  const seenMs = imported ? Math.min(now, Math.max(now - IMPORT_MAX_AGE_MS, Math.floor(atMs))) : now;
  await db.insert(exploreSeen).values({ userId, kind, targetId, seenMs })
    .onConflictDoUpdate({
      target: [exploreSeen.userId, exploreSeen.kind, exploreSeen.targetId],
      set: { seenMs: sql`GREATEST(${exploreSeen.seenMs}, ${seenMs})` },
    });
  if (kind === "discover") return;
  // Keep the most recent few dozen; older interactions stop being news.
  const keep = await db.select({ id: exploreSeen.id }).from(exploreSeen)
    .where(and(eq(exploreSeen.userId, userId), ne(exploreSeen.kind, "discover")))
    .orderBy(desc(exploreSeen.seenMs)).limit(REMEMBER);
  if (keep.length === REMEMBER) {
    const oldest = await db.select({ ms: exploreSeen.seenMs }).from(exploreSeen).where(eq(exploreSeen.id, keep[keep.length - 1].id));
    if (oldest[0]) {
      await db.delete(exploreSeen).where(and(
        eq(exploreSeen.userId, userId), ne(exploreSeen.kind, "discover"),
        lt(exploreSeen.seenMs, Number(oldest[0].ms)),
      ));
    }
  }
}

/** New posts on each target since the given instant for it. */
async function updatesFor(me: string, targets: Target[], sinceFor: (t: Target) => number): Promise<ExploreUpdate[]> {
  const updates: ExploreUpdate[] = [];
  for (const target of targets.slice(0, MAX_TARGETS)) {
    const since = sinceFor(target);
    if (since > Date.now() + 60_000) continue;                   // a clock from the future sees nothing new
    if (target.kind === "builder" && target.id === me) continue; // your own news isn't news
    // "Since" is compared by the database (see getFeedPosts): a post's time
    // read back into JS is off by the server's timezone wherever that isn't UTC.
    const posts: any[] = await storage.getFeedPosts({
      viewerId: me, limit: PER_TARGET, sinceMs: since,
      ...(target.kind === "builder" ? { authorId: target.id } : { projectId: target.id }),
    });
    const fresh = posts.filter((post) => post.authorId !== me);
    if (!fresh.length) continue;
    const name = target.kind === "builder"
      ? fresh[0].profile?.displayName || fresh[0].author?.firstName || "A builder"
      : fresh[0].project?.title || "A project";
    updates.push({ kind: target.kind, id: target.id, name, newPosts: fresh.length, more: fresh.length >= PER_TARGET, latestAt: new Date(fresh[0].createdAt).toISOString() });
  }
  return updates;
}

export function registerDiscoverRoutes(app: Express) {
  /**
   * What's new with each thing you've looked at, since you looked at it — the
   * cards' badges and the welcome-back banner. From what the server remembers;
   * an older browser's `?t=` tokens still count for anything it doesn't.
   *
   * A GET, deliberately: it reads. Recording the visit is its own call.
   */
  app.get("/api/discover/updates", isAuthenticated, async (req: any, res) => {
    try {
      const me = req.user.id as string;
      const remembered = await rememberedTargets(me);
      const known = new Set(remembered.map((t) => `${t.kind}.${t.id}`));
      const fromBrowser: Target[] = String(req.query.t ?? "").split(",").map((s) => TOKEN.exec(s.trim())).filter(Boolean)
        .map((m) => ({ kind: m![1] as Kind, id: m![2], seenMs: Number(m![3]) }))
        .filter((t) => !known.has(`${t.kind}.${t.id}`));
      const targets = [...remembered, ...fromBrowser].slice(0, MAX_TARGETS);
      res.json({ updates: await updatesFor(me, targets, (t) => t.seenMs) });
    } catch (error) {
      console.error("Discover updates error:", error);
      res.status(500).json({ message: "Couldn't check for updates" });
    }
  });

  /**
   * The badge on Discover, wherever the app shows one: new posts from the
   * builders and projects you've looked at, since the later of when you looked
   * at each and when you last opened Discover. Opening Discover clears it; the
   * cards keep their own news until you open the thing itself.
   */
  app.get("/api/discover/new-count", isAuthenticated, async (req: any, res) => {
    try {
      const me = req.user.id as string;
      const [targets, visit] = await Promise.all([rememberedTargets(me), lastVisitMs(me)]);
      const updates = await updatesFor(me, targets, (t) => Math.max(t.seenMs, visit ?? 0));
      res.json({
        count: updates.reduce((n, u) => n + u.newPosts, 0),
        more: updates.some((u) => u.more),
        updates: updates.map(({ kind, id, name, newPosts }) => ({ kind, id, name, newPosts })),
        lastVisitAt: visit ? new Date(visit).toISOString() : null,
      });
    } catch (error) {
      console.error("Discover new-count error:", error);
      res.status(500).json({ message: "Couldn't count what's new" });
    }
  });

  /**
   * Remembering that you looked at a builder or project: `{ kind, id }` when it
   * happens, or `{ items: [{ kind, id, at }] }` to hand over what an older
   * browser remembered.
   */
  app.post("/api/discover/seen", isAuthenticated, rateLimit("track"), async (req: any, res) => {
    try {
      const me = req.user.id as string;
      const valid = (x: any) => (x?.kind === "builder" || x?.kind === "project") && typeof x?.id === "string" && ID.test(x.id);
      if (Array.isArray(req.body?.items)) {
        const items = req.body.items.filter(valid).slice(0, REMEMBER);
        for (const x of items) {
          if (x.kind === "builder" && x.id === me) continue;
          await rememberSeen(me, x.kind, x.id, Number.isFinite(Number(x.at)) ? Number(x.at) : undefined);
        }
        return res.json({ remembered: items.length });
      }
      if (!valid(req.body)) return res.status(400).json({ message: "Say what was looked at.", code: "invalid_input" });
      if (req.body.kind === "builder" && req.body.id === me) return res.json({ remembered: 0 });
      await rememberSeen(me, req.body.kind, req.body.id);
      res.json({ remembered: 1 });
    } catch (error) {
      console.error("Discover seen error:", error);
      res.status(500).json({ message: "Couldn't remember that" });
    }
  });

  /** Opening Discover: the badge's "since" moves to now. */
  app.post("/api/discover/visit", isAuthenticated, rateLimit("track"), async (req: any, res) => {
    try {
      await rememberSeen(req.user.id, "discover", "visit");
      res.json({ ok: true });
    } catch (error) {
      console.error("Discover visit error:", error);
      res.status(500).json({ message: "Couldn't record the visit" });
    }
  });
}
