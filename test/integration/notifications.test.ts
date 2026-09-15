/**
 * The Explore loop's way back: what happened to you, recorded server-side.
 * Progress from people you follow, replies and reactions to what you post,
 * follows and connections — each once, never about yourself, never through a
 * private project, and taken back when the act is undone.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { users } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, first: string) {
  const agent = request.agent(app);
  n += 1;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.100.${40 + (n % 150)}`)
    .send({ email: `notif-${first}-${Date.now()}-${n}@example.test`, password: "Testpass123!", firstName: first });
  expect(res.status).toBe(201);
  return { agent, id: res.body.id as string };
}
const bell = async (who: { agent: any }) => (await who.agent.get("/api/notifications")).body.items as any[];
const counts = async (who: { agent: any }) => (await who.agent.get("/api/notifications/unread-count")).body;
// Notifications are recorded in the background of the request that caused them.
const settle = () => new Promise((r) => setTimeout(r, 400));

describe("notifications", () => {
  it("brings a follower back for progress, and the author back for comments, replies, reactions and mentions", async () => {
    const app = await getTestApp();
    const ada = await person(app, "Ada");
    const ben = await person(app, "Ben");
    const cy = await person(app, "Cy");

    // Ben follows Ada: Ada hears; unfollowing before she looks takes it back.
    await ben.agent.post(`/api/users/${ada.id}/follow`).send({ following: true }).expect(200); await settle();
    expect((await bell(ada)).map((x) => x.text)).toEqual(["Ben started following you"]);
    await ben.agent.post(`/api/users/${ada.id}/follow`).send({ following: false }).expect(200); await settle();
    expect(await bell(ada)).toEqual([]);
    await ben.agent.post(`/api/users/${ada.id}/follow`).send({ following: true }).expect(200);

    // Ada posts: Ben hears, Ada doesn't hear about herself.
    const post = (await ada.agent.post("/api/feed").send({ postType: "project_update", content: "Shipped search across every project." })).body;
    await settle();
    const benBell = await bell(ben);
    expect(benBell[0]).toMatchObject({ kind: "followed_post", text: "Ada posted an update", href: `/posts/${post.id}`, read: false, excerpt: "Shipped search across every project." });
    expect(await counts(ben)).toMatchObject({ count: 1, followedPosts: 1 });
    expect((await bell(ada)).some((x) => x.kind === "followed_post")).toBe(false);

    // Opening Following reads the progress; the rest stays.
    await ben.agent.post("/api/notifications/read").send({ kind: "followed_post" }).expect(200);
    expect(await counts(ben)).toMatchObject({ count: 0, followedPosts: 0 });

    // Ben comments: Ada hears. Cy replies to Ben, mentioning Ada: Ben hears a reply, Ada hears the mention — once each.
    const rows = (await ben.agent.post(`/api/feed/${post.id}/comments`).send({ content: "Does it search comments too?" })).body;
    const benComment = rows.find((c: any) => c.authorId === ben.id);
    await settle();
    await cy.agent.post(`/api/feed/${post.id}/comments`).send({ content: "@Ada it should", parentCommentId: benComment.id, mentions: [{ userId: ada.id, name: "Ada" }] }).expect(200);
    await settle();
    expect((await bell(ben)).filter((x) => !x.read).map((x) => x.text)).toEqual(["Cy replied to your comment"]);
    // (Ben's re-follow is still unread too, which is right: he did follow her.)
    expect((await bell(ada)).filter((x) => !x.read && x.kind !== "follow").map((x) => x.text).sort()).toEqual(["Ben commented on your post", "Cy mentioned you"]);

    // Reactions: reacting twice is one notification; un-reacting takes it back.
    await cy.agent.post(`/api/feed/${post.id}/react`).send({ reaction: "like" }).expect(200);
    await cy.agent.post(`/api/feed/${post.id}/react`).send({ reaction: "celebrate" }).expect(200); await settle();
    expect((await bell(ada)).filter((x) => x.kind === "post_reaction")).toHaveLength(1);
    await cy.agent.post(`/api/feed/${post.id}/react`).send({ reaction: "celebrate" }).expect(200); await settle();
    expect((await bell(ada)).some((x) => x.kind === "post_reaction")).toBe(false);
    await ada.agent.post(`/api/feed/comments/${benComment.id}/react`).send({ reaction: "insightful" }).expect(200); await settle();
    expect((await bell(ben)).find((x) => x.kind === "comment_reaction")).toMatchObject({ text: "Ada reacted to your comment", href: `/posts/${post.id}` });

    // Opening the post reads everything about it.
    await ada.agent.post("/api/notifications/read").send({ postId: post.id }).expect(200);
    expect((await bell(ada)).filter((x) => !x.read).map((x) => x.kind)).toEqual(["follow"]);

    // A taken-down post drops out of the bell rather than linking to nothing.
    const mod = await person(app, "Mod");
    await db.update(users).set({ platformRole: "reviewer" }).where(eq(users.id, mod.id));
    await mod.agent.post(`/api/admin/content/feed_post/${post.id}/hide`).send({ reason: "Test takedown" }).expect(200);
    expect((await bell(ben)).some((x) => x.kind === "followed_post")).toBe(false);
  });

  it("keeps a private project's progress to its team, and closes connections both ways", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const fan = await person(app, "Fan");
    const project = (await owner.agent.post("/api/projects").send({ title: "Soon Private", description: "A project that goes private after someone follows it.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;
    await fan.agent.post(`/api/projects/${project.id}/follow`).send({ following: true }).expect(200); await settle();
    expect((await bell(owner)).find((x) => x.kind === "project_follow")).toMatchObject({ text: "Fan followed Soon Private", href: `/projects/${project.id}` });

    const { projects } = await import("@shared/schema");
    await db.update(projects).set({ isPrivate: true } as any).where(eq(projects.id, project.id));
    await owner.agent.post("/api/feed").send({ postType: "project_update", projectId: project.id, content: "Secret progress." }).expect(200); await settle();
    expect((await bell(fan)).some((x) => x.kind === "followed_post")).toBe(false);

    const conn = (await fan.agent.post("/api/connections/request").send({ userId: owner.id, note: "Loved the demo" })).body;
    await settle();
    expect((await bell(owner)).find((x) => x.kind === "connection_request")).toMatchObject({ text: "Fan wants to connect", excerpt: "Loved the demo" });
    await owner.agent.post(`/api/connections/${conn.id}/accept`).send({}).expect(200); await settle();
    expect((await bell(fan)).find((x) => x.kind === "connection_accepted")).toMatchObject({ text: "Owner accepted your connection request", href: `/profile/${owner.id}` });

    expect((await fan.agent.post("/api/notifications/read").send({})).status).toBe(400);
    await fan.agent.post("/api/notifications/read").send({ all: true }).expect(200);
    expect((await counts(fan)).count).toBe(0);
    expect((await request(app).get("/api/notifications")).status).toBe(401);
  });
});

describe("founder badges", () => {
  it("pins a badge for every public project you create, shows your pinned badges to others, and hides a private one", async () => {
    const app = await getTestApp();
    const maker = await person(app, "Maker");
    // Private projects are a paid feature.
    await db.update(users).set({ subscriptionTier: "pro" }).where(eq(users.id, maker.id));
    const visitor = await person(app, "Visitor");
    const made = (await maker.agent.post("/api/projects").send({ title: "Made By Me", description: "A project its founder should get a badge for.", category: "saas", goal: "ship_mvp", subcategory: "saas", logoUrl: "/objects/logo.png" })).body;
    await settle();

    const pinned = (await visitor.agent.get(`/api/users/${maker.id}/badges/backer`)).body;
    expect(pinned).toEqual([expect.objectContaining({ projectId: made.id, projectTitle: "Made By Me", level: "founder", showcaseOrder: 0, projectLogo: "/objects/logo.png", imageUrl: null })]);

    const quiet = (await maker.agent.post("/api/projects").send({ title: "Quiet One", description: "A private project nobody else should see a badge for.", category: "saas", goal: "ship_mvp", subcategory: "saas", isPrivate: true })).body;
    await settle();
    const mine = (await maker.agent.get("/api/me/badges")).body;
    expect(mine.map((b: any) => b.projectId)).toEqual([made.id]);
    expect(quiet.id).toBeTruthy();

    // A project that goes private leaves other people's view of the profile, not the founder's.
    const { projects } = await import("@shared/schema");
    await db.update(projects).set({ isPrivate: true } as any).where(eq(projects.id, made.id));
    expect((await visitor.agent.get(`/api/users/${maker.id}/badges/backer`)).body).toEqual([]);
    expect((await maker.agent.get(`/api/users/${maker.id}/badges/backer`)).body).toHaveLength(1);

    // Unpinning sticks: the next look doesn't pin it again.
    await maker.agent.put("/api/me/badges/showcase").send({ badgeIds: [] }).expect(200);
    await db.update(projects).set({ isPrivate: false } as any).where(eq(projects.id, made.id));
    await maker.agent.get("/api/me/badges").expect(200);
    expect((await visitor.agent.get(`/api/users/${maker.id}/badges/backer`)).body).toEqual([]);
  });
});
