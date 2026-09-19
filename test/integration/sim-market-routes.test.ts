/**
 * The marketplace over HTTP, and who is allowed to do what.
 *
 * The claim worth guarding hardest is that a sealed bid is actually sealed.
 * It is the kind of thing that leaks by accident — a debug field, a count of
 * bidders, a "highest so far" — and a leak turns a judgement about what a
 * thing is worth to your team into an auction won by whoever is awake last.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { simSeasons, simVentures, simBids, simListings, simRecoveryMoves } from "@shared/schema";
import { startReadySeasons } from "../../server/simulation-tick";
import { marketListings } from "@shared/simulation/assets";
import { nicheById } from "@shared/simulation/niches";
import type { World } from "@shared/simulation/types";

afterAll(async () => { await closeTestApp(); });

const NICHE = "dating_apps";
const ROLES = ["ceo", "cmo", "cfo", "cto", "coo"] as const;
const niche = nicheById(NICHE)!;

let n = 0;
async function player(app: any) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.154.${(n % 200) + 20}`;
  const email = `mkt-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `M${n}` });
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

async function runningCompany(app: any) {
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
  /*
   * Its rooms are closed first, then the season.
   *
   * `abandoned` is no longer the last word on a season: the starter treats it
   * as a conclusion and overturns it if a company in that season is still
   * running, which is what rescues a room whose season was closed around it.
   * A cleanup that only set the status would therefore undo itself on the next
   * sweep. Retiring the rooms makes the conclusion true.
   */
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
  await players[0].agent.post(`/api/sim/ventures/${ventureId}/name`).send({ name: "Northbound", product: "Training" });
  await startReadySeasons();

  const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));
  return { players, ventureId, seasonId: venture.seasonId, seat: (r: typeof ROLES[number]) => players[ROLES.indexOf(r)] };
}

async function give(seasonId: string, ventureId: string, over: Record<string, any>) {
  const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
  const world = season.world as World;
  world.companies = world.companies.map((c) => (c.id === ventureId ? { ...c, ...over } : c));
  await db.update(simSeasons).set({ world }).where(eq(simSeasons.id, seasonId));
}

describe("what is for sale", () => {
  it("shows the same market to everyone, with what you own beside it", async () => {
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);

    const res = await seat("cfo").agent.get(`/api/sim/ventures/${ventureId}/market`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.listings.length).toBeGreaterThan(0);
    expect(res.body.funds).toBeGreaterThan(0);
    // Enough to decide from: what it does, what it costs, how long it lasts.
    for (const listing of res.body.listings) {
      expect(listing.effect).toBeTruthy();
      expect(listing.reserve).toBeGreaterThan(0);
      expect(listing.blurb.length).toBeGreaterThan(10);
    }
  }, 120_000);

  it("tells a stranger nothing", async () => {
    const app = await getTestApp();
    const { ventureId } = await runningCompany(app);
    const stranger = await player(app);
    expect((await stranger.agent.get(`/api/sim/ventures/${ventureId}/market`)).status).toBe(404);
  }, 120_000);
});

describe("a sealed bid", () => {
  it("shows you your own bid and nothing about anyone else's", async () => {
    /*
     * The whole design rests on this. Leaking the high bid — or even how many
     * teams are interested — turns it into an auction decided by who is awake
     * last, which is exactly what sealing it prevents.
     */
    const app = await getTestApp();
    const first = await runningCompany(app);
    const second = await runningCompany(app);

    const listing = marketListings({ seasonId: first.seasonId, year: 1, niche })[0];
    await db.insert(simBids).values({ ventureId: second.ventureId, listingId: listing.id, year: 1, amount: 9_000_000 });

    const mine = await first.seat("cfo").agent.post(`/api/sim/ventures/${first.ventureId}/bids`)
      .send({ listingId: listing.id, amount: 1_250_000 });
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);

    const market = await first.seat("cfo").agent.get(`/api/sim/ventures/${first.ventureId}/market`);
    const row = market.body.listings.find((l: any) => l.id === listing.id);
    expect(row.yourBid).toBe(1_250_000);

    // No trace of the other team's nine million, in any field, anywhere.
    const body = JSON.stringify(market.body);
    expect(body).not.toContain("9000000");
    expect(body).not.toMatch(/bidder|highest|competing|otherBids/i);
  }, 180_000);

  it("lets a team change its mind up to the tick", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    const listing = marketListings({ seasonId, year: 1, niche })[0];

    await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/bids`).send({ listingId: listing.id, amount: 500_000 });
    await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/bids`).send({ listingId: listing.id, amount: 750_000 });

    const rows = await db.select().from(simBids).where(eq(simBids.ventureId, ventureId));
    expect(rows, "a revised bid replaces, it does not stack").toHaveLength(1);
    expect(rows[0].amount).toBe(750_000);

    await seat("ceo").agent.delete(`/api/sim/ventures/${ventureId}/bids/${listing.id}`);
    expect(await db.select().from(simBids).where(eq(simBids.ventureId, ventureId))).toHaveLength(0);
  }, 120_000);

  it("refuses a bid on something that is not for sale", async () => {
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);
    const res = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/bids`)
      .send({ listingId: "mkt_nonsense", amount: 100_000 });
    expect(res.status).toBe(404);
  }, 120_000);

  it("takes a bid the team cannot currently afford, and lets settlement decide", async () => {
    /*
     * Refusing it here would leak that the money had moved, and the money may
     * well be back by the time the year resolves.
     */
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    const listing = marketListings({ seasonId, year: 1, niche })[0];

    const res = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/bids`)
      .send({ listingId: listing.id, amount: 900_000_000 });
    expect(res.status).toBe(200);
  }, 120_000);
});

describe("selling your own things", () => {
  it("is the chief executive's or the finance seat's call", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    const asset = marketListings({ seasonId, year: 1, niche })[0].asset;
    await give(seasonId, ventureId, { assets: [asset] });

    const cto = await seat("cto").agent.post(`/api/sim/ventures/${ventureId}/listings`)
      .send({ assetId: asset.id, reserve: 500_000 });
    expect(cto.status).toBe(403);

    const cfo = await seat("cfo").agent.post(`/api/sim/ventures/${ventureId}/listings`)
      .send({ assetId: asset.id, reserve: 500_000 });
    expect(cfo.status, JSON.stringify(cfo.body)).toBe(200);

    const rows = await db.select().from(simListings).where(eq(simListings.sellerId, ventureId));
    expect(rows).toHaveLength(1);
    expect(rows[0].reserve).toBe(500_000);
  }, 120_000);

  it("refuses to sell what the company does not own", async () => {
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);
    const res = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/listings`)
      .send({ assetId: "not_mine", reserve: 100 });
    expect(res.status).toBe(404);
  }, 120_000);

  it("does not let a team bid on its own listing", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    const asset = marketListings({ seasonId, year: 1, niche })[0].asset;
    await give(seasonId, ventureId, { assets: [asset] });
    await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/listings`).send({ assetId: asset.id, reserve: 100_000 });

    const [row] = await db.select().from(simListings).where(eq(simListings.sellerId, ventureId));
    const res = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/bids`)
      .send({ listingId: row.id, amount: 200_000 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("own_listing");
  }, 120_000);

  it("keeps your own listing off your own market", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    const asset = marketListings({ seasonId, year: 1, niche })[0].asset;
    await give(seasonId, ventureId, { assets: [asset] });
    await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/listings`).send({ assetId: asset.id, reserve: 100_000 });

    const market = await seat("ceo").agent.get(`/api/sim/ventures/${ventureId}/market`);
    expect(market.body.selling).toHaveLength(1);
    expect(market.body.listings.some((l: any) => l.seller)).toBe(false);
  }, 120_000);
});

describe("the moves in trouble", () => {
  const sinking = { cash: 100_000, creditLimit: 0, debt: 3_000_000 };

  it("is the chief executive's call and nobody else's", async () => {
    /*
     * Dissolving a colleague's seat or selling a third of the company is not
     * something one of five people should be able to do to the other four.
     */
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    await give(seasonId, ventureId, sinking);

    const cfo = await seat("cfo").agent.post(`/api/sim/ventures/${ventureId}/recovery`).send({ kind: "rescue_raise" });
    expect(cfo.status).toBe(403);
    expect(cfo.body.code).toBe("not_ceo");

    const ceo = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/recovery`).send({ kind: "rescue_raise" });
    expect(ceo.status, JSON.stringify(ceo.body)).toBe(200);
  }, 120_000);

  it("refuses a move to a company that is not in trouble", async () => {
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);
    const res = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/recovery`).send({ kind: "rescue_raise" });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/isn't in trouble/i);
  }, 120_000);

  it("insists on knowing which seat, and will not let the chief executive dissolve their own", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    await give(seasonId, ventureId, sinking);

    const vague = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/recovery`).send({ kind: "dissolve_seat" });
    expect(vague.status).toBe(400);

    const selfish = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/recovery`)
      .send({ kind: "dissolve_seat", seat: "ceo" });
    expect(selfish.status).toBe(400);

    const real = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/recovery`)
      .send({ kind: "dissolve_seat", seat: "cto" });
    expect(real.status).toBe(200);
  }, 120_000);

  it("takes one move a year, and lets it be changed", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    await give(seasonId, ventureId, sinking);

    await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/recovery`).send({ kind: "rescue_raise" });
    await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/recovery`).send({ kind: "restructure" });

    const rows = await db.select().from(simRecoveryMoves).where(eq(simRecoveryMoves.ventureId, ventureId));
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("restructure");

    await seat("ceo").agent.delete(`/api/sim/ventures/${ventureId}/recovery`);
    expect(await db.select().from(simRecoveryMoves).where(eq(simRecoveryMoves.ventureId, ventureId))).toHaveLength(0);
  }, 120_000);

  it("shows the whole table where the company stands, and what it would cost to fix", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    await give(seasonId, ventureId, sinking);

    // Not just the chief executive — everyone needs to see the position.
    const desk = await seat("cmo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    // Distressed rather than insolvent: there is still money in the bank, just
    // not enough of it, which is the state the warning exists for.
    expect(desk.body.distress.level).toBe("distressed");
    expect(desk.body.distress.body.length).toBeGreaterThan(30);
    expect(desk.body.distress.options.length).toBeGreaterThan(0);
    for (const option of desk.body.distress.options) {
      expect(option.cost.length, `${option.kind} does not say what it costs`).toBeGreaterThan(30);
    }
  }, 120_000);

  it("gives every seat its own objective on the desk", async () => {
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);

    const desk = await seat("coo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(desk.body.challenge).toBeTruthy();
    expect(desk.body.challenge.role).toBe("coo");
    expect(desk.body.challenge.targets.length).toBeGreaterThanOrEqual(2);
    expect(desk.body.challenge.brief.length).toBeGreaterThan(40);
  }, 120_000);
});
