/**
 * What a stranger can read off the wire.
 *
 * Responses are scrubbed centrally (server/app.ts), which works well for rows
 * that look like accounts and not at all for anything else: a payment row, a
 * name built by hand, a file sent with res.send. Each case below leaked through
 * one of those seams.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { donations, projects, userProfiles, users } from "@shared/schema";
import { verifyEmail } from "../helpers/verify-email";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `wire-${first}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.115.${10 + n}`).send({ email, password: "Testpass123!", firstName: first });
  expect(res.status).toBe(201);
  await verifyEmail(app, email, `198.51.116.${10 + n}`);
  return { agent, id: res.body.id as string, email };
}

describe("what leaves the server", () => {
  it("shows a backer wall without the payment's identifiers", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Creator");
    const backer = await person(app, "Backer");
    const project = (await owner.agent.post("/api/projects").send({
      title: `Funded ${Date.now()}`, description: "A project with a donation on its public wall.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body;
    await db.insert(donations).values({
      projectId: project.id, donorId: backer.id, amount: 2500, message: "Go well",
      stripeSessionId: `cs_${Date.now()}`, stripePaymentIntentId: `pi_${Date.now()}`, stripeChargeId: `ch_${Date.now()}`,
    });

    const wall = await request(app).get(`/api/projects/${project.id}/donations`);
    expect(wall.status).toBe(200);
    expect(wall.body).toHaveLength(1);
    expect(wall.body[0]).toMatchObject({ amount: 2500, message: "Go well", refunded: false });
    // The things a stranger has no business with: who paid, and the payment's ids.
    const text = JSON.stringify(wall.body);
    for (const leak of ["donorId", "stripeSessionId", "stripePaymentIntentId", "stripeChargeId", backer.id]) {
      expect(text, `${leak} is on the public wall`).not.toContain(leak);
    }
  });

  it("never publishes an email address as somebody's name", async () => {
    const app = await getTestApp();
    const poster = await person(app, "Poster");
    // An account with no display name and no first name — registration allows it.
    const agent = request.agent(app);
    const email = `nameless-${Date.now()}@example.test`;
    const res = await agent.post("/api/auth/register").set("x-forwarded-for", "198.51.117.10").send({ email, password: "Testpass123!" });
    expect(res.status).toBe(201);
    await verifyEmail(app, email, "198.51.117.11");
    /*
     * The shape this guards: no display name, no first name. Sign-up allows it,
     * and a profile made from an address like 123456@… gets no name either,
     * because the digits are stripped out (server/user-provisioning.ts).
     */
    await db.update(users).set({ firstName: "", lastName: "" }).where(eq(users.id, res.body.id));
    await db.update(userProfiles).set({ displayName: null }).where(eq(userProfiles.userId, res.body.id));

    const post = await poster.agent.post("/api/feed").send({ postType: "looking_for_help", content: "Anyone around to look at an early build of mine?" });
    expect(post.status).toBe(200);
    expect((await agent.post(`/api/feed/${post.body.id}/react`).send({ reaction: "like" })).status).toBe(200);

    // Whoever reads the post sees a name built for publication — never the address.
    const reactions = await request(app).get(`/api/feed/${post.body.id}/reactions`);
    expect(reactions.status).toBe(200);
    const theirs = (reactions.body as any[]).find((r) => r.userId === res.body.id);
    expect(theirs?.name).toBe("Someone");
    expect(JSON.stringify(reactions.body), "an address reached a signed-out reader").not.toContain(email);
  });

  it("keeps money and security state off other people's account rows", async () => {
    const app = await getTestApp();
    const subject = await person(app, "Subject");
    const stranger = await person(app, "Stranger");
    await db.update(users).set({
      paymentFailedAt: new Date(), paymentFailureMessage: "Your card was declined",
      mfaEnabledAt: new Date(), emailVerifiedAt: new Date(),
    }).where(eq(users.id, subject.id));
    await subject.agent.post("/api/projects").send({
      title: `Listed ${Date.now()}`, description: "A project that puts its owner on a public list.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    });

    for (const path of ["/api/projects", "/api/leaderboard"]) {
      const res = await stranger.agent.get(path);
      const text = JSON.stringify(res.body);
      for (const field of ["paymentFailedAt", "paymentFailureMessage", "mfaEnabledAt", "emailVerifiedAt", "accessTokensRevokedAt"]) {
        expect(text, `${field} is visible on ${path}`).not.toContain(field);
      }
      expect(text, `an email is visible on ${path}`).not.toContain(subject.email);
    }
  });

  it("keeps the sealed data source out of an account export", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Exporter");
    const project = (await owner.agent.post("/api/projects").send({
      title: `Exported ${Date.now()}`, description: "A project whose sealed connection must not travel in a download.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body;
    await db.update(projects).set({ dataSource: "sealed:zzzz-not-a-real-connection" }).where(eq(projects.id, project.id));

    const res = await owner.agent.get("/api/account/export");
    expect(res.status).toBe(200);
    const body = res.text;
    expect(body).toContain("Exported");
    expect(body, "the sealed data source travelled in the export").not.toContain("zzzz-not-a-real-connection");
    expect(body).not.toContain("data_source");
    expect(body).not.toContain("passwordHash");
  });
});
