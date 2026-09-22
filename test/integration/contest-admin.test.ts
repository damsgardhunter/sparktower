/**
 * Making a contest, and the race that joining one used to lose.
 *
 * Two failures, both invisible until the first real contest runs:
 *
 *  - There was no way to create one. `storage.createContest` existed and
 *    nothing called it from any route, script or seed, so the Contests page in
 *    everyone's navigation was guaranteed to stay empty — a permanent signpost
 *    to a room that could not be furnished.
 *  - Joining was a check-then-insert with no unique constraint underneath it:
 *    "are they already in?" and "is it full?" were both reads taken before the
 *    write, so two requests sent together each got their answers before either
 *    row landed. A double-clicked button made two entries, which double-counted
 *    the entrants and let a contest pass its own maximum.
 *
 * The second is tested by actually racing it. A sequential test passes against
 * the broken code, which is precisely why it was never caught.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { passMfa } from "../helpers/mfa";
import { db } from "../../server/db";
import { contestParticipants, users } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const ip = () => `198.51.119.${20 + (n++ % 200)}`;
const day = 86_400_000;

async function person(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `cadmin-${first.toLowerCase()}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip())
    .send({ email, password: "Testpass123!", firstName: first, lastName: "Admin" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await verifyEmail(app, email, ip());
  return { agent, email, userId: res.body.id as string };
}

async function admin(app: any) {
  const a = await person(app, "Boss");
  await db.update(users).set({ platformRole: "admin" }).where(eq(users.id, a.userId));
  // The routes ask for a second factor on the session on top of the role.
  await passMfa(a.agent);
  return a;
}

const draft = (over: Record<string, unknown> = {}) => ({
  title: `Ship in a weekend ${Date.now()}-${n++}`,
  description: "Build and publish something in 48 hours.",
  category: "saas",
  difficulty: "intermediate",
  status: "active",
  startDate: new Date(Date.now() - day).toISOString(),
  endDate: new Date(Date.now() + day).toISOString(),
  ...over,
});

describe("creating a contest", () => {
  it("makes one that the public page then shows", async () => {
    const app = await getTestApp();
    const boss = await admin(app);

    const made = await boss.agent.post("/api/admin/contests").set("x-forwarded-for", ip()).send(draft());
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.contest.participantCount).toBe(0);

    // The point of the whole feature: it is now on the page everybody can see.
    const publicList = await request(app).get("/api/contests").set("x-forwarded-for", ip());
    expect(publicList.status).toBe(200);
    expect((publicList.body as any[]).some((c) => c.id === made.body.contest.id)).toBe(true);

    // And editable.
    const edited = await boss.agent.put(`/api/admin/contests/${made.body.contest.id}`)
      .set("x-forwarded-for", ip()).send({ prize: "A year of Pro", promoted: true });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.contest.prize).toBe("A year of Pro");
    expect(edited.body.contest.promoted).toBe(true);
    // A partial edit keeps everything it didn't mention.
    expect(edited.body.contest.title).toBe(made.body.contest.title);
  });

  it("refuses a window that closes before it opens, and a cap below the people already in", async () => {
    const app = await getTestApp();
    const boss = await admin(app);

    const backwards = await boss.agent.post("/api/admin/contests").set("x-forwarded-for", ip())
      .send(draft({ startDate: new Date(Date.now() + day).toISOString(), endDate: new Date(Date.now() - day).toISOString() }));
    expect(backwards.status).toBe(400);
    expect(backwards.body.field).toBe("endDate");

    const made = await boss.agent.post("/api/admin/contests").set("x-forwarded-for", ip()).send(draft());
    expect(made.status).toBe(201);
    const entrant = await person(app, "Entrant");
    expect((await entrant.agent.post(`/api/contests/${made.body.contest.id}/join`).set("x-forwarded-for", ip()).send({})).status).toBe(200);

    const shrunk = await boss.agent.put(`/api/admin/contests/${made.body.contest.id}`)
      .set("x-forwarded-for", ip()).send({ maxParticipants: 0 });
    expect(shrunk.status).toBe(400);
  });

  it("is admins only, and invisible to everyone else", async () => {
    const app = await getTestApp();
    const ordinary = await person(app, "Nobody");

    expect((await ordinary.agent.get("/api/admin/contests").set("x-forwarded-for", ip())).status).toBe(404);
    expect((await ordinary.agent.post("/api/admin/contests").set("x-forwarded-for", ip()).send(draft())).status).toBe(404);
    expect((await request(app).post("/api/admin/contests").set("x-forwarded-for", ip()).send(draft())).status).toBe(401);

    // A reviewer is not an admin: this publishes to the whole site.
    const rev = await person(app, "Reviewer");
    await db.update(users).set({ platformRole: "reviewer" }).where(eq(users.id, rev.userId));
    await passMfa(rev.agent);
    expect((await rev.agent.post("/api/admin/contests").set("x-forwarded-for", ip()).send(draft())).status).toBe(404);
  });
});

describe("joining a contest can't race itself", () => {
  it("makes one entry out of simultaneous joins, not two", async () => {
    const app = await getTestApp();
    const boss = await admin(app);
    const made = await boss.agent.post("/api/admin/contests").set("x-forwarded-for", ip()).send(draft());
    expect(made.status).toBe(201);
    const contestId = made.body.contest.id as string;

    const keen = await person(app, "Keen");
    const address = ip();
    /*
     * Sent together, not one after the other. Before the unique index this is
     * the sequence that produced two rows: both requests read "not a
     * participant" before either insert, and both inserted.
     */
    const answers = await Promise.all(Array.from({ length: 5 }, () =>
      keen.agent.post(`/api/contests/${contestId}/join`).set("x-forwarded-for", address).send({})));

    expect(answers.filter((r) => r.status === 200), "exactly one join succeeds").toHaveLength(1);
    const rows = await db.select().from(contestParticipants).where(eq(contestParticipants.contestId, contestId));
    expect(rows, "one entry, however many times the button was pressed").toHaveLength(1);
    // And the count everyone reads agrees with the table.
    expect((await request(app).get(`/api/contests/${contestId}`).set("x-forwarded-for", ip())).body.participantCount).toBe(1);
  });

  it("holds the maximum when several people arrive for the last place at once", async () => {
    const app = await getTestApp();
    const boss = await admin(app);
    const made = await boss.agent.post("/api/admin/contests").set("x-forwarded-for", ip()).send(draft({ maxParticipants: 2 }));
    expect(made.status).toBe(201);
    const contestId = made.body.contest.id as string;

    const crowd = await Promise.all(["Ann", "Ben", "Cal", "Dee", "Eve"].map((name) => person(app, name)));
    /*
     * Five people, two places, all at once. The cap used to be a read before
     * the insert, so every one of these saw room and every one of them was
     * written — a contest with five entrants and a maximum of two.
     */
    const answers = await Promise.all(crowd.map((p) =>
      p.agent.post(`/api/contests/${contestId}/join`).set("x-forwarded-for", ip()).send({})));

    expect(answers.filter((r) => r.status === 200), "only as many as there were places").toHaveLength(2);
    expect(answers.filter((r) => r.body?.code === "contest_full").length).toBeGreaterThan(0);
    expect(await db.select().from(contestParticipants).where(eq(contestParticipants.contestId, contestId))).toHaveLength(2);
  });
});
