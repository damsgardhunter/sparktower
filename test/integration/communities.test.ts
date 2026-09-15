/**
 * Communities: the starter set is there for everyone, signed in or not;
 * joining counts you in once however often you tap; leaving takes you out;
 * and seeding again never duplicates a community.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { seedCommunities, SEED_COMMUNITIES } from "../../server/community-routes";

afterAll(async () => { await closeTestApp(); });

describe("communities", () => {
  it("lists the starter set, joins once, leaves, and seeds idempotently", async () => {
    const app = await getTestApp();
    await seedCommunities();
    await seedCommunities();

    const anon = (await request(app).get("/api/communities")).body;
    for (const seed of SEED_COMMUNITIES) expect(anon.filter((c: any) => c.slug === seed.slug)).toHaveLength(1);
    expect(anon.find((c: any) => c.slug === "ai-builders")).toMatchObject({ name: "AI Builders", joined: false });
    expect((await request(app).post("/api/communities/ai-builders/join")).status).toBe(401);

    const agent = request.agent(app);
    await agent.post("/api/auth/register").set("x-forwarded-for", "203.0.113.250").send({ email: `comm-${Date.now()}@example.test`, password: "Testpass123!", firstName: "Joiner" });
    const before = (await agent.get("/api/communities")).body.find((c: any) => c.slug === "ai-builders").members;

    const joined = await agent.post("/api/communities/ai-builders/join");
    expect(joined.status).toBe(200);
    expect(joined.body).toMatchObject({ slug: "ai-builders", joined: true, members: before + 1 });
    expect((await agent.post("/api/communities/ai-builders/join")).body.members).toBe(before + 1);
    expect((await agent.get("/api/communities")).body.find((c: any) => c.slug === "ai-builders").joined).toBe(true);
    expect((await agent.get("/api/communities")).body.find((c: any) => c.slug === "saas-founders").joined).toBe(false);

    const left = await agent.delete("/api/communities/ai-builders/join");
    expect(left.body).toMatchObject({ joined: false, members: before });
    expect((await agent.post("/api/communities/nope/join")).status).toBe(404);
  });
});
