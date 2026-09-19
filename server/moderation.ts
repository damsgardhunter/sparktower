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
import { ago, interval } from "./sql-interval";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";
import { db } from "./db";
import {
  contentReports, users, userProfiles, projectComments,
  feedPosts, feedComments, directMessages, projects, rateLimitHits, moderationLog,
} from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { recordActivity } from "./analytics";
import { SAFETY_EVENTS } from "@shared/safety";
import { requireReviewer } from "./platform-roles";
import {
  RATE_LIMITS, DUPLICATE_RULES, REPORT_TARGETS, RETIRED_REPORT_TARGETS, REPORT_REASON_IDS, reportDetailLabel, REPORT_NOTE_MAX,
  REPORT_STATUSES, RATE_LIMITED, DUPLICATE_CONTENT, type DuplicateContentBody, MODERATION_ACTION_IDS, isActionableTarget, isReasonCode, SHADOW_HIDEABLE,
  reasonCodesFor, moderationReasonLabel, isUndoReasonCode, UNDOABLE_ACTIONS, sameModeratedState,
  ACCOUNT_UNDO_ACTIONS, CONTENT_UNDO_ACTIONS, failsClosed, LIMIT_UNAVAILABLE, LIMIT_UNAVAILABLE_RETRY_SECONDS, type LimitUnavailableBody,
  type RateLimitAction, type ReportTarget, type DuplicateRule, type RateLimitedBody, type ModerationAction,
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
const HIT_COUNTED = new Set<RateLimitAction>(["react", "upload", "ai", "login", "loginAccount", "passwordReset", "write", "track", "post", "connect", "review", "payout", "webhookReject", "mfaCode", "session", "workspace", "follow", "apply", "sprint", "checkout", "external", "invite", "inviteLookup"]);

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
  reportDaily: [{
    table: contentReports, author: contentReports.reporterId, created: contentReports.createdAt,
  }],
  react:  [hitSource("react")],
  upload: [hitSource("upload")],
  ai:     [hitSource("ai")],
  login:  [hitSource("login")],
  loginAccount: [hitSource("loginAccount")],
  passwordReset: [hitSource("passwordReset")],
  write:  [hitSource("write")],
  track:  [hitSource("track")],
  post:   [hitSource("post")],
  // Every attempt counts, refused ones included: that's what stops hammering someone with requests.
  connect: [hitSource("connect")],
  // Reviewer actions change state elsewhere (a hidden flag, a suspension), so they're counted as hits.
  review: [hitSource("review")],
  payout: [hitSource("payout")],
  webhookReject: [hitSource("webhookReject")],
  // Wrong second-factor codes, counted per account (server/mfa.ts).
  mfaCode: [hitSource("mfaCode")],
  session: [hitSource("session")],
  workspace: [hitSource("workspace")],
  follow: [hitSource("follow")],
  invite: [hitSource("invite")],
  inviteLookup: [hitSource("inviteLookup")],
  apply: [hitSource("apply")],
  sprint: [hitSource("sprint")],
  checkout: [hitSource("checkout")],
  external: [hitSource("external")],
};

/**
 * The caller's address as a limiter key, for requests with no user.
 *
 * `req.ip`, which Express works out from X-Forwarded-For using the app's
 * `trust proxy` setting — the address our own proxy saw. This used to take the
 * header's first entry, which is the one the client writes: sending a new
 * made-up address with every attempt reset the sign-in limit each time.
 */
/**
 * The key a sign-in is counted against: the address as typed, whether or not
 * an account has it. Keying on a user id would count nothing for the addresses
 * an attacker guesses wrong, and answering differently for the two would turn
 * the limit into a way to find out who has an account here.
 */
export function accountKey(email: unknown): string | null {
  const value = String(email ?? "").trim().toLowerCase();
  return value && value.length <= 320 ? `account:${value}` : null;
}

/**
 * Said once, loudly, if the address every limit is keyed on turns out to be our
 * own proxy.
 *
 * `trust proxy` is set to one hop. If a deployment ever sits behind two — a CDN
 * in front of the host, say — `req.ip` becomes the inner proxy's address, which
 * is the *same* for every visitor. Every per-address limit then shares one
 * bucket: one person's failed sign-ins lock out everybody, and a real attacker
 * is throttled no more than anyone else. It is silent, and it looks exactly
 * like the limits working.
 */
let warnedAboutProxy = false;
function warnIfProxyAddress(address: string): void {
  if (warnedAboutProxy || process.env.NODE_ENV !== "production") return;
  if (!/^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd)/.test(address)) return;
  warnedAboutProxy = true;
  console.warn(
    `[moderation] Every rate limit is being keyed on ${address}, which is a private address — ` +
    `this server is seeing its proxy rather than the visitor, so all visitors share one limit. ` +
    `Check the number of proxies in front of it against \`trust proxy\` (server/replit_integrations/auth/replitAuth.ts).`,
  );
}

export function ipKey(req: any): string {
  const address = req.ip || req.socket?.remoteAddress || "unknown";
  warnIfProxyAddress(String(address));
  return `ip:${address}`;
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
  gte(col, ago(minutes, "minutes"));

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

/*
 * Accounts the limits don't stop: platform admins, and testers listed by email
 * in RATE_LIMIT_EXEMPT_EMAILS. Their use is still recorded — an exempt account
 * running away is exactly what the hit table should show — they just aren't
 * refused. Only a signed-in account can be exempt, never an address, since
 * nothing proves who is behind one. So sign-in attempts are limited for
 * everybody.
 *
 * Only asked once someone is over a limit, so it costs nothing normally. The
 * account's role and email are cached briefly; the list is read live, so
 * changing it needs no restart.
 */
const EXEMPT_LOOKUP_TTL_MS = 30_000;
const exemptLookups = new Map<string, { role: string | null; email: string | null; at: number }>();

function exemptEmails(): Set<string> {
  return new Set((process.env.RATE_LIMIT_EXEMPT_EMAILS || "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
}

async function isExempt(key: string): Promise<boolean> {
  if (key.startsWith("ip:")) return false;
  let who = exemptLookups.get(key);
  if (!who || Date.now() - who.at > EXEMPT_LOOKUP_TTL_MS) {
    try {
      const [row] = await db.select({ role: users.platformRole, email: users.email }).from(users).where(eq(users.id, key));
      who = { role: row?.role ?? null, email: row?.email?.toLowerCase() ?? null, at: Date.now() };
      exemptLookups.set(key, who);
    } catch {
      return false; // Can't tell who this is, so the limit applies.
    }
  }
  // Lowercased on both sides: the allowlist already is, and a row written before
  // addresses were normalised would otherwise miss its own exemption.
  return who.role === "admin" || (!!who.email && exemptEmails().has(who.email.trim().toLowerCase()));
}

export interface RateCheck {
  ok: boolean;
  /** The count itself failed, rather than the person being over a limit (server/moderation.ts, FAIL_CLOSED_ACTIONS). */
  unavailable?: boolean;
  /** Over the limit, but let through because the account is on the allowlist. */
  exempt: boolean;
  used: number;
  max: number;
  /** When room next opens; 0 when there's room now. */
  retryAfterSeconds: number;
}

/**
 * Whether this person (or address) has room to do the thing, and if not,
 * how long until they do.
 *
 * The wait is measured to the oldest counted use leaving the window, in the
 * database's clock like the window itself. Past the limit by more than one it
 * is a lower bound — a retry at that moment may still be early — but it is
 * never the "come back in fifteen minutes" that someone one second from room
 * used to be told.
 *
 * Fails open on a database error for ordinary actions — a limiter that blocks
 * comments when it can't count is worse than the spam it prevents — and closed
 * for the few where unmetered traffic does real damage (sign-in attempts,
 * model spend, money, uploads: FAIL_CLOSED_ACTIONS). Those get `unavailable`,
 * and the caller answers 503 rather than pretending a limit was hit.
 */
export async function withinRateLimit(key: string, action: RateLimitAction): Promise<RateCheck> {
  const limit = RATE_LIMITS[action];
  const windowSeconds = limit.windowMinutes * 60;

  try {
    const rows = await Promise.all(COUNTED[action].map(async (src) => {
      const [row] = await db.select({
        n: sql<number>`count(*)::int`,
        frees: sql<number | null>`ceil(extract(epoch from (min(${src.created}) + ${interval(limit.windowMinutes, "minutes")} - now())))::int`,
      })
        .from(src.table as any)
        .where(and(
          eq(src.author, key),
          withinMinutes(src.created, limit.windowMinutes),
          ...(src.where ? [src.where] : []),
        ));
      return { n: Number(row?.n ?? 0), frees: row?.frees == null ? null : Number(row.frees) };
    }));
    const used = sum(rows.map((r) => r.n));
    if (used < limit.max) return { ok: true, exempt: false, used, max: limit.max, retryAfterSeconds: 0 };
    if (await isExempt(key)) return { ok: true, exempt: true, used, max: limit.max, retryAfterSeconds: 0 };

    const frees = rows.map((r) => r.frees).filter((s): s is number => s !== null);
    const soonest = frees.length ? Math.min(...frees) : windowSeconds;
    return { ok: false, exempt: false, used, max: limit.max, retryAfterSeconds: Math.min(windowSeconds, Math.max(1, soonest)) };
  } catch (err) {
    const closed = failsClosed(action);
    console.error(`[moderation] Rate check failed for ${action}, ${closed ? "refusing" : "allowing"}:`, err);
    if (!closed) return { ok: true, exempt: false, used: 0, max: limit.max, retryAfterSeconds: 0 };
    return { ok: false, exempt: false, unavailable: true, used: 0, max: limit.max, retryAfterSeconds: LIMIT_UNAVAILABLE_RETRY_SECONDS };
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
 * Keeps refusals where the daily safety review can count them.
 *
 * A console line tells whoever is tailing the log; it can't tell tomorrow's
 * reviewer that the message limit refused forty people overnight, which is
 * the spike worth acting on. So refusals are also rows in the behaviour
 * stream, named for the limit.
 *
 * Bucketed, because the thing being refused is often a flood: one row per
 * person, limit and minute, carrying `count`. The first refusal in a minute is
 * written at once, so a review sees it straight away; the rest of that
 * minute's are added up and written as one row when the minute closes. Summing
 * `count` gives the exact number refused, and a script sending a thousand
 * requests costs the database two writes, not a thousand.
 *
 * Fire-and-forget: recording must never change what the refused person gets.
 */
interface RefusalBucket { minute: number; extra: number; row: Parameters<typeof recordActivity>[0] }
const refusalBuckets = new Map<string, RefusalBucket>();
const MAX_REFUSAL_BUCKETS = 10_000;

function flushRefusals(before: number) {
  for (const [key, bucket] of refusalBuckets) {
    if (bucket.minute >= before) continue;
    refusalBuckets.delete(key);
    if (bucket.extra > 0) {
      void recordActivity({ ...bucket.row, props: { ...bucket.row.props, count: bucket.extra } });
    }
  }
}

function recordRefusal(req: any, action: RateLimitAction, kind: "volume" | "duplicate" | "unavailable") {
  if (!req) return;
  const minute = Math.floor(Date.now() / 60_000);
  const who = req.user?.id ?? ipKey(req);
  const key = `${who}|${action}|${kind}`;
  const bucket = refusalBuckets.get(key);
  if (bucket && bucket.minute === minute) { bucket.extra += 1; return; }
  if (bucket) flushRefusals(minute);

  const row = {
    name: SAFETY_EVENTS.limitRefused,
    // The column is a foreign key to accounts; an address-keyed refusal has none.
    userId: req.user?.id ?? null,
    visitorId: req.visitorId || "unknown",
    sessionId: req.sessionId || "unknown",
    path: req.originalUrl || req.path || "/",
    method: req.method,
    status: kind === "volume" ? 429 : 409,
    userAgent: req.headers?.["user-agent"],
    props: { action, kind } as Record<string, unknown>,
  };
  if (refusalBuckets.size < MAX_REFUSAL_BUCKETS) refusalBuckets.set(key, { minute, extra: 0, row });
  void recordActivity({ ...row, props: { ...row.props, count: 1 } });
}

setInterval(() => flushRefusals(Math.floor(Date.now() / 60_000)), 15_000).unref();

/** Writes every pending refusal count now. For shutdown and tests. */
export function flushRefusalCounts(): void {
  flushRefusals(Number.MAX_SAFE_INTEGER);
}

/**
 * The refusal, in one place, so every 429 looks the same and is logged.
 *
 * Logged at warn with the numbers, because a limit that fires is either
 * someone abusing the site or a limit set too low for a real person, and the
 * log line is how you tell which — one user at 31/30 is the second, one user
 * at 400/30 is the first.
 */
function refuse(res: any, key: string, action: RateLimitAction, check: RateCheck) {
  if (check.unavailable) {
    // Nobody hit a limit: the counter is down, and this is one of the actions that doesn't run unmetered.
    const body: LimitUnavailableBody = {
      message: "We couldn't check this just now. Try again in a moment.",
      code: LIMIT_UNAVAILABLE, action, retryAfterSeconds: check.retryAfterSeconds,
    };
    recordRefusal(res.req, action, "unavailable");
    res.setHeader("Retry-After", String(check.retryAfterSeconds));
    res.status(503).json(body);
    return;
  }
  console.warn(`[rate-limit] refused ${action} for user ${key}: ${check.used}/${check.max} in ${RATE_LIMITS[action].windowMinutes}m`);
  recordRefusal(res.req, action, "volume");
  const body: RateLimitedBody = {
    message: RATE_LIMITS[action].message,
    code: RATE_LIMITED,
    action,
    retryAfterSeconds: check.retryAfterSeconds,
    retryAfterMinutes: Math.ceil(check.retryAfterSeconds / 60),
  };
  res.setHeader("Retry-After", String(check.retryAfterSeconds));
  res.status(429).json(body);
}

/**
 * For handlers that check inside their own body rather than as middleware —
 * the credit check every AI endpoint runs through is the one that matters.
 * Returns true to proceed; on false the 429 has already been written.
 */
export async function enforceRateLimit(res: any, userId: string, action: RateLimitAction): Promise<boolean> {
  const check = await withinRateLimit(userId, action);
  if (!check.ok) { refuse(res, userId, action, check); return false; }
  await recordHit(userId, action);
  return true;
}

/**
 * A limit on failures only: refuses a key that has failed too often, without
 * counting this attempt — `countRejection` counts it once it has failed. For
 * routes whose legitimate caller must never be slowed (Stripe's webhook), but
 * whose forgeries should be.
 */
export async function enforceRejectionLimit(res: any, key: string, action: RateLimitAction): Promise<boolean> {
  const check = await withinRateLimit(key, action);
  if (!check.ok) { refuse(res, key, action, check); return false; }
  return true;
}

/**
 * Take one attempt from a limit, atomically — check and increment together.
 *
 * Every other limit here reads the count and then writes the hit, which is
 * correct for one caller at a time and wrong for the case a credential-stuffing
 * limit exists to stop. A script that sends two hundred sign-in attempts at
 * once has every one of them read the same pre-burst count, find room under
 * the limit, and proceed: a limit of twelve lets through as many requests as
 * the attacker is willing to open at the same moment.
 *
 * Inside one transaction, behind an advisory lock on the key, the count and
 * the insert can't be split. Attempts against the same account serialise;
 * attempts against different accounts don't touch each other, so this costs
 * nothing to everyone else signing in.
 *
 * The attempt is spent up front, so a successful sign-in gives it back —
 * `refundAttempt`. Only failures should count against someone.
 */
export async function reserveAttempt(key: string, action: RateLimitAction): Promise<RateCheck> {
  const limit = RATE_LIMITS[action];
  try {
    return await db.transaction(async (tx) => {
      // Two 32-bit ints rather than one: hashtext on the key alone would make
      // two different actions on the same account queue behind each other.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}), hashtext(${action}))`);

      const [row] = await tx.select({
        n: sql<number>`count(*)::int`,
        frees: sql<number | null>`ceil(extract(epoch from (min(${rateLimitHits.createdAt}) + ${interval(limit.windowMinutes, "minutes")} - now())))::int`,
      })
        .from(rateLimitHits)
        .where(and(
          eq(rateLimitHits.userId, key),
          eq(rateLimitHits.action, action),
          withinMinutes(rateLimitHits.createdAt, limit.windowMinutes),
        ));

      const used = Number(row?.n ?? 0);
      if (used >= limit.max) {
        if (await isExempt(key)) return { ok: true, exempt: true, used, max: limit.max, retryAfterSeconds: 0 };
        const frees = row?.frees == null ? limit.windowMinutes * 60 : Number(row.frees);
        return { ok: false, exempt: false, used, max: limit.max, retryAfterSeconds: Math.min(limit.windowMinutes * 60, Math.max(1, frees)) };
      }

      await tx.insert(rateLimitHits).values({ userId: key, action });
      return { ok: true, exempt: false, used: used + 1, max: limit.max, retryAfterSeconds: 0 };
    });
  } catch (err) {
    const closed = failsClosed(action);
    console.error(`[moderation] Atomic reserve failed for ${action}, ${closed ? "refusing" : "allowing"}:`, err);
    if (!closed) return { ok: true, exempt: false, used: 0, max: limit.max, retryAfterSeconds: 0 };
    return { ok: false, exempt: false, unavailable: true, used: 0, max: limit.max, retryAfterSeconds: LIMIT_UNAVAILABLE_RETRY_SECONDS };
  }
}

/** `reserveAttempt`, with the refusal written to the response. True when there was room. */
export async function enforceReservedLimit(res: any, key: string, action: RateLimitAction): Promise<boolean> {
  const check = await reserveAttempt(key, action);
  if (!check.ok) { refuse(res, key, action, check); return false; }
  return true;
}

/**
 * Give back the attempt this request reserved.
 *
 * Deletes the newest hit for the key rather than a specific row id: under a
 * burst it doesn't matter which one goes, only that the count drops by one,
 * and the newest is the one this request almost certainly wrote. Best-effort —
 * a failed refund costs the person one attempt out of their window, which is
 * the right way for it to fail.
 */
export async function refundAttempt(key: string, action: RateLimitAction): Promise<void> {
  try {
    await db.execute(sql`
      DELETE FROM ${rateLimitHits}
      WHERE id = (
        SELECT id FROM ${rateLimitHits}
        WHERE ${rateLimitHits.userId} = ${key} AND ${rateLimitHits.action} = ${action}
        ORDER BY ${rateLimitHits.createdAt} DESC
        LIMIT 1
      )`);
  } catch (err) {
    console.error(`[moderation] Could not refund a ${action} attempt:`, err);
  }
}

export async function countRejection(key: string, action: RateLimitAction): Promise<void> {
  await recordHit(key, action);
}

/**
 * The same check, for work that's optional inside a request that mustn't be
 * refused — Nova's match reasons on an otherwise free route. True when there's
 * room, and the use is counted; false means skip the optional part. Nothing
 * is written to the response either way.
 */
export async function consumeRateLimit(key: string, action: RateLimitAction): Promise<boolean> {
  const check = await withinRateLimit(key, action);
  if (!check.ok) return false;
  await recordHit(key, action);
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
     * endpoint without auth, auth endpoints included. Hit-counted actions key
     * on the address instead.
     *
     * A content-counted action can't: its limit is "how many rows did this
     * author write lately", counted by author id, and an address never matches
     * one — the count would come back zero and allow everything. So a
     * content-counted limit with nobody signed in refuses rather than passing
     * through. Every route using one authenticates first today, so this is
     * unreachable; it exists so that the day one doesn't, the route fails
     * loudly instead of quietly becoming an unlimited write that still reads
     * as limited. `test/unit/route-guards.test.ts` catches the same mistake in
     * the source.
     */
    const userId: string | undefined = req.user?.id ?? (HIT_COUNTED.has(action) ? ipKey(req) : undefined);
    if (!userId) {
      console.error(`[moderation] ${action} is counted from content by author, and nobody is signed in: refusing ${req.method} ${req.path} rather than letting it through unlimited.`);
      return res.status(401).json({ message: "Sign in to do that.", code: "unauthenticated" });
    }

    const check = await withinRateLimit(userId, action);
    if (!check.ok) return refuse(res, userId, action, check);

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
      recordRefusal(req, action, "duplicate");
      const body: DuplicateContentBody = { message: rule.message, code: DUPLICATE_CONTENT, action };
      return res.status(409).json(body);
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
/** How long a limiter hit is kept: past the longest window any action counts over (reportDaily, 24h). */
export const RATE_LIMIT_HIT_RETENTION_HOURS = Math.max(...Object.values(RATE_LIMITS).map((r) => r.windowMinutes)) / 60;

/** Deletes hits no window can count any more. Returns how many went. */
export async function sweepRateLimitHits(): Promise<number> {
  const result = await db.delete(rateLimitHits)
    .where(sql`${rateLimitHits.createdAt} < now() - make_interval(hours => ${RATE_LIMIT_HIT_RETENTION_HOURS})`);
  return (result as any)?.rowCount ?? 0;
}

export function startModerationJobs(): void {
  const sweep = async () => {
    try {
      await sweepRateLimitHits();
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
// Only the webhook that exists. A general "/api/webhooks/" exemption covered
// no route at all — it would have let a future, unverified webhook skip the
// floor without anyone deciding it should.
const WRITE_FLOOR_EXEMPT = ["/api/stripe/webhook"];
export const limitWrites: RequestHandler = async (req: any, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  if (!req.path.startsWith("/api/")) return next();
  if (WRITE_FLOOR_EXEMPT.some((p) => req.path.startsWith(p))) return next();
  const key = req.user?.id ?? ipKey(req);
  const check = await withinRateLimit(key, "write");
  if (!check.ok) return refuse(res, key, "write", check);
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
    if (targetType === "comment") {
      const [r] = await db.select().from(projectComments).where(eq(projectComments.id, targetId));
      return r ? { text: trim(r.content), ownerId: r.authorId, projectId: r.projectId }
               : { text: null, ownerId: null, projectId: null };
    }
    if (targetType === "feed_post") {
      const [r] = await db.select().from(feedPosts).where(eq(feedPosts.id, targetId));
      return r ? { text: trim(r.content), ownerId: r.authorId, projectId: r.projectId ?? null }
               : { text: null, ownerId: null, projectId: null };
    }
    if (targetType === "feed_comment") {
      const [r] = await db.select({ content: feedComments.content, authorId: feedComments.authorId, projectId: feedPosts.projectId })
        .from(feedComments).innerJoin(feedPosts, eq(feedPosts.id, feedComments.postId)).where(eq(feedComments.id, targetId));
      return r ? { text: trim(r.content), ownerId: r.authorId, projectId: r.projectId ?? null }
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
  reasonCode?: string | null; previousState?: unknown; resultingState?: unknown;
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
      reasonCode: entry.reasonCode ?? null,
      previousState: entry.previousState ?? null,
      resultingState: entry.resultingState ?? null,
      details: entry.details ?? {},
    });
  } catch (err) {
    console.error(`[moderation] Failed to log ${entry.action}:`, err);
  }
}

export function registerModerationRoutes(app: Express) {
  /** Filing a report. Rate limited like any other write. */
  app.post("/api/reports", isAuthenticated, rateLimit("report"), rateLimit("reportDaily"), async (req: any, res) => {
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
      // The second click, when the form sent one: it has to belong to the reason.
      const detail = req.body?.detail == null || req.body.detail === "" ? null : String(req.body.detail);
      const detailLabel = detail ? reportDetailLabel(reason, detail) : null;
      if (detail && !detailLabel) return res.status(400).json({ message: "Pick one of the options for that reason" });

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
        note: [detailLabel, String(req.body?.note || "").trim().slice(0, REPORT_NOTE_MAX)].filter(Boolean).join(" — ") || null,
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
    comment: { table: projectComments, author: projectComments.authorId },
    feed_post: { table: feedPosts, author: feedPosts.authorId },
    feed_comment: { table: feedComments, author: feedComments.authorId },
  };

  app.get("/api/admin/reports", isAuthenticated, requireReviewer, async (req: any, res) => {
    try {
      const status = (REPORT_STATUSES as readonly string[]).includes(String(req.query.status))
        ? String(req.query.status) as (typeof REPORT_STATUSES)[number]
        : "open";
      // Optionally one kind of content: `?type=comment`. Retired kinds still filter the reports filed before they went.
      const kind = ([...REPORT_TARGETS, ...RETIRED_REPORT_TARGETS] as readonly string[]).includes(String(req.query.type)) ? String(req.query.type) : null;
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
        .where(and(eq(contentReports.status, status), kind ? eq(contentReports.targetType, kind) : undefined))
        .orderBy(desc(contentReports.createdAt))
        .limit(100);

      const hiddenOf = async (type: string, id: string): Promise<boolean | null> => {
        const t = TAKEDOWN_TABLES[type];
        if (!t) return null;
        const [x] = await db.select({ h: t.table.hiddenAt }).from(t.table).where(eq(t.table.id, id));
        return x ? !!x.h : null;
      };
      const commentMode = async (id: string): Promise<string | null> => {
        const [c] = await db.select({ h: projectComments.hiddenAt, m: projectComments.hiddenMode }).from(projectComments).where(eq(projectComments.id, id));
        return c?.h ? (c.m ?? "removed") : null;
      };
      res.json(await Promise.all(rows.map(async (r) => ({
        ...r.report,
        reporterName: r.reporterName || "Someone",
        ownerName: r.ownerName || null,
        ownerId: r.ownerId,
        ownerSuspended: !!r.ownerSuspendedAt,
        /** Null when this kind of target can't be taken down. */
        targetHidden: await hiddenOf(r.report.targetType, r.report.targetId),
        /** "removed" or "shadow" when a comment is hidden; null otherwise. */
        targetHiddenMode: r.report.targetType === "comment" ? await commentMode(r.report.targetId) : null,
        /** Decided through `/act` (action + reason code) rather than the older buttons. */
        actionable: isActionableTarget(r.report.targetType),
        /** Where a reported post or post comment can be read: the post's own page. */
        targetPostId: r.report.targetType === "feed_post"
          ? r.report.targetId
          : r.report.targetType === "feed_comment"
            ? (await db.select({ postId: feedComments.postId }).from(feedComments).where(eq(feedComments.id, r.report.targetId)))[0]?.postId ?? null
            : null,
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
    const reasonCode = req.body?.reasonCode ? String(req.body.reasonCode) : null;
    if (reasonCode && !isReasonCode(reasonCode)) return res.status(400).json({ message: "Unknown reason code.", code: "invalid_input", field: "reasonCode" });
    const [row] = await db.select({ author: t.author, current: t.table }).from(t.table).where(eq(t.table.id, id));
    if (!row) return res.status(404).json({ message: "Not found" });
    const isComment = type === "comment";
    const stateOf = (r: any) => ({
      hiddenAt: r.hiddenAt ?? null, hiddenById: r.hiddenById ?? null, hiddenReason: r.hiddenReason ?? null,
      ...(isComment ? { hiddenMode: r.hiddenMode ?? null } : {}),
    });
    const change = hide
      ? { hiddenAt: new Date(), hiddenById: req.user.id, hiddenReason: reason, ...(isComment ? { hiddenMode: "removed" } : {}) }
      : { hiddenAt: null, hiddenById: null, hiddenReason: null, ...(isComment ? { hiddenMode: null } : {}) };
    // The change and its record together, or neither.
    await db.transaction(async (tx) => {
      const [after] = await tx.update(t.table).set(change).where(eq(t.table.id, id)).returning();
      await tx.insert(moderationLog).values({
        action: hide ? "content_hidden" : "content_restored", actorId: req.user.id, targetUserId: row.author,
        targetType: type, targetId: id, reason: hide ? reason : null, reasonCode,
        previousState: stateOf(row.current), resultingState: stateOf(after),
      });
    });
    res.json({ ok: true, hidden: hide });
  };
  /**
   * Undoing a decision made outside the report queue: a takedown, a restore,
   * a suspension, a reinstatement.
   *
   * The row itself is the lock, so two reviewers undoing the same entry queue
   * up and the second is told it's already done. The state the decision left
   * behind must still be there — if someone has acted since, the later call
   * stands and this one is refused rather than quietly overwriting it.
   */
  const undoDirectDecision = async (
    entry: typeof moderationLog.$inferSelect,
    opts: { undoAction: string; reasonCode: string; note: string | null; actorId: string },
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const account = ACCOUNT_UNDO_ACTIONS.includes(entry.action);
    const t = account ? null : TAKEDOWN_TABLES[String(entry.targetType)];
    if (!account && !t) return { status: 400, body: { message: "That kind of content can't be restored from the log.", code: "not_undoable" } };
    const targetId = account ? entry.targetUserId : entry.targetId;
    if (!targetId) return { status: 400, body: { message: "That entry doesn't say what it acted on.", code: "not_undoable" } };

    const isComment = entry.targetType === "comment";
    const stateOf = (r: any) => account
      ? { suspendedAt: r.suspendedAt ?? null, suspendedReason: r.suspendedReason ?? null }
      : { hiddenAt: r.hiddenAt ?? null, hiddenById: r.hiddenById ?? null, hiddenReason: r.hiddenReason ?? null, ...(isComment ? { hiddenMode: r.hiddenMode ?? null } : {}) };
    const date = (v: unknown) => (v ? new Date(String(v)) : null);
    const before = (entry.previousState ?? null) as Record<string, any> | null;
    const after = (entry.resultingState ?? null) as Record<string, any> | null;
    if (!before) return { status: 400, body: { message: "That entry didn't record what it changed, so it can't be undone.", code: "not_undoable" } };

    return db.transaction(async (tx) => {
      const table = account ? users : t!.table;
      const [row] = await tx.select().from(table).where(eq(table.id, targetId)).for("update");
      if (!row) return { status: 404, body: { message: account ? "That account no longer exists." : "That content no longer exists.", code: "target_gone" } };

      const [undone] = await tx.select({ id: moderationLog.id }).from(moderationLog)
        .where(sql`${moderationLog.details}->>'undoes' = ${entry.id}`).limit(1);
      if (undone) return { status: 409, body: { message: "This decision has already been undone.", code: "already_undone", logId: undone.id } };

      const now = stateOf(row);
      if (!sameModeratedState(after, now)) {
        return { status: 409, body: { message: account ? "The account has changed since this decision, so it can't be undone as it was." : "That content has changed since this decision, so it can't be undone as it was.", code: "state_changed", field: account ? "author" : "content" } };
      }

      const change = account
        ? { suspendedAt: date(before.suspendedAt), suspendedReason: before.suspendedReason ?? null }
        : { hiddenAt: date(before.hiddenAt), hiddenById: before.hiddenById ?? null, hiddenReason: before.hiddenReason ?? null, ...(isComment ? { hiddenMode: before.hiddenMode ?? null } : {}) };
      const [restored] = await tx.update(table).set(change as any).where(eq(table.id, targetId)).returning();

      const [logged] = await tx.insert(moderationLog).values({
        action: opts.undoAction, actorId: opts.actorId, targetUserId: entry.targetUserId,
        targetType: entry.targetType, targetId: entry.targetId, reason: opts.note, reasonCode: opts.reasonCode,
        previousState: now, resultingState: stateOf(restored),
        details: { undoes: entry.id, undoneAction: entry.action },
      }).returning();
      return { status: 200, body: { ok: true, logId: logged.id, undoes: entry.id, ...(account ? { suspended: !!(restored as any).suspendedAt } : { hidden: !!(restored as any).hiddenAt }) } };
    });
  };

  app.post("/api/admin/content/:type/:id/hide", isAuthenticated, requireReviewer, rateLimit("review"), (req: any, res) => setHidden(req, res, true).catch((e) => { console.error("takedown failed:", e); res.status(500).json({ message: "Couldn't take that down" }); }));
  app.post("/api/admin/content/:type/:id/restore", isAuthenticated, requireReviewer, rateLimit("review"), (req: any, res) => setHidden(req, res, false).catch((e) => { console.error("restore failed:", e); res.status(500).json({ message: "Couldn't restore that" }); }));

  /**
   * Deciding a reported comment — the step of the loop that changes anything.
   *
   * One of four actions, each with a required reason code: remove, shadow-hide,
   * ban (suspend the author and remove the comment), or dismiss. The content
   * change, the author's suspension, closing the report and the log entry are
   * one transaction: there is no action without its record, and no record of
   * an action that didn't happen. The entry keeps the prior state of
   * everything it changed, so an undo can put it back exactly.
   *
   * The report row is locked for the decision, so two reviewers acting on the
   * same report at once get one action and one "already decided".
   */
  app.post("/api/admin/reports/:id/act", isAuthenticated, requireReviewer, rateLimit("review"), async (req: any, res) => {
    try {
      const action = String(req.body?.action ?? "") as ModerationAction;
      const reasonCode = String(req.body?.reasonCode ?? "");
      const note = String(req.body?.note ?? "").trim().slice(0, REPORT_NOTE_MAX) || null;
      if (!MODERATION_ACTION_IDS.includes(action)) {
        return res.status(400).json({ message: "Pick what to do.", code: "invalid_input", field: "action" });
      }
      if (!reasonCodesFor(action).some((r) => r.id === reasonCode)) {
        return res.status(400).json({
          message: action === "dismiss" ? "Pick why it's being dismissed." : "Pick the rule it broke.",
          code: "invalid_input", field: "reasonCode",
        });
      }

      const outcome = await db.transaction(async (tx) => {
        const [report] = await tx.select().from(contentReports)
          .where(eq(contentReports.id, String(req.params.id))).for("update");
        if (!report) return { status: 404, body: { message: "Report not found" } };
        const t = TAKEDOWN_TABLES[String(report.targetType)];
        if (!isActionableTarget(report.targetType) || !t) {
          return { status: 400, body: { message: "That kind of report is decided with the buttons on it, not from the queue.", code: "not_actionable" } };
        }
        // Only content with a hidden mode can be shadow-hidden; a post is removed or left alone.
        if (action === "shadow_hide" && !SHADOW_HIDEABLE.includes(String(report.targetType))) {
          return { status: 400, body: { message: "This kind of content can't be shadow-hidden. Remove it or dismiss the report.", code: "invalid_input", field: "action" } };
        }
        if (report.status !== "open") {
          return { status: 409, body: { message: "This report has already been decided.", code: "already_resolved", reportStatus: report.status } };
        }

        const [target] = await tx.select().from(t.table).where(eq(t.table.id, report.targetId)).for("update");
        if (!target && action !== "dismiss") {
          return { status: 404, body: { message: "That content no longer exists. Dismiss the report instead.", code: "target_gone" } };
        }
        const [author] = target
          ? await tx.select({ id: users.id, platformRole: users.platformRole, suspendedAt: users.suspendedAt, suspendedReason: users.suspendedReason })
            .from(users).where(eq(users.id, target.authorId))
          : [];
        if (action === "ban") {
          if (!author) return { status: 404, body: { message: "The author's account no longer exists.", code: "target_gone" } };
          if (author.id === req.user.id) return { status: 400, body: { message: "You can't ban yourself.", code: "invalid_input" } };
          if (author.platformRole !== "user") return { status: 400, body: { message: "Reviewers can't be banned from here.", code: "invalid_input" } };
        }

        const hasMode = SHADOW_HIDEABLE.includes(String(report.targetType));
        const targetState = (c: any) => c
          ? { hiddenAt: c.hiddenAt, hiddenById: c.hiddenById, hiddenReason: c.hiddenReason, ...(hasMode ? { hiddenMode: c.hiddenMode } : {}) }
          : null;
        const authorState = (a: { suspendedAt: Date | null; suspendedReason: string | null }) =>
          ({ suspendedAt: a.suspendedAt, suspendedReason: a.suspendedReason });
        const label = moderationReasonLabel(reasonCode);

        let targetAfter = targetState(target);
        if (action !== "dismiss") {
          const [updated] = await tx.update(t.table).set({
            hiddenAt: new Date(), hiddenById: req.user.id, hiddenReason: label,
            ...(hasMode ? { hiddenMode: action === "shadow_hide" ? "shadow" : "removed" } : {}),
          }).where(eq(t.table.id, target.id)).returning();
          targetAfter = targetState(updated);
        }
        let authorAfter: ReturnType<typeof authorState> | null = null;
        if (action === "ban") {
          const [u] = await tx.update(users).set({ suspendedAt: new Date(), suspendedReason: label })
            .where(eq(users.id, author!.id)).returning({ suspendedAt: users.suspendedAt, suspendedReason: users.suspendedReason });
          authorAfter = authorState(u);
        }

        const reportStatus = action === "dismiss" ? "dismissed" : "actioned";
        await tx.update(contentReports).set({
          status: reportStatus, reviewedById: req.user.id, reviewedAt: new Date(), reviewNote: note,
        }).where(eq(contentReports.id, report.id));

        const [entry] = await tx.insert(moderationLog).values({
          // comment_remove, feed_post_remove, … — the type it was, and what was done.
          action: `${report.targetType}_${action}`,
          actorId: req.user.id,
          targetUserId: target?.authorId ?? report.targetOwnerId,
          targetType: report.targetType,
          targetId: report.targetId,
          reason: note,
          reasonCode,
          /*
           * `target` is the general name; `comment` is written too so entries
           * made before the queue handled posts keep reading the same way, and
           * so does anything that looked for it.
           */
          previousState: {
            report: { status: report.status },
            target: targetState(target), comment: targetState(target),
            ...(action === "ban" ? { author: authorState(author!) } : {}),
          },
          resultingState: {
            report: { status: reportStatus },
            target: targetAfter, comment: targetAfter,
            ...(authorAfter ? { author: authorAfter } : {}),
          },
          details: { reportId: report.id, reportReason: report.reason },
        }).returning();
        return { status: 200, body: { ok: true, reportStatus, logId: entry.id } };
      });
      res.status(outcome.status).json(outcome.body);
    } catch (error) {
      console.error("Moderation action error:", error);
      res.status(500).json({ message: "Couldn't apply that. Nothing was changed." });
    }
  });

  /**
   * Undoing a queue decision. The entry's `previousState` goes back exactly —
   * the comment's visibility, the author's suspension for a ban, the report's
   * status (open again, to be decided afresh) — in one transaction, and a new
   * entry is appended pointing at the original, which stays as it was: the
   * log is append-only (moderation-log-rules.ts). Refused when it was already
   * undone, or when the thing has changed since (someone restored or acted on
   * it another way): an undo restores one decision, never overwrites a later one.
   */
  app.post("/api/admin/moderation-log/:id/undo", isAuthenticated, requireReviewer, rateLimit("review"), async (req: any, res) => {
    try {
      const reasonCode = String(req.body?.reasonCode ?? "");
      const note = String(req.body?.note ?? "").trim().slice(0, REPORT_NOTE_MAX) || null;
      if (!isUndoReasonCode(reasonCode)) {
        return res.status(400).json({ message: "Pick why it's being undone.", code: "invalid_input", field: "reasonCode" });
      }
      const [entry] = await db.select().from(moderationLog).where(eq(moderationLog.id, String(req.params.id)));
      if (!entry) return res.status(404).json({ message: "Log entry not found" });
      const undoAction = UNDOABLE_ACTIONS[entry.action];
      const reportId = (entry.details as any)?.reportId as string | undefined;
      /*
       * A takedown or a suspension made outside the queue: no report to put
       * back, one row to restore. Same rules as a queue undo — once only, and
       * only while the thing is still as the decision left it.
       */
      if (CONTENT_UNDO_ACTIONS.includes(entry.action) || ACCOUNT_UNDO_ACTIONS.includes(entry.action)) {
        const outcome = await undoDirectDecision(entry, { undoAction, reasonCode, note, actorId: req.user.id });
        return res.status(outcome.status).json(outcome.body);
      }

      // Past the branch above, only queue decisions remain: the content it was about, and the report it was decided from.
      const undoTable = TAKEDOWN_TABLES[String(entry.targetType)];
      if (!undoAction || !undoTable || !reportId) {
        return res.status(400).json({ message: "Only decisions made from the report queue can be undone here.", code: "not_undoable" });
      }
      const dismissal = entry.action.endsWith("_dismiss");
      const banned = entry.action.endsWith("_ban");
      const undoHasMode = SHADOW_HIDEABLE.includes(String(entry.targetType));
      // Entries written before the queue handled posts say `comment`; newer ones say `target`.
      const stateBefore = (v: any) => v?.target ?? v?.comment;
      const before = (entry.previousState ?? {}) as { report?: { status: string }; comment?: Record<string, any> | null; target?: Record<string, any> | null; author?: Record<string, any> };
      const after = (entry.resultingState ?? {}) as typeof before;

      const outcome = await db.transaction(async (tx) => {
        // The report row is the lock: two undos of one decision queue up here, and the second sees the first.
        const [report] = await tx.select().from(contentReports).where(eq(contentReports.id, reportId)).for("update");
        if (!report) return { status: 404, body: { message: "The report behind this decision is gone.", code: "target_gone" } };
        const [undone] = await tx.select({ id: moderationLog.id }).from(moderationLog)
          .where(sql`${moderationLog.details}->>'undoes' = ${entry.id}`).limit(1);
        if (undone) return { status: 409, body: { message: "This decision has already been undone.", code: "already_undone", logId: undone.id } };
        if (report.status !== after.report?.status) {
          return { status: 409, body: { message: "The report has changed since this decision, so it can't be undone as it was.", code: "state_changed", field: "report" } };
        }

        const [content] = await tx.select().from(undoTable.table).where(eq(undoTable.table.id, entry.targetId!)).for("update");
        const contentNow = content
          ? { hiddenAt: content.hiddenAt, hiddenById: content.hiddenById, hiddenReason: content.hiddenReason, ...(undoHasMode ? { hiddenMode: content.hiddenMode } : {}) }
          : null;
        if (!dismissal) {
          if (!content) return { status: 404, body: { message: "That content no longer exists.", code: "target_gone" } };
          if (!sameModeratedState(stateBefore(after), contentNow)) {
            // The field names what changed — "comment", "feed_post" — as the queue and the client know it.
            return { status: 409, body: { message: "The content has changed since this decision, so it can't be undone as it was.", code: "state_changed", field: entry.targetType } };
          }
        }
        const [author] = banned && entry.targetUserId
          ? await tx.select({ suspendedAt: users.suspendedAt, suspendedReason: users.suspendedReason }).from(users).where(eq(users.id, entry.targetUserId)).for("update")
          : [];
        if (banned && (!author || !sameModeratedState(after.author, author))) {
          return { status: 409, body: { message: "The author's account has changed since the ban, so it can't be undone from here.", code: "state_changed", field: "author" } };
        }

        const date = (v: unknown) => (v ? new Date(String(v)) : null);
        const wanted = stateBefore(before);
        let contentRestored = contentNow;
        if (!dismissal && wanted !== undefined) {
          const [c] = await tx.update(undoTable.table).set({
            hiddenAt: date(wanted?.hiddenAt), hiddenById: wanted?.hiddenById ?? null, hiddenReason: wanted?.hiddenReason ?? null,
            ...(undoHasMode ? { hiddenMode: wanted?.hiddenMode ?? null } : {}),
          } as any).where(eq(undoTable.table.id, content!.id)).returning();
          contentRestored = { hiddenAt: c.hiddenAt, hiddenById: c.hiddenById, hiddenReason: c.hiddenReason, ...(undoHasMode ? { hiddenMode: c.hiddenMode } : {}) };
        }
        let authorRestored: Record<string, unknown> | null = null;
        if (author && before.author) {
          const [u] = await tx.update(users).set({ suspendedAt: date(before.author.suspendedAt), suspendedReason: before.author.suspendedReason ?? null })
            .where(eq(users.id, entry.targetUserId!)).returning({ suspendedAt: users.suspendedAt, suspendedReason: users.suspendedReason });
          authorRestored = u;
        }
        const reportStatus = before.report?.status ?? "open";
        await tx.update(contentReports).set({ status: reportStatus as any, reviewedById: null, reviewedAt: null })
          .where(eq(contentReports.id, report.id));

        const [logged] = await tx.insert(moderationLog).values({
          action: undoAction, actorId: req.user.id, targetUserId: entry.targetUserId,
          targetType: entry.targetType, targetId: entry.targetId, reason: note, reasonCode,
          previousState: { report: { status: report.status }, target: contentNow, comment: contentNow, ...(author ? { author } : {}) },
          resultingState: { report: { status: reportStatus }, target: contentRestored, comment: contentRestored, ...(authorRestored ? { author: authorRestored } : {}) },
          details: { undoes: entry.id, undoneAction: entry.action, reportId: report.id },
        }).returning();
        return { status: 200, body: { ok: true, logId: logged.id, undoes: entry.id, reportStatus } };
      });
      res.status(outcome.status).json(outcome.body);
    } catch (error) {
      console.error("Moderation undo error:", error);
      res.status(500).json({ message: "Couldn't undo that. Nothing was changed." });
    }
  });

  /** Resolving one. Actioned or dismissed — both close it. */
  app.patch("/api/admin/reports/:id", isAuthenticated, requireReviewer, rateLimit("review"), async (req: any, res) => {
    try {
      const status = String(req.body?.status || "");
      if (status !== "actioned" && status !== "dismissed") {
        return res.status(400).json({ message: "Status must be actioned or dismissed" });
      }
      const [before] = await db.select({ status: contentReports.status }).from(contentReports)
        .where(eq(contentReports.id, String(req.params.id)));
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
        previousState: { status: before?.status ?? null }, resultingState: { status: updated.status },
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
  app.post("/api/admin/users/:id/suspend", isAuthenticated, requireReviewer, rateLimit("review"), async (req: any, res) => {
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
      }).where(eq(users.id, targetId)).returning({ id: users.id, suspendedAt: users.suspendedAt, suspendedReason: users.suspendedReason });

      console.log(`[moderation] ${targetId} ${suspend ? "suspended" : "reinstated"} by ${req.user.id}`);
      await logModeration({
        action: suspend ? "suspend" : "reinstate",
        actorId: req.user.id, targetUserId: targetId, targetType: "user", targetId,
        reason: suspend ? (String(req.body?.reason || "").trim().slice(0, 300) || "Breached the community rules") : null,
        reasonCode: req.body?.reasonCode && isReasonCode(String(req.body.reasonCode)) ? String(req.body.reasonCode) : null,
        previousState: { suspendedAt: target.suspendedAt, suspendedReason: target.suspendedReason },
        resultingState: { suspendedAt: updated.suspendedAt, suspendedReason: updated.suspendedReason },
      });
      res.json({ id: updated.id, suspended: !!updated.suspendedAt });
    } catch (error) {
      console.error("Suspend error:", error);
      res.status(500).json({ message: "Couldn't change that account" });
    }
  });

  /**
   * The log, newest first, optionally narrowed: `?targetType=comment&targetId=…`
   * for everything that happened to one comment, `?action=` or `?actorId=` for
   * what one kind of action or one reviewer did. Read-only: there is no write
   * route, and the database refuses edits and deletes (moderation-log-rules.ts).
   */
  app.get("/api/admin/moderation-log", isAuthenticated, requireReviewer, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const filters = ([
        ["targetType", moderationLog.targetType], ["targetId", moderationLog.targetId],
        ["action", moderationLog.action], ["actorId", moderationLog.actorId],
      ] as const).flatMap(([param, col]) => {
        const v = req.query[param];
        return typeof v === "string" && v ? [eq(col, v)] : [];
      });
      const rows = await db.select({
        entry: moderationLog,
        actorName: sql<string | null>`coalesce(actor_profile.display_name, actor.first_name)`,
      }).from(moderationLog)
        .leftJoin(sql`${users} AS actor`, sql`actor.id = ${moderationLog.actorId}`)
        .leftJoin(sql`${userProfiles} AS actor_profile`, sql`actor_profile.user_id = ${moderationLog.actorId}`)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(moderationLog.createdAt)).limit(limit);
      res.json(rows.map((r) => ({ ...r.entry, actorName: r.actorName ?? null })));
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
