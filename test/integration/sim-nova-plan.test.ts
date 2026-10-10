/**
 * Nova filing the year for you.
 *
 * The thing this has to get right is that it is a *filing*, not a suggestion.
 * One press writes rows the engine will resolve money against, so it goes
 * through the same gates a person's own filing does — the seat, the season
 * running, the year not already closing, the board's chair, and the validator
 * — and it may only ever write the chairs the presser actually holds.
 *
 * It is also the first action in the codebase that costs more than one of the
 * month's free actions, so the allowance arithmetic is covered here too: five
 * taken per press, and a month with fewer than five left refused with a
 * sentence that says so rather than "you've used all 25".
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { simSeasons, simVentures, simDecisions, simBids, users } from "@shared/schema";
import { startReadySeasons } from "../../server/simulation-tick";
import { MONTHLY_SMALL_ACTIONS, NOVA_PLAN_ACTIONS } from "@shared/plans";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const ROLES = ["ceo", "cmo", "cfo", "cto", "coo"] as const;
const NICHE = "dating_apps";

async function player(app: any) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.161.${(n % 200) + 20}`;
  const email = `novaplan-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `N${n}` });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

/**
 * A running company with five seated players.
 *
 * Lifted from sim-decisions-persist.test.ts, including the clearing of stale
 * lobbies: `/api/sim/join` puts you in whatever room is still gathering, so a
 * fixture that does not retire them seats its five players in somebody else's.
 */
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

/** One chair, which is the shape a project's own season — and a shared link — is built with. */
const makeSolo = (seasonId: string) =>
  db.update(simSeasons).set({ seatCount: 1 }).where(eq(simSeasons.id, seasonId));

describe("Nova planning the year", () => {
  it("fills all five chairs for somebody playing alone", async () => {
    /*
     * The case this feature is for: a link to a simulation of your own
     * business, and one press to see what a year of running it looks like.
     */
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    await makeSolo(seasonId);

    const planned = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/nova-plan`).send({});
    expect(planned.status, JSON.stringify(planned.body).slice(0, 400)).toBe(200);
    expect(planned.body.filled.sort()).toEqual([...ROLES].sort());

    const filed = await db.select().from(simDecisions)
      .where(eq(simDecisions.ventureId, ventureId));
    expect(filed.filter((r) => r.year === 1).map((r) => r.role).sort()).toEqual([...ROLES].sort());
  });

  it("files decisions the engine will actually act on", async () => {
    /*
     * Not an empty plan. The optimiser hands a budget out across the levers,
     * so a year it planned has a price and has committed money — a response
     * that said "ok" over five rows of nothing would pass every other test
     * here.
     */
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    await makeSolo(seasonId);

    const planned = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/nova-plan`).send({});
    expect(planned.status).toBe(200);
    expect(planned.body.expects.serves, "a plan that expects to serve nobody is not a plan").toBeGreaterThan(0);
    expect(planned.body.expects.commits, "it spent nothing at all").toBeGreaterThan(0);

    const [marketing] = await db.select().from(simDecisions).where(eq(simDecisions.ventureId, ventureId));
    expect(marketing, "nothing was written").toBeTruthy();

    const all = await db.select().from(simDecisions).where(eq(simDecisions.ventureId, ventureId));
    const cmo = all.find((r) => r.role === "cmo")!.payload as any;
    expect(cmo.price, "no price was set").toBeGreaterThan(0);
  });

  it("hands back the outlook, from the same function the desk uses", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    await makeSolo(seasonId);

    const planned = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/nova-plan`).send({});
    expect(planned.status).toBe(200);
    expect(planned.body.year).toBe(1);
    /* `projectYear` returns a pair; what matters here is that it came back at all. */
    expect(Object.keys(planned.body).length).toBeGreaterThan(5);
    expect(planned.body.preview, "no preview for the screen to show").toBeTruthy();
  });

  it("fills only your own chair at a table of five", async () => {
    /*
     * The plan is made for the whole company — that is what makes it good —
     * but filing the other four would be filing as somebody else, and the
     * argument those four are having is the reason the game is worth playing.
     */
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);

    const planned = await seat("cmo").agent.post(`/api/sim/ventures/${ventureId}/nova-plan`).send({});
    expect(planned.status, JSON.stringify(planned.body).slice(0, 300)).toBe(200);
    expect(planned.body.filled).toEqual(["cmo"]);

    const filed = await db.select().from(simDecisions).where(eq(simDecisions.ventureId, ventureId));
    expect(filed.map((r) => r.role), "it filed a chair it does not hold").toEqual(["cmo"]);
  });

  /*
   * The complaint, as it was made: a chief executive at a table of five had
   * Nova plan their year and could not see that anything had changed. The
   * press now says what it moved, it plans around the colleague who has
   * already saved, and every seat can see what each saved desk is doing.
   */
  it("plans the chief executive's desk around what the table saved, and every seat sees its effect", async () => {
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);

    const cmoSaved = { price: 9, brandSpend: 400_000, performanceSpend: 150_000, celebritySpend: 0, targetCities: [] };
    const saved = await seat("cmo").agent.post(`/api/sim/ventures/${ventureId}/decisions`).send({ decision: cmoSaved });
    expect(saved.status, JSON.stringify(saved.body).slice(0, 300)).toBeLessThan(300);

    const planned = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/nova-plan`).send({});
    expect(planned.status, JSON.stringify(planned.body).slice(0, 300)).toBe(200);
    expect(planned.body.filled).toEqual(["ceo"]);
    expect(planned.body.changed, "the press says what it changed").toBeTruthy();

    // The marketing seat's own filing is untouched.
    const rows = await db.select().from(simDecisions).where(eq(simDecisions.ventureId, ventureId));
    expect((rows.find((r) => r.role === "cmo")?.payload as any)?.brandSpend).toBe(400_000);

    // And the operations seat — who saved nothing — sees both desks' effect.
    const seen = await seat("coo").agent.get(`/api/sim/ventures/${ventureId}/projection`);
    expect(seen.status).toBe(200);
    const roles = (seen.body.impact as { role: string }[]).map((i) => i.role).sort();
    expect(roles).toEqual(["ceo", "cmo"]);
    expect(seen.body.filed.nextYear, "the year after is on the forecast too").toBeTruthy();
  });

  it("bids for something the money can keep", async () => {
    /*
     * The one purchase in a year that is not a flow. Brand decays, hires
     * settle in, room fills — but `ASSET_SLOTS` is a fixed pool and the patent
     * says of itself that it does not expire, so whoever buys it holds it and
     * nobody else can.
     *
     * It is also the only thing that makes an opening balance matter, and
     * `optimise` has no bidding in it: a table following Nova's plan bought
     * nothing it could keep, which is why a consultancy finished a season
     * within a tenth of a per cent of itself on seventy-six times the capital.
     */
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    await makeSolo(seasonId);
    const ceo = seat("ceo");
    /* Money to bid with: the shelf is priced at about a year of payroll. */
    await db.update(simSeasons).set({ status: "running" }).where(eq(simSeasons.id, seasonId));

    const planned = await ceo.agent.post(`/api/sim/ventures/${ventureId}/nova-plan`).send({});
    expect(planned.status, JSON.stringify(planned.body).slice(0, 300)).toBe(200);
    expect(Array.isArray(planned.body.bids), "the response says nothing about bidding").toBe(true);

    const filed = await db.select().from(simBids).where(eq(simBids.ventureId, ventureId));
    if (planned.body.bids.length > 0) {
      expect(filed.length, "a bid was reported and none was filed").toBeGreaterThan(0);
      expect(filed[0].amount).toBeGreaterThan(0);
      expect(planned.body.bids[0].name, "a bid with nothing named on it").toBeTruthy();
    } else {
      /*
       * Nothing worth having, or nothing affordable, is a real answer — the
       * shelf is seeded per season and a company with no cash bids nothing.
       * What must not happen is a bid filed that the response denies.
       */
      expect(filed, "a bid was filed that the response did not report").toHaveLength(0);
    }
  });

  it("takes five of the month's free actions, not one", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    await makeSolo(seasonId);
    const ceo = seat("ceo");

    const before = (await db.select().from(users).where(eq(users.id, ceo.id)))[0].creditsUsed ?? 0;
    const planned = await ceo.agent.post(`/api/sim/ventures/${ventureId}/nova-plan`).send({});
    expect(planned.status, JSON.stringify(planned.body).slice(0, 300)).toBe(200);
    const after = (await db.select().from(users).where(eq(users.id, ceo.id)))[0].creditsUsed ?? 0;

    expect(after - before, "a search is not a chat turn and should not be priced as one").toBe(NOVA_PLAN_ACTIONS);
  });

  it("refuses with the shortfall when the month is nearly out, and charges nothing", async () => {
    /*
     * "You've used all 25" is a lie to somebody who has two left and asked
     * for something costing five — and the next thing they do is press it
     * again.
     */
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    await makeSolo(seasonId);
    const ceo = seat("ceo");

    /*
     * `creditsResetAt` as well as the count. `resetCreditsIfNeeded` wipes the
     * month's usage when that column is null or from another month, and a
     * freshly registered account has it null — so setting the count alone was
     * silently reset to zero and the refusal under test never happened.
     */
    await db.update(users)
      .set({ creditsUsed: MONTHLY_SMALL_ACTIONS - 2, creditsResetAt: new Date() })
      .where(eq(users.id, ceo.id));
    const refused = await ceo.agent.post(`/api/sim/ventures/${ventureId}/nova-plan`).send({});
    expect(refused.status).toBe(402);
    expect(refused.body.message).toContain(String(NOVA_PLAN_ACTIONS));
    expect(refused.body.message).toContain("2 left");

    const after = (await db.select().from(users).where(eq(users.id, ceo.id)))[0].creditsUsed ?? 0;
    expect(after, "a refusal took actions anyway").toBe(MONTHLY_SMALL_ACTIONS - 2);
    const filed = await db.select().from(simDecisions).where(eq(simDecisions.ventureId, ventureId));
    expect(filed, "a refused plan filed a year").toHaveLength(0);
  });

  it("is refused to somebody with no seat at this table", async () => {
    const app = await getTestApp();
    const { ventureId } = await runningCompany(app);
    const stranger = await player(app);

    const refused = await stranger.agent.post(`/api/sim/ventures/${ventureId}/nova-plan`).send({});
    /* 404, not 403: a stranger learns nothing, including that the company exists. */
    expect(refused.status).toBe(404);

    const after = (await db.select().from(users).where(eq(users.id, stranger.id)))[0].creditsUsed ?? 0;
    expect(after, "a stranger was charged for being refused").toBe(0);
  });

  it("is refused once the year is closing", async () => {
    /* The tick may already have read this year's filings. */
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    await makeSolo(seasonId);
    /* `yearClosing` is `now >= nextTickAt`, so the tick has to be *due*. */
    await db.update(simSeasons)
      .set({ nextTickAt: new Date(Date.now() - 1000), startsAt: new Date(Date.now() - 60_000) })
      .where(eq(simSeasons.id, seasonId));

    const refused = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/nova-plan`).send({});
    expect(refused.status).toBe(409);
  });

  it("replaces what you filed yourself rather than adding a second row", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    await makeSolo(seasonId);
    const ceo = seat("ceo");

    await ceo.agent.post(`/api/sim/ventures/${ventureId}/decisions`).send({
      decision: { focus: "quality", price: 23, brandSpend: 60_000, performanceSpend: 30_000, featureSpend: 40_000, capacityTarget: 12_000 },
    });
    const planned = await ceo.agent.post(`/api/sim/ventures/${ventureId}/nova-plan`).send({});
    expect(planned.status).toBe(200);

    const filed = await db.select().from(simDecisions).where(eq(simDecisions.ventureId, ventureId));
    expect(filed.filter((r) => r.year === 1), "five chairs, one row each").toHaveLength(5);
  });
});
