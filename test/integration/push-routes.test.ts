/**
 * The four routes between a phone and being buzzed.
 *
 * `push.test.ts` holds the sending logic to its promises. This is the other
 * half: who may call these, what they refuse, and whether the answers are the
 * shape the app reads. Three of them matter more than they look.
 *
 * **Registering is not authenticated by the token.** A push token is an address,
 * not a credential, so the route has to be the thing that decides whose device
 * this is — which means it must require a session, and must take the user from
 * that session rather than from the body.
 *
 * **Forgetting must be scoped.** A token is a string somebody could learn. If
 * the delete is not scoped to its owner, knowing one is enough to silence
 * somebody else's phone, and they would never find out why.
 *
 * **Turning push off must not drop the devices.** Somebody who wants a quiet
 * week and then changes their mind should not have to reinstall the app.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { pushTokens, users } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any) {
  const agent = request.agent(app);
  n += 1;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.101.${40 + (n % 150)}`)
    .send({ email: `push-r-${Date.now()}-${n}@example.test`, password: "Testpass123!", firstName: "Pat" });
  expect(res.status).toBe(201);
  await verifyEmail(app, res.body.email, `198.51.105.${40 + (n % 150)}`);
  return { agent, id: res.body.id as string };
}

const addr = (s: string) => `ExponentPushToken[route-${s}-${Date.now()}-${Math.random().toString(36).slice(2)}]`;

describe("registering a device", () => {
  it("needs a session, because the route decides whose phone this is", async () => {
    const app = await getTestApp();
    /*
     * The token in the body says nothing about who holds it. If this were open,
     * anybody could register an address against anybody.
     */
    const res = await request(app).post("/api/push/token").send({ token: addr("anon"), platform: "ios" });
    expect(res.status).toBe(401);
  });

  it("stores the address against the signed-in person", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const token = addr("mine");
    await me.agent.post("/api/push/token").send({ token, platform: "ios", device: "iPhone 15" }).expect(200);

    const [row] = await db.select().from(pushTokens).where(eq(pushTokens.token, token));
    expect(row.userId).toBe(me.id);
    expect(row.platform).toBe("ios");
    expect(row.device).toBe("iPhone 15");
  });

  it("ignores a userId in the body, and takes the person from the session", async () => {
    /*
     * The hole this closes: registering an address against somebody else, so
     * that their notifications arrive on your phone. Nothing in a push token
     * says whose it is, so the session is the only thing that can decide — and
     * a route that reads the body "as a convenience" hands the decision to the
     * caller.
     */
    const app = await getTestApp();
    const victim = await person(app);
    const attacker = await person(app);
    const token = addr("idor");
    await attacker.agent.post("/api/push/token")
      .send({ token, platform: "ios", userId: victim.id, recipientId: victim.id })
      .expect(200);

    const [row] = await db.select().from(pushTokens).where(eq(pushTokens.token, token));
    expect(row.userId, "the device belongs to whoever is signed in, never to whoever the body names").toBe(attacker.id);
  });

  it("refuses something that isn't an Expo token, saying which field", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const res = await me.agent.post("/api/push/token").send({ token: "hello", platform: "ios" });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe("token");
  });

  it("refuses an unknown platform", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const res = await me.agent.post("/api/push/token").send({ token: addr("web"), platform: "web" });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe("platform");
  });

  it("takes the same token twice without making a second row", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const token = addr("twice");
    await me.agent.post("/api/push/token").send({ token, platform: "android" }).expect(200);
    await me.agent.post("/api/push/token").send({ token, platform: "android" }).expect(200);
    expect(await db.select().from(pushTokens).where(eq(pushTokens.token, token))).toHaveLength(1);
  });
});

describe("forgetting a device", () => {
  it("forgets your own", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const token = addr("bye");
    await me.agent.post("/api/push/token").send({ token, platform: "ios" }).expect(200);
    await me.agent.delete("/api/push/token").send({ token }).expect(200);
    expect(await db.select().from(pushTokens).where(eq(pushTokens.token, token))).toHaveLength(0);
  });

  it("cannot silence somebody else's phone with a token they happen to know", async () => {
    const app = await getTestApp();
    const mine = await person(app);
    const theirs = await person(app);
    const token = addr("theirs");
    await theirs.agent.post("/api/push/token").send({ token, platform: "ios" }).expect(200);

    /* 200, because signing out should not depend on the server agreeing — but the row stays. */
    await mine.agent.delete("/api/push/token").send({ token }).expect(200);
    const rows = await db.select().from(pushTokens).where(eq(pushTokens.token, token));
    expect(rows, "a push token is a string; it must not be a key to anyone's notifications").toHaveLength(1);
    expect(rows[0].userId).toBe(theirs.id);
  });

  it("is happy about a token it has never seen, because sign-out has to finish", async () => {
    const app = await getTestApp();
    const me = await person(app);
    await me.agent.delete("/api/push/token").send({ token: addr("never") }).expect(200);
  });
});

describe("the switch", () => {
  it("starts on, and lists this person's devices", async () => {
    const app = await getTestApp();
    const me = await person(app);
    await me.agent.post("/api/push/token").send({ token: addr("one"), platform: "ios" }).expect(200);
    await me.agent.post("/api/push/token").send({ token: addr("two"), platform: "android" }).expect(200);

    const res = await me.agent.get("/api/push/state").expect(200);
    /*
     * Default on, because granting the OS permission is the opt-in and asking
     * twice for the same consent is how a dialog gets dismissed.
     */
    expect(res.body.enabled).toBe(true);
    expect(res.body.devices).toHaveLength(2);
  });

  it("shows nobody else's devices", async () => {
    const app = await getTestApp();
    const mine = await person(app);
    const theirs = await person(app);
    await theirs.agent.post("/api/push/token").send({ token: addr("notmine"), platform: "ios" }).expect(200);
    const res = await mine.agent.get("/api/push/state").expect(200);
    expect(res.body.devices).toHaveLength(0);
  });

  it("goes off and back on without losing the devices", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const token = addr("keepme");
    await me.agent.post("/api/push/token").send({ token, platform: "ios" }).expect(200);

    await me.agent.patch("/api/push/state").send({ enabled: false }).expect(200);
    const [off] = await db.select({ on: users.pushEnabled }).from(users).where(eq(users.id, me.id));
    expect(off.on).toBe(false);
    expect(
      await db.select().from(pushTokens).where(eq(pushTokens.token, token)),
      "turning push back on should not need a reinstall",
    ).toHaveLength(1);

    await me.agent.patch("/api/push/state").send({ enabled: true }).expect(200);
    const [on] = await db.select({ on: users.pushEnabled }).from(users).where(eq(users.id, me.id));
    expect(on.on).toBe(true);
  });

  it("refuses anything that isn't on or off", async () => {
    const app = await getTestApp();
    const me = await person(app);
    /* A missing or stringly value must not read as "off" and quietly go silent. */
    for (const body of [{}, { enabled: "false" }, { enabled: 0 }, { enabled: null }]) {
      const res = await me.agent.patch("/api/push/state").send(body);
      expect(res.status, `PATCH ${JSON.stringify(body)} should be refused`).toBe(400);
    }
    const [row] = await db.select({ on: users.pushEnabled }).from(users).where(eq(users.id, me.id));
    expect(row.on).toBe(true);
  });

  it("needs a session", async () => {
    const app = await getTestApp();
    await request(app).get("/api/push/state").expect(401);
    await request(app).patch("/api/push/state").send({ enabled: false }).expect(401);
    await request(app).delete("/api/push/token").send({ token: addr("x") }).expect(401);
  });
});
