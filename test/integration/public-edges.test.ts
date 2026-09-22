/**
 * The public and administrative edges, driven end to end.
 *
 * Four failures live here, and each one is a seam rather than a function:
 *
 *  - a kill switch whose name promised more than it covered. "Sprints &
 *    simulations" listed only `/api/games`, so turning it off closed the
 *    sprint games and left every `/api/sim` route — the desk, the market,
 *    advancing a season — answering as normal.
 *  - a reported project with no takedown. `project` was a report target but
 *    not an actionable one, so the queue could mark a report "actioned" while
 *    the project stayed on every public list. Suspending the owner blocks
 *    writes and unpublishes nothing.
 *  - an invite with no per-recipient cap. Every limit was counted per project
 *    or per sender, so one person with several projects could mail the same
 *    stranger over and over with every check passing.
 *  - a public artifact page with no way to report it. It is the one page built
 *    for people with no account, and the only report route required one.
 *
 * None of these show up in a unit test: they are all "the thing the code says
 * it does" against "what a request actually gets".
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { passMfa } from "../helpers/mfa";
import { db } from "../../server/db";
import { contentReports, feedPosts, pathArtifacts, projects, users } from "@shared/schema";
import { INVITES_PER_ADDRESS_PER_DAY } from "@shared/invites";
import { SURFACE_API_PREFIXES, SURFACE_ROUTES } from "@shared/surfaces";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const ip = () => `198.51.118.${20 + (n++ % 200)}`;

async function person(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `edges-${first.toLowerCase()}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip())
    .send({ email, password: "Testpass123!", firstName: first, lastName: "Edges" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await verifyEmail(app, email, ip());
  return { agent, email, userId: res.body.id as string };
}

async function reviewer(app: any) {
  const r = await person(app, "Reviewer");
  await db.update(users).set({ platformRole: "reviewer" }).where(eq(users.id, r.userId));
  await passMfa(r.agent);
  return r;
}

async function project(agent: any, title: string) {
  const res = await agent.post("/api/projects").set("x-forwarded-for", ip()).send({
    title, description: `${title} — a description long enough to pass validation.`,
    category: "saas", goal: "ship_mvp", subcategory: "saas",
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

/** Turns a surface off for the length of one check and puts it back. */
async function withSurfaceOff(mod: any, id: string, body: () => Promise<void>) {
  const off = await mod.agent.patch(`/api/admin/surfaces/${id}`).set("x-forwarded-for", ip()).send({ enabled: false });
  expect(off.status, JSON.stringify(off.body)).toBe(200);
  try {
    await body();
  } finally {
    const on = await mod.agent.patch(`/api/admin/surfaces/${id}`).set("x-forwarded-for", ip()).send({ enabled: true });
    expect(on.status).toBe(200);
  }
}

describe("the sprints kill switch covers the simulation", () => {
  it("names the simulation's API and pages, not only the sprint games", () => {
    // The map itself, so the gap can't come back by someone removing the prefix
    // and leaving the guard mounted on nothing.
    expect(SURFACE_API_PREFIXES.sprints).toContain("/api/sim");
    expect(SURFACE_API_PREFIXES.sprints).toContain("/api/games");
    expect(SURFACE_ROUTES.sprints).toContain("/simulation");
  });

  it("turns the simulation off, not just the sprint games", async () => {
    const app = await getTestApp();
    const builder = await person(app, "Simmer");
    const mod = await reviewer(app);

    // On: the route answers as itself. (Whatever it says about ventures, it is
    // not the 404 a disabled surface gives.)
    const before = await builder.agent.get("/api/sim/ventures").set("x-forwarded-for", ip());
    expect(before.status).not.toBe(404);

    await withSurfaceOff(mod, "sprints", async () => {
      // Off: gone, along with the sprint games it always covered.
      expect((await builder.agent.get("/api/sim/ventures").set("x-forwarded-for", ip())).status).toBe(404);
      expect((await builder.agent.get("/api/sim/niches").set("x-forwarded-for", ip())).status).toBe(404);
      // And a write, which is the half that actually mattered.
      expect((await builder.agent.post("/api/sim/join").set("x-forwarded-for", ip()).send({ code: "nope" })).status).toBe(404);
      // Something outside the surface is untouched, so this isn't a blanket outage.
      expect((await builder.agent.get("/api/projects").set("x-forwarded-for", ip())).status).toBe(200);
    });

    expect((await builder.agent.get("/api/sim/ventures").set("x-forwarded-for", ip())).status).not.toBe(404);
  });
});

describe("a reported project can be taken down", () => {
  it("removes it from the public list and the leaderboard, and puts it back on an undo", async () => {
    const app = await getTestApp();
    const author = await person(app, "Spammer");
    const reporter = await person(app, "Reader");
    const mod = await reviewer(app);

    const title = `Doxxing Directory ${Date.now()}`;
    const p = await project(author.agent, title);

    // Public before anything happens.
    const listed = () => request(app).get("/api/projects").set("x-forwarded-for", ip())
      .then((r) => (r.body as any[]).some((row) => row.id === p.id));
    const ranked = () => request(app).get("/api/leaderboard").set("x-forwarded-for", ip())
      .then((r) => (r.body as any[]).some((row) => row.id === p.id));
    expect(await listed()).toBe(true);
    expect(await ranked()).toBe(true);

    const filed = await reporter.agent.post("/api/reports").set("x-forwarded-for", ip())
      .send({ targetType: "project", targetId: p.id, reason: "abuse", detail: "targets_other", note: "It's a list of someone's addresses." });
    expect(filed.status, JSON.stringify(filed.body)).toBe(200);

    // The queue now offers a decision on it, rather than "suspend the account instead".
    const queue = await mod.agent.get("/api/admin/reports?status=open").set("x-forwarded-for", ip());
    const entry = (queue.body as any[]).find((r) => r.id === filed.body.id);
    expect(entry, "the report is in the queue").toBeTruthy();
    expect(entry.actionable, "a project report is decidable from the queue").toBe(true);
    expect(entry.targetHidden).toBe(false);

    const acted = await mod.agent.post(`/api/admin/reports/${filed.body.id}/act`).set("x-forwarded-for", ip())
      .send({ action: "remove", reasonCode: "harassment", note: "Removed." });
    expect(acted.status, JSON.stringify(acted.body)).toBe(200);
    expect(acted.body.reportStatus).toBe("actioned");

    // The report being "actioned" now means something happened.
    const [row] = await db.select().from(projects).where(eq(projects.id, p.id));
    expect(row.hiddenAt).toBeTruthy();
    expect(row.hiddenById).toBe(mod.userId);
    expect(await listed(), "a removed project is off the public listing").toBe(false);
    expect(await ranked(), "a removed project is off the leaderboard").toBe(false);
    expect((await request(app).get("/api/discover?kind=projects").set("x-forwarded-for", ip()))
      .body.projects?.some((row2: any) => row2.id === p.id) ?? false).toBe(false);

    // And the takedown can be lifted the same way any other one can.
    const restored = await mod.agent.post(`/api/admin/content/project/${p.id}/restore`).set("x-forwarded-for", ip()).send({});
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect(await listed()).toBe(true);
  });

  it("keeps a suspended owner's projects off the public lists", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Banned");
    const p = await project(owner.agent, `Ordinary Project ${Date.now()}`);

    const listed = () => request(app).get("/api/projects").set("x-forwarded-for", ip())
      .then((r) => (r.body as any[]).some((row) => row.id === p.id));
    expect(await listed()).toBe(true);

    await db.update(users).set({ suspendedAt: new Date(), suspendedReason: "Spam" }).where(eq(users.id, owner.userId));

    /*
     * The point of this one: suspension blocks writes, and before this change
     * that was all it did — everything the account had already published went
     * on being advertised by the site that had just banned them.
     */
    expect(await listed(), "a suspended account's projects are not listed to strangers").toBe(false);
    // Their own view of their own work is not taken away with it.
    expect((await owner.agent.get(`/api/users/${owner.userId}`).set("x-forwarded-for", ip()))
      .body.projects.some((row: any) => row.id === p.id)).toBe(true);
  });
});

describe("invites are capped per recipient", () => {
  it("counts the address across projects, not just within one", async () => {
    const app = await getTestApp();
    const sender = await person(app, "Keen");
    const target = `wanted-${Date.now()}-${n}@example.test`;

    // Several projects, exactly the shape that got past every existing cap:
    // each one has its own daily allowance, and the per-person rate limit is
    // nowhere near this low.
    const one = await project(sender.agent, `First Idea ${Date.now()}`);
    const two = await project(sender.agent, `Second Idea ${Date.now()}`);
    const three = await project(sender.agent, `Third Idea ${Date.now()}`);
    const four = await project(sender.agent, `Fourth Idea ${Date.now()}`);
    const spread = [one, two, three, four];

    for (let i = 0; i < INVITES_PER_ADDRESS_PER_DAY; i += 1) {
      const sent = await sender.agent.post(`/api/projects/${spread[i].id}/invites`).set("x-forwarded-for", ip())
        .send({ email: target, role: "Collaborator" });
      expect(sent.status, `invite ${i + 1}: ${JSON.stringify(sent.body)}`).toBe(201);
    }

    const tooMany = await sender.agent.post(`/api/projects/${spread[INVITES_PER_ADDRESS_PER_DAY].id}/invites`)
      .set("x-forwarded-for", ip()).send({ email: target, role: "Collaborator" });
    expect(tooMany.status, JSON.stringify(tooMany.body)).toBe(429);
    expect(tooMany.body.field).toBe("email");

    // Somebody else is unaffected — the cap is the recipient's, not the sender's.
    const other = await sender.agent.post(`/api/projects/${one.id}/invites`).set("x-forwarded-for", ip())
      .send({ email: `someone-else-${Date.now()}-${n}@example.test`, role: "Collaborator" });
    expect(other.status, JSON.stringify(other.body)).toBe(201);
  });
});

describe("a reader with no account can report a public artifact", () => {
  /** A published artifact with its feed post, as `/publish` would leave it. */
  async function published(authorId: string, projectId: string) {
    const [post] = await db.insert(feedPosts).values({
      authorId, projectId, postType: "project_update", content: "A step we published.",
    } as any).returning();
    const [artifact] = await db.insert(pathArtifacts).values({
      projectId, authorId, taskId: `task-${Date.now()}-${n++}`,
      title: "How we picked the first customer", summary: "What we asked and what they said.",
      body: "The whole write-up.", visibility: "public",
      publishedPostId: post.id, publishedAt: new Date(),
    } as any).returning();
    return { post, artifact };
  }

  it("files a report against the page itself, once per address, with nobody signed in", async () => {
    const app = await getTestApp();
    const author = await person(app, "Author");
    const p = await project(author.agent, `Published Work ${Date.now()}`);
    const { post, artifact } = await published(author.userId, p.id);

    const address = ip();
    const sent = await request(app).post(`/api/public/artifacts/${artifact.id}/report`)
      .set("x-forwarded-for", address).send({ reason: "abuse", detail: "targets_other" });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.received).toBe(true);

    /*
     * Against `path_artifact`, not against the artifact's feed post. It used
     * to be the post, on the reasoning that hiding the post took the page down
     * with it — true only for artifacts that have one. A page published
     * without a post, or one whose post a reviewer had already restored, could
     * not be reported and could not be taken down: the reader saw a page and
     * the queue saw nothing. The page is its own takedown target now.
     */
    const rows = await db.select().from(contentReports)
      .where(and(eq(contentReports.targetType, "path_artifact"), eq(contentReports.targetId, artifact.id)));
    expect(rows, "one report, filed against the page").toHaveLength(1);
    expect(rows[0].reporterId, "no account behind it").toBeNull();
    expect(rows[0].reporterAddressHash, "the reporter is an address hash, not an address").toBeTruthy();
    expect(rows[0].reporterAddressHash).not.toContain(address);

    // The same reader pressing it again is the same report, and gets the same
    // answer either way — a different one would say what is in the queue.
    const again = await request(app).post(`/api/public/artifacts/${artifact.id}/report`)
      .set("x-forwarded-for", address).send({ reason: "spam", detail: "selling" });
    expect(again.status).toBe(200);
    expect(again.body.received).toBe(true);
    expect(await db.select().from(contentReports)
      .where(and(eq(contentReports.targetType, "path_artifact"), eq(contentReports.targetId, artifact.id)))).toHaveLength(1);
  });

  it("refuses a made-up reason, an unpublished artifact, and one already taken down", async () => {
    const app = await getTestApp();
    const author = await person(app, "Quiet");
    const p = await project(author.agent, `Quiet Work ${Date.now()}`);
    const { post, artifact } = await published(author.userId, p.id);

    expect((await request(app).post(`/api/public/artifacts/${artifact.id}/report`)
      .set("x-forwarded-for", ip()).send({ reason: "because-i-say-so" })).status).toBe(400);

    expect((await request(app).post("/api/public/artifacts/00000000-0000-4000-8000-000000000009/report")
      .set("x-forwarded-for", ip()).send({ reason: "spam" })).status).toBe(404);

    // Private again: the page 404s, and so does reporting it — otherwise this
    // would be a way to ask whether a private artifact exists.
    await db.update(pathArtifacts).set({ visibility: "private" }).where(eq(pathArtifacts.id, artifact.id));
    expect((await request(app).post(`/api/public/artifacts/${artifact.id}/report`)
      .set("x-forwarded-for", ip()).send({ reason: "spam" })).status).toBe(404);

    // Public again but the post is already hidden: same answer, for the same reason.
    await db.update(pathArtifacts).set({ visibility: "public" }).where(eq(pathArtifacts.id, artifact.id));
    await db.update(feedPosts).set({ hiddenAt: new Date() }).where(eq(feedPosts.id, post.id));
    expect((await request(app).post(`/api/public/artifacts/${artifact.id}/report`)
      .set("x-forwarded-for", ip()).send({ reason: "spam" })).status).toBe(404);

    // And the page taken down in its own right, which is the case that had no
    // answer at all before `path_artifacts.hidden_at` existed.
    await db.update(feedPosts).set({ hiddenAt: null }).where(eq(feedPosts.id, post.id));
    await db.update(pathArtifacts).set({ hiddenAt: new Date() }).where(eq(pathArtifacts.id, artifact.id));
    expect((await request(app).post(`/api/public/artifacts/${artifact.id}/report`)
      .set("x-forwarded-for", ip()).send({ reason: "spam" })).status).toBe(404);
  });
});
