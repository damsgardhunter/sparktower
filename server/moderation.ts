/**
 * Rate limits, reports and suspension.
 *
 * The rate limiter counts the content itself rather than keeping a separate
 * tally. Asking "how many comments has this person written in ten minutes?" is
 * one indexed query against a table that already exists, it is exactly
 * accurate, and — unlike the in-memory counter this replaces — it survives a
 * restart and works across several server processes. At this volume it costs
 * nothing; if it ever does, that's the point to reach for Redis.
 */
import type { Express, RequestHandler } from "express";
import { and, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";
import { db } from "./db";
import {
  contentReports, users, userProfiles, projectCheckIns, projectComments,
  feedPosts, feedComments, directMessages, projects, rateLimitHits, moderationLog,
} from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { requireReviewer } from "./platform-roles";
import {
  RATE_LIMITS, DUPLICATE_RULES, REPORT_TARGETS, REPORT_REASON_IDS, REPORT_NOTE_MAX,
  REPORT_STATUSES,
  type RateLimitAction, type ReportTarget, type DuplicateRule,
} from "@shared/moderation";

/** One table an action's writes land in, and the columns needed to judge them. */
interface CountSource {
  table: PgTable;
  author: PgColumn;
  created: PgColumn;
  /** The text repetition is judged on. Absent where the action has no text. */
  content?: SQL<string>;
  /**
   * Extra condition for the duplicate query only, where some rows must not
   * count as duplicates of the row being written.
   */
  scope?: SQL;
  /** Applied to every query. Used to pick one action out of the hit table. */
  where?: SQL;
}

/**
 * Actions counted from `rate_limit_hits` rather than from content.
 *
 * Each of these records a row when it passes the check — that is the whole
 * mechanism. A reaction can't be counted from its own table because
 * un-reacting deletes the row; a presign writes nothing; an AI call writes to
 * a dozen places.
 */
const HIT_COUNTED = new Set<RateLimitAction>(["react", "upload", "ai", "login", "write", "track", "post"]);

const hitSource = (action: RateLimitAction): CountSource => ({
  table: rateLimitHits, author: rateLimitHits.userId, created: rateLimitHits.createdAt,
  where: eq(rateLimitHits.action, action),
});

/**
 * Which tables each limited action is counted from.
 *
 * A list rather than a single table, because an action can have more than one
 * home: a comment is written to `project_comments` from one route and
 * `feed_comments` from another, and a limit that reads one of them while two
 * routes write to two is not a limit.
 */
const COUNTED: Record<RateLimitAction, CountSource[]> = {
  checkIn: [{
    table: projectCheckIns, author: projectCheckIns.userId, created: projectCheckIns.createdAt,
    content: sql<string>`${projectCheckIns.goal} || ' ' || ${projectCheckIns.proof} || ' ' || ${projectCheckIns.nextStep}`,
    /*
     * Earlier weeks only. Posting this week's check-in is an upsert — a builder
     * fixing a typo re-sends the same text and must not be told it duplicates
     * itself. Comparing against `date_trunc` rather than a JS week boundary
     * keeps both sides of the comparison inside the database, for the same
     * reason the windows below do.
     */
    scope: sql`${projectCheckIns.weekStart} < date_trunc('week', now())`,
  }],
  comment: [
    {
      table: projectComments, author: projectComments.authorId, created: projectComments.createdAt,
      content: sql<string>`${projectComments.content}`,
    },
    {
      table: feedComments, author: feedComments.authorId, created: feedComments.createdAt,
      content: sql<string>`${feedComments.content}`,
    },
  ],
  feedPost: [{
    table: feedPosts, author: feedPosts.authorId, created: feedPosts.createdAt,
    content: sql<string>`${feedPosts.content}`,
  }],
  message: [{
    table: directMessages, author: directMessages.senderId, created: directMessages.createdAt,
    content: sql<string>`${directMessages.content}`,
  }],
  project: [{
    table: projects, author: projects.ownerId, created: projects.createdAt,
    content: sql<string>`${projects.title} || ' ' || coalesce(${projects.description}, '')`,
  }],
  // Reports carry no text worth comparing, and a unique constraint on
  // (reporter, target) already stops the same person filing one twice.
  report: [{
    table: contentReports, author: contentReports.reporterId, created: contentReports.createdAt,
  }],
  react:  [hitSource("react")],
  upload: [hitSource("upload")],
  ai:     [hitSource("ai")],
  login:  [hitSource("login")],
  write:  [hitSource("write")],
  track:  [hitSource("track")],
  post:   [hitSource("post")],
};

/** The caller's address as a limiter key, for requests with no user. First hop of X-Forwarded-For, as the auth routes already do. */
export function ipKey(req: any): string {
  const fwd = req.headers?.["x-forwarded-for"];
  const ip = (typeof fwd === "string" && fwd.split(",")[0].trim()) || req.ip || req.socket?.remoteAddress || "unknown";
  return `ip:${ip}`;
}

/*
 * Windows are expressed in the database's own terms rather than as a JS Date.
 * These columns are `timestamp without time zone` filled by `defaultNow()`, so
 * they hold the database session's local wall-clock — while a JS Date is
 * serialised as UTC. Comparing the two silently shifts every window by the
 * timezone offset, which once made this limiter count zero rows and let
 * everything through. `now() - interval` keeps both sides in one frame.
 */
const withinMinutes = (col: PgColumn, minutes: number) =>
  gte(col, sql`now() - interval '${sql.raw(String(minutes))} minutes'`);

/**
 * What two pieces of text have to share to count as the same posting.
 *
 * Case, punctuation, emoji and whitespace all collapse, so "BUY NOW!!!" and
 * "buy  now." are one posting and padding a repost with exclamation marks
 * doesn't get it through. NFKC first, which folds full-width characters onto
 * their plain equivalents — "ｃｈｅｃｋ ｏｕｔ" is otherwise a free disguise.
 *
 * `\p{L}\p{N}` keeps the letters and digits of every script. The obvious way to
 * write this is in SQL, and the first version did; but Postgres's `[[:alnum:]]`
 * follows the database's ctype and on this one it matches ASCII only, which
 * reduced every Japanese sentence to an empty string and so made all of them
 * identical to each other. Two normalisers that disagree are worse than a slow
 * one, so there is now exactly one, here.
 */
const normalise = (text: string) =>
  text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Ceiling on how much of someone's recent writing is pulled back to compare.
 *
 * The count limit above runs first and is the real bound — you can't have
 * thousands of rows in one of these windows without having tripped it. This is
 * only here so a pathological case can't turn one comment into a large read.
 */
const DUPLICATE_SCAN_LIMIT = 300;

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

/**
 * True when this person has room to do the thing.
 *
 * Fails open on a database error: a limiter that blocks writes when it can't
 * count is worse than the spam it prevents.
 */
export async function withinRateLimit(
  userId: string, action: RateLimitAction,
): Promise<{ ok: boolean; retryAfterMinutes: number; used: number; max: number }> {
  const limit = RATE_LIMITS[action];

  try {
    const counts = await Promise.all(COUNTED[action].map(async (src) => {
      const [row] = await db.select({ n: sql<number>`count(*)::int` })
        .from(src.table as any)
        .where(and(
          eq(src.author, userId),
          withinMinutes(src.created, limit.windowMinutes),
          ...(src.where ? [src.where] : []),
        ));
      return row?.n ?? 0;
    }));
    const used = sum(counts);
    return { ok: used < limit.max, retryAfterMinutes: limit.windowMinutes, used, max: limit.max };
  } catch (err) {
    console.error(`[moderation] Rate check failed for ${action}, allowing:`, err);
    return { ok: true, retryAfterMinutes: 0, used: 0, max: limit.max };
  }
}

/** Marks one use of a hit-counted action. Content-counted actions need nothing. */
async function recordHit(userId: string, action: RateLimitAction): Promise<void> {
  if (!HIT_COUNTED.has(action)) return;
  try {
    await db.insert(rateLimitHits).values({ userId, action });
  } catch (err) {
    // A hit that fails to record errs on the side of the person, not the limit.
    console.error(`[moderation] Could not record ${action} hit:`, err);
  }
}

/**
 * The refusal, in one place, so every 429 looks the same and is logged.
 *
 * Logged at warn with the numbers, because a limit that fires is either
 * someone abusing the site or a limit set too low for a real person, and the
 * log line is how you tell which — one user at 31/30 is the second, one user
 * at 400/30 is the first.
 */
function refuse(res: any, userId: string, action: RateLimitAction, used: number, max: number, retryAfterMinutes: number) {
  console.warn(`[rate-limit] refused ${action} for user ${userId}: ${used}/${max} in ${RATE_LIMITS[action].windowMinutes}m`);
  res.setHeader("Retry-After", String(retryAfterMinutes * 60));
  res.status(429).json({
    message: RATE_LIMITS[action].message,
    code: "rate_limited",
    action,
    retryAfterMinutes,
  });
}

/**
 * For handlers that check inside their own body rather than as middleware —
 * the credit check every AI endpoint runs through is the one that matters.
 * Returns true to proceed; on false the 429 has already been written.
 */
export async function enforceRateLimit(res: any, userId: string, action: RateLimitAction): Promise<boolean> {
  const { ok, retryAfterMinutes, used, max } = await withinRateLimit(userId, action);
  if (!ok) { refuse(res, userId, action, used, max, retryAfterMinutes); return false; }
  await recordHit(userId, action);
  return true;
}

/**
 * True when this person has already written this same thing too many times.
 *
 * Counts the content itself, like the limiter above, so it needs no store of
 * its own and can't drift from what was actually posted. Note that it doesn't
 * care where the text went: the same note sent to forty different people is
 * forty copies of one message, and looking at each recipient separately is
 * exactly how a blast goes unnoticed.
 */
export async function isDuplicate(
  userId: string, action: RateLimitAction, text: string,
): Promise<boolean> {
  const rule: DuplicateRule | undefined =
    (DUPLICATE_RULES as Partial<Record<RateLimitAction, DuplicateRule>>)[action];
  if (!rule) return false;

  const target = normalise(text ?? "");
  if (target.length < rule.minLength) return false;

  try {
    const counts = await Promise.all(
      COUNTED[action].filter((src) => src.content).map(async (src) => {
        const rows = await db.select({ text: src.content! })
          .from(src.table as any)
          .where(and(
            eq(src.author, userId),
            withinMinutes(src.created, rule.windowMinutes),
            ...(src.scope ? [src.scope] : []),
          ))
          .limit(DUPLICATE_SCAN_LIMIT);
        return rows.filter((r) => normalise(String(r.text ?? "")) === target).length;
      }),
    );
    return sum(counts) >= rule.max;
  } catch (err) {
    console.error(`[moderation] Duplicate check failed for ${action}, allowing:`, err);
    return false;
  }
}

/** Where each action's text sits on the request body. */
const DUPLICATE_TEXT: Partial<Record<RateLimitAction, (body: any) => string>> = {
  checkIn:  (b) => [b?.goal, b?.proof, b?.nextStep].filter(Boolean).join(" "),
  comment:  (b) => String(b?.content ?? ""),
  feedPost: (b) => String(b?.content ?? ""),
  message:  (b) => String(b?.content ?? ""),
  project:  (b) => [b?.title, b?.description].filter(Boolean).join(" "),
};

/** Express guard for a limited action: volume first, then repetition. */
export function rateLimit(action: RateLimitAction): RequestHandler {
  return async (req: any, res, next) => {
    /*
     * No user, no count — was the rule, which made this a no-op on every
     * endpoint without auth, auth endpoints included. Hit-counted actions
     * can key on the address instead; content-counted ones genuinely need
     * an author and pass through.
     */
    const userId: string | undefined = req.user?.id ?? (HIT_COUNTED.has(action) ? ipKey(req) : undefined);
    if (!userId) return next();

    const { ok, retryAfterMinutes, used, max } = await withinRateLimit(userId, action);
    if (!ok) return refuse(res, userId, action, used, max, retryAfterMinutes);

    const rule: DuplicateRule | undefined =
      (DUPLICATE_RULES as Partial<Record<RateLimitAction, DuplicateRule>>)[action];
    const extract = DUPLICATE_TEXT[action];
    if (rule && extract && (await isDuplicate(userId, action, extract(req.body)))) {
      /*
       * 409 rather than 429. Waiting changes nothing here — the same text sent
       * again in a minute is still the same text — so the client needs to say
       * "write something different", not "try again later", and no Retry-After
       * would be honest.
       */
      return res.status(409).json({ message: rule.message, code: "duplicate_content" });
    }

    await recordHit(userId, action);
    next();
  };
}

/**
 * Sweeps hits older than any window needs. Hourly, unref'd, advisory-lock
 * free: a delete of expired rows is idempotent, so two instances doing it at
 * once just means one of them deletes nothing.
 */
export function startModerationJobs(): void {
  const sweep = async () => {
    try {
      await db.delete(rateLimitHits)
        .where(sql`${rateLimitHits.createdAt} < now() - interval '1 day'`);
    } catch (err) {
      console.error("[moderation] Hit sweep failed:", err);
    }
  };
  setTimeout(sweep, 90_000);
  setInterval(sweep, 60 * 60_000).unref();
}

/**
 * Stops a suspended account doing anything except reading and signing out.
 *
 * Mounted globally rather than added to each route, because a suspension that
 * covers most endpoints isn't a suspension. Reads stay open deliberately: the
 * person can still see why, and taking their own content away from them isn't
 * the goal.
 */
/**
 * The floor under every write, mounted once. Any POST, PUT, PATCH or DELETE
 * under /api counts against the "write" limit — per user, or per address
 * when nobody is signed in — on top of whatever tighter limit the route
 * has. Covers the endpoints nobody remembered to limit, which is the whole
 * point of a floor. Signature-verified webhooks are exempt: their caller is
 * a payment provider, and refusing them loses money, not spam.
 */
const WRITE_FLOOR_EXEMPT = ["/api/stripe/webhook", "/api/webhooks/"];
export const limitWrites: RequestHandler = async (req: any, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  if (!req.path.startsWith("/api/")) return next();
  if (WRITE_FLOOR_EXEMPT.some((p) => req.path.startsWith(p))) return next();
  const key = req.user?.id ?? ipKey(req);
  const { ok, retryAfterMinutes, used, max } = await withinRateLimit(key, "write");
  if (!ok) return refuse(res, key, "write", used, max, retryAfterMinutes);
  await recordHit(key, "write");
  next();
};

export const blockSuspended: RequestHandler = async (req: any, _res, next) => {
  const res = _res;
  try {
    if (!req.user?.id) return next();
    if (req.method === "GET" || req.method === "HEAD") return next();
    if (req.path.startsWith("/api/logout") || req.path.startsWith("/api/auth/logout")) return next();

    // `req.user` is loaded per request, so this reflects a suspension applied
    // seconds ago rather than whenever the session was created.
    const suspendedAt = req.user.suspendedAt
      ?? (await db.select({ s: users.suspendedAt, r: users.suspendedReason })
        .from(users).where(eq(users.id, req.user.id)))[0]?.s;

    if (!suspendedAt) return next();

    const [row] = await db.select({ reason: users.suspendedReason })
      .from(users).where(eq(users.id, req.user.id));
    return res.status(403).json({
      message: row?.reason
        ? `Your account is suspended: ${row.reason}`
        : "Your account is suspended.",
      code: "account_suspended",
    });
  } catch (err) {
    console.error("[moderation] Suspension check failed, allowing:", err);
    next();
  }
};

/** A short excerpt of what was reported, kept in case the original is deleted. */
async function snapshotOf(targetType: ReportTarget, targetId: string): Promise<{
  text: string | null; ownerId: string | null; projectId: string | null;
}> {
  const trim = (v: string | null | undefined) => (v ?? "").slice(0, 1000) || null;
  try {
    if (targetType === "check_in") {
      const [r] = await db.select().from(projectCheckIns).where(eq(projectCheckIns.id, targetId));
      return r
        ? { text: trim(`${r.goal}\n\n${r.proof}\n\nNext: ${r.nextStep}`), ownerId: r.userId, projectId: r.projectId }
        : { text: null, ownerId: null, projectId: null };
    }
    if (targetType === "comment") {
      const [r] = await db.select().from(projectComments).where(eq(projectComments.id, targetId));
      return r ? { text: trim(r.content), ownerId: r.authorId, projectId: r.projectId }
               : { text: null, ownerId: null, projectId: null };
    }
    if (targetType === "feed_post") {
      const [r] = await db.select().from(feedPosts).where(eq(feedPosts.id, targetId));
      return r ? { text: trim((r as any).content), ownerId: (r as any).authorId, projectId: null }
               : { text: null, ownerId: null, projectId: null };
    }
    if (targetType === "project") {
      const [r] = await db.select().from(projects).where(eq(projects.id, targetId));
      return r ? { text: trim(`${r.title}\n\n${r.description}`), ownerId: r.ownerId, projectId: r.id }
               : { text: null, ownerId: null, projectId: null };
    }
    const [r] = await db.select().from(userProfiles).where(eq(userProfiles.userId, targetId));
    return r ? { text: trim(`${r.displayName ?? ""}\n${r.headline ?? ""}\n${r.bio ?? ""}`), ownerId: targetId, projectId: null }
             : { text: null, ownerId: targetId, projectId: null };
  } catch {
    return { text: null, ownerId: null, projectId: null };
  }
}

/**
 * Appends one moderation action to the immutable log.
 *
 * Never awaited on the path that matters and never allowed to fail it: the
 * suspension has already happened by the time this runs, and a log write that
 * could undo it would make the log the thing people attack. The row is only
 * ever inserted — there is no route that updates or deletes from this table.
 */
export async function logModeration(entry: {
  action: string; actorId?: string | null; targetUserId?: string | null;
  targetType?: string | null; targetId?: string | null; reason?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(moderationLog).values({
      action: entry.action,
      actorId: entry.actorId ?? null,
      targetUserId: entry.targetUserId ?? null,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      reason: entry.reason ?? null,
      details: entry.details ?? {},
    });
  } catch (err) {
    console.error(`[moderation] Failed to log ${entry.action}:`, err);
  }
}

export function registerModerationRoutes(app: Express) {
  /** Filing a report. Rate limited like any other write. */
  app.post("/api/reports", isAuthenticated, rateLimit("report"), async (req: any, res) => {
    try {
      const targetType = String(req.body?.targetType || "") as ReportTarget;
      const targetId = String(req.body?.targetId || "");
      const reason = String(req.body?.reason || "");

      if (!REPORT_TARGETS.includes(targetType)) {
        return res.status(400).json({ message: "Unknown thing to report" });
      }
      if (!targetId) return res.status(400).json({ message: "Nothing specified" });
      if (!(REPORT_REASON_IDS as readonly string[]).includes(reason)) {
        return res.status(400).json({ message: "Pick a reason" });
      }

      const snap = await snapshotOf(targetType, targetId);
      if (snap.ownerId === req.user.id) {
        return res.status(400).json({ message: "That's yours — delete it instead." });
      }

      const [report] = await db.insert(contentReports).values({
        reporterId: req.user.id,
        targetType, targetId,
        targetOwnerId: snap.ownerId,
        projectId: snap.projectId,
        reason,
        note: String(req.body?.note || "").trim().slice(0, REPORT_NOTE_MAX) || null,
        snapshot: snap.text,
      }).onConflictDoNothing({
        target: [contentReports.reporterId, contentReports.targetType, contentReports.targetId],
      }).returning();

      // Already reported by this person — say thank you either way rather than
      // confirming to a reporter what is or isn't already in the queue.
      res.json({ received: true, id: report?.id ?? null });
    } catch (error) {
      console.error("Report error:", error);
      res.status(500).json({ message: "Couldn't file that report" });
    }
  });

  /** The moderation queue. */
  const TAKEDOWN_TABLES: Record<string, { table: any; author: any }> = {
    check_in: { table: projectCheckIns, author: projectCheckIns.userId },
    comment: { table: projectComments, author: projectComments.authorId },
    feed_post: { table: feedPosts, author: feedPosts.authorId },
  };

  app.get("/api/admin/reports", isAuthenticated, requireReviewer, async (req: any, res) => {
    try {
      const status = (REPORT_STATUSES as readonly string[]).includes(String(req.query.status))
        ? String(req.query.status) as (typeof REPORT_STATUSES)[number]
        : "open";
      const rows = await db.select({
        report: contentReports,
        reporterName: sql<string>`coalesce(reporter_profile.display_name, reporter.first_name)`,
        ownerName: sql<string>`coalesce(owner_profile.display_name, owner.first_name)`,
        ownerSuspendedAt: sql<Date | null>`owner.suspended_at`,
        ownerId: sql<string | null>`owner.id`,
      }).from(contentReports)
        .leftJoin(sql`${users} AS reporter`, sql`reporter.id = ${contentReports.reporterId}`)
        .leftJoin(sql`${userProfiles} AS reporter_profile`, sql`reporter_profile.user_id = ${contentReports.reporterId}`)
        .leftJoin(sql`${users} AS owner`, sql`owner.id = ${contentReports.targetOwnerId}`)
        .leftJoin(sql`${userProfiles} AS owner_profile`, sql`owner_profile.user_id = ${contentReports.targetOwnerId}`)
        .where(eq(contentReports.status, status))
        .orderBy(desc(contentReports.createdAt))
        .limit(100);

      const hiddenOf = async (type: string, id: string): Promise<boolean | null> => {
        const t = TAKEDOWN_TABLES[type];
        if (!t) return null;
        const [x] = await db.select({ h: t.table.hiddenAt }).from(t.table).where(eq(t.table.id, id));
        return x ? !!x.h : null;
      };
      res.json(await Promise.all(rows.map(async (r) => ({
        ...r.report,
        reporterName: r.reporterName || "Someone",
        ownerName: r.ownerName || null,
        ownerId: r.ownerId,
        ownerSuspended: !!r.ownerSuspendedAt,
        /** Null when this kind of target can't be taken down. */
        targetHidden: await hiddenOf(r.report.targetType, r.report.targetId),
      }))));
    } catch (error) {
      console.error("Report queue error:", error);
      res.status(500).json({ message: "Couldn't load the queue" });
    }
  });

  /**
   * Taking content down, and putting it back. The action that was missing
   * from the chain: report → queue → THIS → enforcement in reads → undo.
   * Hidden content vanishes from every list and page for everyone but its
   * author, who sees why. Logged both ways. Reviewer only.
   */
  const setHidden = async (req: any, res: any, hide: boolean) => {
    const type = String(req.params.type), id = String(req.params.id);
    const t = TAKEDOWN_TABLES[type];
    if (!t) return res.status(400).json({ message: "That kind of content can't be taken down here. Suspend the account instead.", code: "not_takedownable" });
    const reason = String(req.body?.reason ?? "").trim().slice(0, 500);
    if (hide && !reason) return res.status(400).json({ message: "Say why — the author sees it, and so does the log.", code: "invalid_input", field: "reason" });
    const [row] = await db.select({ id: t.table.id, author: t.author, hiddenAt: t.table.hiddenAt }).from(t.table).where(eq(t.table.id, id));
    if (!row) return res.status(404).json({ message: "Not found" });
    await db.update(t.table)
      .set(hide ? { hiddenAt: new Date(), hiddenById: req.user.id, hiddenReason: reason } : { hiddenAt: null, hiddenById: null, hiddenReason: null })
      .where(eq(t.table.id, id));
    await logModeration({ action: hide ? "content_hidden" : "content_restored", actorId: req.user.id, targetUserId: row.author, targetType: type, targetId: id, reason: hide ? reason : null });
    res.json({ ok: true, hidden: hide });
  };
  app.post("/api/admin/content/:type/:id/hide", isAuthenticated, requireReviewer, (req: any, res) => setHidden(req, res, true).catch((e) => { console.error("takedown failed:", e); res.status(500).json({ message: "Couldn't take that down" }); }));
  app.post("/api/admin/content/:type/:id/restore", isAuthenticated, requireReviewer, (req: any, res) => setHidden(req, res, false).catch((e) => { console.error("restore failed:", e); res.status(500).json({ message: "Couldn't restore that" }); }));

  /** Resolving one. Actioned or dismissed — both close it. */
  app.patch("/api/admin/reports/:id", isAuthenticated, requireReviewer, async (req: any, res) => {
    try {
      const status = String(req.body?.status || "");
      if (status !== "actioned" && status !== "dismissed") {
        return res.status(400).json({ message: "Status must be actioned or dismissed" });
      }
      const [updated] = await db.update(contentReports).set({
        status,
        reviewedById: req.user.id,
        reviewedAt: new Date(),
        reviewNote: String(req.body?.note || "").trim().slice(0, REPORT_NOTE_MAX) || null,
      }).where(eq(contentReports.id, String(req.params.id))).returning();
      if (!updated) return res.status(404).json({ message: "Report not found" });
      await logModeration({
        action: status === "actioned" ? "report_actioned" : "report_dismissed",
        actorId: req.user.id, targetUserId: updated.targetOwnerId,
        targetType: "report", targetId: updated.id, reason: updated.reviewNote,
        details: { reportedType: updated.targetType, reportedId: updated.targetId, reason: updated.reason },
      });
      res.json(updated);
    } catch (error) {
      console.error("Report review error:", error);
      res.status(500).json({ message: "Couldn't update that report" });
    }
  });

  /**
   * Suspending and reinstating an account.
   *
   * Separate from resolving a report: one report rarely justifies a
   * suspension, and a suspension often covers several. Keeping them apart
   * means neither is a side effect of the other.
   */
  app.post("/api/admin/users/:id/suspend", isAuthenticated, requireReviewer, async (req: any, res) => {
    try {
      const targetId = String(req.params.id);
      if (targetId === req.user.id) {
        return res.status(400).json({ message: "You can't suspend yourself." });
      }
      const [target] = await db.select().from(users).where(eq(users.id, targetId));
      if (!target) return res.status(404).json({ message: "No such account" });
      if (target.platformRole !== "user") {
        return res.status(400).json({ message: "Reviewers can't be suspended from here." });
      }

      const suspend = req.body?.suspended !== false;
      const [updated] = await db.update(users).set({
        suspendedAt: suspend ? new Date() : null,
        suspendedReason: suspend
          ? (String(req.body?.reason || "").trim().slice(0, 300) || "Breached the community rules")
          : null,
      }).where(eq(users.id, targetId)).returning({ id: users.id, suspendedAt: users.suspendedAt });

      console.log(`[moderation] ${targetId} ${suspend ? "suspended" : "reinstated"} by ${req.user.id}`);
      await logModeration({
        action: suspend ? "suspend" : "reinstate",
        actorId: req.user.id, targetUserId: targetId, targetType: "user", targetId,
        reason: suspend ? (String(req.body?.reason || "").trim().slice(0, 300) || "Breached the community rules") : null,
      });
      res.json({ id: updated.id, suspended: !!updated.suspendedAt });
    } catch (error) {
      console.error("Suspend error:", error);
      res.status(500).json({ message: "Couldn't change that account" });
    }
  });

  /** The log, newest first. Read-only by construction: there is no write route. */
  app.get("/api/admin/moderation-log", isAuthenticated, requireReviewer, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const rows = await db.select().from(moderationLog)
        .orderBy(desc(moderationLog.createdAt)).limit(limit);
      res.json(rows);
    } catch (error) {
      console.error("Moderation log error:", error);
      res.status(500).json({ message: "Couldn't load the log" });
    }
  });

  /** Counts for the reviewer console badge. */
  app.get("/api/admin/reports/count", isAuthenticated, requireReviewer, async (_req, res) => {
    try {
      const [row] = await db.select({ n: sql<number>`count(*)::int` })
        .from(contentReports).where(eq(contentReports.status, "open"));
      res.json({ open: row?.n ?? 0 });
    } catch {
      res.json({ open: 0 });
    }
  });
}
