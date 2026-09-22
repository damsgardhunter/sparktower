/**
 * Recruiting from track records.
 *
 * A company comes here to find people who have *shown* commercial judgement —
 * who sat as finance chief through fourteen years of a simulated market and
 * kept the company alive — rather than people who say they have it. The
 * record is the whole value, and it is also the thing a person must be able
 * to keep to themselves. So:
 *
 *  - Nobody is visible until they switch their profile open. A person who has
 *    not is not "hidden" from a company's search; as far as the company can
 *    tell, they do not exist (404 on their page, absent from every list).
 *  - What a company sees is exactly what the person sees on /talent as their
 *    preview. There is no second, richer view.
 *  - Private training seasons are never part of anybody's record.
 *
 * Two sides share this file: the person's (/api/talent/...) and the
 * company's (/api/companies/:id/talent...).
 */
import type { Express } from "express";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "./db";
import {
  talentProfiles, recruitInvites, companies, companyMembers, users, userProfiles, connections, directMessages,
  simSeats, simVentures, simSeasons, simDecisions, simReports, simChallenges,
  startupGames, startupGameVerdicts,
} from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { notify } from "./notifications";
import { feedDisplayName } from "./feed-routes";
import { companyCan, logCompany } from "./company-access";
import { nicheById } from "@shared/simulation/niches";
import { hasPower } from "@shared/companies";
import {
  buildTrackRecord, summaryOf, ROLE_FOR_SEAT, type SeatPlay, type GamePlay, type TrackRecord,
} from "@shared/track-record";
import type { Role } from "@shared/simulation/types";

const MESSAGE_MIN = 20;
const MESSAGE_MAX = 800;

/**
 * Everybody's records at once, for a search.
 *
 * Six queries however many people are asked about, rather than six per
 * person: a company scrolling fifty candidates should not be fifty round
 * trips of five queries each.
 */
export async function loadTrackRecords(userIds: string[]): Promise<Map<string, TrackRecord>> {
  const ids = [...new Set(userIds)];
  const out = new Map<string, TrackRecord>();
  if (ids.length === 0) return out;

  // Public seasons only. `companyId` set means a company's private training season.
  const seats = await db
    .select({
      userId: simSeats.userId, ventureId: simSeats.ventureId, role: simSeats.role,
      seasonId: simSeasons.id, seasonName: simSeasons.name, nicheId: simSeasons.nicheId, status: simSeasons.status,
      createdAt: simSeasons.createdAt,
    })
    .from(simSeats)
    .innerJoin(simVentures, eq(simVentures.id, simSeats.ventureId))
    .innerJoin(simSeasons, eq(simSeasons.id, simVentures.seasonId))
    .where(and(inArray(simSeats.userId, ids), isNull(simSeasons.companyId)))
    .orderBy(desc(simSeasons.createdAt));

  const ventureIds = [...new Set(seats.map((s) => s.ventureId))];
  const seasonIds = [...new Set(seats.map((s) => s.seasonId))];

  const reports = ventureIds.length
    ? await db.select({
        ventureId: simReports.ventureId, seasonId: simReports.seasonId, year: simReports.year,
        rank: sql<number | null>`(${simReports.report}->>'rank')::int`,
      }).from(simReports).where(inArray(simReports.ventureId, ventureIds))
    : [];
  // How many companies stood in each market each year — incumbents included, as on the league table.
  const fields = seasonIds.length
    ? await db.select({ seasonId: simReports.seasonId, year: simReports.year, n: sql<number>`count(*)::int` })
        .from(simReports).where(inArray(simReports.seasonId, seasonIds))
        .groupBy(simReports.seasonId, simReports.year)
    : [];
  const decisions = ventureIds.length
    ? await db.selectDistinct({ ventureId: simDecisions.ventureId, userId: simDecisions.userId, year: simDecisions.year })
        .from(simDecisions).where(and(inArray(simDecisions.ventureId, ventureIds), inArray(simDecisions.userId, ids)))
    : [];
  const challenges = ventureIds.length
    ? await db.select({ ventureId: simChallenges.ventureId, userId: simChallenges.userId, outcome: simChallenges.outcome })
        .from(simChallenges).where(and(inArray(simChallenges.ventureId, ventureIds), inArray(simChallenges.userId, ids)))
    : [];
  // Only verdicts the model actually gave: a fallback is a placeholder, and a placeholder that counts is a lie.
  const games = await db
    .select({ p1: startupGames.player1Id, p2: startupGames.player2Id, overall: startupGameVerdicts.overall })
    .from(startupGameVerdicts)
    .innerJoin(startupGames, eq(startupGames.id, startupGameVerdicts.gameId))
    .where(and(eq(startupGameVerdicts.fromModel, true), or(inArray(startupGames.player1Id, ids), inArray(startupGames.player2Id, ids))));

  const fieldAt = new Map(fields.map((f) => [`${f.seasonId}:${f.year}`, f.n]));
  const reportsBy = new Map<string, typeof reports>();
  for (const r of reports) {
    if (!r.ventureId) continue;
    reportsBy.set(r.ventureId, [...(reportsBy.get(r.ventureId) ?? []), r]);
  }

  const plays = new Map<string, SeatPlay[]>();
  for (const s of seats) {
    const own = reportsBy.get(s.ventureId) ?? [];
    const resolved = new Set(own.map((r) => r.year));
    const last = [...own].sort((a, b) => b.year - a.year)[0];
    // Only years that resolved count as filed; a decision for the year still open is not turnout yet.
    const filed = new Set(decisions.filter((d) => d.ventureId === s.ventureId && d.userId === s.userId && resolved.has(d.year)).map((d) => d.year));
    const mine = challenges.filter((c) => c.ventureId === s.ventureId && c.userId === s.userId);
    const play: SeatPlay = {
      seasonId: s.seasonId,
      seasonName: s.seasonName,
      nicheName: nicheById(s.nicheId)?.name ?? null,
      seasonStatus: s.status,
      role: s.role,
      yearsPlayed: resolved.size,
      yearsFiled: filed.size,
      rank: last?.rank ?? null,
      fieldSize: last ? fieldAt.get(`${last.seasonId}:${last.year}`) ?? null : null,
      objectives: {
        met: mine.filter((c) => c.outcome === "met").length,
        partial: mine.filter((c) => c.outcome === "partial").length,
        missed: mine.filter((c) => c.outcome === "missed").length,
      },
    };
    plays.set(s.userId, [...(plays.get(s.userId) ?? []), play]);
  }

  for (const id of ids) {
    const theirGames: GamePlay[] = games.filter((g) => g.p1 === id || g.p2 === id).map((g) => ({ overall: g.overall }));
    out.set(id, buildTrackRecord(plays.get(id) ?? [], theirGames));
  }
  return out;
}

export async function loadTrackRecord(userId: string): Promise<TrackRecord> {
  return (await loadTrackRecords([userId])).get(userId)!;
}

/** What a person's profile says, with the defaults a person who never opened /talent has. */
function profileShape(row: typeof talentProfiles.$inferSelect | undefined) {
  return {
    open: row?.open ?? false,
    headline: row?.headline ?? null,
    roles: row?.roles ?? [],
    location: row?.location ?? null,
    remote: row?.remote ?? true,
    updatedAt: row?.updatedAt ?? null,
  };
}

/**
 * An open profile, joined to a live, human account — or nothing.
 *
 * Suspended accounts and bots are left out of every company-side read: a
 * suspended person cannot answer, and a bot has no one to hire.
 */
async function openCandidates(filter?: { userId?: string }) {
  return db
    .select({
      profile: talentProfiles,
      firstName: users.firstName, lastName: users.lastName,
      displayName: userProfiles.displayName, avatarUrl: userProfiles.avatarUrl, profileImageUrl: users.profileImageUrl,
    })
    .from(talentProfiles)
    .innerJoin(users, eq(users.id, talentProfiles.userId))
    .leftJoin(userProfiles, eq(userProfiles.userId, talentProfiles.userId))
    .where(and(
      eq(talentProfiles.open, true), isNull(users.suspendedAt), eq(users.isBot, false),
      filter?.userId ? eq(talentProfiles.userId, filter.userId) : undefined,
    ));
}

type Candidate = Awaited<ReturnType<typeof openCandidates>>[number];

const nameOf = (c: { firstName: string | null; lastName: string | null; displayName: string | null }) =>
  feedDisplayName({ firstName: c.firstName, lastName: c.lastName }, { displayName: c.displayName });

function candidateShape(c: Candidate) {
  return {
    userId: c.profile.userId,
    name: nameOf(c),
    avatarUrl: c.avatarUrl || c.profileImageUrl || null,
    headline: c.profile.headline,
    roles: c.profile.roles ?? [],
    location: c.profile.location,
    remote: c.profile.remote,
  };
}

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

export function registerTalentRoutes(app: Express): void {
  // ─── The person's side ─────────────────────────────────────────────────────

  /** My profile and the record a company would see if I opened it. */
  app.get("/api/talent/me", isAuthenticated, async (req: any, res) => {
    const me = req.user.id as string;
    const [row] = await db.select().from(talentProfiles).where(eq(talentProfiles.userId, me));
    res.json({ profile: profileShape(row), record: await loadTrackRecord(me) });
  });

  app.put("/api/talent/me", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    const me = req.user.id as string;
    const body = req.body ?? {};
    const [existing] = await db.select().from(talentProfiles).where(eq(talentProfiles.userId, me));
    const current = profileShape(existing);

    if (body.open !== undefined && typeof body.open !== "boolean") return res.status(400).json({ message: "open is yes or no.", field: "open" });
    if (body.remote !== undefined && typeof body.remote !== "boolean") return res.status(400).json({ message: "remote is yes or no.", field: "remote" });
    if (body.roles !== undefined && !Array.isArray(body.roles)) return res.status(400).json({ message: "roles is a list.", field: "roles" });

    const roles = body.roles !== undefined
      ? [...new Set((body.roles as unknown[]).map((r) => clean(r, 40)?.toLowerCase()).filter((r): r is string => !!r))].slice(0, 8)
      : current.roles;
    const next = {
      open: body.open ?? current.open,
      headline: body.headline !== undefined ? clean(body.headline, 140) : current.headline,
      roles,
      location: body.location !== undefined ? clean(body.location, 80) : current.location,
      remote: body.remote ?? current.remote,
      updatedAt: new Date(),
    };
    const [row] = await db.insert(talentProfiles).values({ userId: me, ...next })
      .onConflictDoUpdate({ target: talentProfiles.userId, set: next })
      .returning();
    res.json({ profile: profileShape(row) });
  });

  /** Companies that asked me to talk. */
  app.get("/api/talent/invites", isAuthenticated, async (req: any, res) => {
    const rows = await db
      .select({
        invite: recruitInvites,
        company: { id: companies.id, name: companies.name, slug: companies.slug, industry: companies.industry, website: companies.website, size: companies.size },
      })
      .from(recruitInvites)
      .innerJoin(companies, eq(companies.id, recruitInvites.companyId))
      .where(eq(recruitInvites.userId, req.user.id))
      .orderBy(desc(recruitInvites.createdAt));
    res.json({
      invites: rows.map((r) => ({
        id: r.invite.id, role: r.invite.role, message: r.invite.message, status: r.invite.status,
        createdAt: r.invite.createdAt, answeredAt: r.invite.answeredAt, sentBy: r.invite.sentBy,
        company: r.company,
      })),
    });
  });

  /**
   * Yes or no.
   *
   * A yes tells the person who asked, and opens a direct conversation between
   * the two with the company's message as its first line — direct messages
   * need an accepted connection, and saying yes to talking is exactly that.
   * A no tells nobody; the company sees it on its list of sent invitations,
   * which is enough, and a notification saying "declined" is a small unkindness
   * with no use.
   */
  app.post("/api/talent/invites/:id/answer", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    const me = req.user.id as string;
    if (typeof req.body?.accept !== "boolean") return res.status(400).json({ message: "Say yes or no.", field: "accept" });
    const accept = req.body.accept as boolean;

    const [invite] = await db.select().from(recruitInvites).where(and(eq(recruitInvites.id, req.params.id), eq(recruitInvites.userId, me)));
    if (!invite) return res.status(404).json({ message: "No such invitation." });
    if (invite.status !== "sent") return res.status(409).json({ message: "You've already answered this one.", code: "already_answered" });

    // Conditional on still being unanswered, so two taps can't both win.
    const [answered] = await db.update(recruitInvites)
      .set({ status: accept ? "accepted" : "declined", answeredAt: new Date() })
      .where(and(eq(recruitInvites.id, invite.id), eq(recruitInvites.status, "sent")))
      .returning();
    if (!answered) return res.status(409).json({ message: "You've already answered this one.", code: "already_answered" });

    let conversationWith: string | null = null;
    if (accept) {
      const [company] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, invite.companyId));
      const [meRow] = await db.select({ firstName: users.firstName, lastName: users.lastName, displayName: userProfiles.displayName })
        .from(users).leftJoin(userProfiles, eq(userProfiles.userId, users.id)).where(eq(users.id, me));
      /*
       * The person who asked, or — if their account has since gone — someone
       * at the company who recruits, so a yes never lands on nobody.
       */
      let contact = invite.sentBy;
      if (!contact) {
        const team = await db.select({ userId: companyMembers.userId, role: companyMembers.role, permissions: companyMembers.permissions })
          .from(companyMembers).where(eq(companyMembers.companyId, invite.companyId)).orderBy(asc(companyMembers.joinedAt));
        const order = { owner: 0, admin: 1, member: 2 } as const;
        contact = team.filter((m) => hasPower(m, "recruit")).sort((a, b) => order[a.role] - order[b.role])[0]?.userId ?? null;
      }
      await notify({
        recipients: [contact], actorId: me, kind: "recruit_answer",
        targetId: `${invite.companyId}:${invite.id}`,
        excerpt: `${meRow ? nameOf(meRow) : "They"} would like to talk${company ? ` with ${company.name}` : ""}. Your conversation is open in Messages.`,
      });
      try {
        if (contact) {
          await openConversation(contact, me, `${company?.name ?? "Our company"}: ${invite.message}`);
          conversationWith = contact;
        }
      } catch (err) {
        // The answer stands either way; the notification already tells them.
        console.error("[talent] couldn't open the conversation (non-fatal):", err);
      }
    }
    res.json({ invite: answered, conversationWith });
  });

  // ─── The company's side ────────────────────────────────────────────────────

  /**
   * Open profiles, strongest record first.
   *
   * Filters: `role` matches what they said they would take or a seat they have
   * held; `minSeasons` is seasons actually played; `q` is words in their name,
   * headline, location or roles.
   */
  app.get("/api/companies/:id/talent", isAuthenticated, async (req: any, res) => {
    const found = await companyCan(res, req.params.id, req.user.id, "view");
    if (!found) return;

    const role = clean(req.query.role, 40)?.toLowerCase() ?? null;
    const minSeasons = Math.max(0, Math.min(50, Number(req.query.minSeasons) || 0));
    const q = clean(req.query.q, 80)?.toLowerCase() ?? null;

    const candidates = await openCandidates();
    const records = await loadTrackRecords(candidates.map((c) => c.profile.userId));
    const invites = await db.select({ userId: recruitInvites.userId, status: recruitInvites.status })
      .from(recruitInvites).where(eq(recruitInvites.companyId, found.company.id));
    const inviteOf = new Map(invites.map((i) => [i.userId, i.status]));

    const list = candidates
      .map((c) => ({ c, record: records.get(c.profile.userId)! }))
      .filter(({ c, record }) => {
        if (record.seasonsPlayed < minSeasons) return false;
        if (role) {
          const said = (c.profile.roles ?? []).some((r) => r.toLowerCase().includes(role));
          const sat = record.seats.some((s) => ROLE_FOR_SEAT[s.role as Role].includes(role) || s.role === role);
          if (!said && !sat) return false;
        }
        if (q) {
          const hay = [nameOf(c), c.profile.headline, c.profile.location, ...(c.profile.roles ?? [])].filter(Boolean).join(" ").toLowerCase();
          if (!q.split(" ").every((w) => hay.includes(w))) return false;
        }
        return true;
      })
      .sort((a, b) => b.record.score - a.record.score)
      .slice(0, 60)
      .map(({ c, record }) => ({ ...candidateShape(c), record: summaryOf(record), invite: inviteOf.get(c.profile.userId) ?? null }));

    res.json({ candidates: list });
  });

  /** One candidate, whole. A closed profile is a 404, the same as no profile at all. */
  app.get("/api/companies/:id/talent/:userId", isAuthenticated, async (req: any, res) => {
    const found = await companyCan(res, req.params.id, req.user.id, "view");
    if (!found) return;
    const [c] = await openCandidates({ userId: req.params.userId });
    if (!c) return res.status(404).json({ message: "Nobody by that name is open to companies." });
    const [invite] = await db.select().from(recruitInvites)
      .where(and(eq(recruitInvites.companyId, found.company.id), eq(recruitInvites.userId, c.profile.userId)));
    res.json({
      ...candidateShape(c),
      record: await loadTrackRecord(c.profile.userId),
      invite: invite ? { id: invite.id, status: invite.status, role: invite.role, createdAt: invite.createdAt, answeredAt: invite.answeredAt } : null,
    });
  });

  /**
   * Ask somebody to talk. Once per company per person, ever: a person who said
   * no, or has not answered, should not hear from the same company again
   * because someone else there tried.
   */
  app.post("/api/companies/:id/talent/:userId/invite", isAuthenticated, rateLimit("invite"), async (req: any, res) => {
    const found = await companyCan(res, req.params.id, req.user.id, "recruit");
    if (!found) return;
    const { company } = found;
    const [c] = await openCandidates({ userId: req.params.userId });
    if (!c) return res.status(404).json({ message: "Nobody by that name is open to companies." });
    if (c.profile.userId === req.user.id) return res.status(400).json({ message: "That's you." });

    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (message.length < MESSAGE_MIN || message.length > MESSAGE_MAX) {
      return res.status(400).json({ message: `Write between ${MESSAGE_MIN} and ${MESSAGE_MAX} characters: who you are and what you'd like to talk about.`, field: "message" });
    }
    const role = clean(req.body?.role, 80);

    const [invite] = await db.insert(recruitInvites).values({
      companyId: company.id, userId: c.profile.userId, sentBy: req.user.id, role, message, status: "sent", createdAt: new Date(),
    }).onConflictDoNothing().returning();
    if (!invite) return res.status(409).json({ message: "Your company has already asked them.", code: "already_invited" });

    const firstLine = message.split(/\r?\n/).find((l: string) => l.trim())?.trim() ?? message;
    await notify({
      recipients: [c.profile.userId], actorId: req.user.id, kind: "recruit_invite",
      targetId: `${company.id}:${invite.id}`, excerpt: `${company.name}: ${firstLine}`,
    });
    await logCompany(company.id, req.user.id, "candidate_invited", c.profile.userId, { role });
    res.status(201).json({ invite });
  });

  /** Who this company has asked, and what they said. */
  app.get("/api/companies/:id/talent-invites", isAuthenticated, async (req: any, res) => {
    const found = await companyCan(res, req.params.id, req.user.id, "view");
    if (!found) return;
    const rows = await db
      .select({
        invite: recruitInvites,
        firstName: users.firstName, lastName: users.lastName, displayName: userProfiles.displayName,
      })
      .from(recruitInvites)
      .innerJoin(users, eq(users.id, recruitInvites.userId))
      .leftJoin(userProfiles, eq(userProfiles.userId, recruitInvites.userId))
      .where(eq(recruitInvites.companyId, found.company.id))
      .orderBy(desc(recruitInvites.createdAt));
    const senders = [...new Set(rows.map((r) => r.invite.sentBy).filter((id): id is string => !!id))];
    const senderRows = senders.length
      ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, displayName: userProfiles.displayName })
          .from(users).leftJoin(userProfiles, eq(userProfiles.userId, users.id)).where(inArray(users.id, senders))
      : [];
    const senderName = new Map(senderRows.map((s) => [s.id, nameOf(s)]));
    res.json({
      invites: rows.map((r) => ({
        id: r.invite.id, userId: r.invite.userId, name: nameOf(r), role: r.invite.role, message: r.invite.message,
        status: r.invite.status, createdAt: r.invite.createdAt, answeredAt: r.invite.answeredAt,
        sentBy: { id: r.invite.sentBy, name: (r.invite.sentBy && senderName.get(r.invite.sentBy)) || "A former colleague" },
      })),
    });
  });
}

/**
 * The two of them connected, and the company's message waiting in the thread.
 *
 * Direct messages need an accepted connection. Saying yes to an invitation to
 * talk is that consent, so an existing request between them either way is
 * accepted and a missing one is made accepted.
 */
async function openConversation(senderId: string, receiverId: string, firstMessage: string) {
  const [existing] = await db.select().from(connections).where(or(
    and(eq(connections.requesterId, senderId), eq(connections.receiverId, receiverId)),
    and(eq(connections.requesterId, receiverId), eq(connections.receiverId, senderId)),
  ));
  if (existing) {
    if (existing.status !== "accepted") await db.update(connections).set({ status: "accepted" }).where(eq(connections.id, existing.id));
  } else {
    await db.insert(connections).values({ requesterId: senderId, receiverId, status: "accepted" });
  }
  await db.insert(directMessages).values({ senderId, receiverId, content: firstMessage, read: false });
}
