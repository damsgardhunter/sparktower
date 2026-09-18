/**
 * The security console, and mostly who it refuses.
 *
 * These two routes hand out real power: one takes somebody's second factor off,
 * the other ends every session they hold. Until they existed, both were a shell
 * and a production database URL — which mattered more once recovery codes were
 * removed, because a person who loses their phone now depends entirely on an
 * operator being able to help them.
 *
 * So the happy path is the small half of this file. The rest is: an ordinary
 * account can't find it, a reviewer can't use it, an admin who hasn't passed
 * their own second factor can't either, nobody can disarm themselves, and
 * everything that happens is written somewhere that cannot be edited.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { passMfa } from "../helpers/mfa";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { users, moderationLog } from "@shared/schema";

let ownerEmail = "";
const previousOwner = process.env.PLATFORM_OWNER_EMAIL;
beforeAll(() => { ownerEmail = `sec-owner-${Date.now()}@example.test`; process.env.PLATFORM_OWNER_EMAIL = ownerEmail; });
afterAll(async () => {
  if (previousOwner === undefined) delete process.env.PLATFORM_OWNER_EMAIL;
  else process.env.PLATFORM_OWNER_EMAIL = previousOwner;
  await closeTestApp();
});

let n = 0;
const ip = () => `198.51.150.${20 + (n++ % 200)}`;
const password = "Testpass123!";

async function person(app: any, first: string, role?: "admin" | "reviewer", email?: string) {
  n += 1;
  const agent = request.agent(app);
  const address = email ?? `sec-${first.toLowerCase()}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip())
    .send({ email: address, password, firstName: first });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await verifyEmail(app, address, ip());
  if (role) await db.update(users).set({ platformRole: role }).where(eq(users.id, res.body.id));
  return { agent, id: res.body.id as string, email: address };
}

describe("who can reach the security console", () => {
  it("is not there for an ordinary account, a reviewer, or an admin who hasn't passed 2FA", async () => {
    const app = await getTestApp();

    const ordinary = await person(app, "Ordinary");
    expect((await ordinary.agent.get("/api/admin/security/overview")).status).toBe(404);

    // A reviewer can act on reports; this is not reports.
    const reviewer = await person(app, "Reviewer", "reviewer");
    await passMfa(reviewer.agent);
    expect((await reviewer.agent.get("/api/admin/security/overview")).status).toBe(404);

    // The role is right and the session isn't: 2FA not passed.
    const admin = await person(app, "Unverified", "admin");
    const refused = await admin.agent.get("/api/admin/security/overview");
    expect(refused.status).toBe(403);

    // Signed out entirely.
    expect((await request(app).get("/api/admin/security/overview")).status).toBe(401);
    expect((await request(app).post(`/api/admin/security/users/${ordinary.id}/reset-mfa`).send({ reason: "because I said so" })).status).toBe(401);
  });
});

describe("the overview", () => {
  it("shows who holds power and whether their sign-in is actually protected", async () => {
    const app = await getTestApp();
    const admin = await person(app, "Admin", "admin");
    await passMfa(admin.agent);
    // Somebody with a role and no second factor — the thing worth seeing at a glance.
    const exposed = await person(app, "NoFactor", "reviewer");

    const res = await admin.agent.get("/api/admin/security/overview");
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const rows = res.body.privileged as any[];
    expect(rows.find((r) => r.id === admin.id)?.twoFactor).toBe("on");
    expect(rows.find((r) => r.id === exposed.id)?.twoFactor).toBe("OFF");
    // Addresses are masked: an operator needs to tell accounts apart, not read everyone's email.
    expect(rows.find((r) => r.id === exposed.id)?.email).not.toBe(exposed.email);
    expect(rows.find((r) => r.id === exposed.id)?.email).toContain("@");

    expect(Array.isArray(res.body.refusalsLastDay)).toBe(true);
    expect(Array.isArray(res.body.recentActions)).toBe(true);
  });
});

describe("resetting somebody's second factor", () => {
  it("turns it off, ends every session they hold, and writes down why", async () => {
    const app = await getTestApp();
    const admin = await person(app, "Resetter", "admin");
    await passMfa(admin.agent);

    // Somebody with 2FA on and a session open.
    const locked = await person(app, "LockedOut");
    await passMfa(locked.agent);
    expect((await locked.agent.get("/api/auth/user")).status).toBe(200);

    const done = await admin.agent.post(`/api/admin/security/users/${locked.id}/reset-mfa`)
      .send({ reason: "Called them, confirmed the last four of their card and the project they own." });
    expect(done.status, JSON.stringify(done.body)).toBe(200);

    const [after] = await db.select().from(users).where(eq(users.id, locked.id));
    expect(after.mfaEnabledAt, "2FA is off").toBeNull();
    expect(after.mfaSecret).toBeNull();
    // A reset that left old sessions alive would be a way to keep access, not restore it.
    expect((await locked.agent.get("/api/auth/user")).status).toBe(401);

    const logged = await db.select().from(moderationLog).where(eq(moderationLog.targetUserId, locked.id));
    const entry = logged.find((l) => l.action === "security.reset_mfa");
    expect(entry, "the log is the point").toBeTruthy();
    expect(entry!.actorId).toBe(admin.id);
    expect(entry!.reason).toMatch(/Called them/);
  });

  it("refuses without a reason, and refuses to disarm the person asking", async () => {
    const app = await getTestApp();
    const admin = await person(app, "SelfReset", "admin");
    await passMfa(admin.agent);
    const other = await person(app, "Other");
    await passMfa(other.agent);

    const noReason = await admin.agent.post(`/api/admin/security/users/${other.id}/reset-mfa`).send({ reason: "lost" });
    expect(noReason.status).toBe(400);
    expect(noReason.body.field).toBe("reason");

    // A stolen admin session must not be able to remove the thing protecting it.
    const self = await admin.agent.post(`/api/admin/security/users/${admin.id}/reset-mfa`)
      .send({ reason: "I would like to remove my own second factor please." });
    expect(self.status).toBe(400);
    expect(self.body.code).toBe("no_self_reset");

    // And the account with no 2FA on is a plain refusal, not a silent success.
    const plain = await person(app, "Plain");
    const none = await admin.agent.post(`/api/admin/security/users/${plain.id}/reset-mfa`)
      .send({ reason: "They asked me to, over the phone, at length." });
    expect(none.status).toBe(400);
    expect(none.body.code).toBe("mfa_not_enabled");
  });
});

describe("signing an account out everywhere", () => {
  it("cuts the browser session and the phone, and logs it", async () => {
    const app = await getTestApp();
    const admin = await person(app, "Cutter", "admin");
    await passMfa(admin.agent);

    const compromised = await person(app, "Compromised");
    const phone = await request(app).post("/api/auth/mobile/login").set("x-forwarded-for", ip())
      .send({ email: compromised.email, password, device: "Phone" });
    expect(phone.status).toBe(200);
    const token = phone.body.accessToken as string;

    const done = await admin.agent.post(`/api/admin/security/users/${compromised.id}/sign-out`)
      .send({ reason: "Reported their laptop stolen this morning." });
    expect(done.status, JSON.stringify(done.body)).toBe(200);

    expect((await compromised.agent.get("/api/auth/user")).status, "the browser session").toBe(401);
    expect((await request(app).get("/api/auth/mobile/me").set("Authorization", `Bearer ${token}`)).status, "the phone").toBe(401);

    const logged = await db.select().from(moderationLog).where(eq(moderationLog.targetUserId, compromised.id));
    expect(logged.some((l) => l.action === "security.sign_out_everywhere")).toBe(true);
  });
});
