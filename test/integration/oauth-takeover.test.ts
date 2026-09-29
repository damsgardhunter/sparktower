/**
 * The oldest trick against an app that offers both a password and Google.
 *
 *   1. Somebody registers victim@gmail.com with a password of their choosing.
 *      Nothing stops them, and nothing should: requiring a verified address
 *      before an account exists would leave people waiting on an email before
 *      they can use anything.
 *   2. The real owner of that address later clicks Sign in with Google.
 *   3. The address matches, so Google is attached to the account somebody else
 *      made — and the real owner is signed into it while the squatter's
 *      password still works. Two people in one account, one of them unaware.
 *
 * The rule that closes it: when the account never proved it owns the address
 * and Google just did, Google wins. These drive the real linking path, which is
 * what both the web strategy and the mobile token exchange call.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { users } from "@shared/schema";
import { authStorage } from "../../server/replit_integrations/auth/storage";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const ip = () => `198.51.123.${20 + (n++ % 200)}`;
const squatterPassword = "Squatter123!";

describe("someone else registered your address first", () => {
  it("puts the squatter out when Google proves the address", async () => {
    const app = await getTestApp();
    const address = `victim-${Date.now()}@example.test`;

    // 1. The squatter registers the victim's address and signs in with it.
    const squatter = request.agent(app);
    const made = await squatter.post("/api/auth/register").set("x-forwarded-for", ip())
      .send({ email: address, password: squatterPassword, firstName: "Squatter" });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const userId = made.body.id as string;
    expect((await squatter.get("/api/auth/user")).status, "the squatter is inside").toBe(200);

    // 2. The real owner signs in with Google, which is what this call is.
    const linked = await authStorage.linkGoogleAccount(userId, `google-${Date.now()}`);

    // 3. It is the same account — the owner keeps whatever is in it — but the squatter is out.
    expect(linked.id).toBe(userId);
    expect(linked.googleId).toBeTruthy();
    expect(linked.passwordHash, "the password somebody else chose must stop working").toBeNull();
    expect(linked.emailVerifiedAt, "Google proved the address, so it counts as proved").toBeTruthy();

    // The password is refused now.
    const tryOldPassword = await request(app).post("/api/auth/login").set("x-forwarded-for", ip())
      .send({ email: address, password: squatterPassword });
    expect(tryOldPassword.status).toBe(401);

    // And the session they were already holding is gone.
    expect((await squatter.get("/api/auth/user")).status, "the squatter's session must be cut").toBe(401);
  });

  it("leaves a verified account alone — that is just linking", async () => {
    const app = await getTestApp();
    const address = `owner-${Date.now()}@example.test`;

    const owner = request.agent(app);
    const made = await owner.post("/api/auth/register").set("x-forwarded-for", ip())
      .send({ email: address, password: squatterPassword, firstName: "Owner" });
    expect(made.status).toBe(201);
    // This account proved the address itself, so both parties have.
    await verifyEmail(app, address, ip());

    const linked = await authStorage.linkGoogleAccount(made.body.id, `google-${Date.now()}`);
    expect(linked.googleId).toBeTruthy();
    expect(linked.passwordHash, "a verified account keeps its password").toBeTruthy();

    // And it still signs in, with the session it already had.
    expect((await owner.get("/api/auth/user")).status).toBe(200);
    const again = await request(app).post("/api/auth/login").set("x-forwarded-for", ip())
      .send({ email: address, password: squatterPassword });
    expect(again.status).toBe(200);
  });

  it("cuts the mobile tokens too, not only the browser session", async () => {
    const app = await getTestApp();
    const address = `mobile-victim-${Date.now()}@example.test`;

    const made = await request(app).post("/api/auth/mobile/register").set("x-forwarded-for", ip())
      .send({ email: address, password: squatterPassword, firstName: "Squatter" });
    expect(made.status, JSON.stringify(made.body).slice(0, 200)).toBe(200);
    const token = made.body.accessToken as string;
    expect((await request(app).get("/api/auth/mobile/me").set("Authorization", `Bearer ${token}`)).status).toBe(200);

    await authStorage.linkGoogleAccount(made.body.user.id, `google-${Date.now()}`);

    const after = await request(app).get("/api/auth/mobile/me").set("Authorization", `Bearer ${token}`);
    expect(after.status, "a token issued to the squatter must stop working").toBe(401);

    const [row] = await db.select().from(users).where(eq(users.email, address));
    expect(row.accessTokensRevokedAt).toBeTruthy();
  });
});

/**
 * The same rules, for Apple — and the one place they have to differ.
 *
 * Apple is not Google. "Hide My Email" hands over a relay address invented for
 * this app, which is deliverable and is *not* proof that the person owns any
 * mailbox somebody else might have registered. So the identity is trusted
 * enough to sign in with, and not enough to take a password off an account
 * that claimed the address first. A shared real address, which Apple marks
 * verified, behaves exactly as Google does.
 *
 * These drive `linkAppleAccount` directly. The route above it is the part that
 * decides `proved`, from `email_verified` and `is_private_email` on a token
 * signed by Apple — which cannot be forged here and is not what these are
 * about.
 */
describe("signing in with Apple, against an address somebody already used", () => {
  it("joins the existing account rather than making a second one", async () => {
    const app = await getTestApp();
    const address = `apple-join-${Date.now()}@example.test`;

    const owner = request.agent(app);
    const made = await owner.post("/api/auth/register").set("x-forwarded-for", ip())
      .send({ email: address, password: squatterPassword, firstName: "Owner" });
    expect(made.status).toBe(201);
    await verifyEmail(app, address, ip());

    const before = await db.select().from(users).where(eq(users.email, address));
    expect(before).toHaveLength(1);

    const linked = await authStorage.linkAppleAccount(before[0].id, `apple-sub-${Date.now()}`, true);

    const after = await db.select().from(users).where(eq(users.email, address));
    expect(after, "one address, one account").toHaveLength(1);
    expect(after[0].id, "and it is the one that was already there").toBe(before[0].id);
    expect(linked.appleId).toBeTruthy();
    expect(linked.authProvider).toBe("apple");
  }, 60_000);

  it("puts a squatter out when Apple proves a shared address", async () => {
    const app = await getTestApp();
    const address = `apple-victim-${Date.now()}@example.test`;

    const squatter = request.agent(app);
    const made = await squatter.post("/api/auth/register").set("x-forwarded-for", ip())
      .send({ email: address, password: squatterPassword, firstName: "Squatter" });
    expect(made.status).toBe(201);
    // Deliberately never verified: that is the whole of the squatter's problem.

    const [row] = await db.select().from(users).where(eq(users.email, address));
    const linked = await authStorage.linkAppleAccount(row.id, `apple-sub-${Date.now()}`, true);

    expect(linked.passwordHash, "the password somebody else chose is gone").toBeNull();
    expect(linked.emailVerifiedAt, "and the address counts as proved").not.toBeNull();
    expect(linked.accessTokensRevokedAt, "every token issued before now is dead").not.toBeNull();
  }, 60_000);

  it("leaves the password alone when Apple only hands over a relay address", async () => {
    /*
     * The difference that matters. A relay address proves the person owns
     * *that* relay — which Apple made for them — and nothing about the real
     * address an account was registered with. Clearing a password on that
     * basis would be handing the account over on weaker evidence than Google
     * ever gives.
     */
    const app = await getTestApp();
    const address = `apple-relay-${Date.now()}@example.test`;

    const squatter = request.agent(app);
    expect((await squatter.post("/api/auth/register").set("x-forwarded-for", ip())
      .send({ email: address, password: squatterPassword, firstName: "Squatter" })).status).toBe(201);

    const [row] = await db.select().from(users).where(eq(users.email, address));
    const linked = await authStorage.linkAppleAccount(row.id, `apple-sub-${Date.now()}`, false);

    expect(linked.appleId, "they are still signed in").toBeTruthy();
    expect(linked.passwordHash, "but nothing was taken from anybody").not.toBeNull();
    expect(linked.emailVerifiedAt, "and the address is still unproved").toBeNull();
  }, 60_000);
});
