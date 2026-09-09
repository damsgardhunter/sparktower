/**
 * The flows the product is actually for: make a project, ship an update, get a
 * reply.
 *
 * Everything else on the site exists to support this sequence, so a regression
 * here is worse than a regression anywhere else — and the permission edges are
 * the part nobody exercises by hand, because doing so means keeping two
 * accounts and remembering which one you're signed into.
 *
 * The membership rules the tests below pin down:
 *   - a check-in may only be posted by the project's owner or a member
 *   - a private project is invisible to everyone else, and 404s rather than
 *     403s so its existence isn't confirmed
 *   - a comment must belong to the project it claims to be on
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { users } from "@shared/schema";

afterAll(async () => {
  await closeTestApp();
});

const password = "Testpass123!";
const newEmail = () => `wedge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

/** A signed-in agent, with the cookie jar held for the rest of the test. */
async function signedIn(app: any, label: string) {
  const agent = request.agent(app);
  const email = newEmail();
  const res = await agent
    .post("/api/auth/register")
    .send({ email, password, firstName: label, lastName: "Tester" });
  expect(res.status).toBe(201);
  return { agent, email, userId: res.body.id as string };
}

const aProject = (overrides: Record<string, unknown> = {}) => ({
  title: "Weeknight Recipes",
  description: "Plans a week of dinners from what is already in the fridge.",
  category: "saas", goal: "ship_mvp",
  ...overrides,
});

const aCheckIn = (overrides: Record<string, unknown> = {}) => ({
  goal: "Get the meal planner generating a full week",
  proof: "Shipped the generator and wired it to the fridge inventory screen",
  nextStep: "Add a shopping list export",
  ...overrides,
});

describe("create a project", () => {
  it("succeeds for a signed-in user and comes back on their list", async () => {
    const app = await getTestApp();
    const { agent } = await signedIn(app, "Owner");

    const created = await agent.post("/api/projects").send(aProject());
    expect(created.status).toBe(200);
    expect(created.body.id).toBeTruthy();
    expect(created.body.title).toBe("Weeknight Recipes");

    const mine = await agent.get("/api/user/projects");
    expect(mine.status).toBe(200);
    expect(mine.body.map((p: any) => p.id)).toContain(created.body.id);
  });

  it("refuses an anonymous caller", async () => {
    const app = await getTestApp();
    await request(app).post("/api/projects").send(aProject()).expect(401);
  });
});

describe("post a check-in", () => {
  it("attaches to the project and is listed on it", async () => {
    const app = await getTestApp();
    const { agent } = await signedIn(app, "Owner");

    const project = await agent.post("/api/projects").send(aProject());
    const checkIn = await agent
      .post(`/api/projects/${project.body.id}/check-ins`)
      .send(aCheckIn({ visibility: "public" }));

    expect(checkIn.status).toBe(200);
    expect(checkIn.body.projectId).toBe(project.body.id);
    expect(checkIn.body.goal).toBe("Get the meal planner generating a full week");

    const listed = await agent.get(`/api/projects/${project.body.id}/check-ins`);
    const ids = (Array.isArray(listed.body) ? listed.body : listed.body.checkIns ?? [])
      .map((c: any) => c.id);
    expect(ids).toContain(checkIn.body.id);
  });

  it("rejects a check-in from someone who is not on the project", async () => {
    const app = await getTestApp();
    const owner = await signedIn(app, "Owner");
    const stranger = await signedIn(app, "Stranger");

    const project = await owner.agent.post("/api/projects").send(aProject());

    const attempt = await stranger.agent
      .post(`/api/projects/${project.body.id}/check-ins`)
      .send(aCheckIn());
    expect(attempt.status).toBe(403);

    // And nothing was written despite the refusal.
    const listed = await owner.agent.get(`/api/projects/${project.body.id}/check-ins`);
    const rows = Array.isArray(listed.body) ? listed.body : listed.body.checkIns ?? [];
    expect(rows).toHaveLength(0);
  });

  it("validates the fields rather than storing a half-written update", async () => {
    const app = await getTestApp();
    const { agent } = await signedIn(app, "Owner");
    const project = await agent.post("/api/projects").send(aProject());

    const tooThin = await agent
      .post(`/api/projects/${project.body.id}/check-ins`)
      .send({ goal: "hi", proof: "", nextStep: "" });
    expect(tooThin.status).toBe(422);
    expect(tooThin.body.errors).toBeTruthy();
  });
});

describe("comment on a check-in", () => {
  it("is created and can be read back", async () => {
    const app = await getTestApp();
    const owner = await signedIn(app, "Owner");
    const reader = await signedIn(app, "Reader");

    const project = await owner.agent.post("/api/projects").send(aProject());
    const checkIn = await owner.agent
      .post(`/api/projects/${project.body.id}/check-ins`)
      .send(aCheckIn({ visibility: "public", needsFeedback: true }));

    // Someone who isn't on the project can still comment — a public project is
    // open to feedback, which is the entire point of asking for it.
    const comment = await reader.agent.post(`/api/projects/${project.body.id}/comments`).send({
      targetType: "check_in",
      targetId: checkIn.body.id,
      content: "The fridge inventory idea is the interesting half — how do you keep it current?",
    });
    expect(comment.status).toBe(200);

    const thread = await request(app)
      .get(`/api/projects/${project.body.id}/comments`)
      .query({ targetType: "check_in", targetId: checkIn.body.id });
    expect(thread.status).toBe(200);

    const contents = (Array.isArray(thread.body) ? thread.body : []).map((c: any) => c.content);
    expect(contents.some((c: string) => c.includes("fridge inventory idea"))).toBe(true);
  });

  it("refuses a comment aimed at another project's check-in", async () => {
    const app = await getTestApp();
    const owner = await signedIn(app, "Owner");

    const projectA = await owner.agent.post("/api/projects").send(aProject({ title: "Project A" }));
    const projectB = await owner.agent.post("/api/projects").send(aProject({ title: "Project B" }));

    const checkInOnA = await owner.agent
      .post(`/api/projects/${projectA.body.id}/check-ins`)
      .send(aCheckIn({ visibility: "public" }));

    /*
     * Filed against B, pointing at A's check-in. Without the ownership check
     * this writes a comment that shows up on neither thread properly and
     * attributes discussion to the wrong project.
     */
    const crossed = await owner.agent.post(`/api/projects/${projectB.body.id}/comments`).send({
      targetType: "check_in",
      targetId: checkInOnA.body.id,
      content: "This comment is pointed at the wrong project on purpose.",
    });
    expect(crossed.status).toBe(404);
  });

  it("refuses an anonymous commenter", async () => {
    const app = await getTestApp();
    const owner = await signedIn(app, "Owner");
    const project = await owner.agent.post("/api/projects").send(aProject());
    const checkIn = await owner.agent
      .post(`/api/projects/${project.body.id}/check-ins`)
      .send(aCheckIn({ visibility: "public" }));

    await request(app)
      .post(`/api/projects/${project.body.id}/comments`)
      .send({ targetType: "check_in", targetId: checkIn.body.id, content: "Drive-by comment." })
      .expect(401);
  });
});

describe("private projects", () => {
  /**
   * Private projects need the entitlement, which the free tier doesn't have —
   * so the tier is set directly rather than through a purchase. Testing the
   * permission boundary and testing the paywall are different jobs, and doing
   * both in one test means neither failure tells you which broke.
   */
  async function ownerWithPrivateProjects(app: any) {
    const owner = await signedIn(app, "Owner");
    await db.update(users).set({ subscriptionTier: "builder" }).where(eq(users.id, owner.userId));
    return owner;
  }

  it("hides a private project from everyone else, and 404s rather than 403s", async () => {
    const app = await getTestApp();
    const owner = await ownerWithPrivateProjects(app);
    const stranger = await signedIn(app, "Stranger");

    const project = await owner.agent
      .post("/api/projects")
      .send(aProject({ title: "Quiet Project", isPrivate: true }));
    expect(project.status).toBe(200);
    expect(project.body.isPrivate).toBe(true);

    const id = project.body.id;

    /*
     * 404, not 403. A 403 confirms the project exists, which is a slow way of
     * enumerating what someone is working on privately.
     */
    expect((await stranger.agent.get(`/api/projects/${id}/comments`)).status).toBe(404);
    expect((await request(app).get(`/api/projects/${id}/comments`)).status).toBe(404);

    // The owner still sees their own.
    expect((await owner.agent.get(`/api/projects/${id}/comments`)).status).toBe(200);
  });

  it("stops a non-member posting to a private project", async () => {
    const app = await getTestApp();
    const owner = await ownerWithPrivateProjects(app);
    const stranger = await signedIn(app, "Stranger");

    const project = await owner.agent
      .post("/api/projects")
      .send(aProject({ title: "Quiet Project", isPrivate: true }));
    const id = project.body.id;

    const checkIn = await stranger.agent.post(`/api/projects/${id}/check-ins`).send(aCheckIn());
    expect(checkIn.status).toBe(403);

    const comment = await stranger.agent.post(`/api/projects/${id}/comments`).send({
      targetType: "project",
      targetId: id,
      content: "Trying to comment on something I should not be able to see.",
    });
    expect(comment.status).toBe(404);

    // The owner is unaffected by any of it.
    const ownerCheckIn = await owner.agent.post(`/api/projects/${id}/check-ins`).send(aCheckIn());
    expect(ownerCheckIn.status).toBe(200);
  });
});
