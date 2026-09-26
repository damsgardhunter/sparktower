/**
 * "Is there a problem? Report it", and the queue it lands in.
 *
 * The point of this is that it asks for nothing. No category, no severity, no
 * account: a sentence and the page they were on. Every field a person has to
 * fill in before they can tell you something is broken is a field that loses
 * you reports, and the ones you lose are from the people least willing to put
 * up with a form — which is most people.
 *
 * So it takes reports from signed-out visitors too. The landing page is where
 * somebody who cannot sign in is standing, and "I cannot sign in" is a report
 * worth having.
 */
import type { Express, RequestHandler } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { problemReports, users } from "@shared/schema";
import {
  PROBLEM_STATUSES, isProblemStatus, readProblemMessage, readProblemPath,
} from "@shared/problem-reports";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { mfaGate } from "./mfa";
import { atLeast } from "./platform-roles";
import { rateLimit } from "./moderation";

/** Admin, with a session that has proved its second factor — as the other consoles are. */
const requireAdmin: RequestHandler = (req: any, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Not signed in" });
  if (!atLeast(req.user.platformRole, "admin")) return res.status(404).json({ message: "Not found" });
  if (!mfaGate(req, res)) return;
  next();
};

export function registerProblemReportRoutes(app: Express) {
  /**
   * Somebody says something is broken.
   *
   * Open to anyone, rate limited (`problemReport`, its own budget so a
   * crashing screen cannot spend the one that reports it).
   */
  app.post("/api/problem-reports", rateLimit("problemReport"), async (req: any, res) => {
    // public-write: nothing at all, on purpose. The person best placed to tell
    // you the sign-in page is broken is the one who cannot get past it, and a
    // report form behind a sign-in wall never hears from them. It accepts a
    // message and a path and nothing else — no ids, no target — so the worst a
    // stranger can do is write a sentence into a queue, twelve times per
    // address every thirty minutes (`problemReport`, counted per address).
    const read = readProblemMessage(req.body?.message);
    if (!read.ok) return res.status(400).json({ message: read.reason, code: "invalid_input", field: "message" });

    const [row] = await db.insert(problemReports).values({
      userId: req.user?.id ?? null,
      message: read.message,
      path: readProblemPath(req.body?.path) || null,
      /*
       * Kept because "only on Safari" is the first thing anyone asks and the
       * last thing anyone remembers. Truncated because it is attacker-supplied
       * and unbounded.
       */
      userAgent: String(req.get("user-agent") ?? "").slice(0, 300) || null,
    }).returning({ id: problemReports.id });

    console.log(`[problem] ${row.id} from ${req.user?.id ?? "a signed-out visitor"} on ${readProblemPath(req.body?.path) || "(no path)"}`);
    res.status(201).json({ id: row.id });
  });

  /**
   * How many nobody has read, for the badge on the sidebar.
   *
   * Its own endpoint rather than a count off the list, because the sidebar
   * asks for it on every screen and the list is the whole queue.
   */
  app.get("/api/admin/problem-reports/unread", isAuthenticated, requireAdmin, async (_req, res) => {
    const [row] = await db.select({ n: sql<number>`count(*)::int` })
      .from(problemReports).where(eq(problemReports.status, "new"));
    res.json({ new: row?.n ?? 0 });
  });

  /** The queue, newest first. */
  app.get("/api/admin/problem-reports", isAuthenticated, requireAdmin, async (req: any, res) => {
    const status = typeof req.query.status === "string" && isProblemStatus(req.query.status) ? req.query.status : null;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));

    const rows = await db.select({
      id: problemReports.id,
      message: problemReports.message,
      path: problemReports.path,
      userAgent: problemReports.userAgent,
      status: problemReports.status,
      note: problemReports.note,
      createdAt: problemReports.createdAt,
      handledAt: problemReports.handledAt,
      userId: problemReports.userId,
      email: users.email,
    })
      .from(problemReports)
      .leftJoin(users, eq(users.id, problemReports.userId))
      .where(status ? eq(problemReports.status, status) : sql`true`)
      .orderBy(desc(problemReports.createdAt))
      .limit(limit);

    /* How many are waiting, per status, so the page can say what is unread. */
    const counts = await db.select({ status: problemReports.status, n: sql<number>`count(*)::int` })
      .from(problemReports).groupBy(problemReports.status);

    res.json({
      reports: rows,
      counts: Object.fromEntries(PROBLEM_STATUSES.map((s) => [s, counts.find((c) => c.status === s)?.n ?? 0])),
    });
  });

  /** Moving one along, with a note for whoever reads it next. */
  app.patch("/api/admin/problem-reports/:id", isAuthenticated, requireAdmin, async (req: any, res) => {
    const status = req.body?.status;
    if (status !== undefined && !isProblemStatus(status)) {
      return res.status(400).json({ message: "That isn't one of the states a report can be in.", code: "invalid_input", field: "status" });
    }
    const note = req.body?.note === undefined ? undefined : String(req.body.note ?? "").trim().slice(0, 2_000) || null;

    const [row] = await db.update(problemReports)
      .set({
        ...(status ? { status } : {}),
        ...(note === undefined ? {} : { note }),
        /* Who looked, and when — only once it has actually been moved off new. */
        ...(status && status !== "new" ? { handledById: req.user.id, handledAt: new Date() } : {}),
      })
      .where(eq(problemReports.id, String(req.params.id)))
      .returning({ id: problemReports.id, status: problemReports.status, note: problemReports.note });

    if (!row) return res.status(404).json({ message: "No such report." });
    res.json(row);
  });
}
