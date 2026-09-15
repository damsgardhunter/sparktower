/**
 * The whole path a new person takes, in order, in one session.
 *
 * Signup → profile → onboarding → project → an update post → its shared page.
 *
 * Each step is covered elsewhere in pieces, and each piece passing is not the
 * same claim as this one. What breaks a first run is almost never a handler in
 * isolation — it is a session cookie that doesn't survive the next request, an
 * onboarding gate that a provisioned profile fails, an id that comes back under
 * a different key than the next call expects. Those only show up when the steps
 * run against each other, which is what this does.
 *
 * `request.agent` keeps the cookie jar across requests, so this is one person
 * in one browser rather than six unrelated calls.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { projects } from "@shared/schema";

afterAll(async () => {
  await closeTestApp();
});

const password = "Testpass123!";
const newEmail = () => `loop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

describe("a new user can get all the way through the loop", () => {
  it("signs up, sets up, ships, and shares", async () => {
    const app = await getTestApp();
    const agent = request.agent(app);
    const email = newEmail();

    // --- Sign up ------------------------------------------------------
    const signup = await agent
      .post("/api/auth/register")
      .send({ email, password, firstName: "Casey", lastName: "Builder" });
    expect(signup.status).toBe(201);
    expect(signup.body.email).toBe(email);
    // A password hash must never leave the server, whatever it is asked for.
    expect(signup.body.passwordHash).toBeUndefined();

    // The session has to survive the next request or nothing below works.
    const me = await agent.get("/api/auth/user");
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);

    // --- The profile exists already -----------------------------------
    //
    // Provisioned at signup rather than left for the user to discover. The
    // client's onboarding redirect reads `profile && !profile.isOnboarded`,
    // which a *missing* profile fails — so a null here would let exactly the
    // accounts most in need of onboarding walk straight past it.
    const profile = await agent.get("/api/profile");
    expect(profile.status).toBe(200);
    expect(profile.body).not.toBeNull();
    expect(profile.body.isOnboarded).toBe(false);

    // --- Finish onboarding --------------------------------------------
    const onboarded = await agent.post("/api/profile/complete-onboarding").send({
      displayName: "Casey Builder",
      headline: "Building something small and useful",
      bio: "Here to ship weekly.",
      skills: ["typescript"],
    });
    expect([200, 201]).toContain(onboarded.status);

    const afterOnboarding = await agent.get("/api/profile");
    expect(afterOnboarding.body.isOnboarded).toBe(true);

    // --- Create a project ---------------------------------------------
    const project = await agent.post("/api/projects").send({
      title: "Weeknight Recipes",
      description: "A small app that plans a week of dinners from what's already in the fridge.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    });
    expect(project.status).toBe(200);
    const projectId = project.body.id;
    expect(projectId).toBeTruthy();

    // --- Post the first update -----------------------------------------
    const post = await agent.post("/api/feed").send({
      postType: "project_update",
      projectId,
      content: "Shipped the meal planner's week generator and wired it to the fridge inventory screen.",
      asks: ["Would you use a shopping list export?"],
    });
    expect(post.status).toBe(200);
    const postId = post.body.id;
    expect(postId).toBeTruthy();

    // --- It comes back on the project ----------------------------------
    const listed = await agent.get(`/api/feed?projectId=${projectId}`);
    expect(listed.status).toBe(200);
    expect(listed.body.posts.map((p: any) => p.id)).toContain(postId);

    // --- And the shared link works for a stranger -----------------------
    //
    // The whole point of the loop's last step. Fetched with a bare client, no
    // cookie jar: someone who has never heard of this site opening a link.
    const stranger = await request(app).get(`/api/feed/${postId}`);
    expect(stranger.status).toBe(200);
    expect(stranger.body.content).toContain("week generator");
  });

  it("keeps a private project's update out of a stranger's hands", async () => {
    const app = await getTestApp();
    const agent = request.agent(app);

    await agent
      .post("/api/auth/register")
      .send({ email: newEmail(), password, firstName: "Private", lastName: "Builder" });

    const project = await agent.post("/api/projects").send({
      title: "Quiet Project",
      description: "Something being worked on without an audience yet.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    });
    const projectId = project.body.id;

    const post = await agent.post("/api/feed").send({
      postType: "project_update", projectId,
      content: "Wrote up the two versions and picked the smaller one to build first.",
    });
    expect(post.status).toBe(200);
    const id = post.body.id;

    /*
     * The control first: while the project is public the post is reachable
     * and listed — otherwise the assertions below could be satisfied by a
     * post that never went anywhere.
     */
    expect((await request(app).get(`/api/feed/${id}`)).status).toBe(200);
    expect((await request(app).get(`/api/feed?projectId=${projectId}`)).body.posts.map((p: any) => p.id)).toContain(id);

    // Private projects are a paid plan; set the flag directly, it is the thing under test.
    await db.update(projects).set({ isPrivate: true }).where(eq(projects.id, projectId));

    // Not by its link, and not turning up anywhere a stranger could find it.
    expect((await request(app).get(`/api/feed/${id}`)).status).toBe(404);
    expect((await request(app).get(`/api/feed?projectId=${projectId}`)).body.posts.map((p: any) => p.id)).not.toContain(id);
    expect((await request(app).get("/api/feed?limit=50")).body.posts.map((p: any) => p.id)).not.toContain(id);

    // Nor its comments or reactions: a signed-in stranger with the id can't read, comment or react.
    const outsider = request.agent(app);
    await outsider.post("/api/auth/register").set("x-forwarded-for", "198.51.100.199").send({ email: newEmail(), password, firstName: "Outside" });
    expect((await outsider.get(`/api/feed/${id}/comments`)).status).toBe(404);
    expect((await request(app).get(`/api/feed/${id}/comments`)).status).toBe(404);
    expect((await outsider.post(`/api/feed/${id}/comments`).send({ content: "Found your private post." })).status).toBe(404);
    expect((await outsider.post(`/api/feed/${id}/react`).send({ reaction: "like" })).status).toBe(404);

    // The team still sees it, and can still talk on it.
    expect((await agent.get(`/api/feed/${id}`)).status).toBe(200);
    expect((await agent.post(`/api/feed/${id}/comments`).send({ content: "Team note on the private update." })).status).toBe(200);
    expect((await agent.get(`/api/feed/${id}/comments`)).body.some((c: any) => c.content === "Team note on the private update.")).toBe(true);
  });
});
