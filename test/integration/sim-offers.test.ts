/**
 * Buying a company, over HTTP and through a tick.
 *
 * The important claim is the one about what an acquisition leaves behind: the
 * team that sold has to still be playing the next day. Everything else here —
 * consent, affordability, lapsing — exists to protect that.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { simSeasons, simVentures, simOffers, simReports } from "@shared/schema";
import { startReadySeasons, tickSeason } from "../../server/simulation-tick";
import type { World } from "@shared/simulation/types";

afterAll(async () => { await closeTestApp(); });

const NICHE = "fitness_app";
const ROLES = ["ceo", "cmo", "cfo", "cto", "coo"] as const;

let n = 0;
async function player(app: any) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.155.${(n % 200) + 20}`;
  const email = `off-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `O${n}` });
  /*
   * The raw text, not just the parsed body.
   *
   * A long combined run occasionally answers this with a 404 whose body is not
   * JSON — so `res.body` is `{}` and the failure says nothing at all. The app
   * is fully built when it happens (the helper checks), it is not the /api
   * catch-all (that answers in JSON) and auth is behind no kill switch, so
   * what actually came back is the next thing worth knowing.
   */
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

/** Two teams in the same season, both running. */
async function twoTeams(app: any) {
  await db.update(simVentures).set({ phase: "retired" })
    .where(inArray(simVentures.phase, ["filling", "claiming", "naming"]));
  /*
   * And close any season still taking rooms, so this one gets its own.
   *
   * A season holds every room in its market and a tick moves all of them.
   * Sharing one across tests meant a test that resolved a year quietly
   * advanced another test's company — which passed alone and failed in a full
   * run, on whichever test happened to be downstream.
   */
  await db.update(simSeasons).set({ status: "abandoned" })
    .where(eq(simSeasons.status, "forming"));

  const build = async (name: string) => {
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
    await players[0].agent.post(`/api/sim/ventures/${ventureId}/name`).send({ name, product: "Training" });
    return { players, ventureId, ceo: players[0], cfo: players[2] };
  };

  const a = await build("Northbound");
  const b = await build("Kestrel");
  await startReadySeasons();

  const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, a.ventureId));
  return { a, b, seasonId: venture.seasonId };
}

async function shape(seasonId: string, ventureId: string, over: Record<string, any>) {
  const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
  const world = season.world as World;
  world.companies = world.companies.map((c) => (c.id === ventureId ? { ...c, ...over } : c));
  await db.update(simSeasons).set({ world }).where(eq(simSeasons.id, seasonId));
}

const companyIn = async (seasonId: string, ventureId: string) => {
  const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
  return (season.world as World).companies.find((c) => c.id === ventureId)!;
};

const makeDue = (seasonId: string) =>
  db.update(simSeasons)
    .set({ nextTickAt: new Date(Date.now() - 1000), startsAt: new Date(Date.now() - 60_000) })
    .where(eq(simSeasons.id, seasonId));

describe("looking at who could be bought", () => {
  it("values every rival, and your own company, in the open", async () => {
    const app = await getTestApp();
    const { a, b, seasonId } = await twoTeams(app);
    await shape(seasonId, b.ventureId, { customers: { committed: 80_000 }, price: 20 });

    const res = await a.ceo.agent.get(`/api/sim/ventures/${a.ventureId}/offers`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const target = res.body.targets.find((t: any) => t.id === b.ventureId);
    expect(target.fair).toBeGreaterThan(0);
    expect(target.notes.join(" ")).toMatch(/80,000 customers/);

    // Your own worth too — you cannot judge a number on the table without it.
    expect(res.body.you.fair).toBeGreaterThanOrEqual(0);
    expect(res.body.reach).toBeGreaterThan(0);
  }, 180_000);

  it("sends what a buyer needs to know they could serve what they are buying", async () => {
    /*
     * The one mistake this mechanic punishes hardest is buying more customers
     * than you can serve — it turns them away and costs reputation in public.
     * A screen cannot warn about that without capacity on one side and
     * customers on the other.
     */
    const app = await getTestApp();
    const { a, b, seasonId } = await twoTeams(app);
    await shape(seasonId, b.ventureId, { customers: { committed: 120_000 } });

    const res = await a.ceo.agent.get(`/api/sim/ventures/${a.ventureId}/offers`);
    expect(res.body.you.capacity).toBeGreaterThan(0);
    expect(res.body.targets.find((t: any) => t.id === b.ventureId).customers).toBe(120_000);
    expect(res.body.status).toBe("running");
  }, 180_000);

  it("refuses to withdraw an offer that has already been answered", async () => {
    /*
     * Telling somebody their offer was taken back, when it had in fact just
     * been accepted, is the worst possible moment to be casually wrong.
     */
    const app = await getTestApp();
    const { a, b, seasonId } = await twoTeams(app);
    await shape(seasonId, a.ventureId, { cash: 50_000_000 });
    await a.ceo.agent.post(`/api/sim/ventures/${a.ventureId}/offers`).send({ targetId: b.ventureId, amount: 2_000_000 });
    const [offer] = await db.select().from(simOffers).where(eq(simOffers.fromVentureId, a.ventureId));
    await b.ceo.agent.post(`/api/sim/ventures/${b.ventureId}/offers/${offer.id}/respond`).send({ accept: true });

    const late = await a.ceo.agent.delete(`/api/sim/ventures/${a.ventureId}/offers/${offer.id}`);
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("not_pending");

    const [after] = await db.select().from(simOffers).where(eq(simOffers.id, offer.id));
    expect(after.status, "an accepted offer stays accepted").toBe("accepted");
  }, 180_000);

  it("does not offer the incumbents for sale", async () => {
    const app = await getTestApp();
    const { a } = await twoTeams(app);
    const res = await a.ceo.agent.get(`/api/sim/ventures/${a.ventureId}/offers`);
    expect(res.body.targets.every((t: any) => t.id.startsWith("inc_") === false)).toBe(true);
  }, 180_000);
});

describe("making an offer", () => {
  it("is the chief executive's call", async () => {
    const app = await getTestApp();
    const { a, b } = await twoTeams(app);

    const cfo = await a.cfo.agent.post(`/api/sim/ventures/${a.ventureId}/offers`)
      .send({ targetId: b.ventureId, amount: 1_000_000 });
    expect(cfo.status).toBe(403);

    const ceo = await a.ceo.agent.post(`/api/sim/ventures/${a.ventureId}/offers`)
      .send({ targetId: b.ventureId, amount: 1_000_000, message: "You're in our way." });
    expect(ceo.status, JSON.stringify(ceo.body)).toBe(200);
  }, 180_000);

  it("refuses money the buyer does not have", async () => {
    /*
     * A real refusal, unlike a sealed bid. An offer is a promise made to five
     * other people who will spend a day deciding about it.
     */
    const app = await getTestApp();
    const { a, b } = await twoTeams(app);
    const res = await a.ceo.agent.post(`/api/sim/ventures/${a.ventureId}/offers`)
      .send({ targetId: b.ventureId, amount: 900_000_000 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("cannot_afford");
  }, 180_000);

  it("allows one live offer at a time, and lets it be revised", async () => {
    const app = await getTestApp();
    const { a, b } = await twoTeams(app);

    await a.ceo.agent.post(`/api/sim/ventures/${a.ventureId}/offers`).send({ targetId: b.ventureId, amount: 1_000_000 });
    const revised = await a.ceo.agent.post(`/api/sim/ventures/${a.ventureId}/offers`).send({ targetId: b.ventureId, amount: 2_000_000 });
    expect(revised.status).toBe(200);

    const rows = await db.select().from(simOffers).where(eq(simOffers.fromVentureId, a.ventureId));
    expect(rows, "revising replaces rather than stacking").toHaveLength(1);
    expect(rows[0].amount).toBe(2_000_000);
  }, 180_000);

  it("can be taken back off the table", async () => {
    const app = await getTestApp();
    const { a, b } = await twoTeams(app);
    await a.ceo.agent.post(`/api/sim/ventures/${a.ventureId}/offers`).send({ targetId: b.ventureId, amount: 1_000_000 });
    const [offer] = await db.select().from(simOffers).where(eq(simOffers.fromVentureId, a.ventureId));

    await a.ceo.agent.delete(`/api/sim/ventures/${a.ventureId}/offers/${offer.id}`);
    const [after] = await db.select().from(simOffers).where(eq(simOffers.id, offer.id));
    expect(after.status).toBe("withdrawn");
  }, 180_000);
});

describe("answering one", () => {
  it("shows the target what it is worth against what is being offered", async () => {
    const app = await getTestApp();
    const { a, b, seasonId } = await twoTeams(app);
    await shape(seasonId, b.ventureId, { customers: { committed: 100_000 }, price: 20 });
    await shape(seasonId, a.ventureId, { cash: 50_000_000 });

    await a.ceo.agent.post(`/api/sim/ventures/${a.ventureId}/offers`)
      .send({ targetId: b.ventureId, amount: 500_000, message: "Take it or leave it." });

    const res = await b.ceo.agent.get(`/api/sim/ventures/${b.ventureId}/offers`);
    const received = res.body.received[0];
    expect(received.from).toBe("Northbound");
    expect(received.amount).toBe(500_000);
    expect(received.message).toBe("Take it or leave it.");
    // Two and a half million of business for half a million.
    expect(received.verdict).toBe("insulting");
    expect(received.fair).toBeGreaterThan(500_000);
  }, 180_000);

  it("cannot be answered by the buyer, or by anyone but the target's chief executive", async () => {
    /*
     * Consent is the whole basis of this mechanic. An acquisition that could
     * happen without the target agreeing would take a fortnight of five
     * people's decisions away from them without asking.
     */
    const app = await getTestApp();
    const { a, b, seasonId } = await twoTeams(app);
    await shape(seasonId, a.ventureId, { cash: 50_000_000 });
    await a.ceo.agent.post(`/api/sim/ventures/${a.ventureId}/offers`).send({ targetId: b.ventureId, amount: 2_000_000 });
    const [offer] = await db.select().from(simOffers).where(eq(simOffers.fromVentureId, a.ventureId));

    // The buyer cannot accept on the seller's behalf.
    const byBuyer = await a.ceo.agent.post(`/api/sim/ventures/${a.ventureId}/offers/${offer.id}/respond`).send({ accept: true });
    expect(byBuyer.status).toBe(404);

    // Nor can another seat at the target.
    const byCfo = await b.cfo.agent.post(`/api/sim/ventures/${b.ventureId}/offers/${offer.id}/respond`).send({ accept: true });
    expect(byCfo.status).toBe(403);

    const byCeo = await b.ceo.agent.post(`/api/sim/ventures/${b.ventureId}/offers/${offer.id}/respond`).send({ accept: true });
    expect(byCeo.status, JSON.stringify(byCeo.body)).toBe(200);
  }, 180_000);

  it("can be declined, and then it is over", async () => {
    const app = await getTestApp();
    const { a, b, seasonId } = await twoTeams(app);
    await shape(seasonId, a.ventureId, { cash: 50_000_000 });
    await a.ceo.agent.post(`/api/sim/ventures/${a.ventureId}/offers`).send({ targetId: b.ventureId, amount: 2_000_000 });
    const [offer] = await db.select().from(simOffers).where(eq(simOffers.fromVentureId, a.ventureId));

    await b.ceo.agent.post(`/api/sim/ventures/${b.ventureId}/offers/${offer.id}/respond`).send({ accept: false });
    const again = await b.ceo.agent.post(`/api/sim/ventures/${b.ventureId}/offers/${offer.id}/respond`).send({ accept: true });
    expect(again.status).toBe(409);
  }, 180_000);
});

describe("when it goes through", () => {
  it("moves the business and leaves the seller a company, not a crater", async () => {
    const app = await getTestApp();
    const { a, b, seasonId } = await twoTeams(app);
    await shape(seasonId, a.ventureId, { cash: 50_000_000, capacity: 5_000_000 });
    await shape(seasonId, b.ventureId, { customers: { committed: 100_000 }, debt: 2_000_000 });

    await a.ceo.agent.post(`/api/sim/ventures/${a.ventureId}/offers`).send({ targetId: b.ventureId, amount: 4_000_000 });
    const [offer] = await db.select().from(simOffers).where(eq(simOffers.fromVentureId, a.ventureId));
    await b.ceo.agent.post(`/api/sim/ventures/${b.ventureId}/offers/${offer.id}/respond`).send({ accept: true });

    const sellerBefore = await companyIn(seasonId, b.ventureId);
    await makeDue(seasonId);
    expect(await tickSeason(seasonId)).toBe(1);

    const seller = await companyIn(seasonId, b.ventureId);
    // Still a company, still five seats, and holding real money.
    expect(seller.seats).toEqual(sellerBefore.seats);
    expect(seller.debt, "the debts went with the business").toBe(0);
    /*
     * Several million left, not "more than they started with".
     *
     * The proceeds arrive and then the year runs: a company with no customers
     * still pays its people and, with nobody filing decisions, still spends
     * the opening defaults. Ending a shade below where they started while
     * holding millions in cash and no debt is the correct outcome, and the
     * first version of this assertion missed that the money gets spent like
     * any other money.
     */
    expect(seller.cash).toBeGreaterThan(4_000_000);
    expect(sellerBefore.cash).toBeGreaterThan(0);

    // And still in the season, which is the point.
    const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, b.ventureId));
    expect(venture.phase).toBe("running");

    const [report] = await db.select().from(simReports)
      .where(and(eq(simReports.ventureId, b.ventureId), eq(simReports.year, 1)));
    expect(JSON.stringify(report.report)).toMatch(/starting again, from in front/i);
  }, 240_000);

  it("tells the buyer when they have bought more people than they can serve", async () => {
    const app = await getTestApp();
    const { a, b, seasonId } = await twoTeams(app);
    await shape(seasonId, a.ventureId, { cash: 50_000_000, capacity: 1_000 });
    await shape(seasonId, b.ventureId, { customers: { committed: 200_000 } });

    await a.ceo.agent.post(`/api/sim/ventures/${a.ventureId}/offers`).send({ targetId: b.ventureId, amount: 4_000_000 });
    const [offer] = await db.select().from(simOffers).where(eq(simOffers.fromVentureId, a.ventureId));
    await b.ceo.agent.post(`/api/sim/ventures/${b.ventureId}/offers/${offer.id}/respond`).send({ accept: true });

    await makeDue(seasonId);
    await tickSeason(seasonId);

    const [report] = await db.select().from(simReports)
      .where(and(eq(simReports.ventureId, a.ventureId), eq(simReports.year, 1)));
    expect(JSON.stringify(report.report)).toMatch(/more customers than you can serve/i);
  }, 240_000);

  it("lets an unanswered offer lapse rather than hang over the year", async () => {
    const app = await getTestApp();
    const { a, b, seasonId } = await twoTeams(app);
    await shape(seasonId, a.ventureId, { cash: 50_000_000 });
    await a.ceo.agent.post(`/api/sim/ventures/${a.ventureId}/offers`).send({ targetId: b.ventureId, amount: 2_000_000 });

    await makeDue(seasonId);
    await tickSeason(seasonId);

    const [offer] = await db.select().from(simOffers).where(eq(simOffers.fromVentureId, a.ventureId));
    expect(offer.status).toBe("lapsed");

    // And nothing moved.
    const seller = await companyIn(seasonId, b.ventureId);
    expect(seller.cash).toBeLessThan(10_000_000);
  }, 240_000);
});

describe("where everyone stands", () => {
  it("puts the teams and the incumbents in one table", async () => {
    /*
     * A league table that quietly omitted the incumbents would flatter
     * everybody. They hold most of the market; fourth of nine is the honest
     * position.
     */
    const app = await getTestApp();
    const { a, seasonId } = await twoTeams(app);
    await makeDue(seasonId);
    await tickSeason(seasonId);

    const res = await a.ceo.agent.get(`/api/sim/ventures/${a.ventureId}/standings`);
    expect(res.status).toBe(200);
    expect(res.body.rows.some((r: any) => r.kind === "incumbent")).toBe(true);
    expect(res.body.rows.some((r: any) => r.isYou)).toBe(true);

    // Ranked, and ranked consistently.
    const ranks = res.body.rows.map((r: any) => r.rank);
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y));

    // And a season reads as a story rather than a snapshot.
    expect(res.body.history.length).toBeGreaterThanOrEqual(1);
    expect(res.body.history[0]).toHaveProperty("share");
  }, 240_000);

  it("tells a stranger nothing", async () => {
    const app = await getTestApp();
    const { a } = await twoTeams(app);
    const stranger = await player(app);
    expect((await stranger.agent.get(`/api/sim/ventures/${a.ventureId}/standings`)).status).toBe(404);
  }, 180_000);
});
