/**
 * Two-factor sign-in for reviewers, admins and the platform owner.
 *
 *  - Roles that don't need it: sign-in is unchanged, and nothing asks for a code.
 *  - A reviewer without 2FA signs in, but privileged routes refuse until it's
 *    set up; setting it up verifies the session.
 *  - With 2FA on, the password alone gives no session; a code finishes the
 *    sign-in; a wrong, reused or expired code doesn't; a recovery code works once.
 *  - The platform owner (PLATFORM_OWNER_EMAIL) is held to the same rule.
 *  - Mobile: a challenge instead of tokens; tokens that passed carry it through refresh.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { users } from "@shared/schema";
import { passMfa, codeFor } from "../helpers/mfa";

const password = "Testpass123!";
let n = 0;
const ip = () => `198.51.106.${10 + (n++ % 200)}`;
async function account(app: any, first: string, email?: string) {
  const agent = request.agent(app);
  const address = email ?? `mfa-${first.toLowerCase()}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip()).send({ email: address, password, firstName: first });
  expect(res.status).toBe(201);
  return { agent, id: res.body.id as string, email: address };
}
const login = (app: any, email: string) => {
  const agent = request.agent(app);
  return { agent, res: agent.post("/api/auth/login").set("x-forwarded-for", ip()).send({ email, password }) };
};

let ownerEmail = "";
const previousOwner = process.env.PLATFORM_OWNER_EMAIL;
beforeAll(() => { ownerEmail = `mfa-owner-${Date.now()}@example.test`; process.env.PLATFORM_OWNER_EMAIL = ownerEmail; });
afterAll(async () => {
  // One process runs every file: later files expect the owner they set up.
  if (previousOwner === undefined) delete process.env.PLATFORM_OWNER_EMAIL;
  else process.env.PLATFORM_OWNER_EMAIL = previousOwner;
  await closeTestApp();
});

describe("two-factor sign-in", () => {
  it("leaves ordinary accounts alone: no code asked, no enrolment required, privileged routes still not theirs", async () => {
    const app = await getTestApp();
    const builder = await account(app, "Builder");
    const { agent, res } = login(app, builder.email);
    const r = await res;
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: builder.id, mfaEnrollmentRequired: false });
    expect(r.body.mfaRequired).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toMatch(/mfaSecret|mfaRecoveryCodes/);
    expect((await agent.get("/api/auth/user")).status).toBe(200);
    expect((await agent.get("/api/auth/mfa/status")).body).toEqual({ required: false, enabled: false, verified: false, recoveryCodesLeft: 0 });
    // Not a reviewer: the admin routes don't exist for them, 2FA or not.
    expect((await agent.get("/api/admin/reports")).status).toBe(404);
  });

  it("makes a reviewer set up 2FA before using review tools, then asks for a code at every sign-in", async () => {
    const app = await getTestApp();
    const reviewer = await account(app, "Reviewer");
    await db.update(users).set({ platformRole: "reviewer" }).where(eq(users.id, reviewer.id));

    // Signed in, but the review queue refuses until 2FA is on.
    const first = login(app, reviewer.email);
    expect((await first.res).body).toMatchObject({ mfaEnrollmentRequired: true });
    const refused = await first.agent.get("/api/admin/reports");
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("mfa_enrollment_required");

    // Setting it up: a wrong code doesn't; a right one turns it on and verifies this session.
    const setup = await first.agent.post("/api/auth/mfa/setup").send({});
    expect(setup.body.otpauthUrl).toContain(`secret=${setup.body.secret}`);
    expect((await first.agent.post("/api/auth/mfa/enable").send({ code: "000000" })).body.code).toBe("mfa_invalid_code");
    const enabled = await first.agent.post("/api/auth/mfa/enable").send({ code: codeFor(setup.body.secret) });
    expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
    expect(enabled.body.recoveryCodes).toHaveLength(10);
    expect((await first.agent.get("/api/admin/reports")).status).toBe(200);
    // Stored sealed, never plaintext, and never sent.
    const [row] = await db.select().from(users).where(eq(users.id, reviewer.id));
    expect(row.mfaSecret).toMatch(/^v1\./);
    expect(row.mfaSecret).not.toContain(setup.body.secret);
    expect(row.mfaRecoveryCodes).not.toContain(enabled.body.recoveryCodes[0]);
    expect(JSON.stringify((await first.agent.get("/api/auth/user")).body)).not.toMatch(/mfaSecret|v1\./);

    // Next sign-in: the password alone gives no session.
    const second = login(app, reviewer.email);
    const pw = await second.res;
    expect(pw.body).toEqual({ mfaRequired: true });
    expect((await second.agent.get("/api/auth/user")).status).toBe(401);
    expect((await second.agent.get("/api/admin/reports")).status).toBe(401);
    // A wrong code, then the right one (the next step: the enable code's step is spent).
    expect((await second.agent.post("/api/auth/mfa/verify").send({ code: "123456" })).body.code).toBe("mfa_invalid_code");
    const ok = await second.agent.post("/api/auth/mfa/verify").send({ code: codeFor(setup.body.secret, 1) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ id: reviewer.id, mfaMethod: "totp" });
    expect((await second.agent.get("/api/admin/reports")).status).toBe(200);
    expect((await second.agent.get("/api/auth/mfa/status")).body).toMatchObject({ required: true, enabled: true, verified: true });

    // The same code again, on a new sign-in: refused (a code works once). A recovery code works — once.
    const third = login(app, reviewer.email);
    await third.res;
    expect((await third.agent.post("/api/auth/mfa/verify").send({ code: codeFor(setup.body.secret, 1) })).body.code).toBe("mfa_invalid_code");
    const recovery = enabled.body.recoveryCodes[0];
    expect((await third.agent.post("/api/auth/mfa/verify").send({ code: recovery })).body.mfaMethod).toBe("recovery");
    const fourth = login(app, reviewer.email);
    await fourth.res;
    expect((await fourth.agent.post("/api/auth/mfa/verify").send({ code: recovery })).body.code).toBe("mfa_invalid_code");
    // Without a password first there's nothing to verify.
    expect((await request(app).post("/api/auth/mfa/verify").send({ code: codeFor(setup.body.secret) })).body.code).toBe("mfa_challenge_expired");
  });

  it("holds the platform owner to the same rule on the owner-only console", async () => {
    const app = await getTestApp();
    const owner = await account(app, "Owner", ownerEmail);
    const refused = await owner.agent.get("/api/admin/analytics/summary");
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("mfa_enrollment_required");
    await passMfa(owner.agent);
    expect((await owner.agent.get("/api/admin/analytics/summary")).status).toBe(200);
  });

  it("gives an enrolled account a challenge on mobile, and tokens that passed keep it through refresh", async () => {
    const app = await getTestApp();
    const admin = await account(app, "Admin");
    await db.update(users).set({ platformRole: "admin" }).where(eq(users.id, admin.id));
    const { secret } = await passMfa(admin.agent);

    const pw = await request(app).post("/api/auth/mobile/login").set("x-forwarded-for", ip()).send({ email: admin.email, password, device: "Test phone" });
    expect(pw.body.mfaRequired).toBe(true);
    expect(pw.body.accessToken).toBeUndefined();
    expect((await request(app).post("/api/auth/mobile/mfa/verify").set("x-forwarded-for", ip()).send({ challengeToken: "forged.token", code: codeFor(secret, 1) })).body.code).toBe("mfa_challenge_expired");
    const done = await request(app).post("/api/auth/mobile/mfa/verify").set("x-forwarded-for", ip()).send({ challengeToken: pw.body.challengeToken, code: codeFor(secret, 1), device: "Test phone" });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const bearer = (t: string) => request(app).get("/api/admin/reports").set("Authorization", `Bearer ${t}`);
    expect((await bearer(done.body.accessToken)).status).toBe(200);

    const refreshed = await request(app).post("/api/auth/mobile/refresh").set("x-forwarded-for", ip()).send({ refreshToken: done.body.refreshToken });
    expect((await bearer(refreshed.body.accessToken)).status).toBe(200);

    // A reviewer's tokens from before 2FA carry nothing: refused on privileged routes.
    const rev = await account(app, "MobileReviewer");
    await db.update(users).set({ platformRole: "reviewer" }).where(eq(users.id, rev.id));
    const plain = await request(app).post("/api/auth/mobile/login").set("x-forwarded-for", ip()).send({ email: rev.email, password });
    expect(plain.body).toMatchObject({ mfaEnrollmentRequired: true, accessToken: expect.any(String) });
    expect((await bearer(plain.body.accessToken)).body.code).toBe("mfa_enrollment_required");
    // And an ordinary account's mobile sign-in is unchanged.
    const user = await account(app, "MobileUser");
    const ordinary = await request(app).post("/api/auth/mobile/login").set("x-forwarded-for", ip()).send({ email: user.email, password });
    expect(ordinary.body).toMatchObject({ accessToken: expect.any(String), mfaEnrollmentRequired: false });
  });
});
