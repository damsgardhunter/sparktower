/**
 * The print file Printful fetches, and the promise it keeps to the buyer.
 *
 * `GET /api/merch-orders/:orderId/print/:face.png` had no test at all, and the
 * claim in its own comment is the kind that is easy to write and easy to stop
 * being true: it renders from *the artwork snapshot stored on the order*, never
 * from the campaign's current config, because "a creator who swaps their logo
 * after someone ordered must not change what that person already bought."
 *
 * Nothing enforced that. The route and the preview route sit next to each other
 * and differ by exactly this — the preview deliberately reads live config,
 * since that is what a creator is editing — so the two are one careless
 * copy-paste apart. A regression would be silent: the endpoint keeps answering
 * a valid PNG, Printful keeps accepting it, and the garment that arrives is
 * not the one the backer paid for. Nobody finds out until a parcel is opened.
 *
 * The `Cache-Control: immutable` header on this route is only *safe* because
 * of that property, so the two are asserted together: an answer that can
 * change must not be cached for a day, and one cached for a day must not
 * change.
 *
 * It is deliberately unauthenticated — Printful is not going to sign in, and
 * the order id is the credential. Its sibling's privacy hole and the cost of
 * the renderer are covered by `merch-preview-privacy.test.ts`.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { projects, projectBackings, projectBackingCampaigns, projectMerchOrders } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function owner(app: any) {
  n += 1;
  const agent = request.agent(app);
  const email = `print-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.189.${(n % 200) + 20}`)
    .send({ email, password: "a-good-passphrase-here", firstName: `P${n}` });
  expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
  return { agent, id: res.body.id as string };
}

/** A project with an open campaign, a pledge, and a merch order carrying artwork. */
async function anOrder(app: any, snapshotName: string) {
  const creator = await owner(app);
  const made = await creator.agent.post("/api/projects").send({
    title: "Printed", description: "A project used to check what the print file renders from.",
    category: "saas", goal: "ship_mvp", subcategory: "saas",
  });
  expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
  const projectId = made.body.id as string;

  await db.insert(projectBackingCampaigns).values({
    projectId, enabled: true, startedAt: new Date("2026-03-01T00:00:00Z"),
    merchConfig: { displayName: "LIVE CONFIG", showName: true, showDatestamp: true },
  } as any);

  const [backing] = await db.insert(projectBackings).values({
    id: randomUUID(), projectId, backerId: creator.id, amountCents: 4_000, status: "held",
    stripePaymentIntentId: `pi_${randomUUID()}`, createdAt: new Date(),
  } as any).returning();

  const [order] = await db.insert(projectMerchOrders).values({
    id: randomUUID(), backingId: backing.id, projectId, status: "queued",
    items: [{ product: "shirt", artwork: { displayName: snapshotName, showName: true, showDatestamp: true } }],
  } as any).returning();

  return { projectId, orderId: order.id as string };
}

/*
 * The back face by default, and that is not incidental.
 *
 * `front` and `creator` render a fixed tagline (BELIEVER_TAGLINE /
 * CREATOR_TAGLINE) and nothing from the config, so a snapshot test against
 * either passes whatever the route reads — which is exactly what the control
 * test below caught when this file first asked for `front`. The back face is
 * the one that draws `config.displayName || projectName`, so it is the only
 * one where "which config did you use" has an observable answer.
 */
const face = (app: any, orderId: string, f = "back") =>
  request(app).get(`/api/merch-orders/${orderId}/print/${f}.png`).set("x-forwarded-for", `198.51.190.${(n % 200) + 20}`);

describe("the print file", () => {
  it("renders what was bought, not what the creator changed their mind to", async () => {
    const app = await getTestApp();
    const { projectId, orderId } = await anOrder(app, "AS ORDERED");

    const first = await face(app, orderId);
    expect(first.status, (first.text ?? "").slice(0, 200)).toBe(200);
    expect(first.headers["content-type"]).toContain("image/png");
    expect(first.body.length, "a real PNG came back").toBeGreaterThan(1000);

    /*
     * The creator now changes everything the renderer reads — the campaign's
     * config and the project's own name. The order's snapshot is untouched.
     */
    await db.update(projectBackingCampaigns)
      .set({ merchConfig: { displayName: "CHANGED AFTER THE SALE", showName: true, showDatestamp: true } } as any)
      .where(eq(projectBackingCampaigns.projectId, projectId));
    await db.update(projects).set({ title: "Renamed After The Sale" } as any).where(eq(projects.id, projectId));

    const second = await face(app, orderId);
    expect(second.status).toBe(200);
    expect(second.body.equals(first.body), "the print file changed after the sale — it is reading live config, not the order's snapshot").toBe(true);
  }, 180_000);

  /*
   * The test above would also pass if the renderer ignored the snapshot and
   * drew the same thing every time. This is the control: two orders that
   * differ only in their stored artwork must not render identically.
   */
  it("does read the snapshot, rather than drawing the same thing regardless", async () => {
    const app = await getTestApp();
    const a = await anOrder(app, "ORDER A");
    const b = await anOrder(app, "ORDER BBBBB");

    const one = await face(app, a.orderId);
    const two = await face(app, b.orderId);
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    expect(one.body.equals(two.body), "two different snapshots rendered byte-identical — the snapshot isn't being read").toBe(false);
  }, 180_000);

  /*
   * Cached for a day and marked immutable, which is only honest because of
   * the first test. If the answer could change, this header would serve a
   * stale garment for 24 hours.
   */
  it("is cached as immutable, which only holds because it never changes", async () => {
    const app = await getTestApp();
    const { orderId } = await anOrder(app, "CACHED");
    const res = await face(app, orderId);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("immutable");
    expect(res.headers["cache-control"]).toContain("max-age=86400");
  }, 180_000);

  it("refuses a face it does not print, and an order that does not exist", async () => {
    const app = await getTestApp();
    const { orderId } = await anOrder(app, "REFUSALS");

    for (const bad of ["sleeve", "left", "FRONT", "../secret"]) {
      const res = await face(app, orderId, bad);
      expect(res.status, `${bad} should not be a printable face`).toBe(404);
    }
    expect((await face(app, randomUUID())).status, "an unknown order is not found").toBe(404);

    /* The three it does print all answer. */
    for (const good of ["front", "back", "creator"]) {
      expect((await face(app, orderId, good)).status, `${good} is a printable face`).toBe(200);
    }
  }, 180_000);
});
