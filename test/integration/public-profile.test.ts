/**
 * Someone's public profile is readable signed out, so it must carry only what
 * a profile page shows — never the account row (email, provider and payment
 * ids, plan, credits, role, suspension, signup attribution) — and a private
 * project only to its team.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { projects } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any) {
  const agent = request.agent(app);
  n += 1;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.100.${60 + n}`)
    .send({ email: `pub-${Date.now()}-${n}@example.test`, password: "Testpass123!", firstName: `P${n}`, lastName: "Public" });
  expect(res.status).toBe(201);
  return { agent, id: res.body.id as string };
}

describe("a public profile", () => {
  it("shows the profile, never the account, and no private projects", async () => {
    const app = await getTestApp();
    const [owner, stranger] = [await person(app), await person(app)];
    const make = async (title: string) => (await owner.agent.post("/api/projects").send({
      title, description: "A project on someone's public profile, for the privacy test.", category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body.id as string;
    const open = await make("Open One");
    const hidden = await make("Hidden One");
    await db.update(projects).set({ isPrivate: true } as any).where(eq(projects.id, hidden));

    const anonymous = await request(app).get(`/api/users/${owner.id}`);
    expect(anonymous.status).toBe(200);
    expect(Object.keys(anonymous.body).sort()).toEqual(["createdAt", "firstName", "id", "lastName", "profile", "profileImageUrl", "projects"]);
    expect(anonymous.body.projects.map((p: any) => p.id)).toEqual([open]);

    // Private projects aren't in public listings at all.
    expect((await stranger.agent.get(`/api/users/${owner.id}`)).body.projects.map((p: any) => p.id)).toEqual([open]);
    expect((await request(app).get("/api/users/not-a-user")).status).toBe(404);
  });

  it("never carries anyone else's account details in an embedded user, anywhere", async () => {
    const app = await getTestApp();
    const [owner, stranger] = [await person(app), await person(app)];
    const project = (await owner.agent.post("/api/projects").send({
      title: "Listed One", description: "A listed project whose owner's account details must stay private.", category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body.id as string;
    const PRIVATE = ["email", "googleId", "stripeCustomerId", "stripeSubscriptionId", "stripeConnectAccountId", "subscriptionTier", "creditsUsed", "platformRole", "suspendedAt", "suspendedReason", "signupSource", "signupParams"];

    for (const viewer of [request(app), stranger.agent]) {
      const list = (await viewer.get("/api/projects")).body;
      const listed = (Array.isArray(list) ? list : list.projects).find((p: any) => p.id === project);
      expect(listed.owner.firstName).toBeTruthy();
      for (const key of PRIVATE) expect(listed.owner, key).not.toHaveProperty(key);
    }

    // Your own account still comes back whole.
    const me = (await owner.agent.get("/api/auth/user")).body;
    expect(me.email).toMatch(/@example\.test$/);
  });
});
