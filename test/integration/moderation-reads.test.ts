/**
 * The moderation drill for *reads*: once a reviewer has taken something down,
 * is it actually gone?
 *
 * The takedown itself was already proven (test/integration/moderation-drill.ts
 * — report, queue, hide, log, restore). What was never proven is the half that
 * the public experiences: a hidden row is only hidden if every query that can
 * reach it says so, and there are dozens of those. A takedown that works on
 * the post page and not on the feed, or on the feed and not on the sitemap, is
 * not a takedown — it is a reviewer being told the problem is handled while
 * the content is still being served, which is worse than no takedown at all,
 * because nobody goes back and checks.
 *
 * So this file takes one of each kind of content, hides it through the real
 * admin route, and then tries to reach it through every open endpoint there
 * is, signed out and signed in as an ordinary account. Then it does the same
 * with a *suspension*, which is the other way content should stop being
 * served: a suspension blocks writes, and on its own leaves everything the
 * account ever published exactly where it was.
 *
 * And it checks the opposite direction too — that the queue can still see all
 * of it. A fix for "hidden content is still visible" that blinds the reviewer
 * has removed the only person who can put a mistake right.
 *
 * The static counterpart is test/unit/visibility-guards.test.ts, which fails
 * when a *new* read forgets the policy. This one fails when an existing one
 * stops working.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { passMfa } from "../helpers/mfa";
import { db } from "../../server/db";
import { companies, companyMembers, users } from "@shared/schema";
import { publicArtifactPages, publicProfilePages, publicProjectPages } from "../../server/sitemap";
import { artifactPageMeta } from "../../server/artifact-routes";
import { injectPageMeta } from "@shared/path-artifacts";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
let n = 0;
const ip = () => `198.51.120.${20 + (n++ % 200)}`;

async function person(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `modread-${first.toLowerCase()}-${Date.now()}-${n}@example.test`;
  const addr = ip();
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", addr)
    .send({ email, password, firstName: first, lastName: "Read" });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  await verifyEmail(app, email, addr);
  return { agent, id: res.body.id as string, email };
}

/** Roles come from the environment at boot; a test grants one directly, then passes the second factor review tools require. */
async function reviewer(app: any) {
  const r = await person(app, "Reviewer");
  await db.update(users).set({ platformRole: "reviewer" }).where(eq(users.id, r.id));
  await passMfa(r.agent);
  return r;
}

/**
 * One of everything a reviewer can take down, made through the real routes by
 * one author — so that suspending that author is a single act with an effect
 * on all four, which is exactly the case a per-table filter gets wrong.
 *
 * The words are distinctive on purpose: the /a/:id assertions look for them in
 * the rendered HTML, and "none of the hidden text is in the page" is only a
 * real assertion if the text would otherwise be unmistakable.
 */
async function everythingPublishable(app: any, author: { agent: any; id: string }, tag: string) {
  const project = (await author.agent.post("/api/projects").send({
    title: `Takedown Target ${tag}`,
    description: `A project used to prove that hidden content stops being readable. ${tag}`,
    category: "Fintech", goal: "ship_mvp", subcategory: "saas",
  })).body;
  expect(project.id, JSON.stringify(project)).toBeTruthy();

  const post = (await author.agent.post("/api/feed").send({
    postType: "project_update", projectId: project.id,
    content: `POSTWORDS-${tag} — the update that a reviewer is about to remove.`,
  })).body;
  expect(post.id).toBeTruthy();

  // Both comment routes answer with the whole thread, not the new row.
  const replies = (await author.agent.post(`/api/feed/${post.id}/comments`).send({
    content: `FEEDCOMMENTWORDS-${tag} — a reply that a reviewer is about to remove.`,
  })).body as any[];
  const feedComment = (Array.isArray(replies) ? replies : []).find((c) => String(c.content ?? "").includes(`FEEDCOMMENTWORDS-${tag}`));
  expect(feedComment?.id, JSON.stringify(replies).slice(0, 300)).toBeTruthy();

  const thread = (await author.agent.post(`/api/projects/${project.id}/comments`).send({
    targetType: "project", targetId: project.id,
    content: `PROJECTCOMMENTWORDS-${tag} — a note on the project that a reviewer is about to remove.`,
  })).body as any[];
  const projectComment = (Array.isArray(thread) ? thread : []).find((c) => String(c.content ?? "").includes(`PROJECTCOMMENTWORDS-${tag}`));
  expect(projectComment?.id, JSON.stringify(thread).slice(0, 300)).toBeTruthy();

  // A finished step becomes an artifact, and the artifact becomes a public page.
  const tasks = (await author.agent.get(`/api/projects/${project.id}/kanban`)).body;
  const step = tasks.find((t: any) => (t.tags ?? []).includes("backbone:SHIP.M1.1"));
  await author.agent.patch(`/api/kanban/${step.id}`)
    .send({ status: "done", description: `ARTIFACTWORDS-${tag} — the published page's own body text.` }).expect(200);
  const artifact = (await author.agent.post(`/api/projects/${project.id}/path/tasks/${step.id}/artifact`).send({})).body;
  const published = await author.agent.post(`/api/artifacts/${artifact.id}/publish`)
    .send({ title: `Published Page ${tag}`, tags: ["positioning"] });
  expect(published.status, JSON.stringify(published.body)).toBe(200);

  return {
    projectId: project.id as string,
    postId: post.id as string,
    feedCommentId: feedComment!.id as string,
    projectCommentId: projectComment!.id as string,
    artifactId: artifact.id as string,
    artifactPostId: published.body.postId as string,
    words: {
      post: `POSTWORDS-${tag}`,
      feedComment: `FEEDCOMMENTWORDS-${tag}`,
      projectComment: `PROJECTCOMMENTWORDS-${tag}`,
      artifact: `ARTIFACTWORDS-${tag}`,
    },
  };
}

type Fixture = Awaited<ReturnType<typeof everythingPublishable>>;

/**
 * /a/:id as a browser or a crawler receives it.
 *
 * `createApp` doesn't mount the static handler (there is no client build in a
 * test run), so this does what server/static.ts does with the result: run the
 * real route handler, then inject whatever meta it set into the shell. The
 * meta is the whole point — it carries the page's title, description *and* a
 * <noscript> copy of the body, which is the part a naive "the API 404s"
 * assertion would miss entirely. A takedown that leaves the words in the HTML
 * has taken nothing down: that copy is what a crawler indexes and what a link
 * preview shows.
 */
async function artifactPageHtml(id: string): Promise<string> {
  const req: any = { params: { id }, headers: {}, protocol: "https" };
  const res: any = { locals: {} };
  await new Promise<void>((resolve, reject) => {
    Promise.resolve(artifactPageMeta(req, res, () => resolve())).catch(reject);
  });
  const shell = '<html><head><title>SparkTower</title></head><body><div id="root"></div></body></html>';
  return res.locals.pageMeta ? injectPageMeta(shell, res.locals.pageMeta) : shell;
}

/**
 * What each open read says about the fixture, for one viewer. Everything here
 * is reachable with no account or with an ordinary one — no role, no
 * membership, nothing but a session.
 */
async function openReads(app: any, who: any, f: Fixture) {
  const feed = await who.get(`/api/feed?projectId=${f.projectId}`);
  const postPage = await who.get(`/api/feed/${f.postId}`);
  const feedComments = await who.get(`/api/feed/${f.postId}/comments`);
  const projectComments = await who.get(`/api/projects/${f.projectId}/comments`);
  const commentCounts = await who.get(`/api/projects/${f.projectId}/comment-counts`);
  const artifact = await who.get(`/api/public/artifacts/${f.artifactId}`);
  const projectListing = await who.get("/api/projects?limit=200");
  const html = await artifactPageHtml(f.artifactId);
  return {
    inFeed: ((feed.body?.posts ?? []) as any[]).some((p) => p.id === f.postId),
    postStatus: postPage.status,
    // A 404 answers with an object, not a list — an absent list is "not there" too.
    hasFeedComment: Array.isArray(feedComments.body) && feedComments.body.some((c: any) => c.id === f.feedCommentId),
    hasProjectComment: Array.isArray(projectComments.body) && projectComments.body.some((c: any) => c.id === f.projectCommentId),
    projectCommentCount: (commentCounts.body ?? {})[`project:${f.projectId}`] ?? 0,
    artifactStatus: artifact.status,
    inProjectListing: Array.isArray(projectListing.body) && projectListing.body.some((p: any) => p.id === f.projectId),
    html,
  };
}

/** The page's own words, wherever they might have survived: the JSON, the meta tags, the noscript copy. */
const htmlMentions = (html: string, words: string) => html.includes(words);

describe("a takedown, from every open read", () => {
  it("hides a post, both kinds of comment and a published page — signed out and signed in", async () => {
    const app = await getTestApp();
    const author = await person(app, "Author");
    const stranger = await person(app, "Stranger");
    const mod = await reviewer(app);
    const tag = `T${Date.now()}`;
    const f = await everythingPublishable(app, author, tag);

    // Before: every one of them is readable by anybody, which is what makes
    // the "after" meaningful rather than a test of four 404s that were always
    // going to be 404s.
    for (const who of [request(app), stranger.agent]) {
      const before = await openReads(app, who, f);
      expect(before.inFeed).toBe(true);
      expect(before.postStatus).toBe(200);
      expect(before.hasFeedComment).toBe(true);
      expect(before.hasProjectComment).toBe(true);
      expect(before.projectCommentCount).toBeGreaterThan(0);
      expect(before.artifactStatus).toBe(200);
      expect(htmlMentions(before.html, f.words.artifact)).toBe(true);
    }

    // Taken down through the route a reviewer actually presses, one kind at a
    // time, each with a reason — including the published page, which until now
    // had no takedown at all.
    for (const [type, id] of [
      ["feed_post", f.postId],
      ["feed_comment", f.feedCommentId],
      ["comment", f.projectCommentId],
      ["path_artifact", f.artifactId],
    ] as const) {
      const hide = await mod.agent.post(`/api/admin/content/${type}/${id}/hide`).send({ reason: "Spam" });
      expect(hide.status, `${type}: ${JSON.stringify(hide.body)}`).toBe(200);
      expect(hide.body.hidden).toBe(true);
    }

    for (const [label, who] of [["signed out", request(app)], ["an ordinary account", stranger.agent]] as const) {
      const after = await openReads(app, who, f);
      expect(after.inFeed, `${label}: the hidden post is still on the feed`).toBe(false);
      expect(after.postStatus, `${label}: the hidden post still has a page`).toBe(404);
      expect(after.hasFeedComment, `${label}: the hidden reply is still under the post`).toBe(false);
      expect(after.hasProjectComment, `${label}: the hidden note is still on the project`).toBe(false);
      expect(after.projectCommentCount, `${label}: the badge still counts a comment nobody can open`).toBe(0);
      expect(after.artifactStatus, `${label}: the hidden page is still served`).toBe(404);
      // The HTML, not just the API: none of the page's words survive anywhere in it.
      for (const words of Object.values(f.words)) {
        expect(htmlMentions(after.html, words), `${label}: /a/${f.artifactId} still contains "${words}"`).toBe(false);
      }
      expect(after.html).not.toContain("<noscript>");
    }

    // And out of the index with it: a sitemap entry for a page that 404s is
    // the one thing a sitemap must never contain.
    const listed = await publicArtifactPages();
    expect(listed.map((r: any) => r.id)).not.toContain(f.artifactId);

    // Restoring puts all four back, so this is a takedown and not a deletion.
    for (const [type, id] of [
      ["feed_post", f.postId],
      ["feed_comment", f.feedCommentId],
      ["comment", f.projectCommentId],
      ["path_artifact", f.artifactId],
    ] as const) {
      expect((await mod.agent.post(`/api/admin/content/${type}/${id}/restore`).send({})).status).toBe(200);
    }
    const restored = await openReads(app, request(app), f);
    expect(restored.postStatus).toBe(200);
    expect(restored.artifactStatus).toBe(200);
    expect(restored.hasFeedComment).toBe(true);
    expect(restored.hasProjectComment).toBe(true);
    expect((await publicArtifactPages()).map((r: any) => r.id)).toContain(f.artifactId);
  });

  it("lets a reader with no account report a published page, and a reviewer take it down from the queue", async () => {
    const app = await getTestApp();
    const author = await person(app, "Publisher");
    const mod = await reviewer(app);
    const f = await everythingPublishable(app, author, `A${Date.now()}`);

    // The anonymous report route now files against the page itself rather than
    // against a feed post that may not exist.
    const filed = await request(app).post(`/api/public/artifacts/${f.artifactId}/report`)
      .set("x-forwarded-for", ip()).send({ reason: "abuse", detail: "targets_other" });
    expect(filed.status, JSON.stringify(filed.body)).toBe(200);

    const queue = (await mod.agent.get("/api/admin/reports")).body as any[];
    const report = queue.find((r) => r.targetId === f.artifactId && r.targetType === "path_artifact");
    expect(report, "the page's report never reached the queue").toBeTruthy();
    expect(report.actionable, "a reviewer has no way to act on it").toBe(true);
    expect(report.targetHidden).toBe(false);
    expect(report.snapshot).toContain(f.words.artifact);

    const acted = await mod.agent.post(`/api/admin/reports/${report.id}/act`)
      .send({ action: "remove", reasonCode: "harassment", note: "Taken down from the queue." });
    expect(acted.status, JSON.stringify(acted.body)).toBe(200);
    expect((await request(app).get(`/api/public/artifacts/${f.artifactId}`)).status).toBe(404);
    expect(await artifactPageHtml(f.artifactId)).not.toContain(f.words.artifact);

    // The anonymous route stops confirming the page exists at all, exactly as
    // it does for one that was never published.
    expect((await request(app).post(`/api/public/artifacts/${f.artifactId}/report`)
      .set("x-forwarded-for", ip()).send({ reason: "spam" })).status).toBe(404);
  });
});

describe("a suspension, from every open read", () => {
  it("takes the suspended author's content off the public surfaces, and leaves it to them", async () => {
    const app = await getTestApp();
    const author = await person(app, "Suspended");
    const stranger = await person(app, "Onlooker");
    const mod = await reviewer(app);
    const tag = `S${Date.now()}`;
    const f = await everythingPublishable(app, author, tag);

    // A profile the sitemap is willing to list, so the suspension has
    // something to take out of it.
    await author.agent.post("/api/profile").send({ displayName: `Suspended ${tag}`, headline: "Building", bio: "In public." });
    await author.agent.post("/api/profile/complete-onboarding").send({});

    expect((await stranger.agent.get(`/api/users/${author.id}`)).status).toBe(200);
    const searchBefore = await stranger.agent.get(`/api/discover/search?q=${encodeURIComponent(`Takedown Target ${tag}`)}&kind=projects`);
    expect(searchBefore.status).toBe(200);
    expect((searchBefore.body.projects as any[]).some((p) => p.id === f.projectId)).toBe(true);

    const suspend = await mod.agent.post(`/api/admin/users/${author.id}/suspend`)
      .send({ suspended: true, reason: "Advertising in every post" });
    expect(suspend.status, JSON.stringify(suspend.body)).toBe(200);

    for (const [label, who] of [["signed out", request(app)], ["an ordinary account", stranger.agent]] as const) {
      const after = await openReads(app, who, f);
      expect(after.inFeed, `${label}: a suspended account's post is still on the feed`).toBe(false);
      expect(after.postStatus, `${label}: a suspended account's post still has a page`).toBe(404);
      expect(after.hasFeedComment, `${label}: a suspended account's reply is still under the post`).toBe(false);
      expect(after.hasProjectComment, `${label}: a suspended account's note is still on the project`).toBe(false);
      expect(after.artifactStatus, `${label}: a suspended account's published page is still served`).toBe(404);
      expect(after.inProjectListing, `${label}: a suspended account's project is still listed`).toBe(false);
      for (const words of Object.values(f.words)) {
        expect(htmlMentions(after.html, words), `${label}: /a/${f.artifactId} still contains "${words}"`).toBe(false);
      }
    }

    // The profile, search and the index too.
    expect((await stranger.agent.get(`/api/users/${author.id}`)).status).toBe(404);
    const searchAfter = await stranger.agent.get(`/api/discover/search?q=${encodeURIComponent(`Takedown Target ${tag}`)}&kind=projects`);
    expect((searchAfter.body.projects as any[]).some((p) => p.id === f.projectId)).toBe(false);
    expect((await publicArtifactPages()).map((r: any) => r.id)).not.toContain(f.artifactId);
    expect((await publicProjectPages()).map((r: any) => r.id)).not.toContain(f.projectId);
    expect((await publicProfilePages()).map((r: any) => r.id)).not.toContain(author.id);

    /*
     * And their own view is untouched. Somebody appealing a suspension has to
     * be able to see what they are appealing about — the suspension is about
     * what they can do to other people, not about hiding their own words from
     * them.
     */
    expect((await author.agent.get(`/api/feed/${f.postId}`)).status).toBe(200);
    expect((await author.agent.get(`/api/users/${author.id}`)).status).toBe(200);
    const mine = await author.agent.get(`/api/projects/${f.projectId}/comments`);
    expect((mine.body as any[]).some((c) => c.id === f.projectCommentId)).toBe(true);

    // Reinstating puts it all back: a suspension is not a deletion either.
    expect((await mod.agent.post(`/api/admin/users/${author.id}/suspend`).send({ suspended: false })).status).toBe(200);
    const back = await openReads(app, request(app), f);
    expect(back.postStatus).toBe(200);
    expect(back.artifactStatus).toBe(200);
    expect(back.hasFeedComment).toBe(true);
  });

  it("stops recommending a suspended builder's project, and one a reviewer took down, to companies scouting", async () => {
    const app = await getTestApp();
    const founder = await person(app, "Founder");
    const scout = await person(app, "Scout");
    const mod = await reviewer(app);
    const tag = `C${Date.now()}`;
    const f = await everythingPublishable(app, founder, tag);

    const [company] = await db.insert(companies).values({
      name: `Scouts ${tag}`, slug: `scouts-${tag.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`,
      createdBy: scout.id, createdAt: new Date(),
    }).returning();
    await db.insert(companyMembers).values({ companyId: company.id, userId: scout.id, role: "owner", joinedAt: new Date() });
    await scout.agent.put(`/api/companies/${company.id}/watches`).send({ industries: ["Fintech"] }).expect(200);

    const suggested = async () => {
      const res = await scout.agent.get(`/api/companies/${company.id}/scouting`);
      expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
      return (res.body.suggestions as any[]).map((p) => p.id);
    };
    expect(await suggested()).toContain(f.projectId);

    // A project a reviewer took down was still being recommended to companies
    // as somebody worth backing: scouting tested the owner's suspension and
    // never `projects.hiddenAt`.
    await mod.agent.post(`/api/admin/content/project/${f.projectId}/hide`).send({ reason: "Spam" }).expect(200);
    expect(await suggested()).not.toContain(f.projectId);
    await mod.agent.post(`/api/admin/content/project/${f.projectId}/restore`).send({}).expect(200);
    expect(await suggested()).toContain(f.projectId);

    await mod.agent.post(`/api/admin/users/${founder.id}/suspend`).send({ suspended: true, reason: "Spam" }).expect(200);
    expect(await suggested()).not.toContain(f.projectId);
  });
});

describe("the people who have to judge it", () => {
  it("keeps every hidden item, and its state, in front of a reviewer", async () => {
    const app = await getTestApp();
    const author = await person(app, "Author");
    const reporter = await person(app, "Reporter");
    const mod = await reviewer(app);
    const tag = `Q${Date.now()}`;
    const f = await everythingPublishable(app, author, tag);

    const targets = [
      ["feed_post", f.postId],
      ["feed_comment", f.feedCommentId],
      ["comment", f.projectCommentId],
      ["path_artifact", f.artifactId],
      ["project", f.projectId],
    ] as const;

    for (const [targetType, targetId] of targets) {
      const filed = await reporter.agent.post("/api/reports").send({ targetType, targetId, reason: "spam", note: "Looks like an advert." });
      expect(filed.status, `${targetType}: ${JSON.stringify(filed.body)}`).toBe(200);
      expect((await mod.agent.post(`/api/admin/content/${targetType}/${targetId}/hide`).send({ reason: "Spam" })).status).toBe(200);
    }

    /*
     * The whole point of the read filters is that content a reviewer removed
     * is unreachable — for everyone but the reviewer. If the queue applied the
     * same policy it would show an empty list of things it had just hidden,
     * nobody could tell a mistaken removal from a correct one, and the undo
     * path would have nothing to act on.
     */
    const queue = (await mod.agent.get("/api/admin/reports?status=open")).body as any[];
    for (const [targetType, targetId] of targets) {
      const row = queue.find((r) => r.targetId === targetId && r.targetType === targetType);
      expect(row, `${targetType} is not in the queue after being hidden`).toBeTruthy();
      expect(row.targetHidden, `${targetType}: the queue can't tell it's hidden`).toBe(true);
      expect(row.ownerId).toBe(author.id);
      expect(row.snapshot, `${targetType}: the queue lost the evidence`).toBeTruthy();
    }

    // Still restorable, which is what "the reviewer can still see it" is for.
    for (const [targetType, targetId] of targets) {
      expect((await mod.agent.post(`/api/admin/content/${targetType}/${targetId}/restore`).send({})).status).toBe(200);
    }
    expect((await request(app).get(`/api/feed/${f.postId}`)).status).toBe(200);
    expect((await request(app).get(`/api/public/artifacts/${f.artifactId}`)).status).toBe(200);

    // And the log tells the story, including for the kind of content that had
    // no takedown at all until now.
    const log = (await mod.agent.get("/api/admin/moderation-log")).body as any[];
    const onPage = log.filter((e) => e.targetId === f.artifactId).map((e) => e.action);
    expect(onPage).toEqual(expect.arrayContaining(["content_hidden", "content_restored"]));
  });
});
