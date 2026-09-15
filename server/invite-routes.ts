/**
 * Inviting collaborators to a project (rules in shared/invites.ts).
 *
 *   owner → POST /api/projects/:id/invites  → a link, shown once; an email if one was given
 *   anyone with the link → GET /api/invites/:token → who's inviting you, to what, as what
 *   signed in → POST /api/invites/:token/accept → a member of the project; the owner hears
 *
 * Abuse controls: only the owner invites; 20 invites an hour per person
 * (`invite`), 25 a day and 50 pending per project; opening or accepting a link
 * is limited per address (`inviteLookup`); tokens are 256 random bits, stored
 * only as a hash, single use, expiring, revocable.
 */
import type { Express, Request } from "express";
import crypto from "node:crypto";
import { and, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { projectInvites, projectMembers, projects, users, userProfiles } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { enforceRateLimit, ipKey, rateLimit } from "./moderation";
import { notify } from "./notifications";
import { sendEmail, devOutbox } from "./email";
import { feedDisplayName } from "./feed-routes";
import {
  INVITES_PER_PROJECT_PER_DAY, MAX_PENDING_INVITES, invitePath, inviteStatus, isInviteToken, maskEmail, validateInviteInput,
} from "@shared/invites";

export const hashInviteToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
/** 32 bytes from the OS's CSPRNG, as URL-safe text. */
export const newInviteToken = () => crypto.randomBytes(32).toString("base64url");

const siteBase = (req: Request) => (process.env.SERVER_BASE_URL || process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

type Owned =
  | { project: { id: string; title: string; ownerId: string; soloMode: boolean | null }; error?: undefined }
  | { error: { status: number; body: { message: string } }; project?: undefined };

async function ownedProject(projectId: string, userId: string): Promise<Owned> {
  const [project] = await db.select({ id: projects.id, title: projects.title, ownerId: projects.ownerId, soloMode: projects.soloMode }).from(projects).where(eq(projects.id, projectId));
  if (!project) return { error: { status: 404, body: { message: "Project not found" } } };
  if (project.ownerId !== userId) return { error: { status: 403, body: { message: "Only the project's owner can invite people." } } };
  return { project };
}

async function inviterName(userId: string) {
  const [row] = await db.select({ firstName: users.firstName, lastName: users.lastName, email: users.email, displayName: userProfiles.displayName })
    .from(users).leftJoin(userProfiles, eq(userProfiles.userId, users.id)).where(eq(users.id, userId));
  return row ? feedDisplayName(row, { displayName: row.displayName }) : "A builder";
}

const publicInvite = (i: typeof projectInvites.$inferSelect) => ({
  id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt, createdAt: i.createdAt,
  emailStatus: i.emailStatus, status: inviteStatus(i),
});

export function registerInviteRoutes(app: Express) {
  /** Create an invite. The link is in this response and nowhere else. */
  app.post("/api/projects/:id/invites", isAuthenticated, rateLimit("invite"), async (req: any, res) => {
    try {
      const owned = await ownedProject(String(req.params.id), req.user.id);
      if (owned.error) return res.status(owned.error.status).json(owned.error.body);
      const project = owned.project!;
      if (project.soloMode) return res.status(400).json({ message: "This is a solo build — it doesn't take collaborators.", code: "solo_project" });
      const checked = validateInviteInput(req.body ?? {});
      if (!checked.ok) return res.status(400).json({ message: checked.message, code: "invalid_input", field: checked.field });
      const { email, role, expiresInDays } = checked.value;

      // The project's own caps, on top of the per-person limit.
      const [today] = await db.select({ n: count() }).from(projectInvites)
        .where(and(eq(projectInvites.projectId, project.id), gt(projectInvites.createdAt, sql`now() - interval '1 day'`)));
      if (today.n >= INVITES_PER_PROJECT_PER_DAY) {
        return res.status(429).json({ message: `This project has sent ${INVITES_PER_PROJECT_PER_DAY} invites today. Try again tomorrow.`, code: "rate_limited", action: "invite" });
      }
      const [pending] = await db.select({ n: count() }).from(projectInvites)
        .where(and(eq(projectInvites.projectId, project.id), isNull(projectInvites.acceptedAt), isNull(projectInvites.revokedAt), gt(projectInvites.expiresAt, new Date())));
      if (pending.n >= MAX_PENDING_INVITES) {
        return res.status(429).json({ message: `${MAX_PENDING_INVITES} invites are waiting on this project. Revoke some first.`, code: "rate_limited", action: "invite" });
      }
      if (email) {
        const [already] = await db.select({ id: projectMembers.id }).from(projectMembers).innerJoin(users, eq(users.id, projectMembers.userId))
          .where(and(eq(projectMembers.projectId, project.id), sql`lower(${users.email}) = ${email}`));
        if (already) return res.status(409).json({ message: "That person is already on the team.", code: "already_member", field: "email" });
      }

      const token = newInviteToken();
      const [invite] = await db.insert(projectInvites).values({
        projectId: project.id, email, role, tokenHash: hashInviteToken(token),
        expiresAt: new Date(Date.now() + expiresInDays * 86_400_000), createdById: req.user.id,
      }).returning();
      const url = `${siteBase(req)}${invitePath(token)}`;

      let emailResult: Awaited<ReturnType<typeof sendEmail>> | null = null;
      if (email) {
        const from = await inviterName(req.user.id);
        emailResult = await sendEmail({
          to: email, tag: "project_invite",
          subject: `${from} invited you to ${project.title} on SparkTower`,
          text: `${from} invited you to join ${project.title} on SparkTower as ${role}.\n\nAccept the invite: ${url}\n\nThe link works once and expires ${invite.expiresAt.toUTCString()}. If you weren't expecting this, you can ignore it.`,
        });
        await db.update(projectInvites).set({ emailStatus: emailResult.status }).where(eq(projectInvites.id, invite.id));
      }
      res.status(201).json({ invite: { ...publicInvite(invite), emailStatus: emailResult?.status ?? null }, url, email: emailResult });
    } catch (error) {
      console.error("Invite create error:", error);
      res.status(500).json({ message: "Couldn't create that invite" });
    }
  });

  /** The project's invites, newest first. Never their links. */
  app.get("/api/projects/:id/invites", isAuthenticated, async (req: any, res) => {
    try {
      const owned = await ownedProject(String(req.params.id), req.user.id);
      if (owned.error) return res.status(owned.error.status).json(owned.error.body);
      const rows = await db.select().from(projectInvites).where(eq(projectInvites.projectId, owned.project!.id)).orderBy(desc(projectInvites.createdAt)).limit(100);
      res.json({ invites: rows.map(publicInvite) });
    } catch (error) {
      console.error("Invite list error:", error);
      res.status(500).json({ message: "Couldn't load invites" });
    }
  });

  /** Revoke one: its link stops working immediately. */
  app.delete("/api/projects/:id/invites/:inviteId", isAuthenticated, rateLimit("invite"), async (req: any, res) => {
    try {
      const owned = await ownedProject(String(req.params.id), req.user.id);
      if (owned.error) return res.status(owned.error.status).json(owned.error.body);
      const [row] = await db.update(projectInvites).set({ revokedAt: new Date() })
        .where(and(eq(projectInvites.id, String(req.params.inviteId)), eq(projectInvites.projectId, owned.project!.id), isNull(projectInvites.acceptedAt), isNull(projectInvites.revokedAt)))
        .returning();
      if (!row) return res.status(404).json({ message: "No pending invite by that id." });
      res.json({ invite: publicInvite(row) });
    } catch (error) {
      console.error("Invite revoke error:", error);
      res.status(500).json({ message: "Couldn't revoke that invite" });
    }
  });

  /** What an invite link opens onto. No account needed — the person may not have one yet. */
  app.get("/api/invites/:token", async (req: any, res) => {
    try {
      if (!(await enforceRateLimit(res, req.user?.id ?? ipKey(req), "inviteLookup"))) return;
      const token = String(req.params.token);
      if (!isInviteToken(token)) return res.status(404).json({ message: "This invite link isn't valid.", code: "invite_not_found" });
      const [row] = await db.select({ invite: projectInvites, title: projects.title, oneLiner: projects.oneLiner, logoUrl: projects.logoUrl })
        .from(projectInvites).innerJoin(projects, eq(projects.id, projectInvites.projectId)).where(eq(projectInvites.tokenHash, hashInviteToken(token)));
      if (!row) return res.status(404).json({ message: "This invite link isn't valid.", code: "invite_not_found" });
      const status = inviteStatus(row.invite);
      const viewerEmail = req.user?.email?.toLowerCase() ?? null;
      res.json({
        status, role: row.invite.role, expiresAt: row.invite.expiresAt,
        project: { id: row.invite.projectId, title: row.title, oneLiner: row.oneLiner ?? null, logoUrl: row.logoUrl ?? null },
        invitedBy: await inviterName(row.invite.createdById),
        // Who it's for, masked for whoever holds the link; whether the signed-in account is that person.
        forEmail: row.invite.email ? maskEmail(row.invite.email) : null,
        viewerMatches: row.invite.email ? viewerEmail === row.invite.email : null,
      });
    } catch (error) {
      console.error("Invite lookup error:", error);
      res.status(500).json({ message: "Couldn't open that invite" });
    }
  });

  /** Accept: join the project with the invite's role. Single use, claimed atomically. */
  app.post("/api/invites/:token/accept", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await enforceRateLimit(res, req.user.id, "inviteLookup"))) return;
      const token = String(req.params.token);
      if (!isInviteToken(token)) return res.status(404).json({ message: "This invite link isn't valid.", code: "invite_not_found" });
      const outcome = await db.transaction(async (tx) => {
        const [invite] = await tx.select().from(projectInvites).where(eq(projectInvites.tokenHash, hashInviteToken(token))).for("update");
        if (!invite) return { status: 404, body: { message: "This invite link isn't valid.", code: "invite_not_found" } };
        const status = inviteStatus(invite);
        if (status === "accepted") return { status: 410, body: { message: "This invite has already been used.", code: "invite_used" } };
        if (status === "revoked") return { status: 410, body: { message: "This invite was cancelled by the project owner.", code: "invite_revoked" } };
        if (status === "expired") return { status: 410, body: { message: "This invite has expired. Ask for a new one.", code: "invite_expired" } };
        if (invite.email && (req.user.email ?? "").toLowerCase() !== invite.email) {
          return { status: 403, body: { message: `This invite is for ${maskEmail(invite.email)}. Sign in with that account to accept it.`, code: "invite_wrong_account" } };
        }
        const [project] = await tx.select({ id: projects.id, title: projects.title, ownerId: projects.ownerId }).from(projects).where(eq(projects.id, invite.projectId));
        if (!project) return { status: 404, body: { message: "That project no longer exists.", code: "invite_not_found" } };
        const alreadyIn = project.ownerId === req.user.id
          || (await tx.select({ id: projectMembers.id }).from(projectMembers).where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, req.user.id)))).length > 0;
        if (!alreadyIn) await tx.insert(projectMembers).values({ projectId: project.id, userId: req.user.id, role: invite.role });
        await tx.update(projectInvites).set({ acceptedAt: new Date(), acceptedById: req.user.id }).where(eq(projectInvites.id, invite.id));
        return { status: 200, body: { ok: true, projectId: project.id, projectTitle: project.title, role: invite.role, alreadyMember: alreadyIn }, notifyOwner: !alreadyIn ? project : null };
      });
      if (outcome.status === 200 && (outcome as any).notifyOwner) {
        const p = (outcome as any).notifyOwner;
        await notify({ recipients: [p.ownerId], actorId: req.user.id, kind: "invite_accepted", targetId: `${p.id}:${req.user.id}`, projectId: p.id, excerpt: outcome.body.role as string }).catch(() => {});
      }
      res.status(outcome.status).json(outcome.body);
    } catch (error) {
      console.error("Invite accept error:", error);
      res.status(500).json({ message: "Couldn't accept that invite" });
    }
  });

  /** Development only: the emails that would have been sent. */
  app.get("/api/dev/outbox", isAuthenticated, (req, res) => {
    if (process.env.NODE_ENV === "production") return res.status(404).json({ message: "Not found" });
    res.json({ messages: devOutbox() });
  });
}
