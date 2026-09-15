/**
 * Finishing a sprint: in review each partner rates the other once, sees their
 * own rating (so the page knows they've rated) but not their partner's until
 * it's over, and can't rate on someone else's behalf. Converting to a project
 * twice opens the same project. And a contest knows you've joined it.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { cofounderSprints, contests, surfaceFlags } from "@shared/schema";
import { loadSurfaceFlags } from "../../server/surfaces";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, first: string) {
  const agent = request.agent(app);
  n += 1;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.100.${210 + n}`)
    .send({ email: `sprint-${first}-${Date.now()}-${n}@example.test`, password: "Testpass123!", firstName: first });
  expect(res.status).toBe(201);
  return { agent, id: res.body.id as string };
}
const scores = { communicationClarity: 4, reliability: 5, wouldBuildLongTerm: true, stressLevel: 2 };

describe("sprint review and contests", () => {
  it("rates once each, blind until completed, and converts to one project", async () => {
    const app = await getTestApp();
    const [a, b] = [await person(app, "Ana"), await person(app, "Ben")];
    const outsider = await person(app, "Out");
    const [sprint] = await db.insert(cofounderSprints).values({
      user1Id: a.id, user2Id: b.id, duration: "24h", status: "building", productName: `Pairly ${Date.now()}`, productDescription: "A product two builders agreed on.",
    } as any).returning();

    expect((await a.agent.post(`/api/sprints/${sprint.id}/ratings`).send(scores)).status).toBe(400);
    await db.update(cofounderSprints).set({ status: "review" } as any).where(eq(cofounderSprints.id, sprint.id));

    const forged = await a.agent.post(`/api/sprints/${sprint.id}/ratings`).send({ ...scores, raterId: b.id, rateeId: a.id });
    expect(forged.status).toBe(200);
    expect(forged.body).toMatchObject({ raterId: a.id, rateeId: b.id });
    expect((await a.agent.post(`/api/sprints/${sprint.id}/ratings`).send(scores)).status).toBe(409);
    expect((await b.agent.post(`/api/sprints/${sprint.id}/ratings`).send({ ...scores, reliability: 9 })).status).toBe(400);
    expect((await b.agent.post(`/api/sprints/${sprint.id}/ratings`).send(scores)).status).toBe(200);

    const mineInReview = (await a.agent.get(`/api/sprints/${sprint.id}/ratings`)).body;
    expect(mineInReview.map((r: any) => r.raterId)).toEqual([a.id]);
    expect((await outsider.agent.get(`/api/sprints/${sprint.id}/ratings`)).status).toBe(403);

    await db.update(cofounderSprints).set({ status: "completed" } as any).where(eq(cofounderSprints.id, sprint.id));
    expect((await a.agent.get(`/api/sprints/${sprint.id}/ratings`)).body).toHaveLength(2);

    const first = await a.agent.post(`/api/sprints/${sprint.id}/convert`);
    expect(first.status).toBe(200);
    const again = await b.agent.post(`/api/sprints/${sprint.id}/convert`);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
  });

  it("tells a signed-in user they've joined a contest", async () => {
    const app = await getTestApp();
    const me = await person(app, "Racer");
    // Contests ship on, but a flag row can switch them off; pin them on for this test, and clear it after.
    const setContests = async (enabled: boolean) => {
      await db.insert(surfaceFlags).values({ surfaceId: "contests", enabled } as any).onConflictDoUpdate({ target: surfaceFlags.surfaceId, set: { enabled } as any });
      await loadSurfaceFlags();
    };
    await setContests(true);
    try {
    const [contest] = await db.insert(contests).values({
      title: "Weekend Build", description: "Ship something small.", category: "saas", status: "active",
      startDate: new Date(Date.now() - 86_400_000), endDate: new Date(Date.now() + 86_400_000),
    } as any).returning();
    const joined = await me.agent.post(`/api/contests/${contest.id}/join`);
    expect(joined.status).toBeLessThan(300);
    expect((await me.agent.get(`/api/contests/${contest.id}`)).body.isParticipant).toBe(true);
    expect((await me.agent.get("/api/contests")).body.find((c: any) => c.id === contest.id)?.isParticipant).toBe(true);
    } finally {
      await db.delete(surfaceFlags).where(eq(surfaceFlags.surfaceId, "contests"));
      await loadSurfaceFlags();
    }
  });
});
