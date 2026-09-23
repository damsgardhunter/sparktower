/**
 * The customer console: finding a person, seeing what they have, and fixing it.
 *
 * ## What this is for
 *
 * Somebody writes in. Their generation failed and took their dollar; the
 * confirmation mail never arrived; they published a project they meant to keep
 * private; they signed up twice and want their work moved across. Every one of
 * those was previously a shell, a database URL and a hand-written UPDATE — the
 * most dangerous way to help a customer, because there is no record of it, no
 * limit on it, and no way to put it back.
 *
 * So: a short list of named actions (shared/admin-console.ts), each of which
 * writes to the moderation log with the state from before and the state after.
 * The log is append-only at the database level (`applyModerationLogRules`), so
 * the account of what was done cannot be edited by whoever did it.
 *
 * ## The four rules every route here holds to
 *
 * **Admin, and a session that proved its second factor.** A stolen cookie is
 * not enough to reach anybody's balance. Money and ownership need the owner
 * specifically, so support can be handed to somebody without handing over the
 * bank.
 *
 * **A reason, every time.** Stored, and required to be a sentence. A log full
 * of "ok" answers nothing six months later.
 *
 * **Never yourself.** Every action refuses its own actor. The point of an
 * audited console is that somebody else can read what you did; an operator who
 * can quietly top up their own balance has a console that audits everyone but
 * them.
 *
 * **Reversible where it can be.** `previousState` is the undo, and undo is a
 * logged action of its own rather than a deletion — the mistake and the
 * correction both stay on the record.
 *
 * ## What it deliberately cannot do
 *
 * Read anybody's work. It answers "what has this account got and what has been
 * done to it" — balances, passes, project titles, the ledger. Not the contents
 * of a project. Support does not need somebody's business plan to refund them
 * a dollar, and a console that could read one would be a reason not to trust
 * the product with anything.
 */
import type { Express, RequestHandler, Response } from "express";
import { and, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "./db";
import {
  moderationLog, novaBuildPasses, novaLedger, projects, users,
} from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { mfaGate } from "./mfa";
import { atLeast, isOwner } from "./platform-roles";
import { logModeration, rateLimit } from "./moderation";
import { walletOf } from "./wallet";
import { MONTHLY_SMALL_ACTIONS, OUTCOME_PRICE_CENTS, formatMoney } from "@shared/plans";
import {
  CONSOLE_ACTION_DEFS, MAX_GRANT_CENTS, MAX_GRANT_CENTS_PER_DAY, MAX_PASS_DAYS,
  MAX_REASON, MIN_REASON, consoleLogAction, isConsoleAction,
  type ConsoleAction,
} from "@shared/admin-console";

/** Admin, with a session that proved its second factor. Anything less doesn't learn this exists. */
const requireAdmin: RequestHandler = (req: any, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Not signed in" });
  if (!atLeast(req.user.platformRole, "admin")) return res.status(404).json({ message: "Not found" });
  if (!mfaGate(req, res)) return;
  next();
};

/**
 * Whether this caller may take this particular action.
 *
 * Read from the catalogue rather than written per route, so "who may do this"
 * is answered in the same place the action is described and cannot drift from
 * the label the operator read before pressing it.
 */
function mayDo(req: any, action: ConsoleAction, res: Response): boolean {
  const def = CONSOLE_ACTION_DEFS[action];
  if (def.role === "owner" && !isOwner(req.user?.email)) {
    res.status(403).json({
      code: "owner_only",
      message: `"${def.label}" is the account owner's to do. Ask them, or sign in as the owner address.`,
    });
    return false;
  }
  return true;
}

/** The sentence that goes on the record. Refused rather than defaulted. */
function reasonFrom(req: any, res: Response): string | null {
  const reason = String(req.body?.reason ?? "").trim().slice(0, MAX_REASON);
  if (reason.length < MIN_REASON) {
    res.status(400).json({
      code: "reason_required",
      message: `Say why, in a sentence — at least ${MIN_REASON} characters. It goes on the permanent record for this account.`,
    });
    return null;
  }
  return reason;
}

/** Enough to identify an account without printing addresses in full across a list. */
const maskEmail = (email: string | null): string => {
  if (!email) return "(no address)";
  const [local, domain] = email.split("@");
  if (!domain) return "(no address)";
  return `${local.slice(0, 2)}${local.length > 2 ? "***" : ""}@${domain}`;
};

/**
 * The target account, or null once a 404 has been sent.
 *
 * Also refuses the caller's own account. See the header: a console whose
 * operator can act on themselves audits everybody except the one person whose
 * actions nobody else is watching.
 */
async function targetUser(req: any, res: Response, id: string) {
  if (id === req.user.id) {
    res.status(400).json({ code: "not_yourself", message: "Use the ordinary screens for your own account. This console is for other people's, and it says who did what." });
    return null;
  }
  const [row] = await db.select().from(users).where(eq(users.id, id));
  if (!row) {
    res.status(404).json({ message: "No such account." });
    return null;
  }
  return row;
}

/** How much this operator has handed out in the last day, for the ceiling. */
async function grantedTodayCents(actorId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db.select({
    cents: sql<number>`coalesce(sum(((${moderationLog.details}->>'cents')::int)), 0)::int`,
  }).from(moderationLog).where(and(
    eq(moderationLog.actorId, actorId),
    eq(moderationLog.action, consoleLogAction("credit")),
    gte(moderationLog.createdAt, since),
  ));
  return row?.cents ?? 0;
}

export function registerAdminConsoleRoutes(app: Express) {
  /**
   * What the console can do, for the screen that draws the buttons.
   *
   * Sent rather than hardcoded in the client so that an operator who is an
   * admin but not the owner sees the owner-only actions as owner-only, in the
   * same words the server will refuse them with — rather than pressing one and
   * being told no.
   */
  app.get("/api/admin/console/actions", isAuthenticated, requireAdmin, async (req: any, res) => {
    res.json({
      you: { id: req.user.id, isOwner: isOwner(req.user.email) },
      actions: Object.values(CONSOLE_ACTION_DEFS),
      limits: {
        maxGrantCents: MAX_GRANT_CENTS,
        maxGrantPerDayCents: MAX_GRANT_CENTS_PER_DAY,
        grantedTodayCents: await grantedTodayCents(req.user.id),
        maxPassDays: MAX_PASS_DAYS,
        minReason: MIN_REASON,
      },
      prices: OUTCOME_PRICE_CENTS,
    });
  });

  /**
   * Find the customer who just wrote in.
   *
   * By address, by name, or by pasting the id out of their email — support
   * arrives in all three shapes and guessing which one is a worse use of a
   * minute than trying all of them. Projects are searched too, because "my
   * project X is broken" is how people describe themselves.
   */
  app.get("/api/admin/console/search", isAuthenticated, requireAdmin, rateLimit("review"), async (req: any, res) => {
    const q = String(req.query.q ?? "").trim().slice(0, 120);
    if (q.length < 2) return res.json({ people: [], projects: [] });
    const like = `%${q}%`;

    const people = await db.select({
      id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName,
      platformRole: users.platformRole, suspendedAt: users.suspendedAt, isBot: users.isBot,
      balanceCents: users.balanceCents, createdAt: users.createdAt,
    }).from(users).where(or(
      ilike(users.email, like),
      ilike(users.firstName, like),
      ilike(users.lastName, like),
      eq(users.id, q),
    )).limit(20);

    const found = await db.select({
      id: projects.id, title: projects.title, ownerId: projects.ownerId,
      isPrivate: projects.isPrivate, goal: projects.goal,
    }).from(projects).where(or(ilike(projects.title, like), eq(projects.id, q))).limit(20);

    res.json({
      people: people.map((p) => ({
        id: p.id,
        email: p.email,
        name: [p.firstName, p.lastName].filter(Boolean).join(" ") || "(no name)",
        role: p.platformRole,
        suspended: !!p.suspendedAt,
        isBot: p.isBot,
        balance: formatMoney(p.balanceCents),
        joined: p.createdAt,
      })),
      projects: found,
    });
  });

  /**
   * One customer, as a support person needs them: what they have, what they
   * have spent, what has been done to them, and what they own.
   *
   * Never the contents of their projects — titles and settings only. See the
   * header.
   */
  app.get("/api/admin/console/users/:id", isAuthenticated, requireAdmin, async (req: any, res) => {
    const [account] = await db.select().from(users).where(eq(users.id, req.params.id));
    if (!account) return res.status(404).json({ message: "No such account." });

    const [wallet, theirProjects, ledger, history, passes] = await Promise.all([
      walletOf(account.id),
      db.select({
        id: projects.id, title: projects.title, isPrivate: projects.isPrivate,
        goal: projects.goal, subcategory: projects.subcategory, createdAt: projects.createdAt,
      }).from(projects).where(eq(projects.ownerId, account.id)).orderBy(desc(projects.createdAt)).limit(50),
      db.select().from(novaLedger).where(eq(novaLedger.userId, account.id))
        .orderBy(desc(novaLedger.createdAt)).limit(25),
      db.select().from(moderationLog).where(eq(moderationLog.targetUserId, account.id))
        .orderBy(desc(moderationLog.createdAt)).limit(40),
      db.select().from(novaBuildPasses).where(eq(novaBuildPasses.userId, account.id)),
    ]);

    res.json({
      account: {
        id: account.id,
        email: account.email,
        name: [account.firstName, account.lastName].filter(Boolean).join(" ") || "(no name)",
        role: account.platformRole,
        isBot: account.isBot,
        suspended: !!account.suspendedAt,
        suspendedReason: account.suspendedReason ?? null,
        emailVerifiedAt: account.emailVerifiedAt,
        mfaEnabled: !!account.mfaEnabledAt,
        joined: account.createdAt,
        subscriptionTier: account.subscriptionTier,
      },
      wallet,
      allowance: { used: account.creditsUsed, of: MONTHLY_SMALL_ACTIONS, resetAt: account.creditsResetAt },
      projects: theirProjects.map((p) => ({
        ...p,
        /** Whether the whole-business build has been bought for it. */
        buildPass: passes.some((pass) => pass.projectId === p.id),
      })),
      ledger,
      /** Everything ever done to this account by an operator, newest first. */
      history: history.map((h) => ({
        id: h.id, action: h.action, actorId: h.actorId, reason: h.reason,
        details: h.details, createdAt: h.createdAt,
        previousState: h.previousState, resultingState: h.resultingState,
      })),
    });
  });

  /**
   * Take an action, and write down that you did.
   *
   * One route for all of them rather than eight, because the rules that matter
   * — who may, a reason, not yourself, log the pair of states — are the same
   * for every one, and eight handlers is eight chances for one of them to
   * quietly not do one of those things.
   */
  app.post("/api/admin/console/act", isAuthenticated, requireAdmin, rateLimit("review"), async (req: any, res) => {
    const action = req.body?.action;
    if (!isConsoleAction(action)) return res.status(400).json({ message: "No such action." });
    if (!mayDo(req, action, res)) return;

    const reason = reasonFrom(req, res);
    if (reason === null) return;

    const def = CONSOLE_ACTION_DEFS[action];
    const log = async (input: {
      targetUserId: string; targetType: string; targetId: string;
      previousState: unknown; resultingState: unknown; details?: Record<string, unknown>;
    }) => {
      await logModeration({
        action: consoleLogAction(action),
        actorId: req.user.id,
        targetUserId: input.targetUserId,
        targetType: input.targetType,
        targetId: input.targetId,
        reason,
        previousState: input.previousState,
        resultingState: input.resultingState,
        details: { ...(input.details ?? {}), reversible: def.reversible },
      });
    };

    try {
      if (def.subject === "user") {
        const account = await targetUser(req, res, String(req.body?.userId ?? ""));
        if (!account) return;
        return await actOnUser({ req, res, action, account, log });
      }

      const [project] = await db.select().from(projects).where(eq(projects.id, String(req.body?.projectId ?? "")));
      if (!project) return res.status(404).json({ message: "No such project." });
      if (project.ownerId === req.user.id) {
        return res.status(400).json({ code: "not_yourself", message: "That is your own project. Use the ordinary screens for it." });
      }
      return await actOnProject({ req, res, action, project, log });
    } catch (err) {
      console.error(`[console] ${action} failed:`, err);
      res.status(500).json({ message: "That didn't go through. Nothing was changed." });
    }
  });

  /**
   * Put one back.
   *
   * Undo is a new logged action rather than a deletion, and the log refuses
   * edits anyway: the mistake and the correction both stay on the record,
   * which is the only version of "undo" an audit can believe. It restores
   * `previousState` — what was actually there — rather than what the operator
   * assumes was there.
   */
  app.post("/api/admin/console/undo/:logId", isAuthenticated, requireAdmin, rateLimit("review"), async (req: any, res) => {
    const [entry] = await db.select().from(moderationLog).where(eq(moderationLog.id, req.params.logId));
    if (!entry || !entry.action.startsWith("console:")) {
      return res.status(404).json({ message: "No such console action." });
    }
    const action = entry.action.slice("console:".length);
    if (!isConsoleAction(action)) return res.status(400).json({ message: "That action can't be undone." });
    if (!CONSOLE_ACTION_DEFS[action].reversible) {
      return res.status(400).json({ message: "That action isn't reversible." });
    }
    if (!mayDo(req, action, res)) return;

    /*
     * The same rule the actions hold to, applied to putting one back: nobody
     * changes their own account through this console.
     *
     * Not because the alternative is an escalation — `act` already refuses to
     * target the caller, so an entry pointing at them was written by somebody
     * else, and reversing it can only give them less. It is here so the
     * invariant is uniform and can be stated without an exception: every
     * change this console makes to an account was made by a different person,
     * and that is what makes the record worth reading.
     */
    if (entry.targetUserId && entry.targetUserId === req.user.id) {
      return res.status(400).json({
        code: "not_yourself",
        message: "That one is about your own account. Ask another operator to put it back, so the record still shows two people.",
      });
    }

    const reason = reasonFrom(req, res);
    if (reason === null) return;

    /* Undoing twice would double the correction — a credit reversed, then reversed again. */
    const [already] = await db.select({ id: moderationLog.id }).from(moderationLog)
      .where(and(eq(moderationLog.action, "console:undo"), eq(moderationLog.targetId, entry.id))).limit(1);
    if (already) return res.status(409).json({ code: "already_undone", message: "That one has already been put back." });

    const before = (entry.previousState ?? {}) as Record<string, any>;
    try {
      const undone = await restore(action, entry, before);
      if (!undone.ok) return res.status(400).json({ message: undone.message });

      await logModeration({
        action: "console:undo",
        actorId: req.user.id,
        targetUserId: entry.targetUserId,
        /* The log entry being reversed, so "has this been undone?" is one query. */
        targetType: "moderation_log",
        targetId: entry.id,
        reason,
        previousState: entry.resultingState,
        resultingState: entry.previousState,
        details: { undid: entry.action, cents: undone.cents ?? 0 },
      });
      res.json({ undone: true, action: entry.action });
    } catch (err) {
      console.error("[console] undo failed:", err);
      res.status(500).json({ message: "Couldn't put that back. Nothing was changed." });
    }
  });

  /** Everything this console has ever done, newest first. Read-only, like the log it reads. */
  app.get("/api/admin/console/log", isAuthenticated, requireAdmin, async (req: any, res) => {
    const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 60));
    const rows = await db.select().from(moderationLog)
      .where(sql`${moderationLog.action} like 'console:%'`)
      .orderBy(desc(moderationLog.createdAt)).limit(limit);

    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((id): id is string => !!id))];
    const actors = actorIds.length
      ? await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, actorIds))
      : [];
    const nameOf = new Map(actors.map((a) => [a.id, maskEmail(a.email)]));

    /* Which ones have already been put back, so the screen never offers undo twice. */
    const undone = new Set(rows.filter((r) => r.action === "console:undo").map((r) => r.targetId ?? ""));

    res.json({
      entries: rows.map((r) => ({
        id: r.id, action: r.action, actor: nameOf.get(r.actorId ?? "") ?? "(gone)",
        targetUserId: r.targetUserId, targetType: r.targetType, targetId: r.targetId,
        reason: r.reason, details: r.details, createdAt: r.createdAt,
        undone: undone.has(r.id),
      })),
    });
  });
}

// ─── The actions themselves ──────────────────────────────────────────────────

type Logger = (input: {
  targetUserId: string; targetType: string; targetId: string;
  previousState: unknown; resultingState: unknown; details?: Record<string, unknown>;
}) => Promise<void>;

async function actOnUser({ req, res, action, account, log }: {
  req: any; res: Response; action: ConsoleAction; account: typeof users.$inferSelect; log: Logger;
}) {
  const id = account.id;

  if (action === "credit") {
    const cents = Math.round(Number(req.body?.cents));
    if (!Number.isFinite(cents) || cents <= 0) {
      return res.status(400).json({ message: "How much? In cents, above zero." });
    }
    if (cents > MAX_GRANT_CENTS) {
      return res.status(400).json({ message: `${formatMoney(cents)} is over the ${formatMoney(MAX_GRANT_CENTS)} ceiling for one grant.` });
    }
    const already = await grantedTodayCents(req.user.id);
    if (already + cents > MAX_GRANT_CENTS_PER_DAY) {
      return res.status(429).json({
        code: "daily_ceiling",
        message: `You've handed out ${formatMoney(already)} in the last day, and the ceiling is ${formatMoney(MAX_GRANT_CENTS_PER_DAY)}.`,
      });
    }

    /*
     * Written as a ledger row as well as a balance change, so it shows on the
     * customer's own statement. A balance that moved with no line explaining
     * it is the kind of thing that makes somebody think they have been
     * charged for something.
     */
    const after = await db.transaction(async (tx) => {
      const [row] = await tx.update(users)
        .set({ balanceCents: sql`${users.balanceCents} + ${cents}` })
        .where(eq(users.id, id)).returning({ balanceCents: users.balanceCents });
      await tx.insert(novaLedger).values({
        userId: id, kind: "topup", outcome: null, amountCents: cents,
        balanceAfter: row.balanceCents, note: "Added by support",
      } as any);
      return row.balanceCents;
    });

    await log({
      targetUserId: id, targetType: "user", targetId: id,
      previousState: { balanceCents: account.balanceCents },
      resultingState: { balanceCents: after },
      details: { cents },
    });
    return res.json({ ok: true, balance: formatMoney(after), added: formatMoney(cents) });
  }

  if (action === "day_pass" || action === "image_pass") {
    const days = Math.round(Number(req.body?.days ?? 1));
    if (!Number.isFinite(days) || days < 1 || days > MAX_PASS_DAYS) {
      return res.status(400).json({ message: `Between 1 and ${MAX_PASS_DAYS} days.` });
    }
    const column = action === "day_pass" ? users.dayPassUntil : users.imagePassUntil;
    const was = action === "day_pass" ? account.dayPassUntil : account.imagePassUntil;
    /* Extended from now or from whatever is left, whichever is later — a pass on top of a pass adds. */
    const [row] = await db.update(users)
      .set({ [action === "day_pass" ? "dayPassUntil" : "imagePassUntil"]:
        sql`greatest(coalesce(${column}, now()), now()) + make_interval(days => ${days})` } as any)
      .where(eq(users.id, id)).returning({ until: column });

    await log({
      targetUserId: id, targetType: "user", targetId: id,
      previousState: { [action]: was },
      resultingState: { [action]: row.until },
      details: { days },
    });
    return res.json({ ok: true, until: row.until });
  }

  if (action === "reset_allowance") {
    const [row] = await db.update(users)
      .set({ creditsUsed: 0, creditsResetAt: new Date() })
      .where(eq(users.id, id)).returning({ creditsUsed: users.creditsUsed });
    await log({
      targetUserId: id, targetType: "user", targetId: id,
      previousState: { creditsUsed: account.creditsUsed, creditsResetAt: account.creditsResetAt },
      resultingState: { creditsUsed: row.creditsUsed },
    });
    return res.json({ ok: true, used: row.creditsUsed, of: MONTHLY_SMALL_ACTIONS });
  }

  if (action === "verify_email") {
    if (account.emailVerifiedAt) {
      return res.status(409).json({ message: "That address is already verified." });
    }
    const [row] = await db.update(users).set({ emailVerifiedAt: new Date() })
      .where(eq(users.id, id)).returning({ emailVerifiedAt: users.emailVerifiedAt });
    await log({
      targetUserId: id, targetType: "user", targetId: id,
      previousState: { emailVerifiedAt: null },
      resultingState: { emailVerifiedAt: row.emailVerifiedAt },
    });
    return res.json({ ok: true, verifiedAt: row.emailVerifiedAt });
  }

  return res.status(400).json({ message: "That action doesn't apply to an account." });
}

async function actOnProject({ req, res, action, project, log }: {
  req: any; res: Response; action: ConsoleAction; project: typeof projects.$inferSelect; log: Logger;
}) {
  if (action === "build_pass") {
    const [existing] = await db.select().from(novaBuildPasses)
      .where(and(eq(novaBuildPasses.userId, project.ownerId), eq(novaBuildPasses.projectId, project.id)));
    if (existing) return res.status(409).json({ message: "That project already has the build." });

    const [pass] = await db.insert(novaBuildPasses).values({
      userId: project.ownerId, projectId: project.id,
      /* Zero, and honestly so: a granted pass is not revenue and must not read as any. */
      paidCents: 0,
    }).returning();

    await log({
      targetUserId: project.ownerId, targetType: "project", targetId: project.id,
      previousState: { buildPass: null },
      resultingState: { buildPass: pass.id },
      details: { worthCents: OUTCOME_PRICE_CENTS.business },
    });
    return res.json({ ok: true, granted: true });
  }

  if (action === "project_privacy") {
    const isPrivate = req.body?.isPrivate !== false;
    if (isPrivate === project.isPrivate) {
      return res.status(409).json({ message: `That project is already ${isPrivate ? "private" : "public"}.` });
    }
    const [row] = await db.update(projects).set({ isPrivate })
      .where(eq(projects.id, project.id)).returning({ isPrivate: projects.isPrivate });
    await log({
      targetUserId: project.ownerId, targetType: "project", targetId: project.id,
      previousState: { isPrivate: project.isPrivate },
      resultingState: { isPrivate: row.isPrivate },
    });
    return res.json({ ok: true, isPrivate: row.isPrivate });
  }

  if (action === "transfer_project") {
    const toId = String(req.body?.toUserId ?? "");
    if (toId === project.ownerId) return res.status(400).json({ message: "They already own it." });
    const [to] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, toId));
    if (!to) return res.status(404).json({ message: "No such account to move it to." });

    const [row] = await db.update(projects).set({ ownerId: to.id })
      .where(eq(projects.id, project.id)).returning({ ownerId: projects.ownerId });
    await log({
      targetUserId: project.ownerId, targetType: "project", targetId: project.id,
      previousState: { ownerId: project.ownerId },
      resultingState: { ownerId: row.ownerId },
      details: { toUserId: to.id },
    });
    return res.json({ ok: true, ownerId: row.ownerId });
  }

  return res.status(400).json({ message: "That action doesn't apply to a project." });
}

/**
 * Put one action back from the state it recorded.
 *
 * Every branch restores what the log says was there, never what the current
 * code thinks the default is: an undo that "knows" the old value is an undo
 * that is wrong the first time a default changes.
 */
async function restore(action: ConsoleAction, entry: typeof moderationLog.$inferSelect, before: Record<string, any>):
  Promise<{ ok: true; cents?: number } | { ok: false; message: string }> {
  const userId = entry.targetUserId;

  if (action === "credit") {
    const cents = Number((entry.details as any)?.cents ?? 0);
    if (!userId || !Number.isFinite(cents) || cents <= 0) return { ok: false, message: "Nothing to take back." };
    /*
     * Taken back as its own ledger line rather than by rewriting the old one.
     * The customer's statement should show the grant and its reversal, which
     * is what actually happened; a statement that quietly loses a line is the
     * thing people ring up about.
     *
     * Never below zero: somebody may have already spent it, and a negative
     * balance would be a debt this product does not have a concept of.
     */
    const after = await db.transaction(async (tx) => {
      const [row] = await tx.update(users)
        .set({ balanceCents: sql`greatest(0, ${users.balanceCents} - ${cents})` })
        .where(eq(users.id, userId)).returning({ balanceCents: users.balanceCents });
      await tx.insert(novaLedger).values({
        userId, kind: "topup", outcome: null, amountCents: -cents,
        balanceAfter: row.balanceCents, note: "Support grant taken back",
      } as any);
      return row.balanceCents;
    });
    void after;
    return { ok: true, cents };
  }

  if (action === "day_pass" || action === "image_pass") {
    if (!userId) return { ok: false, message: "No account on that entry." };
    const was = before[action] ?? null;
    const column = action === "day_pass" ? "dayPassUntil" : "imagePassUntil";
    await db.update(users).set({ [column]: was ? new Date(was) : null } as any).where(eq(users.id, userId));
    return { ok: true };
  }

  if (action === "reset_allowance") {
    if (!userId) return { ok: false, message: "No account on that entry." };
    await db.update(users).set({
      creditsUsed: Number(before.creditsUsed ?? 0),
      creditsResetAt: before.creditsResetAt ? new Date(before.creditsResetAt) : null,
    }).where(eq(users.id, userId));
    return { ok: true };
  }

  if (action === "verify_email") {
    if (!userId) return { ok: false, message: "No account on that entry." };
    await db.update(users).set({ emailVerifiedAt: before.emailVerifiedAt ? new Date(before.emailVerifiedAt) : null })
      .where(eq(users.id, userId));
    return { ok: true };
  }

  if (action === "build_pass") {
    if (!entry.targetId) return { ok: false, message: "No project on that entry." };
    await db.delete(novaBuildPasses).where(and(
      eq(novaBuildPasses.projectId, entry.targetId),
      eq(novaBuildPasses.userId, userId ?? ""),
    ));
    return { ok: true };
  }

  if (action === "project_privacy") {
    if (!entry.targetId) return { ok: false, message: "No project on that entry." };
    await db.update(projects).set({ isPrivate: !!before.isPrivate }).where(eq(projects.id, entry.targetId));
    return { ok: true };
  }

  if (action === "transfer_project") {
    if (!entry.targetId || !before.ownerId) return { ok: false, message: "No previous owner recorded." };
    await db.update(projects).set({ ownerId: String(before.ownerId) }).where(eq(projects.id, entry.targetId));
    return { ok: true };
  }

  return { ok: false, message: "That action isn't reversible." };
}
