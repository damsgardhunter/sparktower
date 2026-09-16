/**
 * Inviting a collaborator to a project: the rules both sides agree on.
 *
 * An invite is a link with a secret in it. The token is 32 random bytes
 * (256 bits) — unguessable — and only its SHA-256 is stored, so a database
 * read can't be turned into a working link. It works once, until it expires,
 * and can be revoked. An invite addressed to an email can only be accepted by
 * the account with that email; one without an email is for whoever the owner
 * hands the link to.
 */

export const INVITE_ROLES = ["Collaborator", "Cofounder", "Engineer", "Designer", "Marketer", "Advisor"] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export const INVITE_EXPIRY_DAYS = [1, 7, 14, 30] as const;
export const DEFAULT_INVITE_EXPIRY_DAYS = 7;
/** Invites one project may create in a day, across its whole team. */
export const INVITES_PER_PROJECT_PER_DAY = 25;
/** Pending invites a project may hold at once. */
export const MAX_PENDING_INVITES = 50;

/** The link to an invite, relative to the site. */
export const invitePath = (token: string) => `/invite/${token}`;
/** A token as it appears in a URL: base64url, 43 characters for 32 bytes. */
export const isInviteToken = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export function validateInviteInput(raw: { email?: unknown; role?: unknown; expiresInDays?: unknown }):
  | { ok: true; value: { email: string | null; role: InviteRole; expiresInDays: number } }
  | { ok: false; field: string; message: string } {
  const email = raw.email == null || String(raw.email).trim() === "" ? null : String(raw.email).trim().toLowerCase();
  if (email && (!EMAIL.test(email) || email.length > 254)) return { ok: false, field: "email", message: "That doesn't look like an email address." };
  const role = raw.role == null || raw.role === "" ? "Collaborator" : String(raw.role);
  if (!(INVITE_ROLES as readonly string[]).includes(role)) return { ok: false, field: "role", message: `Pick a role: ${INVITE_ROLES.join(", ")}.` };
  const days = raw.expiresInDays == null ? DEFAULT_INVITE_EXPIRY_DAYS : Number(raw.expiresInDays);
  if (!(INVITE_EXPIRY_DAYS as readonly number[]).includes(days)) return { ok: false, field: "expiresInDays", message: `An invite lasts ${INVITE_EXPIRY_DAYS.join(", ")} days.` };
  return { ok: true, value: { email, role: role as InviteRole, expiresInDays: days } };
}

export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export function inviteStatus(invite: { acceptedAt: Date | string | null; revokedAt: Date | string | null; expiresAt: Date | string }, now = new Date()): InviteStatus {
  if (invite.acceptedAt) return "accepted";
  if (invite.revokedAt) return "revoked";
  return new Date(invite.expiresAt).getTime() <= now.getTime() ? "expired" : "pending";
}

/** An email shown to someone holding the link, without handing the whole address to whoever finds it: "ja***@example.com". */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, Math.min(2, Math.max(1, local.length - 1)))}***@${domain}`;
}

/** Where a pending invite waits through sign up and onboarding in this browser. */
export const PENDING_INVITE_KEY = "st_pending_invite";

/**
 * The project someone has just joined, so the manage page can welcome them and
 * point at the next step. Set when an invite is accepted, read and cleared
 * once — it outlives the redirect through onboarding that a new account takes.
 */
export const JOINED_PROJECT_KEY = "st_joined_project";
