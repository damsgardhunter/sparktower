/**
 * What a half-finished account can and cannot do.
 *
 * Before this, the answer was "everything", and the only thing stopping it was
 * a redirect in the client. Every write route gated on `isAuthenticated`
 * alone, so an account that signed in with Google and never finished could
 * post, comment, connect and enter a contest by calling the API directly —
 * the requirement held only for people who used the interface.
 *
 * That was hidden while the redirect sent everyone to the form before they
 * could reach anything. Letting people in to look around is what makes it
 * visible, so these tests are the rule itself rather than a description of it.
 *
 * The line: an action that puts this person in front of somebody else waits
 * for a profile. Reading, following and reacting do not — a follow is a
 * bookmark and a reaction is a number, and neither carries a claim about who
 * you are.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { userProfiles, projects, feedPosts } from "@shared/schema";
import { ONBOARDING_REQUIRED_CODE } from "@shared/onboarding";

afterAll(async () => { await closeTestApp(); });

let n = 0;
/** An account exactly as a Google sign-in leaves it: a row, and nothing filled in. */
async function halfFinished(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const ip = `198.51.196.${(n % 200) + 20}`;
  const email = `onb-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: first });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

/** The same account, with the five things the rule asks for. */
async function finish(userId: string) {
  await db.update(userProfiles).set({
    displayName: "Finished Person", skills: ["SQL"], hoursPerWeek: 20,
    riskTolerance: "moderate", scheduleStyle: "flexible",
  } as any).where(eq(userProfiles.userId, userId));
}

const project = async (ownerId: string) => (await db.insert(projects).values({
  ownerId, title: `Gate ${++n}`, description: "Something being built.", category: "saas", status: "active",
} as any).returning())[0];

describe("a half-finished account", () => {
  it("is refused a connection request, and told what is missing", async () => {
    const app = await getTestApp();
    const me = await halfFinished(app, "Newby");
    const them = await halfFinished(app, "Other");

    const res = await me.agent.post("/api/connections/request").send({ userId: them.id });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ONBOARDING_REQUIRED_CODE);
    /* The refusal names the action and the gap, so it is not a dead end. */
    expect(res.body.message).toContain("connect with somebody");
    expect(res.body.missing, "the client needs the fields, not just prose").toContain("skills");
    expect(res.body.missingLabels.join(" ")).toContain("skill");
  });

  it("is refused a message", async () => {
    const app = await getTestApp();
    const me = await halfFinished(app, "Quiet");
    const them = await halfFinished(app, "Target");
    const res = await me.agent.post(`/api/messages/${them.id}`).send({ content: "hello" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ONBOARDING_REQUIRED_CODE);
  });

  it("is refused a post and a comment", async () => {
    const app = await getTestApp();
    const me = await halfFinished(app, "Loud");
    const owner = await halfFinished(app, "Owner");
    await finish(owner.id);
    const p = await project(owner.id);

    const post = await me.agent.post("/api/feed").send({ content: "Hello everyone", postType: "project_update" });
    expect(post.status).toBe(403);
    expect(post.body.code).toBe(ONBOARDING_REQUIRED_CODE);

    const comment = await me.agent.post(`/api/projects/${p.id}/comments`).send({ content: "Nice work" });
    expect(comment.status).toBe(403);
    expect(comment.body.code).toBe(ONBOARDING_REQUIRED_CODE);
  });

  /*
   * Looking is the whole point of letting them in, so none of this is gated.
   * A follow is a bookmark; a reaction is a number. Neither says who you are.
   */
  it("can still follow a project", async () => {
    const app = await getTestApp();
    const me = await halfFinished(app, "Browser");
    const owner = await halfFinished(app, "Maker");
    await finish(owner.id);
    const p = await project(owner.id);

    const res = await me.agent.post(`/api/projects/${p.id}/follow`);
    expect(res.status, (res.text ?? "").slice(0, 200)).toBeLessThan(400);
  });

  it("can still react to a post", async () => {
    const app = await getTestApp();
    const me = await halfFinished(app, "Reactor");
    const author = await halfFinished(app, "Author");
    await finish(author.id);
    const [post] = await db.insert(feedPosts).values({
      authorId: author.id, content: "Shipping today.", postType: "project_update",
    } as any).returning();

    const res = await me.agent.post(`/api/feed/${post.id}/react`).send({ reaction: "like" });
    expect(res.status, (res.text ?? "").slice(0, 200)).toBeLessThan(400);
  });

  it("can still read the feed and open a project", async () => {
    const app = await getTestApp();
    const me = await halfFinished(app, "Reader");
    const owner = await halfFinished(app, "Builder");
    await finish(owner.id);
    const p = await project(owner.id);

    expect((await me.agent.get("/api/feed")).status).toBeLessThan(400);
    expect((await me.agent.get(`/api/projects/${p.id}`)).status).toBeLessThan(400);
  });
});

describe("once the profile is finished", () => {
  it("the same actions go through", async () => {
    const app = await getTestApp();
    const me = await halfFinished(app, "Ready");
    const them = await halfFinished(app, "Friend");
    await finish(me.id);
    await finish(them.id);

    const connect = await me.agent.post("/api/connections/request").send({ userId: them.id });
    expect(connect.status, (connect.text ?? "").slice(0, 200)).toBeLessThan(400);

    const post = await me.agent.post("/api/feed").send({ content: "Hello everyone", postType: "project_update" });
    expect(post.status, (post.text ?? "").slice(0, 200)).toBeLessThan(400);
  });

  /*
   * One missing answer is enough. The working-style questions are the ones a
   * person is most likely to skip and the ones matching most needs.
   */
  it("one unanswered question is still unfinished", async () => {
    const app = await getTestApp();
    const me = await halfFinished(app, "Almost");
    const them = await halfFinished(app, "Someone");
    await finish(me.id);
    await db.update(userProfiles).set({ scheduleStyle: null } as any).where(eq(userProfiles.userId, me.id));

    const res = await me.agent.post("/api/connections/request").send({ userId: them.id });
    expect(res.status).toBe(403);
    expect(res.body.missing).toEqual(["scheduleStyle"]);
  });
});
