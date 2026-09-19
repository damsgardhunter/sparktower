/**
 * Getting out of a sprint.
 *
 * There are two ways to be committed to one, and until now only the first had
 * a way back:
 *
 *   - waiting in the matchmaking queue — `DELETE /api/sprints/queue`, which
 *     already existed and is driven from the web and the phone;
 *   - actually being in a sprint with somebody — which had no exit at all.
 *     The only ends were finishing it, or stopping without saying so, and a
 *     partner looking at a sprint nobody is answering can't tell which of
 *     those happened.
 *
 * Leaving ends the sprint for both people rather than removing one of them. A
 * co-founder sprint is two people by definition; one with a single participant
 * isn't a shorter sprint, it's a broken one. The row stays, marked `abandoned`
 * with who left — the other person spent hours in it, and a sprint that
 * vanishes reads as a bug.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { cofounderSprints } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

/*
 * A range no other spec uses. Registering counts against the per-address
 * sign-in limit, so two files sharing one address share one budget and the
 * second to run is refused — which surfaces here as a registration that
 * doesn't return 201, nowhere near the thing under test.
 */
let n = 0;
const password = "Testpass123!";

async function person(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `sprint-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.170.${10 + (n % 200)}`)
    .send({ email, password, firstName: first });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await verifyEmail(app, email, `198.51.171.${10 + (n % 200)}`);
  await agent.post("/api/profile/complete-onboarding").send({ displayName: first });
  return { agent, id: res.body.id as string, email };
}

/**
 * A sprint between two people, written straight in.
 *
 * Going through matchmaking would make these tests about matchmaking: it needs
 * two people queued with compatible options and a pairing to land between
 * them. What's under test is the exit, so the sprint is created directly and
 * the route does the rest.
 */
async function sprintBetween(a: { id: string }, b: { id: string }, over: Record<string, unknown> = {}) {
  const [row] = await db.insert(cofounderSprints).values({
    user1Id: a.id, user2Id: b.id, duration: "24h", status: "building", ...over,
  } as any).returning();
  return row;
}

const statusOf = async (id: string) =>
  (await db.select().from(cofounderSprints).where(eq(cofounderSprints.id, id)))[0];

describe("leaving a sprint", () => {
  it("ends it for both, records who left and why, and tells the partner", async () => {
    const app = await getTestApp();
    const ari = await person(app, "Ari");
    const bea = await person(app, "Bea");
    const sprint = await sprintBetween(ari, bea);

    const left = await ari.agent.post(`/api/sprints/${sprint.id}/leave`)
      .send({ reason: "Work got in the way this week." });
    expect(left.status, JSON.stringify(left.body)).toBe(200);
    expect(left.body.partnerNotified, "the other person must be told").toBe(true);

    const after = await statusOf(sprint.id);
    expect(after.status).toBe("abandoned");
    expect(after.abandonedById, "who left is the point — the partner is shown it").toBe(ari.id);
    expect(after.abandonedAt).toBeTruthy();
    expect(after.abandonReason).toBe("Work got in the way this week.");

    // The partner hears about it, and the notification leads to the sprint itself.
    await expect.poll(async () => {
      const bell = await (await bea.agent.get("/api/notifications")).json?.() ?? (await bea.agent.get("/api/notifications")).body;
      return (bell.items ?? []).some((x: any) => x.kind === "sprint_left");
    }).toBe(true);

    const bell = (await bea.agent.get("/api/notifications")).body;
    const item = bell.items.find((x: any) => x.kind === "sprint_left");
    expect(item.text).toMatch(/left your sprint/i);
    expect(item.href, "the link should reach the sprint, not a list").toBe(`/sprints/${sprint.id}`);
  });

  it("can be left by either side", async () => {
    const app = await getTestApp();
    const ari = await person(app, "Ari");
    const bea = await person(app, "Bea");
    const sprint = await sprintBetween(ari, bea);

    // The second person in the row, not just the first.
    expect((await bea.agent.post(`/api/sprints/${sprint.id}/leave`).send({})).status).toBe(200);
    expect((await statusOf(sprint.id)).abandonedById).toBe(bea.id);
  });

  it("refuses someone who isn't in it", async () => {
    const app = await getTestApp();
    const ari = await person(app, "Ari");
    const bea = await person(app, "Bea");
    const zed = await person(app, "Zed");
    const sprint = await sprintBetween(ari, bea);

    expect((await zed.agent.post(`/api/sprints/${sprint.id}/leave`).send({})).status).toBe(403);
    expect((await statusOf(sprint.id)).status, "a stranger must not end someone else's sprint").toBe("building");
  });

  /*
   * Both partners pressing Leave at the same moment. The write is conditional
   * on the status, so the first one lands and the second is told it's over
   * rather than overwriting who left.
   */
  it("keeps the first answer when both leave at once", async () => {
    const app = await getTestApp();
    const ari = await person(app, "Ari");
    const bea = await person(app, "Bea");
    const sprint = await sprintBetween(ari, bea);

    const [one, two] = await Promise.all([
      ari.agent.post(`/api/sprints/${sprint.id}/leave`).send({}),
      bea.agent.post(`/api/sprints/${sprint.id}/leave`).send({}),
    ]);
    const codes = [one.status, two.status].sort();
    expect(codes, "exactly one should succeed").toEqual([200, 400]);

    const after = await statusOf(sprint.id);
    expect(after.status).toBe("abandoned");
    expect([ari.id, bea.id]).toContain(after.abandonedById);
  });

  it("refuses to leave a sprint that already ended", async () => {
    const app = await getTestApp();
    const ari = await person(app, "Ari");
    const bea = await person(app, "Bea");
    const done = await sprintBetween(ari, bea, { status: "completed" });

    const res = await ari.agent.post(`/api/sprints/${done.id}/leave`).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("already_over");
    expect((await statusOf(done.id)).status, "a finished sprint stays finished").toBe("completed");
  });

  it("404s for a sprint that doesn't exist, and 401s with no session", async () => {
    const app = await getTestApp();
    const ari = await person(app, "Ari");
    expect((await ari.agent.post("/api/sprints/00000000-0000-0000-0000-000000000000/leave").send({})).status).toBe(404);
    expect((await request(app).post("/api/sprints/whatever/leave").send({})).status).toBe(401);
  });

  /*
   * A practice sprint stores the same person in both columns, with Nova as the
   * partner. Leaving one must not try to notify the person who left.
   */
  it("notifies nobody when a practice sprint is left", async () => {
    const app = await getTestApp();
    const ari = await person(app, "Ari");
    const solo = await sprintBetween(ari, ari, { isPractice: true });

    const res = await ari.agent.post(`/api/sprints/${solo.id}/leave`).send({});
    expect(res.status).toBe(200);
    expect(res.body.partnerNotified, "there is no partner to tell").toBe(false);
    expect((await statusOf(solo.id)).status).toBe("abandoned");
  });

  /*
   * Leaving doesn't strand you. Joining the queue is a paid feature, so a free
   * account gets the upgrade prompt rather than a place in it — that's the
   * product's gate, not a leftover from the sprint. What matters here is that
   * nothing about having left blocks the next step, and that stopping looking
   * still works whatever the tier.
   */
  it("leaves you free afterwards — the only thing in the way is the plan", async () => {
    const app = await getTestApp();
    const ari = await person(app, "Ari");
    const bea = await person(app, "Bea");
    const sprint = await sprintBetween(ari, bea);
    expect((await ari.agent.post(`/api/sprints/${sprint.id}/leave`).send({})).status).toBe(200);

    const joined = await ari.agent.post("/api/sprints/queue").send({ duration: "24h" });
    expect(joined.status, "a free account is stopped by the plan, not by the sprint it left").toBe(402);
    expect(joined.body.code).toBe("upgrade_required");

    // Leaving the queue is not gated: you can always stop looking.
    expect((await ari.agent.delete("/api/sprints/queue")).status).toBe(200);
  });

});
