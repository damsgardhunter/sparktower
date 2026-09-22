/**
 * A surface that is off answers 404 for everything under its prefixes,
 * including the writes that matter most under an incident: new accounts,
 * uploads, and Nova. Sign-in never goes behind a switch.
 *
 * The after-wedge surfaces are here for a different reason. They are the ones
 * that cost the most to keep — the simulation runs seasons on a clock, backing
 * holds other people's money — and the argument for building them before the
 * wedge is proven is that they can be switched off. That argument is only as
 * good as the switch, so each one is asked, from the outside, whether it
 * actually refuses.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";

afterAll(async () => { await closeTestApp(); });

async function setSurface(id: string, enabled: boolean) {
  const { db } = await import("../../server/db");
  const { surfaceFlags } = await import("@shared/schema");
  const { loadSurfaceFlags } = await import("../../server/surfaces");
  await db.insert(surfaceFlags).values({ surfaceId: id, enabled } as any).onConflictDoUpdate({ target: surfaceFlags.surfaceId, set: { enabled } as any });
  await loadSurfaceFlags();
}
afterEach(async () => {
  const { loadSurfaceFlags } = await import("../../server/surfaces");
  await loadSurfaceFlags();
});

const password = "Testpass123!";
async function signedIn(app: any, tag: string) {
  const agent = request.agent(app);
  const email = `ks-${tag}-${Date.now()}@example.test`;
  await agent.post("/api/auth/register").set("x-forwarded-for", "203.0.113.100").send({ email, password });
  return { agent, email };
}

describe("kill switches", () => {
  it("closes registration on web and mobile while sign-in keeps working", async () => {
    const app = await getTestApp();
    const { email } = await signedIn(app, "before");
    await setSurface("signup", false);
    expect((await request(app).post("/api/auth/register").set("x-forwarded-for", "203.0.113.101").send({ email: `late-${Date.now()}@example.test`, password })).status).toBe(404);
    expect((await request(app).post("/api/auth/mobile/register").set("x-forwarded-for", "203.0.113.102").send({ email: `late2-${Date.now()}@example.test`, password })).status).toBe(404);
    expect((await request(app).post("/api/auth/login").set("x-forwarded-for", "203.0.113.103").send({ email, password })).status).toBe(200);
    await setSurface("signup", true);
    expect((await request(app).post("/api/auth/register").set("x-forwarded-for", "203.0.113.104").send({ email: `open-${Date.now()}@example.test`, password })).status).toBe(201);
  });

  it("closes uploads and Nova for everyone, including sub-routes, and reopens", async () => {
    const app = await getTestApp();
    const { agent } = await signedIn(app, "nova");
    const project = await agent.post("/api/projects").send({ title: "Switch", description: "A project used to check that a surface that is off answers 404.", category: "saas", goal: "ship_mvp", subcategory: "saas" });
    const id = project.body.id;
    await setSurface("uploads", false);
    expect((await agent.post("/api/uploads/request-url").send({ name: "x.png", size: 10, type: "image/png" })).status).toBe(404);
    await setSurface("nova", false);
    expect((await agent.post(`/api/projects/${id}/path/work`).send({ taskId: "x" })).status).toBe(404);
    expect((await agent.post(`/api/projects/${id}/nova/suggest`).send({})).status).toBe(404);
    expect((await agent.post("/api/chat").send({ message: "hi" })).status).toBe(404);
    // Neighbouring routes with a similar prefix are untouched.
    expect((await agent.put(`/api/projects/${id}/nova-notes`).send({ notes: "still here" })).status).toBe(200);
    expect((await agent.get(`/api/projects/${id}/path`)).status).toBe(200);
    await setSurface("nova", true); await setSurface("uploads", true);
    expect((await agent.post(`/api/projects/${id}/path/work`).send({ taskId: "x" })).status).not.toBe(404);
  });
});

/**
 * Everything after the wedge, one representative route each.
 *
 * A route per surface rather than a route per endpoint: the guard is mounted
 * on the prefix, so if the prefix is right the whole surface goes, and if it
 * is missing no endpoint under it goes. The list is the point — every
 * after-wedge surface is asked the same question.
 */
const AFTER_WEDGE: { id: string; label: string; path: string; method?: "get" | "post" }[] = [
  { id: "sprints", label: "the market simulation", path: "/api/sim/niches" },
  { id: "sprints", label: "sprint games", path: "/api/games/active" },
  { id: "backing", label: "backing", path: "/api/me/backings" },
  { id: "backing", label: "payouts", path: "/api/payouts" },
  { id: "matches", label: "matches", path: "/api/matches" },
  { id: "connections", label: "connections", path: "/api/connections" },
  { id: "messages", label: "messages", path: "/api/messages/conversations" },
  { id: "leaderboard", label: "the leaderboard", path: "/api/leaderboard" },
  { id: "contests", label: "contests", path: "/api/contests" },
  { id: "communities", label: "communities", path: "/api/communities" },
  /*
   * Project-scoped, because a storyboard that doesn't exist answers 404 on
   * its own and would prove nothing about the switch. This one answers a
   * list — empty, but an answer — while the surface is on.
   */
  { id: "storyboards", label: "storyboards", path: "/api/projects/:project/storyboards" },
];

describe("the surfaces built before the wedge was proven", () => {
  for (const { id, label, path, method = "get" } of AFTER_WEDGE) {
    it(`switches ${label} off, and back on`, async () => {
      const app = await getTestApp();
      const { agent } = await signedIn(app, `aw-${id}-${path.replace(/\W/g, "")}`.slice(0, 40));

      /* Some probes need something of this account's to ask about. */
      let url = path;
      if (path.includes(":project")) {
        const project = await agent.post("/api/projects").send({
          title: "Switched", description: "A project used to check that a surface that is off answers 404.",
          category: "saas", goal: "ship_mvp", subcategory: "saas",
        });
        url = path.replace(":project", project.body.id);
      }

      const before = await (method === "get" ? agent.get(url) : agent.post(url).send({}));
      expect(before.status, `${path} exists while ${id} is on`).not.toBe(404);

      await setSurface(id, false);
      const off = await (method === "get" ? agent.get(url) : agent.post(url).send({}));
      expect(off.status, `${path} is gone while ${id} is off`).toBe(404);

      await setSurface(id, true);
      const on = await (method === "get" ? agent.get(url) : agent.post(url).send({}));
      expect(on.status, `${path} comes back`).not.toBe(404);
    }, 60_000);
  }

  /*
   * The simulation is the one with a clock. Switching it off used to stop the
   * screens and leave the seasons resolving every minute, the bots filing and
   * the auctions settling — the heaviest thing in the product, running for
   * nobody, invisibly, for as long as it was "off".
   */
  it("stops the simulation's clock, not just its screens", async () => {
    await getTestApp();
    const { runSimulationPass } = await import("../../server/simulation-tick");

    await setSurface("sprints", false);
    expect(await runSimulationPass(), "a pass does nothing at all while the surface is off").toBeNull();

    await setSurface("sprints", true);
    const ran = await runSimulationPass();
    expect(ran, "and runs again when it comes back").not.toBeNull();
  }, 60_000);

  /*
   * Every surface that owns an API says which API. A surface whose note
   * promises to cover something it has no prefix for is how the simulation
   * ended up unswitchable: "Sprints & simulations" listed /api/games and
   * nothing else, while the simulation lived under /api/sim.
   */
  it("claims an API prefix for every after-wedge surface that has one", async () => {
    const { SURFACES, SURFACE_API_PREFIXES } = await import("@shared/surfaces");
    for (const s of SURFACES.filter((x) => x.sequence === "after-wedge")) {
      const prefixes = SURFACE_API_PREFIXES[s.id] ?? [];
      expect(prefixes.length, `${s.id} ("${s.label}") owns no API prefix, so its switch reaches nothing`).toBeGreaterThan(0);
    }
    expect(SURFACE_API_PREFIXES.sprints, "the simulation is under /api/sim").toContain("/api/sim");
  });
});
