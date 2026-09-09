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
  category: "saas", goal: "ship_mvp", subcategory: "saas",
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
    // The goal is a required field, so it has to come back — on creation and
    // on every read, since the roadmap and briefing branch on it.
    expect(created.body.goal).toBe("ship_mvp");

    const mine = await agent.get("/api/user/projects");
    expect(mine.status).toBe(200);
    expect(mine.body.map((p: any) => p.id)).toContain(created.body.id);
    expect(mine.body.find((p: any) => p.id === created.body.id).goal).toBe("ship_mvp");

    const one = await agent.get(`/api/projects/${created.body.id}`);
    expect(one.status).toBe(200);
    expect(one.body.goal).toBe("ship_mvp");
  });

  it("tells the person what to fix when the goal is missing or unknown", async () => {
    const app = await getTestApp();
    const { agent } = await signedIn(app, "Owner");

    /*
     * 400, not 500. This used to be an Internal Server Error carrying a raw
     * Zod dump — for an empty box. Whose mistake it is is the first thing the
     * status says, and the message has to read as a sentence a person can act
     * on, since the client puts it straight into a toast.
     */
    const { goal: _omit, ...withoutGoal } = aProject();
    const missing = await agent.post("/api/projects").send(withoutGoal);
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe("invalid_input");
    expect(missing.body.field).toBe("goal");
    expect(missing.body.message).toBe("Pick a goal: ship an MVP, systemize a business, or raise funding.");

    const unknown = await agent.post("/api/projects").send(aProject({ goal: "get_rich" }));
    expect(unknown.status).toBe(400);
    expect(unknown.body.field).toBe("goal");
    expect(unknown.body.message).toMatch(/pick a goal/i);

    const { subcategory: _s, ...withoutSub } = aProject();
    const noSub = await agent.post("/api/projects").send(withoutSub);
    expect(noSub.status).toBe(400);
    expect(noSub.body.field).toBe("subcategory");
    expect(noSub.body.message).toBe("Pick what kind of project it is for that goal.");
  });

  it("requires a subcategory that belongs to the chosen goal", async () => {
    const app = await getTestApp();
    const { agent } = await signedIn(app, "Owner");

    // Distinct titles throughout: the duplicate-content guard refuses the
    // same title and description twice from one account, which is right, and
    // is not what this test is about.
    // A restaurant is a kind of business to systemize, not a kind of MVP.
    const crossed = await agent.post("/api/projects").send(aProject({ title: "Crossed", goal: "ship_mvp", subcategory: "restaurant" }));
    expect(crossed.status).toBe(400);
    expect(crossed.body.field).toBe("subcategory");
    expect(crossed.body.message).toMatch(/isn't one of the kinds of project for that goal/);
    // The same id is fine under the goal it belongs to.
    const right = await agent.post("/api/projects").send(aProject({ title: "The Corner Bistro", goal: "systemize_business", subcategory: "restaurant" }));
    expect(right.status).toBe(200);
    expect(right.body.subcategory).toBe("restaurant");
    // "other" is valid on every path — a real answer, not a fallback.
    expect((await agent.post("/api/projects").send(aProject({ title: "Community Fund", goal: "raise_funding", subcategory: "other" }))).status).toBe(200);

    // And an update can't orphan it: changing only the goal is refused until
    // the subcategory is changed with it.
    const orphan = await agent.patch(`/api/projects/${right.body.id}`).send({ goal: "ship_mvp" });
    expect(orphan.status).toBe(400);
    expect(orphan.body.code).toBe("subcategory_mismatch");
    expect(orphan.body.message).toMatch(/pick a subcategory for the new goal/i);
    // And an unknown goal on update is a 400 with the same sentence as create.
    const badUpdate = await agent.patch(`/api/projects/${right.body.id}`).send({ goal: "get_rich" });
    expect(badUpdate.status).toBe(400);
    expect(badUpdate.body.message).toMatch(/pick a goal/i);
    const together = await agent.patch(`/api/projects/${right.body.id}`).send({ goal: "ship_mvp", subcategory: "app" });
    expect(together.status).toBe(200);
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
