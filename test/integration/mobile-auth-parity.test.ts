/**
 * What the phone can do with a token, and what it could not do at all.
 *
 * Two things an audit of the mobile app raised, and they have different
 * answers.
 *
 * **Password recovery was missing.** Signing in was the only door in the app:
 * somebody who had forgotten their password had to find the website on a
 * laptop to get back into an app they had already installed. The screen is now
 * there, and these are the endpoint's side of the bargain — including the part
 * that matters most, that the answer is the same whether or not an account
 * exists, because a reset form that says "no account found" is a way of asking
 * which addresses are real.
 *
 * **The security screen calls the web's endpoints** — /api/auth/mfa/* and
 * /api/auth/change-password — rather than anything under /api/auth/mobile.
 * That reads as a mismatch and is in fact fine: `attachBearerUser` is mounted
 * above every guarded route, so a token satisfies them exactly as a cookie
 * does. But "fine because of where one line sits in routes.ts" is worth
 * pinning, because moving that line would break the phone's security screen
 * silently and no test would have noticed.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { users } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
let n = 0;

/** An account with a mobile session: the token is all the phone ever holds. */
async function onAPhone(app: any) {
  n += 1;
  const email = `mob-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const ip = `198.51.250.${(n % 200) + 20}`;
  const made = await request(app).post("/api/auth/mobile/register")
    .set("x-forwarded-for", ip).send({ email, password, firstName: "Mo", device: "Test phone" });
  // The mobile sign-up answers 200 with a session, where the web's answers 201 with a user.
  expect(made.status, `${made.status}: ${(made.text ?? "").slice(0, 200)}`).toBe(200);
  const token = made.body.accessToken as string;
  expect(token, "a mobile sign-up hands back a token").toBeTruthy();
  return { email, ip, token, id: made.body.user?.id ?? made.body.id };
}

describe("asking for a reset link from the phone", () => {
  it("answers the same for an address with an account and one without", async () => {
    const app = await getTestApp();
    const me = await onAPhone(app);

    const known = await request(app).post("/api/auth/forgot-password")
      .set("x-forwarded-for", "198.51.251.10").send({ email: me.email });
    const unknown = await request(app).post("/api/auth/forgot-password")
      .set("x-forwarded-for", "198.51.251.11").send({ email: `nobody-${Date.now()}@example.test` });

    expect(known.status, "an address with an account").toBe(200);
    expect(unknown.status, "and one without — the same answer, or the form is an address oracle").toBe(200);
    expect(unknown.body.ok).toBe(known.body.ok);
    expect(unknown.body.message, "word for word the same, whether or not the account exists").toBe(known.body.message);

    /*
     * The one field that differs is `devToken`, which the handler adds only
     * outside production so the development outbox and the tests can open the
     * link. Named here rather than ignored: if anything else ever tells the
     * two answers apart, this fails.
     */
    const extra = (body: any) => Object.keys(body).filter((k) => !["ok", "message"].includes(k));
    expect(extra(unknown.body)).toEqual([]);
    expect(extra(known.body).filter((k) => k !== "devToken")).toEqual([]);
  }, 120_000);

  it("needs no account and no token, which is the whole point of it", async () => {
    const app = await getTestApp();
    const res = await request(app).post("/api/auth/forgot-password")
      .set("x-forwarded-for", "198.51.251.12").send({ email: `locked-out-${Date.now()}@example.test` });
    expect(res.status).toBe(200);
  }, 120_000);
});

describe("the phone's security screen, on a bearer token", () => {
  it("reaches the web's own MFA and password endpoints", async () => {
    const app = await getTestApp();
    const me = await onAPhone(app);
    const auth = { Authorization: `Bearer ${me.token}` };

    /*
     * Not /api/auth/mobile/* — these are the web session's routes, and the
     * phone calls them with a token. If `attachBearerUser` ever stops running
     * before them, every one of these becomes a 401 and the security screen
     * silently stops working.
     */
    const who = await request(app).get("/api/auth/user").set(auth);
    expect(who.status, "the token is a session as far as these routes are concerned").toBe(200);
    expect(who.body.email).toBe(me.email);

    const setup = await request(app).post("/api/auth/mfa/setup").set(auth).send({});
    expect(setup.status, "two-factor setup").toBe(200);
    expect(setup.body.secret, "a secret to put in an authenticator app").toBeTruthy();

    const wrongPassword = await request(app).post("/api/auth/change-password").set(auth)
      .send({ currentPassword: "not-the-password", newPassword: "Testpass456!" });
    expect(wrongPassword.status, "reached the handler, and it checked the old password").toBe(401);

    const changed = await request(app).post("/api/auth/change-password").set(auth)
      .send({ currentPassword: password, newPassword: "An-entirely-different-one-42" });
    expect(changed.status, JSON.stringify(changed.body).slice(0, 200)).toBe(200);
  }, 180_000);

  it("refuses the same routes with no token at all", async () => {
    const app = await getTestApp();
    expect((await request(app).post("/api/auth/mfa/setup").send({})).status).toBe(401);
    expect((await request(app).post("/api/auth/change-password")
      .send({ currentPassword: password, newPassword: "Something-else-99" })).status).toBe(401);
  }, 120_000);
});
