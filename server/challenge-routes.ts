/**
 * Sponsored challenges: a company posts a real problem with a stated prize,
 * founders answer it, and the company shortlists and picks winners.
 *
 * Two sides. The company side lives under /api/companies/:id/challenges and
 * goes through `companyCan`, so a stranger learns nothing (404) and a member
 * without the "run challenges" power can look but not judge (403). The founder side lives under
 * /api/challenges and is open to anyone signed in: a challenge is the one
 * place a company chooses to show up in public.
 *
 * No money moves here. The prize is text the company wrote; the company pays
 * its winners directly under its own terms, which an entrant must accept to
 * enter. See CHALLENGE_DISCLAIMER in shared/challenges.ts.
 *
 * Deadlines are compared in JavaScript, against the Date Drizzle reads back,
 * never against SQL now(): the column has no time zone, and the database's
 * idea of "now" and this process's are one misconfiguration apart.
 */
import type { Express } from "express";
import { and, desc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "./db";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { notify } from "./notifications";
import { companyCan, logCompany } from "./company-access";
import {
  challengeEntries, companies, companyChallenges, companyMembers, projectMembers, projects, userProfiles, users,
  type Company,
} from "@shared/schema";
import {
  acceptsEntries, canAnnounce, canCloseEntries, canEditChallenge, canJudge, effectiveStatus,
  JUDGED_STATUSES, ENTRY_LIMITS, LOCKED_ONCE_ENTERED, resultExcerpt, validateChallenge, validateEntry,
  type EntryStatus,
} from "@shared/challenges";
import { INDUSTRIES, hasPower } from "@shared/companies";
import { CHALLENGE_FEE_CENTS, formatPrize, readPrize } from "@shared/challenges-money";
import { recordPrize, releasePrize, takePrize } from "./challenge-prizes";

type Challenge = typeof companyChallenges.$inferSelect;
type Entry = typeof challengeEntries.$inferSelect;

/** The name a person goes by here. Never their email: the company is a stranger to them until they win. */
const nameOf = (r: { displayName: string | null; firstName: string | null; lastName: string | null }) =>
  r.displayName || [r.firstName, r.lastName].filter(Boolean).join(" ") || "A founder";

const personColumns = {
  displayName: userProfiles.displayName, firstName: users.firstName, lastName: users.lastName,
};

async function challengeOf(companyId: string, challengeId: string): Promise<Challenge | null> {
  const [c] = await db.select().from(companyChallenges)
    .where(and(eq(companyChallenges.id, challengeId), eq(companyChallenges.companyId, companyId)));
  return c ?? null;
}

/** Entries that count, per challenge. A withdrawn entry has left, so it isn't one. */
async function entryCounts(challengeIds: string[]): Promise<Map<string, number>> {
  if (!challengeIds.length) return new Map();
  const rows = await db.select({ id: challengeEntries.challengeId, n: sql<number>`count(*)::int` })
    .from(challengeEntries)
    .where(and(inArray(challengeEntries.challengeId, challengeIds), sql`${challengeEntries.status} <> 'withdrawn'`))
    .groupBy(challengeEntries.challengeId);
  return new Map(rows.map((r) => [r.id, r.n]));
}

async function isProjectMember(userId: string, projectId: string): Promise<boolean> {
  const [p] = await db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, projectId));
  if (!p) return false;
  if (p.ownerId === userId) return true;
  const [m] = await db.select({ id: projectMembers.id }).from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
  return !!m;
}

async function isCompanyMember(companyId: string, userId: string): Promise<boolean> {
  const [m] = await db.select({ userId: companyMembers.userId }).from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));
  return !!m;
}

/** A challenge as a founder sees it: the company's public face, never its members. */
function publicChallenge(c: Challenge, company: Pick<Company, "id" | "name" | "industry" | "website">, now: number) {
  return {
    id: c.id, title: c.title, brief: c.brief, criteria: c.criteria, prize: c.prize, terms: c.terms,
    industry: c.industry, deadline: c.deadline, createdAt: c.createdAt,
    status: effectiveStatus(c, now),
    acceptingEntries: acceptsEntries(c, now),
    company: { id: company.id, name: company.name, industry: company.industry, website: company.website },
  };
}

function myEntryView(e: Entry | undefined) {
  if (!e) return null;
  return {
    id: e.id, title: e.title, pitch: e.pitch, link: e.link, projectId: e.projectId,
    status: e.status, feedback: e.feedback, createdAt: e.createdAt,
  };
}

export function registerChallengeRoutes(app: Express): void {
  /* ---------------- The company's side ---------------- */

  app.get("/api/companies/:id/challenges", isAuthenticated, async (req: any, res) => {
    const access = await companyCan(res, req.params.id, req.user.id, "view");
    if (!access) return;
    const rows = await db.select().from(companyChallenges)
      .where(eq(companyChallenges.companyId, access.company.id))
      .orderBy(desc(companyChallenges.createdAt));
    const counts = await entryCounts(rows.map((r) => r.id));
    const now = Date.now();
    res.json(rows.map((c) => ({
      ...c,
      acceptingEntries: acceptsEntries(c, now),
      entryCount: counts.get(c.id) ?? 0,
    })));
  });

  /**
   * Post one: verified company, fee paid, prize in the safe.
   *
   * Three gates, and each closes a different half of the same hole. Only a
   * company that has proved its domain may post, so a challenge cannot be
   * posted in somebody else's name. It costs $4.99, so posting one is a
   * decision rather than a reflex. And the prize is taken from the balance and
   * held here, so what an entrant is told is "already paid in" rather than
   * "the company says".
   *
   * The money moves in the same transaction as the insert. A challenge whose
   * prize was not taken, or a prize taken for a challenge that was not
   * created, are both worse than a failed request.
   */
  app.post("/api/companies/:id/challenges", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    const access = await companyCan(res, req.params.id, req.user.id, "challenges");
    if (!access) return;

    /*
     * Unverified companies keep everything else — their people, their seasons,
     * their recruiting. What they cannot do is put a challenge in front of
     * strangers, because that is the surface where being able to check who is
     * asking is the whole of the protection.
     */
    if (!access.company.verifiedDomain) {
      return res.status(403).json({
        code: "company_not_verified",
        message: "Only a company that has proved its website can post a challenge. Verify your domain first — it takes a file or a DNS record, and it's what tells entrants you're real.",
      });
    }

    const check = validateChallenge(req.body, Date.now());
    if (!check.ok) return res.status(400).json({ message: check.message });
    const v = check.value;

    const prize = readPrize(req.body?.prizeCents);
    if (!prize.ok) return res.status(400).json({ code: "bad_prize", message: prize.message });

    const now = new Date();
    /*
     * The money first, then the challenge.
     *
     * In that order there is nothing to undo when the balance cannot cover it:
     * the debit is one conditional update that either moved the money or did
     * not, and the insert simply never happens. The alternative — insert, try
     * to charge, roll back — is a rollback path running with real money in the
     * middle of it, which is the one place not to be clever.
     */
    const outcome = await db.transaction(async (tx) => {
      const taken = await takePrize({
        tx, companyId: access.company.id, userId: req.user.id, amountCents: prize.cents, now,
      });
      if (!taken.ok) return { ok: false as const, refused: taken };

      const [created] = await tx.insert(companyChallenges).values({
        companyId: access.company.id, title: v.title!, brief: v.brief!, criteria: v.criteria ?? null,
        /* The words stay for anything the money can't say — "and a call with our CTO". */
        prize: v.prize ?? null, terms: v.terms!, industry: v.industry ?? null, deadline: v.deadline!,
        status: "open", createdBy: req.user.id, createdAt: now,
      }).returning();

      await recordPrize({ tx, challengeId: created.id, companyId: access.company.id, userId: req.user.id, taken, now });
      return { ok: true as const, created, taken };
    });

    if (!outcome.ok) {
      const r = outcome.refused;
      return res.status(402).json({
        code: "insufficient_balance",
        message: r
          ? `Posting this needs ${formatPrize(r.needCents)} — ${formatPrize(CHALLENGE_FEE_CENTS)} to post and ${formatPrize(prize.cents)} held for the prize — and your balance is ${formatPrize(r.haveCents)}. Top up and it goes straight out.`
          : "Posting this needs more than your balance covers. Top up and it goes straight out.",
        needCents: r?.needCents,
        haveCents: r?.haveCents,
      });
    }

    await logCompany(access.company.id, req.user.id, "challenge_posted", null, {
      challengeId: outcome.created.id, title: outcome.created.title,
      prizeCents: prize.cents, feeCents: outcome.taken.feeCents,
    });
    res.status(201).json({
      ...outcome.created,
      acceptingEntries: true, entryCount: 0,
      prize: { amountCents: prize.cents, state: "held" },
      paid: { feeCents: outcome.taken.feeCents, prizeHeldCents: prize.cents },
    });
  });

  app.patch("/api/companies/:id/challenges/:cid", isAuthenticated, rateLimit("write"), async (req: any, res) => {
    const access = await companyCan(res, req.params.id, req.user.id, "challenges");
    if (!access) return;
    const c = await challengeOf(access.company.id, req.params.cid);
    if (!c) return res.status(404).json({ message: "No such challenge." });
    if (!canEditChallenge(c.status)) return res.status(409).json({ message: "A challenge can only be changed while it's open." });
    const check = validateChallenge(req.body ?? {}, Date.now(), { partial: true });
    if (!check.ok) return res.status(400).json({ message: check.message });
    const changes = check.value;
    const now = Date.now();
    const movesDeadline = "deadline" in changes && changes.deadline && new Date(changes.deadline).getTime() !== c.deadline.getTime();
    // Once the deadline has passed, entries are closed; moving it would quietly reopen them.
    if (movesDeadline && c.deadline.getTime() <= now) {
      return res.status(409).json({ message: "The deadline has passed, so it can't be moved.", code: "deadline_passed" });
    }
    const [anyEntry] = await db.select({ id: challengeEntries.id }).from(challengeEntries).where(eq(challengeEntries.challengeId, c.id)).limit(1);
    if (anyEntry) {
      /*
       * People entered against what the challenge said. What they answered
       * (brief, criteria) and what they were promised (terms, prize) hold
       * still; the only change allowed is more time.
       */
      const locked = [...LOCKED_ONCE_ENTERED, "brief", "criteria"] as const;
      if (locked.some((k) => k in changes && (changes as any)[k] !== (c as any)[k])) {
        return res.status(409).json({ message: "People have entered against this brief, these terms and this prize, so they can't change now.", code: "locked" });
      }
      if (movesDeadline && new Date(changes.deadline!).getTime() < c.deadline.getTime()) {
        return res.status(409).json({ message: "People have entered, so the deadline can be extended but not brought forward.", code: "locked" });
      }
    }
    if (!Object.keys(changes).length) return res.json(c);
    const [updated] = await db.update(companyChallenges).set(changes)
      .where(and(eq(companyChallenges.id, c.id), eq(companyChallenges.status, "open"))).returning();
    if (!updated) return res.status(409).json({ message: "A challenge can only be changed while it's open." });
    res.json(updated);
  });

  app.post("/api/companies/:id/challenges/:cid/close-entries", isAuthenticated, rateLimit("write"), async (req: any, res) => {
    const access = await companyCan(res, req.params.id, req.user.id, "challenges");
    if (!access) return;
    const c = await challengeOf(access.company.id, req.params.cid);
    if (!c) return res.status(404).json({ message: "No such challenge." });
    if (!canCloseEntries(c.status)) return res.status(409).json({ message: "Entries are already closed." });
    // Conditional on the status, so two admins pressing at once move it once.
    const [updated] = await db.update(companyChallenges).set({ status: "judging" })
      .where(and(eq(companyChallenges.id, c.id), eq(companyChallenges.status, "open"))).returning();
    if (!updated) return res.status(409).json({ message: "Entries are already closed." });
    res.json(updated);
  });

  app.get("/api/companies/:id/challenges/:cid/entries", isAuthenticated, async (req: any, res) => {
    const access = await companyCan(res, req.params.id, req.user.id, "view");
    if (!access) return;
    const c = await challengeOf(access.company.id, req.params.cid);
    if (!c) return res.status(404).json({ message: "No such challenge." });
    const rows = await db.select({
      entry: challengeEntries, projectTitle: projects.title, ...personColumns,
    }).from(challengeEntries)
      .innerJoin(users, eq(users.id, challengeEntries.userId))
      .leftJoin(userProfiles, eq(userProfiles.userId, challengeEntries.userId))
      .leftJoin(projects, eq(projects.id, challengeEntries.projectId))
      .where(eq(challengeEntries.challengeId, c.id))
      .orderBy(challengeEntries.createdAt);
    res.json(rows.map((r) => ({
      ...r.entry,
      entrantName: nameOf(r),
      project: r.entry.projectId ? { id: r.entry.projectId, title: r.projectTitle, href: `/projects/${r.entry.projectId}` } : null,
    })));
  });

  app.post("/api/companies/:id/challenges/:cid/entries/:eid/status", isAuthenticated, rateLimit("write"), async (req: any, res) => {
    const access = await companyCan(res, req.params.id, req.user.id, "challenges");
    if (!access) return;
    const c = await challengeOf(access.company.id, req.params.cid);
    if (!c) return res.status(404).json({ message: "No such challenge." });
    if (!canJudge(c.status)) {
      return res.status(409).json({ message: c.status === "open" ? "Close entries before judging them." : "The results are already out." });
    }
    const status = req.body?.status;
    if (!(JUDGED_STATUSES as readonly string[]).includes(status)) {
      return res.status(400).json({ message: "Status has to be shortlisted or winner." });
    }
    const set: Partial<Entry> = { status };
    if (req.body && "feedback" in req.body) {
      const fb = typeof req.body.feedback === "string" ? req.body.feedback.trim() : "";
      if (fb.length > ENTRY_LIMITS.feedback.max) return res.status(400).json({ message: `Feedback can be at most ${ENTRY_LIMITS.feedback.max} characters.` });
      set.feedback = fb || null;
    }
    const [entry] = await db.select().from(challengeEntries)
      .where(and(eq(challengeEntries.id, req.params.eid), eq(challengeEntries.challengeId, c.id)));
    if (!entry) return res.status(404).json({ message: "No such entry." });
    if (entry.status === "withdrawn") return res.status(409).json({ message: "That entry was withdrawn." });
    const [updated] = await db.update(challengeEntries).set(set).where(eq(challengeEntries.id, entry.id)).returning();

    /*
     * Naming a winner pays the prize, there and then.
     *
     * Not on announce, and not on a nightly job: the moment a company says who
     * won is the moment the money should be theirs, and anything later is a
     * window in which a company can name a winner and quietly unname them.
     * `releasePrize` moves the row out of `held` in the same statement it
     * reads, so two judges clicking at once cannot pay it twice — and a second
     * winner named afterwards finds nothing left to release, which is the
     * honest outcome rather than a second payout.
     */
    let paid: { amountCents: number } | null = null;
    if (status === "winner") {
      const released = await releasePrize({
        challengeId: c.id, exit: "awarded", toUserId: entry.userId, now: new Date(),
      });
      if (released) {
        paid = { amountCents: released.amountCents };
        await logCompany(access.company.id, req.user.id, "challenge_prize_awarded", entry.userId, {
          challengeId: c.id, entryId: entry.id, amountCents: released.amountCents,
        });
        /*
         * The existing "news on your entry" kind, rather than a new one: the
         * announcement below already uses it, and the money is the news. The
         * excerpt is what the person reads, so it says the amount.
         */
        await notify({
          recipients: [entry.userId], actorId: req.user.id, kind: "challenge_result",
          targetId: `${c.id}:${entry.id}`, projectId: entry.projectId,
          excerpt: `${access.company.name} picked your entry to "${c.title}". ${formatPrize(released.amountCents)} is on your balance.`,
        }).catch(() => {});
      }
    }

    res.json({ ...updated, prizePaid: paid });
  });

  app.post("/api/companies/:id/challenges/:cid/announce", isAuthenticated, rateLimit("write"), async (req: any, res) => {
    const access = await companyCan(res, req.params.id, req.user.id, "challenges");
    if (!access) return;
    const c = await challengeOf(access.company.id, req.params.cid);
    if (!c) return res.status(404).json({ message: "No such challenge." });
    if (!canAnnounce(c.status)) {
      return res.status(409).json({ message: c.status === "open" ? "Close entries and judge them before announcing." : "The results are already out." });
    }
    const [updated] = await db.update(companyChallenges).set({ status: "closed" })
      .where(and(eq(companyChallenges.id, c.id), eq(companyChallenges.status, "judging"))).returning();
    if (!updated) return res.status(409).json({ message: "The results are already out." });

    /*
     * Everyone who is still in hears their own result, one notification each,
     * because each one says something different. Someone who withdrew left
     * before the judging and isn't told how it went.
     */
    const entries = await db.select().from(challengeEntries)
      .where(and(eq(challengeEntries.challengeId, c.id), sql`${challengeEntries.status} <> 'withdrawn'`));
    await Promise.all(entries.map((e) => notify({
      recipients: [e.userId], actorId: req.user.id, kind: "challenge_result",
      targetId: `${c.id}:${e.id}`, excerpt: resultExcerpt(access.company.name, c.title, e.status as EntryStatus),
      projectId: e.projectId,
    })));
    /*
     * Nobody won: the prize goes back.
     *
     * Announcing is the end of the challenge, so it is the moment the money
     * has to stop being held — a prize that sat in the safe after the results
     * were out would be the company's money held for nothing, which is the
     * mirror image of the problem this whole mechanism exists to fix.
     * `releasePrize` finds nothing to move when a winner was already paid, so
     * this is safe either way.
     */
    const returned = await releasePrize({ challengeId: c.id, exit: "refunded", now: new Date() });
    if (returned) {
      await logCompany(access.company.id, req.user.id, "challenge_prize_refunded", null, {
        challengeId: c.id, amountCents: returned.amountCents,
      });
    }

    await logCompany(access.company.id, req.user.id, "challenge_announced", null, { challengeId: c.id, title: c.title, notified: entries.length });
    res.json({ ...updated, notified: entries.length });
  });

  /* ---------------- The founder's side ---------------- */

  app.get("/api/challenges", isAuthenticated, async (req: any, res) => {
    const now = Date.now();
    const industry = typeof req.query.industry === "string" && (INDUSTRIES as readonly string[]).includes(req.query.industry) ? req.query.industry : null;
    const wanted = ["open", "judging", "closed"].includes(req.query.status) ? req.query.status as string : "open";
    /*
     * An open challenge past its deadline is filed under judging for a
     * founder. That is decided in the query, against a JS Date, not after it:
     * filtering in JavaScript after `limit 200` let expired rows fill the page
     * and crowd out live ones. The JS filter below stays as a second check.
     */
    const nowDate = new Date(now);
    const byStatus = wanted === "open"
      ? and(eq(companyChallenges.status, "open"), gt(companyChallenges.deadline, nowDate))
      : wanted === "judging"
        ? or(eq(companyChallenges.status, "judging"), and(eq(companyChallenges.status, "open"), lte(companyChallenges.deadline, nowDate)))
        : eq(companyChallenges.status, "closed");
    const conds = [byStatus!];
    if (industry) conds.push(eq(companyChallenges.industry, industry));
    const rows = await db.select({ c: companyChallenges, company: { id: companies.id, name: companies.name, industry: companies.industry, website: companies.website } })
      .from(companyChallenges)
      .innerJoin(companies, eq(companies.id, companyChallenges.companyId))
      .where(and(...conds))
      .orderBy(companyChallenges.deadline)
      .limit(200);
    const visible = rows.filter((r) => effectiveStatus(r.c, now) === wanted);
    const ids = visible.map((r) => r.c.id);
    const counts = await entryCounts(ids);
    const mine = ids.length
      ? await db.select({ challengeId: challengeEntries.challengeId, status: challengeEntries.status }).from(challengeEntries)
        .where(and(inArray(challengeEntries.challengeId, ids), eq(challengeEntries.userId, req.user.id)))
      : [];
    const myStatus = new Map(mine.map((m) => [m.challengeId, m.status]));
    res.json(visible.map((r) => {
      const { terms: _terms, ...pub } = publicChallenge(r.c, r.company, now);
      const s = myStatus.get(r.c.id);
      return {
        ...pub,
        entryCount: counts.get(r.c.id) ?? 0,
        entered: !!s && s !== "withdrawn",
        myEntryStatus: s ?? null,
      };
    }));
  });

  app.get("/api/challenges/:cid", isAuthenticated, async (req: any, res) => {
    const now = Date.now();
    const [row] = await db.select({ c: companyChallenges, company: { id: companies.id, name: companies.name, industry: companies.industry, website: companies.website } })
      .from(companyChallenges)
      .innerJoin(companies, eq(companies.id, companyChallenges.companyId))
      .where(eq(companyChallenges.id, req.params.cid));
    if (!row) return res.status(404).json({ message: "No such challenge." });
    const [[mine], counts, sponsorMember] = await Promise.all([
      db.select().from(challengeEntries).where(and(eq(challengeEntries.challengeId, row.c.id), eq(challengeEntries.userId, req.user.id))),
      entryCounts([row.c.id]),
      isCompanyMember(row.c.companyId, req.user.id),
    ]);
    // Winners are public once announced — that's the point of announcing — but never before.
    let winners: { entryId: string; title: string; entrantName: string; link: string | null; project: { id: string; title: string | null } | null }[] = [];
    if (row.c.status === "closed") {
      const w = await db.select({ entry: challengeEntries, projectTitle: projects.title, projectPrivate: projects.isPrivate, ...personColumns })
        .from(challengeEntries)
        .innerJoin(users, eq(users.id, challengeEntries.userId))
        .leftJoin(userProfiles, eq(userProfiles.userId, challengeEntries.userId))
        .leftJoin(projects, eq(projects.id, challengeEntries.projectId))
        .where(and(eq(challengeEntries.challengeId, row.c.id), eq(challengeEntries.status, "winner")));
      winners = w.map((r) => ({
        entryId: r.entry.id, title: r.entry.title, entrantName: nameOf(r), link: r.entry.link,
        // A private project stays private even when it wins: this page is public, and the company alone was shown it.
        project: r.entry.projectId && r.projectPrivate === false ? { id: r.entry.projectId, title: r.projectTitle } : null,
      }));
    }
    res.json({
      ...publicChallenge(row.c, row.company, now),
      entryCount: counts.get(row.c.id) ?? 0,
      myEntry: myEntryView(mine),
      isSponsor: sponsorMember,
      winners,
    });
  });

  app.post("/api/challenges/:cid/enter", isAuthenticated, rateLimit("apply"), async (req: any, res) => {
    const userId: string = req.user.id;
    const [c] = await db.select().from(companyChallenges).where(eq(companyChallenges.id, req.params.cid));
    if (!c) return res.status(404).json({ message: "No such challenge." });
    if (!acceptsEntries(c, Date.now())) return res.status(409).json({ message: "This challenge isn't taking entries any more.", code: "closed" });
    // Somebody judging the challenge can't also be in it.
    if (await isCompanyMember(c.companyId, userId)) {
      return res.status(403).json({ message: "People at the sponsoring company can't enter its challenge.", code: "sponsor" });
    }
    if (req.body?.acceptTerms !== true) {
      return res.status(400).json({ message: "To enter, accept the company's terms for this challenge.", code: "terms" });
    }
    const check = validateEntry(req.body);
    if (!check.ok) return res.status(400).json({ message: check.message });
    const v = check.value;
    if (v.projectId && !(await isProjectMember(userId, v.projectId))) {
      return res.status(403).json({ message: "You can only enter with a project you're part of." });
    }

    const [existing] = await db.select().from(challengeEntries)
      .where(and(eq(challengeEntries.challengeId, c.id), eq(challengeEntries.userId, userId)));
    let entry: Entry | undefined;
    if (existing && existing.status !== "withdrawn") {
      return res.status(409).json({ message: "You've already entered. You can edit your entry instead.", code: "already_entered" });
    } else if (existing) {
      // Coming back after withdrawing: the same row, entered again under the terms just accepted.
      [entry] = await db.update(challengeEntries).set({
        title: v.title!, pitch: v.pitch!, link: v.link ?? null, projectId: v.projectId ?? null,
        status: "entered", feedback: null, createdAt: new Date(),
      }).where(and(eq(challengeEntries.id, existing.id), eq(challengeEntries.status, "withdrawn"))).returning();
      if (!entry) return res.status(409).json({ message: "You've already entered.", code: "already_entered" });
    } else {
      try {
        [entry] = await db.insert(challengeEntries).values({
          challengeId: c.id, userId, title: v.title!, pitch: v.pitch!, link: v.link ?? null,
          projectId: v.projectId ?? null, status: "entered", createdAt: new Date(),
        }).returning();
      } catch (err: any) {
        // Two submits at once: the unique (challenge, user) key keeps it to one.
        if (err?.code === "23505" || err?.cause?.code === "23505") {
          return res.status(409).json({ message: "You've already entered.", code: "already_entered" });
        }
        throw err;
      }
    }

    // Whoever judges hears about it: the leaders, and any member given the "run challenges" power.
    const team = await db.select({ userId: companyMembers.userId, role: companyMembers.role, permissions: companyMembers.permissions })
      .from(companyMembers).where(eq(companyMembers.companyId, c.companyId));
    void notify({
      recipients: team.filter((m) => hasPower(m, "challenges")).map((m) => m.userId), actorId: userId, kind: "challenge_entry",
      targetId: `${c.companyId}:${entry.id}`, excerpt: c.title,
    });
    res.status(201).json(myEntryView(entry));
  });

  app.patch("/api/challenges/:cid/entry", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    const userId: string = req.user.id;
    const [c] = await db.select().from(companyChallenges).where(eq(companyChallenges.id, req.params.cid));
    if (!c) return res.status(404).json({ message: "No such challenge." });
    const [mine] = await db.select().from(challengeEntries)
      .where(and(eq(challengeEntries.challengeId, c.id), eq(challengeEntries.userId, userId)));
    if (!mine || mine.status === "withdrawn") return res.status(404).json({ message: "You haven't entered this challenge." });
    if (!acceptsEntries(c, Date.now())) return res.status(409).json({ message: "Entries are closed, so yours can't change now.", code: "closed" });
    const check = validateEntry(req.body ?? {}, { partial: true });
    if (!check.ok) return res.status(400).json({ message: check.message });
    const v = check.value;
    if (v.projectId && !(await isProjectMember(userId, v.projectId))) {
      return res.status(403).json({ message: "You can only enter with a project you're part of." });
    }
    if (!Object.keys(v).length) return res.json(myEntryView(mine));
    const [updated] = await db.update(challengeEntries).set(v).where(eq(challengeEntries.id, mine.id)).returning();
    res.json(myEntryView(updated));
  });

  app.delete("/api/challenges/:cid/entry", isAuthenticated, rateLimit("write"), async (req: any, res) => {
    const userId: string = req.user.id;
    const [c] = await db.select().from(companyChallenges).where(eq(companyChallenges.id, req.params.cid));
    if (!c) return res.status(404).json({ message: "No such challenge." });
    const [mine] = await db.select().from(challengeEntries)
      .where(and(eq(challengeEntries.challengeId, c.id), eq(challengeEntries.userId, userId)));
    if (!mine || mine.status === "withdrawn") return res.status(404).json({ message: "You haven't entered this challenge." });
    // After the results are out, a withdrawal would quietly rewrite who won.
    if (c.status === "closed") return res.status(409).json({ message: "The results are out, so the entry stays." });
    const [updated] = await db.update(challengeEntries).set({ status: "withdrawn" }).where(eq(challengeEntries.id, mine.id)).returning();
    res.json(myEntryView(updated));
  });
}
