/**
 * The customer console, and mostly who it refuses.
 *
 * Every route here is a power over somebody who is not in the room: money onto
 * their balance, a project moved out from under them, an address marked
 * verified that nobody verified. So the happy path is the small half of this
 * file and the rest is the guard rails:
 *
 *   - an ordinary account cannot find it, and a reviewer cannot either
 *   - an admin who has not passed their own second factor cannot use it
 *   - money and ownership need the owner specifically, not any admin
 *   - nobody can act on themselves, which is what keeps the audit honest
 *   - nothing runs without a reason, and every reason is written somewhere
 *     the database refuses to edit
 *   - what was handed out can be taken back, exactly, and only once
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import { and, eq, like } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { passMfa } from "../helpers/mfa";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { users, projects, moderationLog, novaBuildPasses } from "@shared/schema";
import { MAX_GRANT_CENTS, MIN_REASON } from "@shared/admin-console";

let ownerEmail = "";
const previousOwner = process.env.PLATFORM_OWNER_EMAIL;
beforeAll(() => {
  ownerEmail = `con-owner-${Date.now()}@example.test`;
  process.env.PLATFORM_OWNER_EMAIL = ownerEmail;
});
afterAll(async () => {
  if (previousOwner === undefined) delete process.env.PLATFORM_OWNER_EMAIL;
  else process.env.PLATFORM_OWNER_EMAIL = previousOwner;
  await closeTestApp();
});

let n = 0;
const ip = () => `198.51.151.${20 + (n++ % 200)}`;
const password = "Testpass123!";
const REASON = "Refunding a build that failed halfway — ticket 412.";

async function person(app: any, first: string, role?: "admin" | "reviewer", email?: string) {
  n += 1;
  const agent = request.agent(app);
  const address = email ?? `con-${first.toLowerCase()}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip())
    .send({ email: address, password, firstName: first });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await verifyEmail(app, address, ip());
  if (role) await db.update(users).set({ platformRole: role }).where(eq(users.id, res.body.id));
  return { agent, id: res.body.id as string, email: address };
}

/** The owner, signed in with a second factor — the only one who may move money. */
async function owner(app: any) {
  const o = await person(app, "Owner", "admin", ownerEmail);
  await passMfa(o.agent);
  return o;
}

/** An admin who is not the owner: support, without the bank. */
async function supportAdmin(app: any) {
  const a = await person(app, "Support", "admin");
  await passMfa(a.agent);
  return a;
}

const act = (who: { agent: any }, body: Record<string, unknown>) =>
  who.agent.post("/api/admin/console/act").send({ reason: REASON, ...body });

const balanceOf = async (id: string) =>
  (await db.select({ c: users.balanceCents }).from(users).where(eq(users.id, id)))[0].c as number;

async function aProject(customer: { agent: any }, title = "Their café") {
  const res = await customer.agent.post("/api/projects").send({
    title, description: "A business that has been trading for six years.",
    category: "Other", goal: "run_company", subcategory: "restaurant",
  });
  expect(res.status, res.text).toBe(200);
  return res.body.id as string;
}

describe("who can reach the console", () => {
  it("is not there for an ordinary account, a reviewer, or an admin without 2FA", async () => {
    const app = await getTestApp();

    expect((await request(app).get("/api/admin/console/actions")).status).toBe(401);

    const ordinary = await person(app, "Ordinary");
    expect((await ordinary.agent.get("/api/admin/console/actions")).status).toBe(404);
    expect((await ordinary.agent.get("/api/admin/console/search?q=test")).status).toBe(404);
    expect((await act(ordinary, { action: "credit", userId: ordinary.id, cents: 100 })).status).toBe(404);

    // A reviewer works the report queue. This is not the report queue.
    const reviewer = await person(app, "Reviewer", "reviewer");
    await passMfa(reviewer.agent);
    expect((await reviewer.agent.get("/api/admin/console/actions")).status).toBe(404);

    // Right role, unproven session.
    const admin = await person(app, "Unverified", "admin");
    expect((await admin.agent.get("/api/admin/console/actions")).status).toBe(403);
  });
});

describe("money", () => {
  it("is the owner's alone — an admin is told so rather than silently failing", async () => {
    const app = await getTestApp();
    const support = await supportAdmin(app);
    const customer = await person(app, "Customer");

    const res = await act(support, { action: "credit", userId: customer.id, cents: 500 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("owner_only");
    expect(await balanceOf(customer.id)).toBe(0);
  });

  it("lands on the balance, shows on their statement, and goes on the record", async () => {
    const app = await getTestApp();
    const boss = await owner(app);
    const customer = await person(app, "Customer");

    const res = await act(boss, { action: "credit", userId: customer.id, cents: 500 });
    expect(res.status, res.text).toBe(200);
    expect(await balanceOf(customer.id)).toBe(500);

    // Their own statement explains the movement.
    const view = await boss.agent.get(`/api/admin/console/users/${customer.id}`);
    expect(view.status).toBe(200);
    expect(view.body.ledger.some((l: any) => l.amountCents === 500)).toBe(true);

    const [logged] = await db.select().from(moderationLog)
      .where(and(eq(moderationLog.action, "console:credit"), eq(moderationLog.targetUserId, customer.id)));
    expect(logged.reason).toBe(REASON);
    expect(logged.actorId).toBe(boss.id);
    expect((logged.previousState as any).balanceCents).toBe(0);
    expect((logged.resultingState as any).balanceCents).toBe(500);
  });

  it("refuses more than the ceiling for one grant", async () => {
    const app = await getTestApp();
    const boss = await owner(app);
    const customer = await person(app, "Customer");

    const res = await act(boss, { action: "credit", userId: customer.id, cents: MAX_GRANT_CENTS + 1 });
    expect(res.status).toBe(400);
    expect(await balanceOf(customer.id)).toBe(0);
  });

  it("stops at the day's ceiling however many customers ask", async () => {
    const app = await getTestApp();
    const boss = await owner(app);

    /*
     * Three at the single-grant maximum is over the daily one, so the third is
     * refused. The ceiling is per operator rather than per customer — the
     * thing it guards against is a slipped decimal or a session somebody else
     * is driving, neither of which cares whose account it lands on.
     */
    for (let i = 0; i < 2; i += 1) {
      const to = await person(app, `Cust${i}`);
      const res = await act(boss, { action: "credit", userId: to.id, cents: MAX_GRANT_CENTS });
      expect(res.status, res.text).toBe(200);
    }
    const third = await person(app, "Third");
    const refused = await act(boss, { action: "credit", userId: third.id, cents: MAX_GRANT_CENTS });
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe("daily_ceiling");
    expect(await balanceOf(third.id)).toBe(0);
  });

  it("can be taken back, exactly once, and the statement shows both halves", async () => {
    const app = await getTestApp();
    const boss = await owner(app);
    const customer = await person(app, "Customer");

    expect((await act(boss, { action: "credit", userId: customer.id, cents: 700 })).status).toBe(200);
    const [entry] = await db.select().from(moderationLog)
      .where(and(eq(moderationLog.action, "console:credit"), eq(moderationLog.targetUserId, customer.id)));

    const undone = await boss.agent.post(`/api/admin/console/undo/${entry.id}`).send({ reason: "Wrong account — ticket 412." });
    expect(undone.status, undone.text).toBe(200);
    expect(await balanceOf(customer.id)).toBe(0);

    // Undoing twice would double the correction.
    const again = await boss.agent.post(`/api/admin/console/undo/${entry.id}`).send({ reason: "Trying it a second time." });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("already_undone");
    expect(await balanceOf(customer.id)).toBe(0);
  });
});

describe("the rules every action shares", () => {
  it("will not run without a reason worth reading", async () => {
    const app = await getTestApp();
    const boss = await owner(app);
    const customer = await person(app, "Customer");

    const res = await boss.agent.post("/api/admin/console/act")
      .send({ action: "credit", userId: customer.id, cents: 100, reason: "ok" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("reason_required");
    expect(await balanceOf(customer.id)).toBe(0);
    expect(MIN_REASON).toBeGreaterThan(2);
  });

  it("refuses to act on the operator's own account", async () => {
    const app = await getTestApp();
    const boss = await owner(app);

    const res = await act(boss, { action: "credit", userId: boss.id, cents: 500 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("not_yourself");
    expect(await balanceOf(boss.id)).toBe(0);
  });

  it("refuses to act on the operator's own project", async () => {
    const app = await getTestApp();
    const boss = await owner(app);
    const mine = await aProject(boss, "The owner's own");

    const res = await act(boss, { action: "project_privacy", projectId: mine, isPrivate: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("not_yourself");
  });
});

describe("accounts an admin can help with", () => {
  it("marks an address verified when the mail never arrived, and can put it back", async () => {
    const app = await getTestApp();
    const support = await supportAdmin(app);
    const customer = await person(app, "Customer");
    // Undo what the harness did, so this is a genuinely unverified account.
    await db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, customer.id));

    const res = await act(support, { action: "verify_email", userId: customer.id });
    expect(res.status, res.text).toBe(200);
    const [after] = await db.select({ at: users.emailVerifiedAt }).from(users).where(eq(users.id, customer.id));
    expect(after.at).toBeTruthy();

    const [entry] = await db.select().from(moderationLog)
      .where(and(eq(moderationLog.action, "console:verify_email"), eq(moderationLog.targetUserId, customer.id)));
    expect((await support.agent.post(`/api/admin/console/undo/${entry.id}`).send({ reason: "Verified the wrong account." })).status).toBe(200);
    const [back] = await db.select({ at: users.emailVerifiedAt }).from(users).where(eq(users.id, customer.id));
    expect(back.at).toBeNull();
  });

  it("gives a day pass without touching their balance", async () => {
    const app = await getTestApp();
    const support = await supportAdmin(app);
    const customer = await person(app, "Customer");

    const res = await act(support, { action: "day_pass", userId: customer.id, days: 2 });
    expect(res.status, res.text).toBe(200);
    expect(await balanceOf(customer.id)).toBe(0);
    const [row] = await db.select({ until: users.dayPassUntil }).from(users).where(eq(users.id, customer.id));
    expect(row.until).toBeTruthy();
  });

  it("refuses a pass longer than support is for", async () => {
    const app = await getTestApp();
    const support = await supportAdmin(app);
    const customer = await person(app, "Customer");
    expect((await act(support, { action: "day_pass", userId: customer.id, days: 400 })).status).toBe(400);
  });

  it("puts the month's free actions back", async () => {
    const app = await getTestApp();
    const support = await supportAdmin(app);
    const customer = await person(app, "Customer");
    await db.update(users).set({ creditsUsed: 25 }).where(eq(users.id, customer.id));

    expect((await act(support, { action: "reset_allowance", userId: customer.id })).status).toBe(200);
    const [row] = await db.select({ used: users.creditsUsed }).from(users).where(eq(users.id, customer.id));
    expect(row.used).toBe(0);
  });
});

describe("projects", () => {
  it("can be made private again by an admin, and put back", async () => {
    const app = await getTestApp();
    const support = await supportAdmin(app);
    const customer = await person(app, "Customer");
    const id = await aProject(customer);

    const res = await act(support, { action: "project_privacy", projectId: id, isPrivate: true });
    expect(res.status, res.text).toBe(200);
    const [row] = await db.select({ p: projects.isPrivate }).from(projects).where(eq(projects.id, id));
    expect(row.p).toBe(true);

    const [entry] = await db.select().from(moderationLog)
      .where(and(eq(moderationLog.action, "console:project_privacy"), eq(moderationLog.targetId, id)));
    expect((await support.agent.post(`/api/admin/console/undo/${entry.id}`).send({ reason: "They wanted it public after all." })).status).toBe(200);
    const [back] = await db.select({ p: projects.isPrivate }).from(projects).where(eq(projects.id, id));
    expect(back.p).toBe(false);
  });

  it("gets the whole-business build from the owner, recorded as costing nothing", async () => {
    const app = await getTestApp();
    const boss = await owner(app);
    const customer = await person(app, "Customer");
    const id = await aProject(customer);

    expect((await act(boss, { action: "build_pass", projectId: id })).status).toBe(200);
    const [pass] = await db.select().from(novaBuildPasses).where(eq(novaBuildPasses.projectId, id));
    expect(pass.userId).toBe(customer.id);
    // A granted pass is not revenue and must never read as any.
    expect(pass.paidCents).toBe(0);

    // And twice is refused rather than duplicated.
    expect((await act(boss, { action: "build_pass", projectId: id })).status).toBe(409);
  });

  it("moves between accounts only for the owner, and moves back on undo", async () => {
    const app = await getTestApp();
    const boss = await owner(app);
    const support = await supportAdmin(app);
    const from = await person(app, "From");
    const to = await person(app, "To");
    const id = await aProject(from);

    // Support cannot move somebody's work to another account.
    expect((await act(support, { action: "transfer_project", projectId: id, toUserId: to.id })).status).toBe(403);

    expect((await act(boss, { action: "transfer_project", projectId: id, toUserId: to.id })).status).toBe(200);
    const [moved] = await db.select({ o: projects.ownerId }).from(projects).where(eq(projects.id, id));
    expect(moved.o).toBe(to.id);

    const [entry] = await db.select().from(moderationLog)
      .where(and(eq(moderationLog.action, "console:transfer_project"), eq(moderationLog.targetId, id)));
    expect((await boss.agent.post(`/api/admin/console/undo/${entry.id}`).send({ reason: "Moved to the wrong account." })).status).toBe(200);
    const [backAgain] = await db.select({ o: projects.ownerId }).from(projects).where(eq(projects.id, id));
    expect(backAgain.o).toBe(from.id);
  });
});

describe("finding somebody", () => {
  it("searches by address, by name and by id, and shows their projects without their contents", async () => {
    const app = await getTestApp();
    const support = await supportAdmin(app);
    const customer = await person(app, "Findable");
    await aProject(customer, "A findable café");

    const byEmail = await support.agent.get(`/api/admin/console/search?q=${encodeURIComponent(customer.email)}`);
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.people.map((p: any) => p.id)).toContain(customer.id);

    const byId = await support.agent.get(`/api/admin/console/search?q=${customer.id}`);
    expect(byId.body.people.map((p: any) => p.id)).toContain(customer.id);

    const byProject = await support.agent.get("/api/admin/console/search?q=findable%20caf");
    expect(byProject.body.projects.length).toBeGreaterThan(0);

    const view = await support.agent.get(`/api/admin/console/users/${customer.id}`);
    expect(view.body.projects[0].title).toBe("A findable café");
    // Titles and settings only — never the work itself.
    expect(view.body.projects[0]).not.toHaveProperty("description");
    expect(view.body.projects[0]).not.toHaveProperty("scope");
  });

  it("says nothing at all for a query too short to mean anything", async () => {
    const app = await getTestApp();
    const support = await supportAdmin(app);
    const res = await support.agent.get("/api/admin/console/search?q=a");
    expect(res.body).toEqual({ people: [], projects: [] });
  });
});

describe("the record", () => {
  it("keeps every console action, and the log route reads only console ones", async () => {
    const app = await getTestApp();
    const boss = await owner(app);
    const customer = await person(app, "Customer");

    await act(boss, { action: "credit", userId: customer.id, cents: 100 });
    await act(boss, { action: "day_pass", userId: customer.id, days: 1 });

    const log = await boss.agent.get("/api/admin/console/log");
    expect(log.status).toBe(200);
    expect(log.body.entries.length).toBeGreaterThanOrEqual(2);
    for (const e of log.body.entries) expect(e.action.startsWith("console:")).toBe(true);
    // The operator is named, and the address is masked rather than printed whole.
    expect(log.body.entries[0].actor).toContain("@");
    expect(log.body.entries[0].actor).toContain("***");
  });

  it("cannot be edited or deleted, whatever the database is asked", async () => {
    const app = await getTestApp();
    const boss = await owner(app);
    const customer = await person(app, "Customer");
    await act(boss, { action: "credit", userId: customer.id, cents: 100 });

    const [entry] = await db.select().from(moderationLog)
      .where(and(eq(moderationLog.action, "console:credit"), eq(moderationLog.targetUserId, customer.id)));

    await expect(
      db.update(moderationLog).set({ reason: "something else" }).where(eq(moderationLog.id, entry.id)),
    ).rejects.toThrow();
    await expect(
      db.delete(moderationLog).where(eq(moderationLog.id, entry.id)),
    ).rejects.toThrow();

    const [still] = await db.select().from(moderationLog).where(eq(moderationLog.id, entry.id));
    expect(still.reason).toBe(REASON);
  });

  it("refuses to let an operator undo something about their own account", async () => {
    const app = await getTestApp();
    const boss = await owner(app);
    const support = await supportAdmin(app);

    // The owner gives support a day pass — legitimate, and about somebody else.
    expect((await act(boss, { action: "day_pass", userId: support.id, days: 1 })).status).toBe(200);
    const [entry] = await db.select().from(moderationLog)
      .where(and(eq(moderationLog.action, "console:day_pass"), eq(moderationLog.targetUserId, support.id)));

    // Support cannot reverse it themselves: every change here is between two people.
    const res = await support.agent.post(`/api/admin/console/undo/${entry.id}`)
      .send({ reason: "Putting back my own day pass." });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("not_yourself");
  });

  it("refuses to undo something that was never a console action", async () => {
    const app = await getTestApp();
    const boss = await owner(app);
    const [other] = await db.select().from(moderationLog).where(like(moderationLog.action, "console:%")).limit(1);
    void other;
    expect((await boss.agent.post("/api/admin/console/undo/00000000-0000-0000-0000-000000000000")
      .send({ reason: "Trying to undo nothing at all." })).status).toBe(404);
  });
});
