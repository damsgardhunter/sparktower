/**
 * The Explore loop, from a browser's batch to the owner's dashboard.
 *
 * The first thing worth proving is the boundary: `/api/track` is open to
 * anyone, so an Explore event must arrive with its five properties and nothing
 * more, and a name that isn't one of the nine must be dropped. The second is
 * the arithmetic — three people, four visits, a funnel, a median and a repeat
 * rate, all worked out by hand below — because a success signal that's
 * computed wrong is worse than none.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, like } from "drizzle-orm";
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

describe("the owner's Explore numbers", () => {
  it("count the funnel in sessions, time the first action, and measure who comes back", async () => {
    const app = await getTestApp();

    // Ana: two visits. The first goes all the way round; the second just opens Discover.
    await send(app, "vis-ana", "ses-ana-1", [
      { name: "explore.open_discover", path: "/discover", props: { source: "discover" } },
      { name: "explore.view_match_card", path: "/discover", props: { source: "discover", matchType: "builder", targetId: "b1", rankPosition: 1 } },
      { name: "explore.open_profile", path: "/discover", props: { source: "discover", matchType: "builder", targetId: "b1", rankPosition: 1 } },
      { name: "explore.connect_request", path: "/profile/b1", props: { source: "profile_page", matchType: "builder", targetId: "b1", timeToActionMs: 4000 } },
      { name: "explore.message_sent", path: "/messages/b1", props: { source: "messages", matchType: "builder", targetId: "b1", timeToActionMs: 9000 } },
      { name: "explore.return_to_discover", path: "/discover", props: { source: "discover" } },
    ]);
    await send(app, "vis-ana", "ses-ana-2", [{ name: "explore.open_discover", path: "/discover", props: { source: "discover" } }]);
    // Ben: one visit, sees a project and follows it.
    await send(app, "vis-ben", "ses-ben-1", [
      { name: "explore.open_discover", path: "/projects", props: { source: "projects" } },
      { name: "explore.view_match_card", path: "/projects", props: { source: "projects", matchType: "project", targetId: "p1", rankPosition: 2 } },
      { name: "explore.follow", path: "/projects/p1", props: { source: "project_page", matchType: "project", targetId: "p1", timeToActionMs: 10000 } },
    ]);
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

    // Every event is listed, even at zero, so the dashboard never has a hole.
    expect(explore.events).toHaveLength(9);
    expect(explore.events.find((e: any) => e.name === "explore.session_end").events).toBe(0);
  });
});
