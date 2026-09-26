/**
 * A decision you filed is still the decision you filed.
 *
 * Reported from use: "it keeps changing my decisions and not properly saving,
 * and I have to set them again each year." Persistence within a year is
 * covered (sim-desk.test.ts reloads a solo desk and gets its five chairs'
 * worth back). What was not covered is the boundary that report is about: the
 * year turning.
 *
 * That boundary is where a draft is most likely to go wrong, because it is the
 * one place the app is *supposed* to change what you filed. `defaultDraft`
 * carries last year forward and then deliberately clears the levers that are
 * one-shot — a borrow, a buyback, a bonus, an overrule, a firing, a feature
 * bet, a month of rented room. Each of those is a decision about one year, and
 * repeating it by default would quietly take a second two-million loan on
 * somebody's behalf.
 *
 * So the useful test is not "nothing changes". It is that the standing
 * decisions — price, the spends, capacity, the pace, what the company is for —
 * survive the turn, and the one-shots are the only things that do not. A solo
 * founder is the shape that matters here: they hold all five chairs, and their
 * draft is the one the server has to flatten into five rows and reassemble.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { simSeasons, simVentures } from "@shared/schema";
import { startReadySeasons, tickSeason } from "../../server/simulation-tick";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const ROLES = ["ceo", "cmo", "cfo", "cto", "coo"] as const;
const NICHE = "dating_apps";

async function player(app: any) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.159.${(n % 200) + 20}`;
  const email = `persist-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `P${n}` });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

/** A running company with five seated players, and its own room and season. */
async function runningCompany(app: any) {
  await db.update(simVentures).set({ phase: "retired" })
    .where(inArray(simVentures.phase, ["filling", "claiming", "naming"]));
  const stale = await db.select({ id: simSeasons.id }).from(simSeasons).where(eq(simSeasons.status, "forming"));
  if (stale.length > 0) {
    await db.update(simVentures).set({ phase: "retired" })
      .where(inArray(simVentures.seasonId, stale.map((s) => s.id)));
    await db.update(simSeasons).set({ status: "abandoned" })
      .where(inArray(simSeasons.id, stale.map((s) => s.id)));
  }

  const players = [];
  let ventureId = "";
  for (let i = 0; i < 5; i++) {
    const p = await player(app);
    const join = await p.agent.post("/api/sim/join").send({ nicheId: NICHE });
    ventureId = join.body.ventureId;
    players.push(p);
  }
  for (const [i, p] of players.entries()) {
    await p.agent.post(`/api/sim/ventures/${ventureId}/claim`).send({ role: ROLES[i] });
  }
  await players[0].agent.post(`/api/sim/ventures/${ventureId}/name`).send({ name: "Steadfast", product: "Training" });
  await startReadySeasons();
  const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));
  return { players, ventureId, seasonId: venture.seasonId, seat: (r: typeof ROLES[number]) => players[ROLES.indexOf(r)] };
}

/** Roll the season on by one year, the way the overnight tick does. */
async function turnTheYear(seasonId: string) {
  await db.update(simSeasons)
    .set({ nextTickAt: new Date(Date.now() - 1000), startsAt: new Date(Date.now() - 60_000) })
    .where(eq(simSeasons.id, seasonId));
  expect(await tickSeason(seasonId), "the year should have resolved").toBeGreaterThan(0);
}

describe("a decision, after the year turns", () => {
  it("carries a solo founder's standing decisions into the next year", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    // One chair, which is the shape a project's own season is built with.
    await db.update(simSeasons).set({ seatCount: 1 }).where(eq(simSeasons.id, seasonId));

    const ceo = seat("ceo");
    const filed = await ceo.agent.post(`/api/sim/ventures/${ventureId}/decisions`).send({
      /*
       * Year-one levers only. The desk unlocks over a season
       * (`UNLOCKS` in shared/simulation/responsibilities.ts) — the pace of the
       * company arrives in year three, targets and a bonus pot in year two —
       * and `cleanDecision` drops a field whose lever has not arrived, which is
       * right and not what this test is about. An earlier draft of it filed a
       * pace in year one, got "balanced" back, and read that as the bug it was
       * looking for; a second tried payment terms, which arrive in year five.
       * The desk itself never offers a locked lever — `isUnlocked` filters the
       * field list — so nobody can lose work this way through the app. Only a
       * test writing straight to the API can.
       */
      decision: {
        // The chief executive's: what the company is for.
        focus: "quality",
        // Marketing's.
        price: 23, brandSpend: 60_000, performanceSpend: 30_000,
        // Technology's, operations', finance's.
        featureSpend: 40_000, capacityTarget: 12_000,
      },
    });
    expect(filed.status, JSON.stringify(filed.body).slice(0, 300)).toBe(200);

    await turnTheYear(seasonId);

    const next = await ceo.agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(next.status).toBe(200);
    expect(next.body.year, "a year should have passed").toBe(2);
    expect(next.body.submitted, "a new year starts unfiled — that much is meant to change").toBe(false);

    /*
     * Every one of these is a standing decision. Nobody decides to charge £23
     * once; they decide what the product costs, and it stays that until they
     * change it. Coming back to a blank form every year is the complaint this
     * test exists for.
     */
    const draft = next.body.draft;
    expect(draft.focus, "what the company is for").toBe("quality");
    expect(draft.price, "the price").toBe(23);
    expect(draft.brandSpend, "the brand budget").toBe(60_000);
    expect(draft.performanceSpend, "the performance budget").toBe(30_000);
    expect(draft.featureSpend, "what technology spends").toBe(40_000);
    expect(draft.capacityTarget, "the room operations built").toBe(12_000);
  }, 300_000);

  /*
   * And the other half, which is not a bug however much it looks like one from
   * the outside: the one-shots do clear, and they clear on purpose.
   */
  it("clears only the decisions that were about that one year", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    await db.update(simSeasons).set({ seatCount: 1 }).where(eq(simSeasons.id, seasonId));

    const ceo = seat("ceo");
    const filed = await ceo.agent.post(`/api/sim/ventures/${ventureId}/decisions`).send({
      decision: {
        focus: "growth", price: 23, brandSpend: 60_000,
        // Each of these is a decision about this year and no other.
        borrow: 500_000, celebritySpend: 250_000,
      },
    });
    expect(filed.status, JSON.stringify(filed.body).slice(0, 300)).toBe(200);

    await turnTheYear(seasonId);
    const draft = (await ceo.agent.get(`/api/sim/ventures/${ventureId}/desk`)).body.draft;

    /*
     * Repeating a borrow by default would take a second half-million loan that
     * nobody asked for, which is the reason these reset rather than an
     * oversight — the same reasoning is written at `defaultDraft`.
     */
    expect(draft.borrow, "a loan is taken once, not every year").toBe(0);
    expect(draft.celebritySpend, "a sponsorship does not renew itself").toBe(0);
    // While the standing ones beside them are untouched.
    expect(draft.price).toBe(23);
    expect(draft.brandSpend).toBe(60_000);
  }, 300_000);

  /*
   * Filing twice in one year is editing, not appending. "You can still change
   * it until the year resolves" is what the screen promises after a filing,
   * and a second filing that left the first one's numbers behind would make
   * that promise false in the most confusing way available.
   */
  it("replaces a filing rather than merging into it", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    await db.update(simSeasons).set({ seatCount: 1 }).where(eq(simSeasons.id, seasonId));

    const ceo = seat("ceo");
    await ceo.agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { price: 30, brandSpend: 90_000, focus: "growth" } });
    await ceo.agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { price: 18, brandSpend: 0, focus: "margin" } });

    const draft = (await ceo.agent.get(`/api/sim/ventures/${ventureId}/desk`)).body.draft;
    expect(draft.price, "the second filing is the one that counts").toBe(18);
    expect(draft.brandSpend, "and zero is a decision, not a missing value").toBe(0);
    expect(draft.focus).toBe("margin");
  }, 300_000);
});
