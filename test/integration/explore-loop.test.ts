/**
 * The Explore loop, from a browser's batch to the owner's dashboard.
 *
 * The first thing worth proving is the boundary: `/api/track` is open to
 * anyone, so an Explore event must arrive with its five properties and nothing
 * more, and a name that isn't one of the ten must be dropped. The second is
 * the action step: follow, connect and message are recorded by the endpoints
 * that perform them — web or mobile, in the visit they happened in — and a
 * client can no longer claim one through the tracker. The third is the
 * arithmetic — three people, four visits, a funnel, a median, a repeat rate
 * and full cycles, all worked out by hand below — because a success signal
 * that's computed wrong is worse than none.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq, like } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { activityEvents } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let address = 10;
/** One batch from one browser. The cookies pin the visitor and the visit, as a real browser's would. */
const send = (app: any, visitor: string, session: string, events: unknown[]) =>
  request(app).post("/api/track")
    .set("x-forwarded-for", `203.0.113.${address++}`)
    .set("Cookie", `st_vid=${visitor}; st_sid=${session}`)
    .send({ events });

/** `/api/track` answers before it writes. Wait for the rows rather than for a guess. */
async function rowsFor(visitor: string, expected: number) {
  for (let i = 0; i < 60; i++) {
    const rows = await db.select().from(activityEvents).where(eq(activityEvents.visitorId, visitor));
    const mine = rows.filter((r) => r.name !== "session.start");
    if (mine.length >= expected) return mine;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`expected ${expected} rows for ${visitor}`);
}

describe("the Explore loop's events", () => {
  it("are stored with their five properties and nothing else; unknown names are dropped", async () => {
    const app = await getTestApp();
    const res = await send(app, "vis-boundary", "ses-boundary", [
      { name: "explore.open_discover", path: "/discover", props: { source: "discover", matchType: "alien", email: "x@example.com" } },
      { name: "explore.follows", path: "/discover", props: { source: "discover" } },
      { name: "page.view", path: "/discover", title: "Discover" },
    ]);
    expect(res.status).toBe(202);

    const rows = await rowsFor("vis-boundary", 2);
    const explore = rows.find((r) => r.name === "explore.open_discover")!;
    expect(explore.props).toEqual({ source: "discover" });
    expect(explore.sessionId).toBe("ses-boundary");
    expect(rows.map((r) => r.name).sort()).toEqual(["explore.open_discover", "page.view"]);
    // The misspelt one never reached the table at all.
    expect(await db.select().from(activityEvents).where(like(activityEvents.name, "explore.follows%"))).toHaveLength(0);
  });
});

/** A signed-in person, and their session cookie, so a request can also name its visit. */
async function person(app: any, name: string) {
  const res = await request(app).post("/api/auth/register")
    .set("x-forwarded-for", `203.0.113.${address++}`)
    .send({ email: `el-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`, password: "Testpass123!", firstName: name });
  expect(res.status).toBe(201);
  const auth = ([] as string[]).concat(res.headers["set-cookie"] ?? [])
    .map((c) => c.split(";")[0])
    .filter((c) => !/^st_(vid|sid)=/.test(c))
    .join("; ");
  return { id: res.body.id as string, auth };
}

/** A request as that person, inside a given visit — the cookies a browser would send. */
const as = (app: any, who: { auth: string }, visitor: string, session: string) => {
  const cookie = `${who.auth}; st_vid=${visitor}; st_sid=${session}`;
  return {
    post: (url: string) => request(app).post(url).set("x-forwarded-for", `203.0.113.${address++}`).set("Cookie", cookie),
  };
};

const actionsFor = (visitor: string) =>
  db.select().from(activityEvents).where(and(eq(activityEvents.visitorId, visitor), like(activityEvents.name, "explore.%")));

describe("the loop's actions", () => {
  it("are recorded by the follow, connect and message endpoints, in the visit they happened in", async () => {
    const app = await getTestApp();
    const [ana, bea, cai] = [await person(app, "Ana"), await person(app, "Bea"), await person(app, "Cai")];
    const project = (await as(app, cai, "vis-owner", "ses-owner").post("/api/projects").send({
      title: "Followable", description: "A project for the Explore loop's follow to land on.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body;
    const ana1 = as(app, ana, "vis-act-ana", "ses-act-ana");

    // A new project follow counts, with the context the page sent — held to the boundary.
    expect((await ana1.post(`/api/projects/${project.id}/follow`).send({
      following: true, explore: { source: "discover", rankPosition: 3, timeToActionMs: 2500, email: "x@example.com", targetId: "forged" },
    })).status).toBe(200);
    // Following again, and unfollowing, are not the loop's action.
    await ana1.post(`/api/projects/${project.id}/follow`).send({ following: true });
    await ana1.post(`/api/projects/${project.id}/follow`).send({ following: false });

    // A builder follow, a connection request, and — once connected — a message.
    await ana1.post(`/api/users/${cai.id}/follow`).send({ following: true, explore: { source: "profile_page" } });
    const conn = (await ana1.post("/api/connections/request").send({ userId: bea.id, explore: { source: "discover", rankPosition: 1 } })).body;
    // Refused actions record nothing: a message before they've accepted, a second request.
    expect((await ana1.post(`/api/messages/${bea.id}`).send({ content: "too early" })).status).toBe(403);
    expect((await ana1.post("/api/connections/request").send({ userId: bea.id })).status).toBe(400);
    await as(app, bea, "vis-act-bea", "ses-act-bea").post(`/api/connections/${conn.id}/accept`).send({});
    expect((await ana1.post(`/api/messages/${bea.id}`).send({ content: "hello", explore: { source: "messages" } })).status).toBe(200);

    const rows = await actionsFor("vis-act-ana");
    const summary = rows.map((r) => [r.name, r.props]);
    expect(summary).toHaveLength(4);
    expect(summary).toEqual(expect.arrayContaining([
      ["explore.connect_request", { matchType: "builder", targetId: bea.id, source: "discover", rankPosition: 1 }],
      ["explore.follow", { matchType: "builder", targetId: cai.id, source: "profile_page" }],
      ["explore.follow", { matchType: "project", targetId: project.id, source: "discover", rankPosition: 3, timeToActionMs: 2500 }],
      ["explore.message_sent", { matchType: "builder", targetId: bea.id, source: "messages" }],
    ]));
    expect(new Set(rows.map((r) => r.sessionId))).toEqual(new Set(["ses-act-ana"]));
    expect(rows.every((r) => r.userId === ana.id)).toBe(true);
    // Accepting isn't one of the loop's actions.
    expect(await actionsFor("vis-act-bea")).toHaveLength(0);
  });

  it("can't be claimed through the tracker any more", async () => {
    const app = await getTestApp();
    await send(app, "vis-claim", "ses-claim", [
      { name: "explore.open_discover", path: "/discover", props: { source: "discover" } },
      { name: "explore.follow", path: "/discover", props: { source: "discover", matchType: "project", targetId: "p1" } },
      { name: "explore.connect_request", path: "/discover", props: { source: "discover" } },
      { name: "explore.message_sent", path: "/discover", props: { source: "discover" } },
    ]);
    const rows = await rowsFor("vis-claim", 1);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await actionsFor("vis-claim")).map((r) => r.name)).toEqual(["explore.open_discover"]);
    expect(rows).toHaveLength(1);
  });

  it("from the app, without cookies, land in the visit its headers name", async () => {
    const app = await getTestApp();
    const [dee, eli] = [await person(app, "Dee"), await person(app, "Eli")];
    const headers = { "x-st-visitor": "app-visitor-dee", "x-st-session": "app-session-dee-1" };

    const opened = await request(app).post("/api/track").set("x-forwarded-for", `203.0.113.${address++}`)
      .set(headers).set("x-st-session-start", "1")
      .send({ events: [{ name: "explore.open_discover", path: "/discover", props: { source: "discover" } }] });
    expect(opened.status).toBe(202);
    expect(opened.headers["set-cookie"]?.some((c: string) => c.startsWith("st_sid="))).toBeFalsy();
    await rowsFor("app-visitor-dee", 1);

    const followed = await request(app).post(`/api/users/${eli.id}/follow`).set("x-forwarded-for", `203.0.113.${address++}`)
      .set("Cookie", dee.auth).set(headers).send({ following: true, explore: { source: "discover", rankPosition: 2 } });
    expect(followed.status).toBe(200);

    const rows = await db.select().from(activityEvents).where(eq(activityEvents.visitorId, "app-visitor-dee"));
    // The follow's own write row (api.write) rides along, as every write's does.
    expect(rows.map((r) => r.name).filter((n) => n !== "api.write").sort()).toEqual(["explore.follow", "explore.open_discover", "session.start"]);
    expect(new Set(rows.map((r) => r.sessionId))).toEqual(new Set(["app-session-dee-1"]));
  });
});

describe("the owner's Explore numbers", () => {
  it("count the funnel in sessions, time the first action, and measure who comes back", async () => {
    const app = await getTestApp();
    const [ana, ben, bea, pat] = [await person(app, "Ana"), await person(app, "Ben"), await person(app, "Bea"), await person(app, "Pat")];
    const p1 = (await as(app, pat, "vis-pat", "ses-pat").post("/api/projects").send({
      title: "Numbers Project", description: "The project Ben finds and follows in the numbers test.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body;

    // Ana: two visits. The first goes all the way round; the second just opens Discover.
    await send(app, "vis-ana", "ses-ana-1", [
      { name: "explore.open_discover", path: "/discover", props: { source: "discover" } },
      { name: "explore.view_match_card", path: "/discover", props: { source: "discover", matchType: "builder", targetId: bea.id, rankPosition: 1 } },
      { name: "explore.open_profile", path: "/discover", props: { source: "discover", matchType: "builder", targetId: bea.id, rankPosition: 1 } },
    ]);
    await rowsFor("vis-ana", 3);
    const anaVisit = as(app, ana, "vis-ana", "ses-ana-1");
    const conn = (await anaVisit.post("/api/connections/request").send({ userId: bea.id, explore: { source: "profile_page", timeToActionMs: 4000 } })).body;
    await as(app, bea, "vis-bea", "ses-bea").post(`/api/connections/${conn.id}/accept`).send({});
    expect((await anaVisit.post(`/api/messages/${bea.id}`).send({ content: "Hi Bea", explore: { source: "messages", timeToActionMs: 9000 } })).status).toBe(200);
    await rowsFor("vis-ana", 5);
    await send(app, "vis-ana", "ses-ana-1", [{ name: "explore.return_to_discover", path: "/discover", props: { source: "discover" } }]);
    await rowsFor("vis-ana", 6);
    await send(app, "vis-ana", "ses-ana-2", [{ name: "explore.open_discover", path: "/discover", props: { source: "discover" } }]);
    // Ben: one visit, sees a project and follows it.
    await send(app, "vis-ben", "ses-ben-1", [
      { name: "explore.open_discover", path: "/projects", props: { source: "projects" } },
      { name: "explore.view_match_card", path: "/projects", props: { source: "projects", matchType: "project", targetId: p1.id, rankPosition: 2 } },
    ]);
    await rowsFor("vis-ben", 2);
    await as(app, ben, "vis-ben", "ses-ben-1").post(`/api/projects/${p1.id}/follow`).send({ following: true, explore: { source: "project_page", timeToActionMs: 10000 } });
    // Cai: opens Discover and leaves.
    await send(app, "vis-cai", "ses-cai-1", [{ name: "explore.open_discover", path: "/discover", props: { source: "discover" } }]);

    await rowsFor("vis-ana", 7);
    await rowsFor("vis-ben", 3);
    await rowsFor("vis-cai", 1);

    const owner = request.agent(app);
    await owner.get("/").set("Accept", "text/html");
    await owner.post("/api/auth/register").send({ email: "owner@test.local", password: "Testpass123!", firstName: "O", lastName: "W" });
    const summary = await owner.get("/api/admin/analytics/summary?days=7");
    expect(summary.status).toBe(200);
    const explore = summary.body.explore;

    // Sessions: ana-1, ana-2, ben-1, cai-1 opened; two saw a match; one looked closer; two acted; one came back.
    const funnel = Object.fromEntries(explore.funnel.map((s: any) => [s.key, s.sessions]));
    expect(funnel).toEqual({ opened: 4, viewed: 2, lookedCloser: 1, acted: 2, returned: 1 });
    expect(explore.funnel[3].ofOpened).toBe(0.5);

    // First action per session: Ana's connection (4s — not her later message), Ben's follow (10s).
    // Median of [4000, 10000] is 7000; the 90th percentile is 4000 + 0.9 × 6000 = 9400.
    expect(explore.timeToFirstAction).toEqual({ sessions: 2, p50Ms: 7000, p90Ms: 9400 });

    // Three people opened Discover; only Ana did on two visits.
    expect(explore.repeat.people).toBe(3);
    expect(explore.repeat.repeated).toBe(1);
    expect(explore.repeat.rate).toBeCloseTo(1 / 3);

    // One full pass round the loop — Ana's open, act, return — and Ben acted without coming back.
    expect(explore.cycles.completedOne).toBe(1);

    // Every event is listed, even at zero, so the dashboard never has a hole.
    expect(explore.events).toHaveLength(10);
    expect(explore.events.find((e: any) => e.name === "explore.session_end").events).toBe(0);
    expect(explore.events.find((e: any) => e.name === "explore.comment").events).toBe(0);
    expect(explore.events.find((e: any) => e.name === "explore.message_sent").events).toBe(1);
  });
});
