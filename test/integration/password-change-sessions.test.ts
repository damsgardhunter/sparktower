/**
 * Changing a password ends every other session — web and mobile.
 *
 * Without this test, the thing a password change is *for* could quietly stop
 * working. Somebody changes their password because they believe someone else
 * has it; if the other browser keeps its cookie, or the phone keeps minting
 * access tokens off a refresh token issued before the change, the person has
 * changed a string and evicted nobody. That failure is invisible from the
 * outside — the endpoint still answers 200 — so nothing but a test that holds
 * two sessions at once can tell the difference.
 *
 * The other half is just as easy to break in the other direction: the session
 * doing the changing must survive. A "safer" one-line change to delete every
 * session row for the account signs the person out of the page they are
 * standing on, which is why the caller's own `sid` is spared and asserted here.
 */
import { describe, it, expect, afterAll } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";

afterAll(async () => { await closeTestApp(); });

const OLD_PASSWORD = "Testpass123!";
const NEW_PASSWORD = "Rotated-Pass-456!";

/** What /api/auth/change-password reports about what it ended. */
interface ChangePasswordBody {
  ok: boolean;
  sessionsEnded: number;
  devicesSignedOut: number;
}

/** The payload every mobile auth endpoint returns (server/mobile-auth.ts, `buildSession`). */
interface MobileSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string } | null;
}

describe("changing a password", () => {
  it("keeps the session that changed it and ends every other one, on the web and on a phone", async () => {
    const app: Express = await getTestApp();
    const email = `pcs-${Date.now()}@example.test`;

    // Browser A: the person at the keyboard, who will do the changing.
    const browserA = request.agent(app);
    const registered = await browserA.post("/api/auth/register")
      .set("x-forwarded-for", "198.51.100.11")
      .send({ email, password: OLD_PASSWORD, firstName: "Pat" });
    expect(registered.status).toBe(201);

    // Browser B: the seat somebody else is sitting in. A separate agent, so it
    // has its own cookie jar and its own session row — the thing under test.
    const browserB = request.agent(app);
    expect((await browserB.post("/api/auth/login")
      .set("x-forwarded-for", "198.51.100.12").send({ email, password: OLD_PASSWORD })).status).toBe(200);
    expect((await browserB.get("/api/auth/user")).status).toBe(200);

    // And a phone, holding both halves of a mobile session.
    const signedIn = await request(app).post("/api/auth/mobile/login")
      .set("x-forwarded-for", "198.51.100.13").send({ email, password: OLD_PASSWORD, device: "Pixel 8" });
    expect(signedIn.status).toBe(200);
    const phone = signedIn.body as MobileSession;
    // Proof the token works *before* the change, so a 401 afterwards means the
    // change did it rather than the token having been broken all along.
    expect((await request(app).get("/api/auth/mobile/me")
      .set("Authorization", `Bearer ${phone.accessToken}`)).status).toBe(200);

    const changed = await browserA.post("/api/auth/change-password")
      .send({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    const report = changed.body as ChangePasswordBody;
    /*
     * The counts are the only thing an operator ever sees, so they have to
     * describe what happened: browser B's row and nothing else (browser A's is
     * spared), and the phone's one refresh token. A count that drifts from
     * reality — the session rows are found by digging into `sess->passport`,
     * which a session-store change could silently invalidate — would read as a
     * successful sign-out of nobody.
     */
    expect(report).toMatchObject({ ok: true, sessionsEnded: 1, devicesSignedOut: 1 });

    // The person doing it is still signed in on the page they are standing on.
    expect((await browserA.get("/api/auth/user")).status).toBe(200);
    // The other seat is not.
    expect((await browserB.get("/api/auth/user")).status).toBe(401);

    // The phone's access token is unexpired but revoked: refused now, not in fifteen minutes.
    expect((await request(app).get("/api/auth/mobile/me")
      .set("Authorization", `Bearer ${phone.accessToken}`)).status).toBe(401);
    // And it can't quietly mint a replacement, which would make the revocation a delay rather than an eviction.
    const refreshed = await request(app).post("/api/auth/mobile/refresh")
      .set("x-forwarded-for", "198.51.100.14").send({ refreshToken: phone.refreshToken });
    expect(refreshed.status).toBe(401);
    expect(refreshed.body).toMatchObject({ code: "refresh_invalid" });

    // The precondition the rest of it rests on: the password really changed.
    expect((await request(app).post("/api/auth/login")
      .set("x-forwarded-for", "198.51.100.15").send({ email, password: OLD_PASSWORD })).status).toBe(401);
    expect((await request(app).post("/api/auth/login")
      .set("x-forwarded-for", "198.51.100.16").send({ email, password: NEW_PASSWORD })).status).toBe(200);
    // Including on mobile, which is a different code path to the same hash.
    expect((await request(app).post("/api/auth/mobile/login")
      .set("x-forwarded-for", "198.51.100.17").send({ email, password: NEW_PASSWORD })).status).toBe(200);
  });
});
