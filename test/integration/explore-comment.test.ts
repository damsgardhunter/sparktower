/**
 * The Explore loop's message/comment step, for comments: answering someone's
 * progress update in public is the loop's action — recorded by the comment
 * endpoint, in the visit it happened in, and counted like a follow or a message
 * — and it comes back round: the author hears, and their reply brings the
 * commenter back to the post.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq, like } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { activityEvents } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let address = 120;
async function person(app: any, first: string) {
  const res = await request(app).post("/api/auth/register").set("x-forwarded-for", `203.0.113.${address++}`)
    .send({ email: `xc-${first}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`, password: "Testpass123!", firstName: first });
  expect(res.status).toBe(201);
  await verifyEmail(app, res.body.email, `203.0.114.${address++}`);
  const auth = (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).filter((c) => !/^st_(vid|sid)=/.test(c)).join("; ");
  return { id: res.body.id as string, auth };
}
const as = (app: any, who: { auth: string }, visitor: string, session: string) => {
  const cookie = `${who.auth}; st_vid=${visitor}; st_sid=${session}`;
  return {
    post: (url: string) => request(app).post(url).set("x-forwarded-for", `203.0.113.${address++}`).set("Cookie", cookie),
    get: (url: string) => request(app).get(url).set("Cookie", cookie),
  };
};
const explore = async (visitor: string, expected: number) => {
  for (let i = 0; i < 60; i++) {
    const rows = await db.select().from(activityEvents).where(and(eq(activityEvents.visitorId, visitor), like(activityEvents.name, "explore.%")));
    if (rows.length >= expected) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
  return db.select().from(activityEvents).where(and(eq(activityEvents.visitorId, visitor), like(activityEvents.name, "explore.%")));
};
const settle = () => new Promise((r) => setTimeout(r, 400));

describe("commenting on someone's progress", () => {
  it("is the loop's action, only on someone else's update, and the reply brings the commenter back", async () => {
    const app = await getTestApp();
    const [ana, bea] = [await person(app, "Ana"), await person(app, "Bea")];
    const anaVisit = as(app, ana, "vis-xc-ana", "ses-xc-ana");
    const beaVisit = as(app, bea, "vis-xc-bea", "ses-xc-bea");

    // Ana follows Bea, Bea posts progress on her own project and on her own.
    await anaVisit.post(`/api/users/${bea.id}/follow`).send({ following: true }).expect(200);
    const project = (await beaVisit.post("/api/projects").send({ title: "Bea's Planner", description: "A meal planner Bea posts progress about.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;
    const projectPost = (await beaVisit.post("/api/feed").send({ postType: "project_update", projectId: project.id, content: "Shipped fridge scanning." })).body;
    const personalPost = (await beaVisit.post("/api/feed").send({ postType: "project_update", content: "Week one done." })).body;

    // Ana answers both: each is an Explore action, aimed at the project or the builder.
    const rows = (await anaVisit.post(`/api/feed/${projectPost.id}/comments`).send({ content: "How accurate is the scan?", explore: { source: "feed" } })).body;
    const anaComment = rows.find((c: any) => c.authorId === ana.id);
    await anaVisit.post(`/api/feed/${personalPost.id}/comments`).send({ content: "Nice pace." }).expect(200);
    const recorded = (await explore("vis-xc-ana", 3)).filter((r) => r.name === "explore.comment");
    expect(recorded.map((r) => [r.sessionId, r.props])).toEqual(expect.arrayContaining([
      ["ses-xc-ana", expect.objectContaining({ matchType: "project", targetId: project.id, source: "feed" })],
      ["ses-xc-ana", expect.objectContaining({ matchType: "builder", targetId: bea.id })],
    ]));

    // Bea replying on her own update is not exploring.
    await beaVisit.post(`/api/feed/${projectPost.id}/comments`).send({ content: "About 90%.", parentCommentId: anaComment.id }).expect(200);
    await settle();
    expect((await db.select().from(activityEvents).where(and(eq(activityEvents.visitorId, "vis-xc-bea"), eq(activityEvents.name, "explore.comment"))))).toHaveLength(0);

    // Round again: Bea heard about Ana's comment, and Ana hears Bea's reply — which opens the post.
    const beaBell = (await beaVisit.get("/api/notifications")).body.items;
    expect(beaBell.find((x: any) => x.kind === "comment" && x.href === `/posts/${projectPost.id}`)).toMatchObject({ text: "Ana commented on your post" });
    const anaBell = (await anaVisit.get("/api/notifications")).body.items;
    expect(anaBell.find((x: any) => x.kind === "reply")).toMatchObject({ text: "Bea replied to your comment", href: `/posts/${projectPost.id}` });
  });
});
