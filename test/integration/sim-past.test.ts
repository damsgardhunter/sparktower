/**
 * Looking back at a year, with something to look at.
 *
 * The Past tab could say what happened to the company and never what the five
 * of you did to cause it: the decisions lived on the desk for a fortnight and
 * were then unreachable, and the bid rows are deleted the moment they settle.
 * These are the three things a team needs to have kept — what was filed, what
 * was bid and who took it, and where that left everybody.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { simSeasons, simVentures, simDecisions, simReports } from "@shared/schema";
import { startReadySeasons, tickSeason } from "../../server/simulation-tick";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function player(app: any) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.173.${(n % 200) + 20}`;
  const email = `resp-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `D${n}` });
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

const NICHE = "dating_apps";
const ROLES = ["ceo", "cmo", "cfo", "cto", "coo"] as const;

/** A running company with five seated players. */
async function runningCompany(app: any) {
  /*
   * Close any room still standing open from an earlier test first.
   *
   * Joining puts you in whichever room in the market has space, which is the
   * product behaving correctly and a trap for a helper that assumes its five
   * players get a room to themselves: a half-filled room left by the lobby
   * tests swallows the first few, the rest start a second room, and the seats
   * get claimed across two ventures that then never reach `running`. It failed
   * about one combined run in three and passed every time each file was run on
   * its own, which is the most annoying shape a test failure has.
   */
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
    expect(join.body.ventureId, "all five should land in one room").toBe(ventureId || join.body.ventureId);
    ventureId = join.body.ventureId;
    players.push(p);
  }
  for (const [i, p] of players.entries()) {
    await p.agent.post(`/api/sim/ventures/${ventureId}/claim`).send({ role: ROLES[i] });
  }
  await players[0].agent.post(`/api/sim/ventures/${ventureId}/name`).send({ name: "Northbound", product: "Training" });
  await startReadySeasons();

  const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));
  const seat = (role: typeof ROLES[number]) => players[ROLES.indexOf(role)];
  return { players, ventureId, seasonId: venture.seasonId, seat };
}


async function nextYear(seasonId: string) {
  await db.update(simSeasons)
    .set({ nextTickAt: new Date(Date.now() - 1000), startsAt: new Date(Date.now() - 60_000) })
    .where(eq(simSeasons.id, seasonId));
  await tickSeason(seasonId);
}

const idsOf = (res: any) => res.body.fields.map((f: any) => f.id);


describe("what the year leaves behind", () => {
  it("keeps what every seat filed, and hands it back next year", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);

    await seat("cmo").agent.post(`/api/sim/ventures/${ventureId}/decisions`).send({
      decision: { price: 44, brandSpend: 250_000, performanceSpend: 0, celebritySpend: 0, targetCities: [] },
    });
    await nextYear(seasonId);

    const desk = await seat("ceo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(desk.body.year).toBe(2);
    expect(desk.body.lastFiled, "last year's decisions should come back").toBeTruthy();
    expect(desk.body.lastFiled.decisions.cmo.price, "the price the marketing seat actually filed").toBe(44);
    expect(desk.body.lastFiled.decisions.cmo.brandSpend).toBe(250_000);
    // And who filed it, so the card can name them.
    expect(desk.body.lastFiled.filedBy.cmo).toBeTruthy();
  }, 180_000);

  it("places every company in the market, and rates the ones that can be rated", async () => {
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);

    const desk = await seat("coo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    const standing = desk.body.standing as any[];
    expect(standing.length, "everyone in the market, including you").toBeGreaterThan(1);

    const you = standing.find((s) => s.isYou);
    expect(you, "your own company should be on the map").toBeTruthy();
    expect(you.grade, "a player company has a rating").toBeTruthy();
    expect(you.price).toBeGreaterThan(0);
    expect(you.quality).toBeGreaterThan(0);

    // Incumbents are placed too, and are not rated: nobody lends to them here.
    const incumbent = standing.find((s) => s.kind === "incumbent");
    expect(incumbent.grade).toBeNull();
    expect(incumbent.customers).toBeGreaterThan(0);
  }, 180_000);

  it("writes the auction down once it has settled", async () => {
    /*
     * The bid rows are deleted at settlement, so before this the whole record
     * of a lot that took a third of a company's cash was one line of prose.
     */
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);

    const market = await seat("ceo").agent.get(`/api/sim/ventures/${ventureId}/market`);
    const listing = market.body.listings[0];
    expect(listing, "something should be for sale in year one").toBeTruthy();
    await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/bids`)
      .send({ listingId: listing.id, amount: listing.reserve });

    await nextYear(seasonId);

    const [report] = await db.select().from(simReports)
      .where(and(eq(simReports.ventureId, ventureId), eq(simReports.year, 1)));
    const auctions = (report.report as any).auctions as any[];
    expect(auctions, "the year's lots should be on the record").toBeTruthy();
    const mine = auctions.find((a) => a.listingId === listing.id);
    expect(mine.yourBid, "what this company offered").toBe(listing.reserve);
    expect(mine.reserve).toBe(listing.reserve);
    expect(mine.bidders).toBeGreaterThanOrEqual(1);
    // Won or not, the row says who took it and for how much.
    if (mine.winnerId) {
      expect(mine.winner).toBeTruthy();
      expect(mine.price).toBeGreaterThanOrEqual(mine.reserve);
    } else {
      expect(mine.price).toBeNull();
    }

    // And it reaches the desk, which is where the card reads it.
    const desk = await seat("cfo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(desk.body.lastYear.auctions.length).toBe(auctions.length);
  }, 180_000);
});
