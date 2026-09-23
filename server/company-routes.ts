/**
 * Company accounts: making one, seeing it, and the people who act for it.
 *
 *   POST   /api/companies                      → a new company; you are its owner
 *   GET    /api/companies                      → the companies you belong to, with your role
 *   GET    /api/companies/:id                  → { company, role, members, me } (the page shell reads this)
 *   PATCH  /api/companies/:id                  → an admin edits what it says about itself
 *   DELETE /api/companies/:id                  → the owner, and only the owner
 *   POST   /api/companies/:id/invite-link      → someone with manage_team gets a link to hand to a colleague
 *   POST   /api/companies/:id/invite-link/reset → every link made so far stops working (manage_team)
 *   POST   /api/company-invites/accept         → whoever holds the link joins
 *   POST   /api/companies/:id/members          → add an existing account by email or username (manage_team)
 *   PUT    /api/companies/:id/members/:userId/permissions → change what a member may do (manage_team)
 *   PATCH  /api/companies/:id/members/:userId  → a leader changes someone's role
 *   DELETE /api/companies/:id/members/:userId  → someone with manage_team removes a person they outrank, or you leave
 *   GET    /api/companies/:id/audit            → who did what to the team, newest first (manage_team)
 *
 * Who may do what is decided once, in shared/companies.ts and
 * server/company-access.ts; nothing here restates the rule.
 *
 * ## Why invite links are signed rather than stored
 *
 * A project invite is a row: a random token whose hash is kept, so it can be
 * revoked and used once. Company invites had no table and were not to gain
 * one, so the link carries its own meaning instead — which company, which
 * role, until when — signed with the session secret. Nobody can forge one or
 * change the role in it without the secret, and it expires on its own. What it
 * gives up is single use: a link handed round an office admits anyone in that
 * office until it expires, which is what a team link is for, and why links are
 * short-lived and can only ever make someone a member or an admin — never an
 * owner. Revocation is by generation instead: each link carries the company's
 * `inviteKeyVersion`, and raising it (a reset, or removing somebody) retires
 * every link made before.
 */
import type { Express, Request } from "express";
import crypto from "node:crypto";
import { and, asc, desc, eq, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "./db";
import { companies, companyAuditLog, companyMembers, companyVerifications, users, userProfiles } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { spendableVerification } from "./company-verification-routes";
import { feedDisplayName } from "./feed-routes";
import { publicBaseUrl } from "./public-url";
import { notify } from "./notifications";
import { deleteCompany, syncRunProjectMember } from "./company-lifecycle";
import { companyCan, companyFor, companyMember, companyRole, logCompany, mayActOn, powersOf } from "./company-access";
import {
  COMPANY_PERMISSION_IDS, COMPANY_ROLES, COMPANY_SIZES, INDUSTRIES, isCompanyPermission, slugify,
  type CompanyPermission, type CompanyRole,
} from "@shared/companies";

/** How long an invite link works. A week: long enough to reach someone on holiday, short enough that an old link in a chat is dead. */
export const COMPANY_INVITE_DAYS = 7;
/** The roles a link can carry. Ownership is handed over by an owner, deliberately, never by a link. */
const LINK_ROLES = ["member", "admin"] as const;

/* ── Signed invite tokens ─────────────────────────────────────────────── */

function inviteSecret(): string {
  const secret = process.env.SESSION_SECRET;
  /*
   * Refuse rather than fall back to a constant. A default secret would be the
   * same on every install, and anyone who read this file could mint an admin
   * link to any company.
   */
  if (!secret) throw new Error("SESSION_SECRET is not set; company invite links can't be signed.");
  return secret;
}

/** Kept apart from any other use of the session secret, so a signature made for one purpose never verifies for another. */
const sign = (payload: string) =>
  crypto.createHmac("sha256", inviteSecret()).update(`company-invite:${payload}`).digest("base64url");

/**
 * `keyVersion` is the company's invite generation (companies.inviteKeyVersion)
 * when the link was made. A link from an earlier generation is refused, which
 * is how a leader takes every outstanding link back at once.
 */
export function makeCompanyInviteToken(companyId: string, role: (typeof LINK_ROLES)[number], expiresAt: Date, keyVersion = 0): string {
  // The nonce makes two links minted in the same millisecond different, so one can't be mistaken for the other in a log.
  const payload = Buffer.from(JSON.stringify({ c: companyId, r: role, e: expiresAt.getTime(), k: keyVersion, n: crypto.randomBytes(6).toString("base64url") })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readCompanyInviteToken(token: unknown, now = Date.now()):
  | { ok: true; companyId: string; role: (typeof LINK_ROLES)[number]; expiresAt: Date; keyVersion: number }
  | { ok: false; reason: "invalid" | "expired" } {
  if (typeof token !== "string" || token.length > 400) return { ok: false, reason: "invalid" };
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return { ok: false, reason: "invalid" };
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  // Constant time, so the signature can't be discovered a byte at a time from how long a refusal takes.
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return { ok: false, reason: "invalid" };
  let body: { c?: unknown; r?: unknown; e?: unknown; k?: unknown };
  try { body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return { ok: false, reason: "invalid" }; }
  if (typeof body.c !== "string" || typeof body.e !== "number" || !(LINK_ROLES as readonly unknown[]).includes(body.r)) {
    return { ok: false, reason: "invalid" };
  }
  if (body.e <= now) return { ok: false, reason: "expired" };
  // Links made before generations existed carry none, and belong to the first.
  const keyVersion = typeof body.k === "number" && Number.isInteger(body.k) ? body.k : 0;
  return { ok: true, companyId: body.c, role: body.r as (typeof LINK_ROLES)[number], expiresAt: new Date(body.e), keyVersion };
}

/* ── Input ────────────────────────────────────────────────────────────── */

type CompanyInput = { name: string; website: string | null; industry: string | null; size: string | null; description: string | null };

/**
 * What a company says about itself, checked.
 *
 * `partial` is for an edit: a field left out stays as it is, and a field sent
 * as empty is cleared. The name can be changed but never cleared.
 */
function readCompanyInput(raw: any, partial: boolean):
  | { ok: true; value: Partial<CompanyInput> }
  | { ok: false; field: string; message: string } {
  const body = raw ?? {};
  const value: Partial<CompanyInput> = {};
  const text = (v: unknown) => (v == null ? "" : String(v).trim());

  if (!partial || body.name !== undefined) {
    const name = text(body.name);
    if (name.length < 2 || name.length > 80) return { ok: false, field: "name", message: "A company name is 2 to 80 characters." };
    value.name = name;
  }
  if (body.website !== undefined) {
    let website = text(body.website);
    if (website) {
      // People type "acme.com"; a link needs a scheme, and only the web ones are allowed.
      if (!/^https?:\/\//i.test(website)) website = `https://${website}`;
      let ok = false;
      try { const u = new URL(website); ok = (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes("."); } catch { ok = false; }
      if (!ok || website.length > 200) return { ok: false, field: "website", message: "That doesn't look like a web address." };
    }
    value.website = website || null;
  }
  if (body.industry !== undefined) {
    const industry = text(body.industry);
    if (industry && !(INDUSTRIES as readonly string[]).includes(industry)) return { ok: false, field: "industry", message: "Pick an industry from the list." };
    value.industry = industry || null;
  }
  if (body.size !== undefined) {
    const size = text(body.size);
    if (size && !(COMPANY_SIZES as readonly string[]).includes(size)) return { ok: false, field: "size", message: `Pick a size: ${COMPANY_SIZES.join(", ")}.` };
    value.size = size || null;
  }
  if (body.description !== undefined) {
    const description = text(body.description);
    if (description.length > 600) return { ok: false, field: "description", message: "Keep the description under 600 characters." };
    value.description = description || null;
  }
  return { ok: true, value };
}

const publicCompany = (c: typeof companies.$inferSelect) => ({
  id: c.id, name: c.name, slug: c.slug, website: c.website, industry: c.industry,
  size: c.size, description: c.description, projectId: c.projectId,
});

/** Everyone who acts for the company, owners first, then by when they joined. */
export async function companyMembersOf(companyId: string) {
  const rows = await db
    .select({
      userId: companyMembers.userId, role: companyMembers.role, permissions: companyMembers.permissions, joinedAt: companyMembers.joinedAt,
      firstName: users.firstName, lastName: users.lastName,
      displayName: userProfiles.displayName, avatarUrl: userProfiles.avatarUrl,
    })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .leftJoin(userProfiles, eq(userProfiles.userId, companyMembers.userId))
    .where(eq(companyMembers.companyId, companyId))
    .orderBy(asc(companyMembers.joinedAt));
  const order = (r: string) => COMPANY_ROLES.indexOf(r as CompanyRole);
  return rows
    .sort((a, b) => order(a.role) - order(b.role))
    .map((r) => ({
      userId: r.userId,
      name: feedDisplayName(r, { displayName: r.displayName }),
      role: r.role as CompanyRole,
      avatarUrl: r.avatarUrl ?? null,
      /** Only what was given to them. A leader's list means nothing — they hold every power by their role. */
      permissions: (r.permissions ?? []).filter(isCompanyPermission),
    }));
}

/**
 * A list of powers from a request, checked. Duplicates fold together and the
 * order is the catalogue's, so "before" and "after" in the log compare cleanly.
 */
function readPermissions(raw: unknown): { ok: true; value: CompanyPermission[] } | { ok: false; message: string } {
  if (raw == null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, message: "Powers come as a list." };
  const bad = raw.find((p) => !isCompanyPermission(p));
  if (bad !== undefined) return { ok: false, message: `There's no power called "${String(bad).slice(0, 40)}".` };
  return { ok: true, value: COMPANY_PERMISSION_IDS.filter((p) => raw.includes(p)) };
}

/**
 * Finds the account someone typed: an email address (any capitalisation), or
 * a username with or without the @. Bots are never found — they fill empty
 * seats in the simulation and have no business in a company.
 */
async function findAccount(identifier: string):
  Promise<{ ok: true; userId: string } | { ok: false; status: number; message: string; code: string }> {
  const text = identifier.trim();
  if (text.includes("@") && !text.startsWith("@")) {
    const [row] = await db.select({ id: users.id }).from(users)
      .where(and(sql`lower(${users.email}) = ${text.toLowerCase()}`, eq(users.isBot, false)));
    return row ? { ok: true, userId: row.id }
      : { ok: false, status: 404, code: "no_such_account", message: "There's no account with that email address. They need to sign up first." };
  }
  const username = text.replace(/^@/, "").toLowerCase();
  const rows = await db.select({ id: userProfiles.userId }).from(userProfiles)
    .innerJoin(users, eq(users.id, userProfiles.userId))
    .where(and(sql`lower(${userProfiles.username}) = ${username}`, eq(users.isBot, false)))
    .limit(2);
  if (rows.length === 0) {
    return { ok: false, status: 404, code: "no_such_account", message: "There's no account with that username. Try their email address." };
  }
  // Usernames aren't unique here. Guessing between two people would add the wrong one to a company.
  if (rows.length > 1) {
    return { ok: false, status: 409, code: "ambiguous", message: "More than one account uses that username. Use their email address instead." };
  }
  return { ok: true, userId: rows[0].id };
}

const isLeader = (m: { role: CompanyRole }) => m.role === "owner" || m.role === "admin";

const inviteUrl = (req: Request, token: string) => `${publicBaseUrl(req)}/companies?invite=${encodeURIComponent(token)}`;

export function registerCompanyRoutes(app: Express): void {
  /** Make a company. Whoever makes it owns it. */
  app.post("/api/companies", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const checked = readCompanyInput(req.body, false);
      if (!checked.ok) return res.status(400).json({ message: checked.message, code: "invalid_input", field: checked.field });
      const input = checked.value as CompanyInput;
      const now = new Date();

      /*
       * A proven domain, or no company.
       *
       * Anybody could create a company called anything and post challenges
       * under it, and a builder could spend a fortnight entering one for a
       * company that did not exist. The proof comes first — see
       * company-verification-routes.ts for why it is keyed on the person
       * rather than the company — and it is spent inside this transaction, so
       * one proof can never become two companies.
       */
      const result = await db.transaction(async (tx) => {
        const claim = await spendableVerification(tx, req.user.id, req.body?.verificationId);
        if (!claim.ok) return claim;

        const [row] = await tx.insert(companies).values({
          name: input.name,
          // Random rather than counted, so a slug says nothing about how many companies share a name.
          slug: slugify(input.name, crypto.randomBytes(4).toString("hex")),
          /*
           * The website is the proven domain, not whatever was typed in the
           * form. Letting those differ would put "acme.com" on the badge and
           * send people to somewhere else entirely.
           */
          website: `https://${claim.verification.domain}`,
          verifiedDomain: claim.verification.domain,
          verifiedAt: now,
          verifiedMethod: claim.verification.method,
          industry: input.industry ?? null, size: input.size ?? null,
          description: input.description ?? null, createdBy: req.user.id, createdAt: now,
        }).returning();
        await tx.insert(companyMembers).values({ companyId: row.id, userId: req.user.id, role: "owner", joinedAt: now });
        await tx.update(companyVerifications).set({ companyId: row.id })
          .where(eq(companyVerifications.id, claim.verification.id));
        return { ok: true as const, company: row };
      });

      if (!result.ok) {
        return res.status(result.status).json({ code: result.code, message: result.message });
      }
      res.status(201).json({ company: publicCompany(result.company), role: "owner" });
    } catch (error) {
      console.error("Company create error:", error);
      res.status(500).json({ message: "Couldn't create that company." });
    }
  });

  /** The companies I act for. */
  app.get("/api/companies", isAuthenticated, async (req: any, res) => {
    try {
      const rows = await db
        .select({ company: companies, role: companyMembers.role, members: sql<number>`(select count(*)::int from ${companyMembers} m where m.company_id = ${companies.id})` })
        .from(companyMembers)
        .innerJoin(companies, eq(companies.id, companyMembers.companyId))
        .where(eq(companyMembers.userId, req.user.id))
        .orderBy(asc(companies.name));
      res.json({ companies: rows.map((r) => ({ ...publicCompany(r.company), role: r.role, memberCount: r.members })) });
    } catch (error) {
      console.error("Company list error:", error);
      res.status(500).json({ message: "Couldn't load your companies." });
    }
  });

  /** One company, as its page needs it. The shape is relied on by every tab — change it with care. */
  app.get("/api/companies/:id", isAuthenticated, async (req: any, res) => {
    try {
      const found = await companyCan(res, String(req.params.id), req.user.id, "view");
      if (!found) return;
      const { member } = found;
      res.json({
        company: publicCompany(found.company),
        role: member.role,
        members: await companyMembersOf(found.company.id),
        // What this person can do, worked out here so every tab reads one answer instead of restating the rule.
        me: { userId: req.user.id, role: member.role, permissions: member.permissions, powers: powersOf(member) },
      });
    } catch (error) {
      console.error("Company read error:", error);
      res.status(500).json({ message: "Couldn't load that company." });
    }
  });

  app.patch("/api/companies/:id", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const found = await companyFor(res, String(req.params.id), req.user.id, "manage");
      if (!found) return;
      const checked = readCompanyInput(req.body, true);
      if (!checked.ok) return res.status(400).json({ message: checked.message, code: "invalid_input", field: checked.field });
      if (Object.keys(checked.value).length === 0) return res.json({ company: publicCompany(found.company) });
      // The slug stays put when the name changes: links people already shared keep working.
      const [row] = await db.update(companies).set(checked.value).where(eq(companies.id, found.company.id)).returning();
      res.json({ company: publicCompany(row) });
    } catch (error) {
      console.error("Company update error:", error);
      res.status(500).json({ message: "Couldn't save those changes." });
    }
  });

  app.delete("/api/companies/:id", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const found = await companyFor(res, String(req.params.id), req.user.id, "delete");
      if (!found) return;
      // Members, watches and the rest go with it (foreign keys cascade), and its posts are deleted rather than left under their authors' names. Its private seasons stay as history for the people who played them.
      await deleteCompany(found.company.id);
      res.json({ ok: true });
    } catch (error) {
      console.error("Company delete error:", error);
      res.status(500).json({ message: "Couldn't delete that company." });
    }
  });

  /* ── The team ───────────────────────────────────────────────────────── */

  /** A link handed to a colleague by whoever manages the team. Shown once; the server keeps nothing. */
  app.post("/api/companies/:id/invite-link", isAuthenticated, rateLimit("invite"), async (req: any, res) => {
    try {
      const found = await companyCan(res, String(req.params.id), req.user.id, "manage_team");
      if (!found) return;
      const role = req.body?.role == null || req.body.role === "" ? "member" : String(req.body.role);
      if (!(LINK_ROLES as readonly string[]).includes(role)) {
        return res.status(400).json({ message: "A link can make someone a member or an admin.", code: "invalid_input", field: "role" });
      }
      // An admin link is a role change by other means, and roles are a leader's call.
      if (role === "admin" && !isLeader(found.member)) {
        return res.status(403).json({ message: "Only an owner or admin can make a link that joins people as admins.", code: "not_leader" });
      }
      const expiresAt = new Date(Date.now() + COMPANY_INVITE_DAYS * 86_400_000);
      const token = makeCompanyInviteToken(found.company.id, role as (typeof LINK_ROLES)[number], expiresAt, found.company.inviteKeyVersion);
      res.status(201).json({ url: inviteUrl(req, token), token, role, expiresAt });
    } catch (error) {
      console.error("Company invite error:", error);
      res.status(500).json({ message: "Couldn't make an invite link." });
    }
  });

  /**
   * Take back every invite link handed out so far. Links already in chats and
   * inboxes stop working; anyone who needs one is sent a new one.
   */
  app.post("/api/companies/:id/invite-link/reset", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const found = await companyCan(res, String(req.params.id), req.user.id, "manage_team");
      if (!found) return;
      const [row] = await db.update(companies).set({ inviteKeyVersion: sql`${companies.inviteKeyVersion} + 1` })
        .where(eq(companies.id, found.company.id)).returning({ v: companies.inviteKeyVersion });
      await logCompany(found.company.id, req.user.id, "invite_links_reset", null, { generation: row.v });
      res.json({ ok: true });
    } catch (error) {
      console.error("Company invite reset error:", error);
      res.status(500).json({ message: "Couldn't reset the invite links." });
    }
  });

  /** Join from a link. Someone already in the company keeps the role they have — a member link never demotes an admin. */
  app.post("/api/company-invites/accept", isAuthenticated, rateLimit("inviteLookup"), async (req: any, res) => {
    try {
      const read = readCompanyInviteToken(req.body?.token);
      if (!read.ok) {
        return read.reason === "expired"
          ? res.status(410).json({ message: "This invite link has expired. Ask for a new one.", code: "invite_expired" })
          : res.status(404).json({ message: "This invite link isn't valid.", code: "invite_not_found" });
      }
      const [company] = await db.select().from(companies).where(eq(companies.id, read.companyId));
      // A signed link to a company that has since been deleted, or one from before its links were reset.
      if (!company || company.inviteKeyVersion !== read.keyVersion) {
        return res.status(404).json({ message: "This invite link isn't valid.", code: "invite_not_found" });
      }

      const existing = await companyRole(company.id, req.user.id);
      if (existing) return res.json({ companyId: company.id, name: company.name, role: existing, alreadyMember: true });

      await db.insert(companyMembers)
        .values({ companyId: company.id, userId: req.user.id, role: read.role, joinedAt: new Date() })
        .onConflictDoNothing();
      const role = (await companyRole(company.id, req.user.id)) ?? read.role;
      await syncRunProjectMember(company.id, req.user.id, role);
      await logCompany(company.id, req.user.id, "member_joined", req.user.id, { role, via: "link" });
      res.json({ companyId: company.id, name: company.name, role, alreadyMember: false });
    } catch (error) {
      console.error("Company invite accept error:", error);
      res.status(500).json({ message: "Couldn't accept that invite." });
    }
  });

  /**
   * Add somebody who already has an account, by their email or username.
   *
   * The everyday way in is the team link; this is for the leader who knows
   * exactly who they want and doesn't want to chase them to click something.
   * They join as a member, with whatever powers were ticked — "manage the
   * team" only if a leader is the one ticking it — and are told.
   */
  app.post("/api/companies/:id/members", isAuthenticated, rateLimit("invite"), async (req: any, res) => {
    try {
      const found = await companyCan(res, String(req.params.id), req.user.id, "manage_team");
      if (!found) return;
      const actor = { ...found.member, userId: req.user.id };
      const identifier = typeof req.body?.identifier === "string" ? req.body.identifier.trim() : "";
      if (identifier.length < 2 || identifier.length > 254) {
        return res.status(400).json({ message: "Type their email address or username.", code: "invalid_input", field: "identifier" });
      }
      const perms = readPermissions(req.body?.permissions);
      if (!perms.ok) return res.status(400).json({ message: perms.message, code: "invalid_input", field: "permissions" });
      if (!mayActOn(actor, null, "add")) {
        return res.status(403).json({ message: "You can't add people to this company.", code: "missing_power", power: "manage_team" });
      }
      if (perms.value.includes("manage_team") && !mayActOn(actor, null, "grant_manage_team")) {
        return res.status(403).json({ message: "Only an owner or admin can let someone manage the team.", code: "not_leader" });
      }

      const account = await findAccount(identifier);
      if (!account.ok) return res.status(account.status).json({ message: account.message, code: account.code });
      if (await companyRole(found.company.id, account.userId)) {
        return res.status(409).json({ message: "They're already in this company.", code: "already_member" });
      }
      const [added] = await db.insert(companyMembers).values({
        companyId: found.company.id, userId: account.userId, role: "member", permissions: perms.value, joinedAt: new Date(),
      }).onConflictDoNothing().returning({ userId: companyMembers.userId });
      // Somebody else added them in the moment between the check and the insert.
      if (!added) return res.status(409).json({ message: "They're already in this company.", code: "already_member" });

      await syncRunProjectMember(found.company.id, account.userId, "member");
      await notify({
        recipients: [account.userId], actorId: req.user.id, kind: "company_added",
        targetId: `${found.company.id}:${account.userId}`, excerpt: found.company.name,
      });
      await logCompany(found.company.id, req.user.id, "member_added", account.userId, { role: "member", permissions: perms.value });
      const member = (await companyMembersOf(found.company.id)).find((m) => m.userId === account.userId);
      res.status(201).json({ member });
    } catch (error) {
      console.error("Company member add error:", error);
      res.status(500).json({ message: "Couldn't add that person." });
    }
  });

  /**
   * Set exactly which powers a member holds.
   *
   * The whole list is sent, not a change to it, so two leaders editing at once
   * end with what the last one saw and chose rather than a merge neither saw.
   * Owners and admins are refused: they hold every power by their role, and a
   * list stored against them would only mislead whoever read it later.
   */
  app.put("/api/companies/:id/members/:userId/permissions", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const found = await companyCan(res, String(req.params.id), req.user.id, "manage_team");
      if (!found) return;
      const targetId = String(req.params.userId);
      const perms = readPermissions(req.body?.permissions);
      if (!perms.ok) return res.status(400).json({ message: perms.message, code: "invalid_input", field: "permissions" });
      const target = await companyMember(found.company.id, targetId);
      if (!target) return res.status(404).json({ message: "That person isn't in this company." });
      if (isLeader(target)) {
        return res.status(409).json({ message: "Owners and admins already hold every power.", code: "leader_holds_all" });
      }
      const actor = { ...found.member, userId: req.user.id };
      if (!mayActOn(actor, { ...target, userId: targetId }, "powers")) {
        return targetId === req.user.id
          ? res.status(403).json({ message: "Ask a leader to change your own powers.", code: "self" })
          : res.status(403).json({ message: "You can't change what they can do.", code: "outranked" });
      }
      const before = target.permissions;
      if (before.includes("manage_team") !== perms.value.includes("manage_team") && !mayActOn(actor, null, "grant_manage_team")) {
        return res.status(403).json({ message: "Only an owner or admin can give or take away managing the team.", code: "not_leader" });
      }
      if (before.length === perms.value.length && before.every((p) => perms.value.includes(p))) {
        return res.json({ userId: targetId, permissions: perms.value });
      }
      // Only while they're still a member: a promotion landing first makes the list meaningless.
      const [row] = await db.update(companyMembers).set({ permissions: perms.value })
        .where(and(eq(companyMembers.companyId, found.company.id), eq(companyMembers.userId, targetId), eq(companyMembers.role, "member")))
        .returning({ userId: companyMembers.userId });
      if (!row) return res.status(409).json({ message: "Their role has just changed. Reload and try again.", code: "role_changed" });

      await notify({
        recipients: [targetId], actorId: req.user.id, kind: "company_powers",
        targetId: `${found.company.id}:${targetId}`, excerpt: found.company.name,
      });
      await logCompany(found.company.id, req.user.id, "permissions_changed", targetId, { before, after: perms.value });
      res.json({ userId: targetId, permissions: perms.value });
    } catch (error) {
      console.error("Company permissions error:", error);
      res.status(500).json({ message: "Couldn't change those powers." });
    }
  });

  /**
   * Change someone's role.
   *
   * A leader's call alone: a member who manages the team can add people and
   * hand out powers, but making somebody an admin would let them make
   * themselves one by proxy. Ownership is the owners' own business: only an
   * owner can make someone an owner or change an owner's role. And the last
   * owner can never stop being one — a company nobody can delete or hand on
   * is stuck for ever.
   *
   * A new role starts with no powers of its own. An admin stepped down to
   * member would otherwise pick up whatever list they had years ago.
   */
  app.patch("/api/companies/:id/members/:userId", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const found = await companyCan(res, String(req.params.id), req.user.id, "view");
      if (!found) return;
      if (!mayActOn(found.member, null, "role")) {
        return res.status(403).json({ message: "Only an owner or admin can change someone's role.", code: "not_leader" });
      }
      const role = String(req.body?.role ?? "");
      if (!(COMPANY_ROLES as readonly string[]).includes(role)) {
        return res.status(400).json({ message: `Pick a role: ${COMPANY_ROLES.join(", ")}.`, code: "invalid_input", field: "role" });
      }
      const targetId = String(req.params.userId);
      const outcome = await db.transaction(async (tx) => {
        /*
         * The company row is locked for the whole decision. Two owners each
         * demoting the other at the same moment would both count two owners,
         * both succeed, and leave none; holding the lock makes the second one
         * count again after the first has landed.
         */
        await tx.execute(sql`select 1 from ${companies} where ${companies.id} = ${found.company.id} for update`);
        const members = await tx.select({ userId: companyMembers.userId, role: companyMembers.role })
          .from(companyMembers).where(eq(companyMembers.companyId, found.company.id));
        const target = members.find((m) => m.userId === targetId);
        if (!target) return { status: 404, body: { message: "That person isn't in this company." } } as const;
        if ((target.role === "owner" || role === "owner") && found.member.role !== "owner") {
          return { status: 403, body: { message: "Only an owner can change who owns the company.", code: "not_owner" } } as const;
        }
        if (target.role === "owner" && role !== "owner" && members.filter((m) => m.role === "owner").length <= 1) {
          return { status: 409, body: { message: "Every company needs an owner. Make someone else an owner first.", code: "last_owner" } } as const;
        }
        if (target.role === role) return { status: 200, body: { ok: true, userId: targetId, role }, from: null } as const;
        await tx.update(companyMembers).set({ role: role as CompanyRole, permissions: [] })
          .where(and(eq(companyMembers.companyId, found.company.id), eq(companyMembers.userId, targetId)));
        return { status: 200, body: { ok: true, userId: targetId, role }, from: target.role } as const;
      });
      if ("from" in outcome && outcome.from) {
        await syncRunProjectMember(found.company.id, targetId, role as CompanyRole);
        await logCompany(found.company.id, req.user.id, "role_changed", targetId, { from: outcome.from, to: role });
      }
      res.status(outcome.status).json(outcome.body);
    } catch (error) {
      console.error("Company role change error:", error);
      res.status(500).json({ message: "Couldn't change that role." });
    }
  });

  /**
   * Remove someone, or leave. Anyone may leave; removing somebody else takes
   * the "manage the team" power and a person you don't outrank is off limits —
   * an admin can't remove an owner, and a member who manages the team can't
   * remove an admin. Not the last owner either way.
   */
  app.delete("/api/companies/:id/members/:userId", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const companyId = String(req.params.id);
      const targetId = String(req.params.userId);
      const leaving = targetId === req.user.id;
      const found = await companyCan(res, companyId, req.user.id, leaving ? "view" : "manage_team");
      if (!found) return;
      const actor = { ...found.member, userId: req.user.id };
      const outcome = await db.transaction(async (tx) => {
        // Locked for the same reason as a role change: two removals must not both see a second owner.
        await tx.execute(sql`select 1 from ${companies} where ${companies.id} = ${found.company.id} for update`);
        const members = await tx.select({ userId: companyMembers.userId, role: companyMembers.role, permissions: companyMembers.permissions })
          .from(companyMembers).where(eq(companyMembers.companyId, found.company.id));
        const target = members.find((m) => m.userId === targetId);
        if (!target) return { status: 404, body: { message: "That person isn't in this company." } } as const;
        if (!leaving && !mayActOn(actor, { role: target.role as CompanyRole, permissions: [], userId: targetId }, "remove")) {
          return target.role === "owner"
            ? { status: 403, body: { message: "Only an owner can remove an owner.", code: "not_owner" } } as const
            : { status: 403, body: { message: "Only an owner or admin can remove a leader of the company.", code: "outranked" } } as const;
        }
        if (target.role === "owner" && members.filter((m) => m.role === "owner").length <= 1) {
          return { status: 409, body: { message: "Every company needs an owner. Make someone else an owner first.", code: "last_owner" } } as const;
        }
        await tx.delete(companyMembers)
          .where(and(eq(companyMembers.companyId, found.company.id), eq(companyMembers.userId, targetId)));
        /*
         * Someone removed may still hold the team link they joined with.
         * Every outstanding link is retired with them, so being removed means
         * staying out; the people who still need a link are sent a new one.
         */
        if (!leaving) {
          await tx.update(companies).set({ inviteKeyVersion: sql`${companies.inviteKeyVersion} + 1` }).where(eq(companies.id, found.company.id));
        }
        return { status: 200, body: { ok: true }, role: target.role } as const;
      });
      if ("role" in outcome) {
        await syncRunProjectMember(found.company.id, targetId, null);
        await logCompany(found.company.id, req.user.id, leaving ? "member_left" : "member_removed", targetId, { role: outcome.role });
      }
      res.status(outcome.status).json(outcome.body);
    } catch (error) {
      console.error("Company member remove error:", error);
      res.status(500).json({ message: "Couldn't remove that person." });
    }
  });

  /**
   * What has been done to the team and in the company's name, newest first.
   *
   * Paged by the id of the last row seen rather than by offset, so an entry
   * written while someone reads doesn't shift every later page by one. Names
   * are read now, not stored: a person who has since changed their name shows
   * under the name people know them by today.
   */
  app.get("/api/companies/:id/audit", isAuthenticated, async (req: any, res) => {
    try {
      const found = await companyCan(res, String(req.params.id), req.user.id, "manage_team");
      if (!found) return;
      const asked = Number(req.query.limit);
      const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, 100) : 50;

      const conds = [eq(companyAuditLog.companyId, found.company.id)];
      if (typeof req.query.before === "string" && req.query.before) {
        const [cursor] = await db.select({ id: companyAuditLog.id, createdAt: companyAuditLog.createdAt }).from(companyAuditLog)
          .where(and(eq(companyAuditLog.id, req.query.before), eq(companyAuditLog.companyId, found.company.id)));
        if (!cursor) return res.status(400).json({ message: "That page marker isn't valid.", code: "invalid_input", field: "before" });
        conds.push(or(
          lt(companyAuditLog.createdAt, cursor.createdAt),
          and(eq(companyAuditLog.createdAt, cursor.createdAt), lt(companyAuditLog.id, cursor.id)),
        )!);
      }

      const actorUser = alias(users, "actor_user");
      const actorProfile = alias(userProfiles, "actor_profile");
      const targetUser = alias(users, "target_user");
      const targetProfile = alias(userProfiles, "target_profile");
      const rows = await db.select({
        entry: companyAuditLog,
        actorFirst: actorUser.firstName, actorLast: actorUser.lastName, actorDisplay: actorProfile.displayName,
        targetFirst: targetUser.firstName, targetLast: targetUser.lastName, targetDisplay: targetProfile.displayName,
      })
        .from(companyAuditLog)
        .leftJoin(actorUser, eq(actorUser.id, companyAuditLog.actorId))
        .leftJoin(actorProfile, eq(actorProfile.userId, companyAuditLog.actorId))
        .leftJoin(targetUser, eq(targetUser.id, companyAuditLog.targetUserId))
        .leftJoin(targetProfile, eq(targetProfile.userId, companyAuditLog.targetUserId))
        .where(and(...conds))
        .orderBy(desc(companyAuditLog.createdAt), desc(companyAuditLog.id))
        .limit(limit);

      // An account that has since been deleted leaves its id null; say so rather than printing "Someone" as if it were a name.
      const nameOr = (id: string | null, first: string | null, last: string | null, display: string | null) =>
        id ? feedDisplayName({ firstName: first, lastName: last }, { displayName: display }) : null;
      res.json({
        entries: rows.map((r) => ({
          id: r.entry.id,
          action: r.entry.action,
          actorId: r.entry.actorId,
          actorName: nameOr(r.entry.actorId, r.actorFirst, r.actorLast, r.actorDisplay) ?? "A former account",
          targetUserId: r.entry.targetUserId,
          targetName: r.entry.targetUserId ? nameOr(r.entry.targetUserId, r.targetFirst, r.targetLast, r.targetDisplay) : null,
          detail: r.entry.detail ?? null,
          createdAt: r.entry.createdAt,
        })),
        nextBefore: rows.length === limit ? rows[rows.length - 1].entry.id : null,
      });
    } catch (error) {
      console.error("Company audit read error:", error);
      res.status(500).json({ message: "Couldn't load the activity." });
    }
  });
}
