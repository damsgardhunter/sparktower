/**
 * The dollar logo, end to end: the money, the two pictures, and the way back.
 *
 * This is the first test in the suite that actually draws something. Every
 * image route until now was checked up to the point where it would have called
 * the model and no further, because the stub client threw by name on
 * `openai.images` — so the expensive half of the product was the untested half.
 * It runs with `AI_STUB=1`, which now answers image calls with a real grey PNG,
 * and the switch is put back afterwards: the suite shares one process, and a
 * file that leaves the fake model on changes every file after it.
 *
 * What is worth checking here is not the drawing — a stub cannot tell you
 * whether a logo is any good — but everything the drawing is wrapped in:
 *
 *   - a dollar leaves the balance, once, and lands in the ledger;
 *   - nothing leaves it on a project the whole-business build already bought;
 *   - the logo and the cover both end up on the project;
 *   - the images that were there are handed back, so replacing is undoable;
 *   - and the refusals — a look that isn't one of the four, an empty brief, and
 *     somebody who doesn't own the project — all happen before the money.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { users, projects, novaBuildPasses, novaLedger } from "@shared/schema";
import { OUTCOME_PRICE_CENTS } from "@shared/plans";

const AI_STUB_BEFORE = process.env.AI_STUB;
beforeAll(() => { process.env.AI_STUB = "1"; });
afterAll(async () => {
  if (AI_STUB_BEFORE === undefined) delete process.env.AI_STUB;
  else process.env.AI_STUB = AI_STUB_BEFORE;
  await closeTestApp();
});

let address = 120;
async function signUp(app: any, name: string) {
  const agent = request.agent(app);
  const email = `bk-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `203.0.113.${address++}`)
    .send({ email, password: "Testpass123!", firstName: name });
  expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
  return { agent, id: res.body.id as string };
}

const BRIEF = {
  description: "A booking page a tea room can set up in ten minutes.",
  oneLiner: "We help small tea rooms take bookings without a website.",
};

async function projectWithBrief(agent: any, title = "Kettle & Fern") {
  const made = await agent.post("/api/projects").send({
    title, category: "saas", goal: "ship_mvp", subcategory: "saas", ...BRIEF,
  });
  expect([200, 201], JSON.stringify(made.body)).toContain(made.status);
  return made.body.id as string;
}

const fund = (userId: string, cents: number) =>
  db.update(users).set({ balanceCents: cents }).where(eq(users.id, userId));

const balanceOf = async (userId: string) => {
  const [row] = await db.select({ cents: users.balanceCents }).from(users).where(eq(users.id, userId));
  return row?.cents ?? 0;
};

describe("Nova drawing a placeholder logo and cover", () => {
  it("draws both, charges a dollar once, and hands back what it replaced", async () => {
    const app = await getTestApp();
    const owner = await signUp(app, "Owner");
    const projectId = await projectWithBrief(owner.agent);
    await fund(owner.id, 500);

    /* Something of their own to replace, so `replaced` has something to carry. */
    const mine = "/objects/uploads/0b1d2c3e-my-own-logo";
    await owner.agent.patch(`/api/projects/${projectId}`).send({ logoUrl: mine });

    const drawn = await owner.agent.post(`/api/projects/${projectId}/brand-kit`).send({ style: "simple" });
    expect(drawn.status, JSON.stringify(drawn.body)).toBe(200);
    expect(drawn.body.style).toBe("simple");
    expect(drawn.body.logoUrl, "a logo was stored").toMatch(/^\/objects\/uploads\//);
    expect(drawn.body.coverUrl, "and a cover drawn from it").toMatch(/^\/objects\/uploads\//);
    expect(drawn.body.logoUrl).not.toBe(drawn.body.coverUrl);
    expect(drawn.body.coverFailed).toBe(false);
    expect(drawn.body.paidCents).toBe(OUTCOME_PRICE_CENTS.brand);
    expect(drawn.body.covered).toBe(false);
    expect(drawn.body.replaced, "so the owner can put their own back").toEqual({ logoUrl: mine, coverUrl: null });

    /* On the project itself, not only in the reply. */
    const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(row.logoUrl).toBe(drawn.body.logoUrl);
    expect(row.coverUrl).toBe(drawn.body.coverUrl);

    /* A dollar, once — not once per picture. */
    expect(await balanceOf(owner.id)).toBe(500 - OUTCOME_PRICE_CENTS.brand);
    const ledger = await db.select().from(novaLedger).where(eq(novaLedger.userId, owner.id));
    const spent = ledger.filter((l) => l.outcome === "brand");
    expect(spent.length, "one line on the statement").toBe(1);
    expect(Math.abs(spent[0].amountCents)).toBe(OUTCOME_PRICE_CENTS.brand);

    /* And putting the old one back is an ordinary patch — nothing was deleted. */
    const back = await owner.agent.patch(`/api/projects/${projectId}`).send(drawn.body.replaced);
    expect(back.status).toBe(200);
    const [after] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(after.logoUrl).toBe(mine);
  }, 60_000);

  /*
   * The four looks, each reaching the model as its own drawing. The stub draws
   * the same grey square whatever it is asked for, so what this can show is
   * that all four are accepted and priced the same — the prompts themselves are
   * read in test/unit/brand-kit.test.ts, where the difference is visible.
   */
  it("takes all four looks, and refuses anything else before charging", async () => {
    const app = await getTestApp();
    const owner = await signUp(app, "Styles");
    const projectId = await projectWithBrief(owner.agent);
    await fund(owner.id, 1000);

    for (const style of ["name", "artistic", "simple", "symmetric"]) {
      const res = await owner.agent.post(`/api/projects/${projectId}/brand-kit`).send({ style });
      expect(res.status, `${style}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.style).toBe(style);
    }
    expect(await balanceOf(owner.id)).toBe(1000 - 4 * OUTCOME_PRICE_CENTS.brand);

    const before = await balanceOf(owner.id);
    for (const style of ["trio", "", "NAME", undefined]) {
      const bad = await owner.agent.post(`/api/projects/${projectId}/brand-kit`).send({ style });
      expect(bad.status, `${String(style)} is not a look`).toBe(400);
      expect(bad.body.field).toBe("style");
    }
    expect(await balanceOf(owner.id), "a refusal costs nothing").toBe(before);
  }, 120_000);

  /*
   * "Included in the build" has to mean included. Someone who paid $14.99 for
   * the whole business being asked for another dollar reads as being charged
   * twice, and they would be right.
   */
  it("costs nothing on a project the whole-business build has bought", async () => {
    const app = await getTestApp();
    const owner = await signUp(app, "Builder");
    const projectId = await projectWithBrief(owner.agent);
    await fund(owner.id, 400);
    await db.insert(novaBuildPasses).values({ userId: owner.id, projectId, paidCents: 1499 });

    const drawn = await owner.agent.post(`/api/projects/${projectId}/brand-kit`).send({ style: "symmetric" });
    expect(drawn.status, JSON.stringify(drawn.body)).toBe(200);
    expect(drawn.body.covered).toBe(true);
    expect(drawn.body.paidCents).toBe(0);
    expect(drawn.body.logoUrl).toMatch(/^\/objects\/uploads\//);
    expect(await balanceOf(owner.id), "nothing left the balance").toBe(400);

    /* And the wallet says so, which is where the button reads the price from. */
    const wallet = await owner.agent.get("/api/nova/wallet");
    expect(wallet.body.buildPasses).toContain(projectId);
  }, 60_000);

  it("won't draw from an empty brief, and says so before taking anything", async () => {
    const app = await getTestApp();
    const owner = await signUp(app, "Blank");
    /*
     * `description` is not-null on the row, so the blank brief this guards
     * against is an empty one rather than a missing one — a project made in one
     * press from a title, with the questions still to answer.
     */
    const made = await owner.agent.post("/api/projects").send({
      title: "Nothing Written Yet", description: "", category: "saas", goal: "ship_mvp", subcategory: "saas",
    });
    expect([200, 201], JSON.stringify(made.body)).toContain(made.status);
    await fund(owner.id, 500);

    const refused = await owner.agent.post(`/api/projects/${made.body.id}/brand-kit`).send({ style: "artistic" });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("brief_empty");
    expect(await balanceOf(owner.id), "told before charged, not after").toBe(500);
  }, 60_000);

  it("is the owner's to spend, not a stranger's", async () => {
    const app = await getTestApp();
    const owner = await signUp(app, "Mine");
    const stranger = await signUp(app, "Theirs");
    const projectId = await projectWithBrief(owner.agent);
    await fund(stranger.id, 500);

    const tried = await stranger.agent.post(`/api/projects/${projectId}/brand-kit`).send({ style: "simple" });
    expect(tried.status).toBe(403);
    expect(await balanceOf(stranger.id)).toBe(500);
    expect((await db.select().from(projects).where(eq(projects.id, projectId)))[0].logoUrl).toBeFalsy();
  }, 60_000);

  it("asks for a dollar when the balance is empty, in the shape the payment dialog reads", async () => {
    const app = await getTestApp();
    const owner = await signUp(app, "Broke");
    const projectId = await projectWithBrief(owner.agent);
    await fund(owner.id, 0);

    const refused = await owner.agent.post(`/api/projects/${projectId}/brand-kit`).send({ style: "name" });
    expect(refused.status).toBe(402);
    expect(refused.body.outcome).toBe("brand");
    expect(refused.body.price.cents).toBe(OUTCOME_PRICE_CENTS.brand);
    expect(refused.body.remedy).toBe("top_up");
  }, 60_000);
});
