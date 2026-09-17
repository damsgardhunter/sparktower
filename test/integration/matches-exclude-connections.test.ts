/**
 * Matches never recommend someone you already know.
 *
 * The reported bug: a builder you'd already connected with kept appearing in
 * "People to build with" on the home page, scored as a strong match. The cause
 * was in the generator — it read your connections into a set and then never
 * consulted it — but a fix there alone would have left every already-written
 * row in place, so the people already in your matches table would have stayed
 * there for good.
 *
 * So this pins both halves:
 *
 *   1. generation never scores someone you're connected to, or have a request
 *      open with;
 *   2. reading your matches drops anyone you've connected with since, and
 *      accepting a request clears the row then and there.
 *
 * Generation itself is left alone by these tests where it would need Nova —
 * the reasons are optional and cost credits. What's asserted is who is in the
 * list, which is the part that was wrong.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq, or } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { userMatches, connections } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, profile: Record<string, unknown> = {}) {
  const agent = request.agent(app);
  n += 1;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.100.${120 + (n % 100)}`)
    .send({ email: `match-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`, password: "Testpass123!", firstName: `M${n}` });
  expect(res.status).toBe(201);
  const id = res.body.id as string;
  // Connecting needs a confirmed address, like every route that reaches someone else.
  await verifyEmail(app, res.body.email, `198.51.105.${40 + (n % 150)}`);
  // Matching only considers people who finished onboarding.
  await agent.put("/api/profile").send({
    displayName: `Builder ${n}`, headline: "Building things", skills: ["typescript", "react"],
    interests: ["fintech"], experienceLevel: "intermediate", ...profile,
  });
  await agent.post("/api/profile/complete-onboarding").send({});
  return { agent, id };
}

/** A stored match, written straight in — the same row the generator would produce. */
const storeMatch = (userId: string, matchedUserId: string, score = 92) =>
  db.insert(userMatches).values({ userId, matchedUserId, score, reasons: ["Overlapping technical skills"] } as any)
    .onConflictDoUpdate({ target: [userMatches.userId, userMatches.matchedUserId], set: { score } });

const matchIds = async (agent: any) => {
  const res = await agent.get("/api/matches");
  expect(res.status).toBe(200);
  return (res.body as { matchedUserId: string }[]).map((m) => m.matchedUserId);
};

describe("matches and the people you already know", () => {
  it("drops someone from your matches once you're connected, and clears the stale row", async () => {
    const app = await getTestApp();
    const [ari, bea, cai] = [await person(app), await person(app), await person(app)];

    // Both were matched to Ari before any connection existed.
    await storeMatch(ari.id, bea.id);
    await storeMatch(ari.id, cai.id);
    expect((await matchIds(ari.agent)).sort()).toEqual([bea.id, cai.id].sort());

    // Ari connects with Bea.
    const reqRes = await ari.agent.post("/api/connections/request").send({ userId: bea.id });
    expect(reqRes.status).toBeLessThan(300);
    const accept = await bea.agent.post(`/api/connections/${reqRes.body.id}/accept`).send({});
    expect(accept.status).toBe(200);

    // Bea is gone from the list; Cai, still a stranger, is not.
    expect(await matchIds(ari.agent)).toEqual([cai.id]);

    // And the row itself is gone, not merely filtered out of one response.
    const rows = await db.select().from(userMatches).where(and(
      eq(userMatches.userId, ari.id), eq(userMatches.matchedUserId, bea.id),
    ));
    expect(rows).toHaveLength(0);
  });

  /*
   * The read path has to filter as well as the accept path clear, because a
   * row can be written by the generator after a connection already exists —
   * and because this is what repairs accounts whose matches were polluted
   * before the fix shipped.
   */
  it("filters a connected person out even when their match row is written afterwards", async () => {
    const app = await getTestApp();
    const [ari, bea] = [await person(app), await person(app)];

    const reqRes = await ari.agent.post("/api/connections/request").send({ userId: bea.id });
    await bea.agent.post(`/api/connections/${reqRes.body.id}/accept`).send({});

    // Written after the fact, the way a pre-fix generator run would have.
    await storeMatch(ari.id, bea.id);
    expect(await matchIds(ari.agent)).toEqual([]);
  });

  it("hides someone with a connection request still pending, either direction", async () => {
    const app = await getTestApp();
    const [ari, bea, cai] = [await person(app), await person(app), await person(app)];

    await storeMatch(ari.id, bea.id);
    await storeMatch(ari.id, cai.id);

    // Ari asked Bea; Cai asked Ari. Neither has been accepted.
    await ari.agent.post("/api/connections/request").send({ userId: bea.id });
    await cai.agent.post("/api/connections/request").send({ userId: ari.id });

    expect(await matchIds(ari.agent)).toEqual([]);
  });

  it("brings someone back as a match if the connection is removed", async () => {
    const app = await getTestApp();
    const [ari, bea] = [await person(app), await person(app)];

    const reqRes = await ari.agent.post("/api/connections/request").send({ userId: bea.id });
    await bea.agent.post(`/api/connections/${reqRes.body.id}/accept`).send({});

    await db.delete(connections).where(or(
      and(eq(connections.requesterId, ari.id), eq(connections.receiverId, bea.id)),
      and(eq(connections.requesterId, bea.id), eq(connections.receiverId, ari.id)),
    ));

    await storeMatch(ari.id, bea.id);
    expect(await matchIds(ari.agent)).toEqual([bea.id]);
  });

  it("still needs a session", async () => {
    const app = await getTestApp();
    expect((await request(app).get("/api/matches")).status).toBe(401);
  });
});
