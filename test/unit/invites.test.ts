/** Invite rules: what an invite may carry, when it's usable, and how an address is shown to a link holder. */
import { describe, it, expect } from "vitest";
import { inviteStatus, isInviteToken, maskEmail, validateInviteInput, DEFAULT_INVITE_EXPIRY_DAYS } from "@shared/invites";
import { newInviteToken, hashInviteToken } from "../../server/invite-routes";

describe("invites", () => {
  it("makes 256-bit URL-safe tokens that are never reused, and stores a hash that isn't the token", () => {
    const tokens = new Set(Array.from({ length: 2000 }, newInviteToken));
    expect(tokens.size).toBe(2000);
    const t = newInviteToken();
    expect(isInviteToken(t)).toBe(true);
    expect(Buffer.from(t, "base64url")).toHaveLength(32);
    expect(hashInviteToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(t)).not.toContain(t);
    for (const bad of ["", "short", `${t}x`, "a".repeat(42) + "!", null]) expect(isInviteToken(bad)).toBe(false);
  });

  it("validates the input, with sensible defaults", () => {
    expect(validateInviteInput({})).toEqual({ ok: true, value: { email: null, role: "Collaborator", expiresInDays: DEFAULT_INVITE_EXPIRY_DAYS } });
    expect(validateInviteInput({ email: " Jane@Example.COM ", role: "Engineer", expiresInDays: 14 })).toEqual({ ok: true, value: { email: "jane@example.com", role: "Engineer", expiresInDays: 14 } });
    expect(validateInviteInput({ email: "not-an-email" })).toMatchObject({ ok: false, field: "email" });
    expect(validateInviteInput({ role: "Owner" })).toMatchObject({ ok: false, field: "role" });
    expect(validateInviteInput({ expiresInDays: 365 })).toMatchObject({ ok: false, field: "expiresInDays" });
  });

  it("is usable only while pending — not accepted, revoked or past its expiry", () => {
    const now = new Date("2026-09-15T12:00:00Z");
    const base = { acceptedAt: null, revokedAt: null, expiresAt: new Date("2026-09-16T12:00:00Z") };
    expect(inviteStatus(base, now)).toBe("pending");
    expect(inviteStatus({ ...base, expiresAt: new Date("2026-09-15T12:00:00Z") }, now)).toBe("expired");
    expect(inviteStatus({ ...base, revokedAt: now }, now)).toBe("revoked");
    expect(inviteStatus({ ...base, acceptedAt: now, revokedAt: now }, now)).toBe("accepted");
  });

  it("masks the address a link was sent to", () => {
    expect(maskEmail("jane@example.com")).toBe("ja***@example.com");
    expect(maskEmail("j@x.io")).toBe("j***@x.io");
  });
});
