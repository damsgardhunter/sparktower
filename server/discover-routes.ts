/**
 * What's new with the builders and projects you've looked at.
 *
 * The return half of the Explore loop: someone opens a profile or a project,
 * goes back to Discover, and the question worth answering is whether anything
 * happened there since. The browser remembers what was looked at and when
 * (only what was interacted with — the rest would be noise); this answers,
 * for those, how many posts have appeared since.
 *
 * Counted through `getFeedPosts`, which already owns what a viewer may see —
 * taken-down posts, private projects they're not in — so a badge can never
 * reveal a post the feed itself would hide. Your own posts never count as
 * news to you. Bounded twice, because it's asked on every return: a handful of
 * targets, a handful of posts each ("5+" is as precise as a badge needs).
 *
 * A GET, deliberately: it reads. As a POST it would count against the write
 * floor and land in the behaviour stream as an action on every return.
 */
import type { Express } from "express";
import { storage } from "./storage";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";

const MAX_TARGETS = 8;
const PER_TARGET = 5;
/** `builder.<id>.<ms>` or `project.<id>.<ms>` — what the browser remembers, in the query string. */
const TOKEN = /^(builder|project)\.([A-Za-z0-9_-]{1,64})\.(\d{10,14})$/;

export function registerDiscoverRoutes(app: Express) {
  app.get("/api/discover/updates", isAuthenticated, async (req: any, res) => {
    try {
      const me = (req.user as any).id as string;
      const tokens = String(req.query.t ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_TARGETS);
      const updates: { kind: string; id: string; name: string; newPosts: number; more: boolean; latestAt: string }[] = [];

      for (const token of tokens) {
        const match = TOKEN.exec(token);
        if (!match) continue;
        const [, kind, id, ms] = match;
        const seenAt = Number(ms);
        if (seenAt > Date.now() + 60_000) continue;           // a clock from the future sees nothing new
        if (kind === "builder" && id === me) continue;         // your own news isn't news

        // "Since" is compared by the database (see getFeedPosts): a post's time
        // read back into JS is off by the server's timezone wherever that isn't UTC.
        const posts: any[] = await storage.getFeedPosts({
          viewerId: me, limit: PER_TARGET, sinceMs: seenAt, ...(kind === "builder" ? { authorId: id } : { projectId: id }),
        });
        const fresh = posts.filter((post) => post.authorId !== me);
        if (!fresh.length) continue;

        const name = kind === "builder"
          ? fresh[0].profile?.displayName || fresh[0].author?.firstName || "A builder"
          : fresh[0].project?.title || "A project";
        updates.push({ kind, id, name, newPosts: fresh.length, more: fresh.length >= PER_TARGET, latestAt: new Date(fresh[0].createdAt).toISOString() });
      }

      res.json({ updates });
    } catch (error) {
      console.error("Discover updates error:", error);
      res.status(500).json({ message: "Couldn't check for updates" });
    }
  });
}
