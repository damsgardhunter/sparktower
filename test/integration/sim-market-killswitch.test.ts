/**
 * Whether the marketplace can be switched off.
 *
 * `kill-switches.test.ts` holds every after-wedge surface to a rule its own
 * comment states: "Every surface that owns an API says which API. A surface
 * whose note names a feature and whose switch reaches nothing is a switch in
 * name only." The simulation surface claims `/api/sim`, and that test asserts
 * it does.
 *
 * `/api/sim` does not reach `/api/sim-market`. The guards are mounted with
 * `app.use(prefix, …)`, and Express matches a mount path on segment boundaries
 * — `/api/sim` covers `/api/sim/niches` and stops there. So the half of the
 * simulation that takes money has no switch at all, which is the opposite of
 * what the admin console says the control does, and the backing surface's own
 * note is the standard being missed: "Real money and an escrow obligation …
 * turn off here if the payment path misbehaves."
 */
import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";

afterEach(async () => {
  const { loadSurfaceFlags } = await import("../../server/surfaces");
  await loadSurfaceFlags();
});

async function setSurface(id: string, enabled: boolean) {
  const { db } = await import("../../server/db");
  const { surfaceFlags } = await import("@shared/schema");
  const { loadSurfaceFlags } = await import("../../server/surfaces");
  await db.insert(surfaceFlags).values({ surfaceId: id, enabled } as any)
    .onConflictDoUpdate({ target: surfaceFlags.surfaceId, set: { enabled } as any });
  await loadSurfaceFlags();
}

describe("turning the marketplace off", () => {
  it("stops every route that sells, lists or pays", async () => {
    const app = await getTestApp();
    await setSurface("simMarket", false);

    /*
     * Unauthenticated is enough: a surface that is off answers 404 for
     * everything under it, before auth is considered. These all need a session,
     * so a 401 would mean the guard never fired and the route is still live —
     * which is what every one of them did before the surface existed.
     */
    for (const path of [
      "/api/sim-market/listings",
      "/api/sim-market/sources",
      "/api/sim-market/me",
      "/api/sim-market/earnings",
      "/api/sim-market/seller-terms",
      "/api/admin/sim-market/revenue",
    ]) {
      const res = await request(app).get(path);
      expect(res.status, `${path} still answers ${res.status} with the marketplace switched off`).toBe(404);
    }
  }, 90_000);

  it("gives it back when the switch goes on", async () => {
    const app = await getTestApp();
    await setSurface("simMarket", true);

    /*
     * 401 rather than 200: there is no session here. What matters is that it is
     * not the 404 of a surface that is off — the route exists again.
     */
    expect((await request(app).get("/api/sim-market/listings")).status).toBe(401);
  }, 90_000);

  it("leaves seasons already running alone, which is why it is its own switch", async () => {
    const app = await getTestApp();
    await setSurface("simMarket", false);
    await setSurface("sprints", true);

    /*
     * The point of separating them. An owner who needs to stop the money path
     * — a refund going wrong, a payout misfiring — should not have to end
     * everybody's game to do it.
     */
    expect((await request(app).get("/api/sim/niches")).status,
      "the simulation itself is still there").not.toBe(404);
  }, 90_000);

  it("is not switched off by turning the simulation off, and does not switch it off either", async () => {
    const app = await getTestApp();

    /* Two switches, two meanings. Neither is a synonym for the other. */
    await setSurface("simMarket", true);
    await setSurface("sprints", false);
    expect((await request(app).get("/api/sim-market/listings")).status,
      "selling survives the simulation being paused").toBe(401);
    expect((await request(app).get("/api/sim/niches")).status,
      "and the simulation really is paused").toBe(404);
  }, 90_000);
});
