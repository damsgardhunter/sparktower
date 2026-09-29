/**
 * The Ten Years valuation: free once a day, a dollar after that.
 *
 * It is a model call that took no credits and appeared in no ledger, so every
 * play was a small bill with nothing against it. It stays free — it is how
 * people meet the product — but free once a day, and the rules that make that
 * fair are the ones worth testing: a failed call gives the money back, and a
 * verdict that already exists costs the second reader nothing.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { users, aiSpend } from "@shared/schema";
import { mayValue, takePlay, refundPlay, recordValuation, GAME_VERDICT } from "../../server/game-plays";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function player(app: any) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.160.${(n % 200) + 20}`;
  const email = `plays-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `P${n}` });
  expect(res.status, res.text?.slice(0, 200)).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

const paidPlays = async (id: string) =>
  (await db.select({ p: users.gamePlaysPaid }).from(users).where(eq(users.id, id)))[0].p;

describe("a valuation a day", () => {
  it("is free once, then refused until one is bought", async () => {
    const app = await getTestApp();
    const me = await player(app);

    const first = await mayValue(me.id);
    expect(first.allowed).toBe(true);
    expect(first.free, "the first of the day is free").toBe(true);
    expect(first.pricePerPlay).toBe(1);

    // Taking it and recording it is what spends the day's free one.
    expect((await takePlay(me.id)).paid).toBe(false);
    await recordValuation(me.id, "gpt-4o");

    const second = await mayValue(me.id);
    expect(second.free, "the second is not free").toBe(false);
    expect(second.allowed, "and there is nothing bought to fall back on").toBe(false);
    expect(second.usedToday).toBe(1);

    // A dollar's worth, and it is allowed again — on the bought play, not free.
    await db.update(users).set({ gamePlaysPaid: 2 }).where(eq(users.id, me.id));
    const third = await mayValue(me.id);
    expect(third.allowed).toBe(true);
    expect(third.free).toBe(false);

    const taken = await takePlay(me.id);
    expect(taken).toEqual({ ok: true, paid: true });
    expect(await paidPlays(me.id), "one spent, one left").toBe(1);
  }, 120_000);

  it("gives a bought play back when the model does not answer", async () => {
    const app = await getTestApp();
    const me = await player(app);
    await recordValuation(me.id, "gpt-4o");              // today's free one, gone
    await db.update(users).set({ gamePlaysPaid: 1 }).where(eq(users.id, me.id));

    const taken = await takePlay(me.id);
    expect(taken.paid).toBe(true);
    expect(await paidPlays(me.id)).toBe(0);

    // The call failed, so nothing is recorded and the dollar comes back.
    await refundPlay(me.id);
    expect(await paidPlays(me.id), "nobody pays for a placeholder").toBe(1);
    expect((await mayValue(me.id)).allowed).toBe(true);
  }, 120_000);

  it("never spends the same bought play twice, however many tabs ask at once", async () => {
    const app = await getTestApp();
    const me = await player(app);
    await recordValuation(me.id, "gpt-4o");
    await db.update(users).set({ gamePlaysPaid: 1 }).where(eq(users.id, me.id));

    // Both polls arrive together, as two open tabs on a finished game do.
    const [a, b] = await Promise.all([takePlay(me.id), takePlay(me.id)]);
    expect([a.ok, b.ok].filter(Boolean).length, "exactly one of them gets it").toBe(1);
    expect(await paidPlays(me.id)).toBe(0);
  }, 120_000);

  it("records the call in the same ledger as everything else Nova spends", async () => {
    const app = await getTestApp();
    const me = await player(app);
    await recordValuation(me.id, "gpt-4o");

    const [row] = await db.select().from(aiSpend).where(eq(aiSpend.userId, me.id));
    expect(row.action).toBe(GAME_VERDICT);
    expect(row.credits, "free to the person, and still a real call").toBe(0);
    expect(row.model).toBe("gpt-4o");
  }, 120_000);

  it("tells the screen where it stands, and refuses a silly purchase", async () => {
    const app = await getTestApp();
    const me = await player(app);

    const stand = await me.agent.get("/api/games/plays");
    expect(stand.status).toBe(200);
    expect(stand.body).toMatchObject({ allowed: true, free: true, usedToday: 0, pricePerPlay: 1 });

    const silly = await me.agent.post("/api/games/plays/checkout").send({ plays: 9999 });
    expect(silly.status).toBe(400);
    expect(silly.body.code).toBe("invalid_input");
  }, 120_000);
});
