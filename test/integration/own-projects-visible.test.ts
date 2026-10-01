/**
 * Your own projects are listed whatever state they are in.
 *
 * Reported as "I only see one of my four projects". The three that had gone
 * missing were the three a seeding script had marked `completed`; the one still
 * showing was the only one left `active`. That is a specific enough coincidence
 * to be worth pinning down rather than reasoning about, because "finished
 * projects quietly vanish from your own list" is a bug that would equally well
 * be reached by a founder actually finishing something.
 *
 * `/api/user/projects` is what the home rail's "Your projects" card and the
 * profile's project section both read, so it is the one endpoint that decides
 * whether somebody can see their own work.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { projects, projectMembers, users } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function builder(app: any) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.192.${(n % 200) + 20}`;
  const email = `ownproj-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `O${n}` });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

async function project(ownerId: string, title: string, over: Record<string, unknown> = {}) {
  const [row] = await db.insert(projects).values({
    ownerId, title, description: "Something being built.", category: "saas", ...over,
  } as any).returning();
  return row;
}

describe("the list of your own projects", () => {
  /* The reported shape, exactly: three finished, one running, one of them private. */
  it("includes finished and private ones, not just the one still running", async () => {
    const app = await getTestApp();
    const me = await builder(app);

    const made = [
      await project(me.id, "SparkTower-like", { status: "completed", totalDonations: 2500, externalTractionUrl: "https://example.test/t", views: 112_847 }),
      await project(me.id, "Second finished", { status: "completed" }),
      await project(me.id, "Finished and private", { status: "completed", isPrivate: true }),
      await project(me.id, "Still going", { status: "active" }),
    ];

    const res = await me.agent.get("/api/user/projects");
    expect(res.status, (res.text ?? "").slice(0, 300)).toBe(200);
    const titles = (res.body as any[]).map((p) => p.title).sort();
    expect(titles, "all four, whatever their status").toEqual(made.map((p) => p.title).sort());
  });

  /* And with collaborators on one of them, which the seeding also added. */
  it("is not disturbed by other people being members of one of them", async () => {
    const app = await getTestApp();
    const me = await builder(app);
    const mine = await project(me.id, "Shared and finished", { status: "completed" });
    await project(me.id, "Also mine", { status: "active" });

    const others: string[] = [];
    for (let i = 0; i < 10; i++) {
      const [u] = await db.insert(users).values({
        email: `member-${Date.now()}-${n}-${i}@example.test`, firstName: `M${i}`,
      } as any).returning();
      others.push(u.id);
    }
    await db.insert(projectMembers).values(
      others.map((userId) => ({ projectId: mine.id, userId, role: "contributor" })) as any,
    );

    const res = await me.agent.get("/api/user/projects");
    expect(res.status).toBe(200);
    expect((res.body as any[]).map((p) => p.title).sort()).toEqual(["Also mine", "Shared and finished"]);
  });

  /*
   * A project somebody else owns and you are a member of counts as yours here,
   * and did before — worth holding, because the card is the only route to it.
   */
  it("includes projects you were added to rather than own", async () => {
    const app = await getTestApp();
    const me = await builder(app);
    const them = await builder(app);
    await project(me.id, "My own", { status: "completed" });
    const theirs = await project(them.id, "Theirs, finished", { status: "completed" });
    await db.insert(projectMembers).values({ projectId: theirs.id, userId: me.id, role: "contributor" } as any);

    const res = await me.agent.get("/api/user/projects");
    expect((res.body as any[]).map((p) => p.title).sort()).toEqual(["My own", "Theirs, finished"]);
  });

  /* Each row carries its owner, which the cards print; without it they read "Anonymous". */
  it("names the owner on every row", async () => {
    const app = await getTestApp();
    const me = await builder(app);
    await project(me.id, "Needs an owner", { status: "completed" });

    const res = await me.agent.get("/api/user/projects");
    const [row] = res.body as any[];
    expect(row.owner?.id, "the card prints this").toBe(me.id);
  });
});
