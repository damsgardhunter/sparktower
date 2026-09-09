/**
 * The whole path a new person takes, in order, in one session.
 *
 * Signup → profile → onboarding → project → check-in → the shared permalink.
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
import { getTestApp, closeTestApp } from "../helpers/app";

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
      category: "saas", goal: "ship_mvp",
    });
    expect(project.status).toBe(200);
    const projectId = project.body.id;
    expect(projectId).toBeTruthy();

    // --- Post the first check-in ---------------------------------------
    const checkIn = await agent.post(`/api/projects/${projectId}/check-ins`).send({
      goal: "Get the meal planner generating a full week",
      proof: "Shipped the generator and wired it to the fridge inventory screen",
      nextStep: "Add a shopping list export",
      visibility: "public",
      needsFeedback: true,
    });
    expect(checkIn.status).toBe(200);
    const checkInId = checkIn.body.id;
    expect(checkInId).toBeTruthy();

    // --- It comes back on the project ----------------------------------
    const listed = await agent.get(`/api/projects/${projectId}/check-ins`);
    expect(listed.status).toBe(200);
    const ids = (Array.isArray(listed.body) ? listed.body : listed.body.checkIns ?? [])
      .map((c: any) => c.id);
    expect(ids).toContain(checkInId);

    // --- And the shared link works for a stranger -----------------------
    //
    // The whole point of the loop's last step. Fetched with a bare client, no
    // cookie jar: someone who has never heard of this site opening a link.
    const stranger = await request(app).get(`/api/check-ins/${checkInId}`);
    expect(stranger.status).toBe(200);
    expect(stranger.body.goal).toBe("Get the meal planner generating a full week");
  });

  it("keeps an unlisted check-in out of a stranger's hands", async () => {
    const app = await getTestApp();
    const agent = request.agent(app);

    await agent
      .post("/api/auth/register")
      .send({ email: newEmail(), password, firstName: "Private", lastName: "Builder" });

    const project = await agent.post("/api/projects").send({
      title: "Quiet Project",
      description: "Something being worked on without an audience yet.",
      category: "saas", goal: "ship_mvp",
    });

    const checkIn = await agent.post(`/api/projects/${project.body.id}/check-ins`).send({
      goal: "Work out whether this idea is worth continuing",
      proof: "Wrote up the two versions and picked the smaller one",
      nextStep: "Build the smaller one",
      // The default, stated here because it is the thing under test.
      visibility: "unlisted",
      /*
       * Asked for, deliberately. The queue filters on `needsFeedback = true`
       * AND `visibility = 'public'`, so leaving this false would keep the row
       * out via the wrong condition — the test would pass identically with the
       * visibility guard deleted, which is the same as not testing it. With
       * this true, visibility is the only thing holding it back.
       */
      needsFeedback: true,
    });
    expect(checkIn.status).toBe(200);
    const id = checkIn.body.id;

    /*
     * Unlisted means "reachable by anyone holding the link, listed nowhere" —
     * so a stranger with the link is *allowed*. What must not happen is it
     * turning up somewhere they could have found it without one.
     */
    const direct = await request(app).get(`/api/check-ins/${id}`);
    expect(direct.status).toBe(200);

    const queue = await request(app).get("/api/check-ins/queue/needs-feedback");
    const listedIds = (Array.isArray(queue.body) ? queue.body : queue.body?.checkIns ?? [])
      .map((c: any) => c.id);
    expect(listedIds).not.toContain(id);

    // And the control: the same check-in, made public, does reach the queue —
    // otherwise the assertion above could be satisfied by an empty queue.
    await agent.patch(`/api/check-ins/${id}`).send({ visibility: "public" });
    const publicQueue = await request(app).get("/api/check-ins/queue/needs-feedback");
    const publicIds = (Array.isArray(publicQueue.body) ? publicQueue.body : publicQueue.body?.checkIns ?? [])
      .map((c: any) => c.id);
    expect(publicIds).toContain(id);
  });
});
