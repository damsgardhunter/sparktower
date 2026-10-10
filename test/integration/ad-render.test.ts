/**
 * Ordering an advert, and the money.
 *
 * The render itself is exercised by hand against a real project and by the
 * compositor's own suite; what these cover is the part that has to be right
 * every time and is invisible when it isn't — that the quoted price is the
 * price taken, that a refusal takes nothing, and that an advert which does not
 * arrive is refunded in full rather than pro rata.
 *
 * Nothing here reaches the video provider. `vitest.config.ts` pins the Kling
 * variables empty, so `advanceRender` fails at the first submit — which is
 * exactly the failure the refund path exists for, and makes it testable
 * without a provider or a bill.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { adRenders } from "@shared/schema";
import { eq } from "drizzle-orm";
import { startRender, advanceRender, quoteRender } from "../../server/ad-render";
import { walletOf } from "../../server/wallet";
import { OUTCOME_PRICE_CENTS } from "@shared/plans";
import { adPriceCents } from "@shared/ads";

afterAll(async () => { await closeTestApp(); });

let address = 90;
async function signUp(app: any, name: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `203.0.117.${address++}`)
    .send({ email: `ad-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`, password: "Testpass123!", firstName: name });
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBeLessThan(300);
  await verifyEmail(app, res.body.email, `203.0.118.${address++}`);
  const me = await agent.get("/api/auth/user");
  return { agent, id: me.body.id as string };
}

const newProject = async (agent: any, title: string) => (await agent.post("/api/projects").send({
  title, description: "A small-batch coffee roaster that delivers the week it roasts.",
  category: "saas", goal: "ship_mvp", subcategory: "saas",
})).body;

const BRIEF = "We roast coffee in small batches and deliver it the week it is roasted.";

const topUp = (agent: any, amountCents: number) =>
  agent.post("/api/dev/credit-wallet").send({ amountCents });

describe("what an advert costs before you buy one", () => {
  it("quotes every length, with the plan behind the price", async () => {
    const app = await getTestApp();
    const { agent } = await signUp(app, "Quoter");
    const project = await newProject(agent, "Quote Me");

    const res = await agent.get(`/api/projects/${project.id}/ad-renders`);
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);

    for (const q of res.body.quotes) {
      expect(q.priceCents, `${q.durationSeconds}s`).toBe(adPriceCents(q.durationSeconds));
      /* The plan, because a thirty-second advert being better value is only visible from it. */
      expect(q.clips).toBeGreaterThan(0);
      expect(q.generatedSeconds, "clips have a five-second floor").toBeGreaterThanOrEqual(q.durationSeconds);
    }
    /* Styles that need evidence are marked, not hidden: hiding them answers no question. */
    expect(res.body.styles.some((s: any) => s.available)).toBe(true);
    expect(res.body.styles.some((s: any) => !s.available)).toBe(true);
  });
});

describe("paying for one", () => {
  it("takes exactly the listed price, once", async () => {
    const app = await getTestApp();
    const { agent, id } = await signUp(app, "Payer");
    const project = await newProject(agent, "Paid Advert");
    await topUp(agent, 2000);

    const before = (await walletOf(id)).balanceCents;
    const started = await startRender(id, project.id, { duration: 15, format: "vertical", style: "problem_solution", brief: BRIEF });
    expect(started.ok, started.ok ? "" : started.refusal.message).toBe(true);
    if (!started.ok) return;

    expect(started.render.chargedCents).toBe(OUTCOME_PRICE_CENTS.advert15);
    expect((await walletOf(id)).balanceCents).toBe(before - OUTCOME_PRICE_CENTS.advert15);
  });

  it("refuses when the money isn't there, and takes nothing", async () => {
    const app = await getTestApp();
    const { agent, id } = await signUp(app, "Broke");
    const project = await newProject(agent, "No Money");
    await topUp(agent, 100);

    const before = (await walletOf(id)).balanceCents;
    const started = await startRender(id, project.id, { duration: 30, format: "vertical", style: "problem_solution", brief: BRIEF });
    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(started.refusal.field).toBe("balance");
    expect((await walletOf(id)).balanceCents, "a refusal is not a charge").toBe(before);
    expect(await db.select().from(adRenders).where(eq(adRenders.projectId, project.id))).toHaveLength(0);
  });

  it("checks the request before it charges, so nobody pays to learn they picked wrong", async () => {
    const app = await getTestApp();
    const { agent, id } = await signUp(app, "Wrong");
    const project = await newProject(agent, "Bad Request");
    await topUp(agent, 2000);
    const before = (await walletOf(id)).balanceCents;

    for (const [req, field] of [
      [{ duration: 12, format: "vertical", style: "problem_solution", brief: BRIEF }, "duration"],
      [{ duration: 15, format: "panoramic", style: "problem_solution", brief: BRIEF }, "format"],
      [{ duration: 15, format: "vertical", style: "interpretive_dance", brief: BRIEF }, "style"],
      [{ duration: 15, format: "vertical", style: "problem_solution", brief: "coffee" }, "brief"],
      /* Needs a quote this project has never supplied. */
      [{ duration: 15, format: "vertical", style: "social_proof", brief: BRIEF }, "style"],
    ] as const) {
      const out = await startRender(id, project.id, req as any);
      expect(out.ok, `${field} was accepted`).toBe(false);
      if (!out.ok) expect(out.refusal.field).toBe(field);
    }
    expect((await walletOf(id)).balanceCents, "five refusals, nothing taken").toBe(before);
  });
});

describe("an advert that doesn't arrive", () => {
  it("is refunded in full, not pro rata", async () => {
    const app = await getTestApp();
    const { agent, id } = await signUp(app, "Refunded");
    const project = await newProject(agent, "Will Fail");
    await topUp(agent, 2000);

    const before = (await walletOf(id)).balanceCents;
    const started = await startRender(id, project.id, { duration: 15, format: "vertical", style: "problem_solution", brief: BRIEF });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect((await walletOf(id)).balanceCents).toBe(before - OUTCOME_PRICE_CENTS.advert15);

    /* No provider configured, so the first submit fails — which is the point. */
    const failed = await advanceRender(started.render.id);
    expect(failed.status).toBe("failed");
    expect(failed.failure, "and says why, in words somebody could be shown").toBeTruthy();

    expect((await walletOf(id)).balanceCents, "half an advert is worth nothing").toBe(before);
    expect(failed.refundedCents).toBe(OUTCOME_PRICE_CENTS.advert15);
  });

  it("is refunded once, however many times something notices it failed", async () => {
    const app = await getTestApp();
    const { agent, id } = await signUp(app, "Once");
    const project = await newProject(agent, "Double Refund");
    await topUp(agent, 2000);

    const before = (await walletOf(id)).balanceCents;
    const started = await startRender(id, project.id, { duration: 15, format: "vertical", style: "problem_solution", brief: BRIEF });
    if (!started.ok) throw new Error("could not start");

    /*
     * A sweep and a person's refresh can both decide a render has failed. The
     * guard is a conditional update, so the database picks which one pays.
     */
    await Promise.all([
      advanceRender(started.render.id),
      advanceRender(started.render.id),
      advanceRender(started.render.id),
    ]);
    await advanceRender(started.render.id);

    expect((await walletOf(id)).balanceCents, "refunded more than once").toBe(before);
  });

  it("keeps the failed row, because the refund points at it", async () => {
    const app = await getTestApp();
    const { agent, id } = await signUp(app, "Kept");
    const project = await newProject(agent, "Row Kept");
    await topUp(agent, 2000);
    const started = await startRender(id, project.id, { duration: 6, format: "square", style: "problem_solution", brief: BRIEF });
    if (!started.ok) throw new Error("could not start");
    await advanceRender(started.render.id);

    const [row] = await db.select().from(adRenders).where(eq(adRenders.id, started.render.id));
    expect(row.status).toBe("failed");
    expect(row.chargedCents).toBe(OUTCOME_PRICE_CENTS.advert6);
    expect(row.finishedAt).toBeTruthy();
  });
});

describe("whose advert it is", () => {
  it("is invisible to someone not on the team, and says 404 rather than 403", async () => {
    const app = await getTestApp();
    const { agent: owner, id } = await signUp(app, "Owner");
    const { agent: stranger } = await signUp(app, "Stranger");
    const project = await newProject(owner, "Private Ads");
    await topUp(owner, 2000);
    const started = await startRender(id, project.id, { duration: 15, format: "vertical", style: "problem_solution", brief: BRIEF });
    if (!started.ok) throw new Error("could not start");

    expect((await stranger.get(`/api/projects/${project.id}/ad-renders`)).status).toBe(404);
    expect((await stranger.get(`/api/ad-renders/${started.render.id}`)).status).toBe(404);
    expect((await stranger.post(`/api/ad-renders/${started.render.id}/check`)).status).toBe(404);
    expect((await stranger.post(`/api/projects/${project.id}/ad-renders`).send({
      duration: 15, format: "vertical", style: "problem_solution", brief: BRIEF,
    })).status).toBe(404);
  });

  it("needs an account at all", async () => {
    const app = await getTestApp();
    const { agent } = await signUp(app, "Member");
    const project = await newProject(agent, "Anon Ads");
    expect((await request(app).get(`/api/projects/${project.id}/ad-renders`)).status).toBe(401);
    expect((await request(app).post(`/api/projects/${project.id}/ad-renders`).send({ duration: 15 })).status).toBe(401);
  });

  it("will not order one on a server with no video model", async () => {
    /* Kling is pinned empty in the test environment, so this is that server. */
    const app = await getTestApp();
    const { agent } = await signUp(app, "Unconfigured");
    const project = await newProject(agent, "No Provider");
    await topUp(agent, 2000);

    const res = await agent.post(`/api/projects/${project.id}/ad-renders`)
      .send({ duration: 15, format: "vertical", style: "problem_solution", brief: BRIEF });
    expect(res.status, "503, and before any money moves").toBe(503);
    expect(await db.select().from(adRenders).where(eq(adRenders.projectId, project.id))).toHaveLength(0);
  });
});
