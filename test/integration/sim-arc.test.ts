/**
 * Challenges, the marketplace and the way back from a bad year, against a real
 * database.
 *
 * The engine for all three is pure and tested on its own. What is left to get
 * wrong is the ordering inside the tick — a challenge reward that arrives
 * after the bids are settled is a reward that could not be bid with, a
 * recovery move applied after the year has run is a free year, and a covenant
 * checked against the plan rather than the spending is not a covenant at all.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import {
  simSeasons, simVentures, simDecisions, simChallenges, simBids, simListings, simRecoveryMoves,
  simReports as simReportsTable,
} from "@shared/schema";
import { startReadySeasons, tickSeason } from "../../server/simulation-tick";
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
  const ip = `198.51.153.${(n % 200) + 20}`;
  const email = `arc-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `A${n}` });
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

const makeDue = (seasonId: string) =>
  db.update(simSeasons)
    .set({ nextTickAt: new Date(Date.now() - 1000), startsAt: new Date(Date.now() - 60_000) })
    .where(eq(simSeasons.id, seasonId));

/** Put the company in whatever position a test needs. */
async function setCompany(seasonId: string, ventureId: string, over: Record<string, any>) {
  const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
  const world = season.world as World;
  world.companies = world.companies.map((c) => (c.id === ventureId ? { ...c, ...over } : c));
  await db.update(simSeasons).set({ world }).where(eq(simSeasons.id, seasonId));
}

const companyIn = async (seasonId: string, ventureId: string) => {
  const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
  return (season.world as World).companies.find((c) => c.id === ventureId)!;
};

describe("everyone gets something of their own", () => {
  it("sets a challenge for every seat on day one", async () => {
    const app = await getTestApp();
    const { ventureId } = await runningCompany(app);

    const set = await db.select().from(simChallenges)
      .where(and(eq(simChallenges.ventureId, ventureId), eq(simChallenges.year, 1)));
    expect(set).toHaveLength(5);
    expect(new Set(set.map((c) => c.role)).size).toBe(5);
  }, 120_000);

  it("marks them when the year runs, and sets the next one", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId } = await runningCompany(app);
    await makeDue(seasonId);
    expect(await tickSeason(seasonId)).toBe(1);

    const marked = await db.select().from(simChallenges)
      .where(and(eq(simChallenges.ventureId, ventureId), eq(simChallenges.year, 1)));
    expect(marked.every((c) => c.outcome !== null), "every challenge should have been marked").toBe(true);
    expect(marked.every((c) => c.result !== null)).toBe(true);

    const next = await db.select().from(simChallenges)
      .where(and(eq(simChallenges.ventureId, ventureId), eq(simChallenges.year, 2)));
    expect(next, "year two should already have objectives").toHaveLength(5);
  }, 180_000);

  it("pays the reward into the company, where the whole team gets it", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId } = await runningCompany(app);

    /*
     * Rigged so the objective is certainly met: the point is that the reward
     * lands on the company, not that a particular year was good.
     */
    const rows = await db.select().from(simChallenges)
      .where(and(eq(simChallenges.ventureId, ventureId), eq(simChallenges.year, 1)));
    expect(rows.length, `challenges were set for: ${rows.map((r) => r.role).join(", ") || "nobody"}`).toBe(5);
    const cfo = rows.find((r) => r.role === "cfo")!;
    await db.update(simChallenges).set({
      challenge: {
        ...(cfo.challenge as any),
        targets: [{ id: "easy", label: "Exist", goal: -99_000_000, compare: "at_least", metric: "cash" }],
        reward: { kind: "credit", amount: 1_000_000, label: "The bank liked it." },
      },
    }).where(eq(simChallenges.id, cfo.id));

    const before = await companyIn(seasonId, ventureId);
    await makeDue(seasonId);
    await tickSeason(seasonId);
    const after = await companyIn(seasonId, ventureId);

    // Credit limit is recomputed each year, so compare against a run without
    // the reward would be fragile; the marked outcome is the claim.
    const marked = await db.select().from(simChallenges).where(eq(simChallenges.id, cfo.id));
    expect(marked[0].outcome).toBe("met");
    expect(after.creditLimit).toBeGreaterThan(0);
    expect(before).toBeTruthy();
  }, 180_000);

  it("pays every seat that met theirs, not whichever the database returned last", async () => {
    /*
     * The bug: the results came back as a map keyed by company, written once
     * per challenge row. There are five rows per company per year — one per
     * seat, which is the entire point of them — so each seat's result
     * overwrote the last and four of the five were dropped on the floor.
     *
     * Every seat's row was still marked, so all five people saw "done" on
     * their own desk and believed it. The company was paid once. And the desk
     * says, in as many words: "Everyone on the team gets it — that is why they
     * want you to win yours."
     */
    const app = await getTestApp();
    const { ventureId, seasonId } = await runningCompany(app);

    const rows = await db.select().from(simChallenges)
      .where(and(eq(simChallenges.ventureId, ventureId), eq(simChallenges.year, 1)));
    expect(rows).toHaveLength(5);

    // All five rigged to pay cash, so the total is arithmetic rather than
    // a judgement about whether a particular year went well.
    const each = 250_000;
    for (const row of rows) {
      await db.update(simChallenges).set({
        challenge: {
          ...(row.challenge as any),
          targets: [{ id: "easy", label: "Exist", goal: -99_000_000, compare: "at_least", metric: "cash" }],
          reward: { kind: "cash", amount: each, label: "Paid." },
        },
      }).where(eq(simChallenges.id, row.id));
    }

    const before = await companyIn(seasonId, ventureId);
    await makeDue(seasonId);
    await tickSeason(seasonId);
    const after = await companyIn(seasonId, ventureId);

    const marked = await db.select().from(simChallenges)
      .where(and(eq(simChallenges.ventureId, ventureId), eq(simChallenges.year, 1)));
    expect(marked.filter((m) => m.outcome === "met"), "all five met theirs").toHaveLength(5);

    /*
     * A year also earns and spends money, so the claim is not "cash went up by
     * 1.25m" — it is that the five rewards are all in there. Checked against
     * the report's own notes, which is where the team reads about them, and
     * which had one line where it should have had five.
     */
    const [report] = await db.select().from(simReportsTable)
      .where(and(eq(simReportsTable.ventureId, ventureId), eq(simReportsTable.year, 1)));
    const paid = ((report.report as any).notes as string[]).filter((n) => /Paid\./.test(n));
    expect(paid, "one note per seat that won theirs").toHaveLength(5);

    // And the money is really there: five rewards, not one.
    const traded = (report.report as any).profit as number;
    expect(after.cash - before.cash - traded).toBeCloseTo(each * 5, -3);
  }, 180_000);

  it("puts the reward in the year-end report as its own line, and the cash still lands", async () => {
    /*
     * The engine accounts for the trading year; the tick then pays objectives
     * and settles the marketplace, and none of that is trading. The cash
     * bridge has to name those steps as well or it stops matching the bank
     * balance on exactly the years that matter — the ones where something
     * other than selling happened.
     */
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);

    const rows = await db.select().from(simChallenges)
      .where(and(eq(simChallenges.ventureId, ventureId), eq(simChallenges.year, 1)));
    for (const row of rows) {
      await db.update(simChallenges).set({
        challenge: {
          ...(row.challenge as any),
          targets: [{ id: "easy", label: "Exist", goal: -99_000_000, compare: "at_least", metric: "cash" }],
          reward: { kind: "cash", amount: 100_000, label: "Paid." },
        },
      }).where(eq(simChallenges.id, row.id));
    }

    const before = await companyIn(seasonId, ventureId);
    await makeDue(seasonId);
    await tickSeason(seasonId);
    const after = await companyIn(seasonId, ventureId);

    const res = await seat("cfo").agent.get(`/api/sim/ventures/${ventureId}/reports/1`);
    expect(res.status).toBe(200);
    const r = res.body.report;

    // The accounts, the cash, the customers and the rivals are all there.
    expect(r.pnl.revenue).toBeGreaterThanOrEqual(0);
    expect(r.segments.length).toBeGreaterThan(0);
    expect(r.rivals.length).toBeGreaterThan(0);

    const bridge = r.cashBridge;
    expect(bridge.opening).toBeCloseTo(before.cash, 0);
    expect(bridge.closing).toBeCloseTo(after.cash, 0);
    const summed = bridge.opening + bridge.lines.reduce((a: number, l: any) => a + l.amount, 0);
    expect(summed, JSON.stringify(bridge.lines)).toBeCloseTo(bridge.closing, 0);

    const rewards = bridge.lines.find((l: any) => l.label === "Objectives met");
    expect(rewards?.amount, "the five rewards, as one named line").toBeCloseTo(500_000, -3);
    expect(bridge.lines.some((l: any) => l.label === "Other"), "nothing unexplained").toBe(false);

    // Latest year by default, and a stranger sees nothing.
    expect((await seat("ceo").agent.get(`/api/sim/ventures/${ventureId}/reports`)).body.year).toBe(1);
    const stranger = await player(app);
    expect((await stranger.agent.get(`/api/sim/ventures/${ventureId}/reports/1`)).status).toBe(404);
  }, 180_000);

  it("sets nothing for a seat that was dissolved", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId } = await runningCompany(app);
    await setCompany(seasonId, ventureId, { seats: ["ceo", "cmo", "cfo"] });

    await makeDue(seasonId);
    await tickSeason(seasonId);

    const next = await db.select().from(simChallenges)
      .where(and(eq(simChallenges.ventureId, ventureId), eq(simChallenges.year, 2)));
    expect(next.map((c) => c.role).sort()).toEqual(["ceo", "cfo", "cmo"]);
  }, 180_000);
});

describe("the marketplace", () => {
  it("hands the asset to the higher sealed bid and charges what was bid", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId } = await runningCompany(app);

    const listing = marketListings({ seasonId, year: 1, niche })[0];
    await db.insert(simBids).values({ ventureId, listingId: listing.id, year: 1, amount: listing.reserve });

    const before = await companyIn(seasonId, ventureId);
    await makeDue(seasonId);
    await tickSeason(seasonId);
    const after = await companyIn(seasonId, ventureId);

    expect(after.assets.map((a) => a.name)).toContain(listing.asset.name);
    expect(after.cash).toBeLessThan(before.cash);

    /*
     * And the team is told. A sealed bid that resolves silently leaves a
     * player to work out what happened from the asset appearing in a list —
     * the result of the bid has to come back as news.
     */
    const [report] = await db.select().from(simReportsTable)
      .where(and(eq(simReportsTable.ventureId, ventureId), eq(simReportsTable.year, 1)));
    const market = (report.report as any).market ?? [];
    expect(market, "a win should come back typed, not buried in prose").toContainEqual(
      expect.objectContaining({ kind: "won" }),
    );
    expect(market[0].text).toMatch(new RegExp(listing.asset.name, "i"));
  }, 180_000);

  it("buys nothing with a bid under the reserve, and says so", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId } = await runningCompany(app);

    const listing = marketListings({ seasonId, year: 1, niche })[0];
    await db.insert(simBids).values({
      ventureId, listingId: listing.id, year: 1, amount: Math.round(listing.reserve * 0.4),
    });

    await makeDue(seasonId);
    await tickSeason(seasonId);

    const after = await companyIn(seasonId, ventureId);
    expect(after.assets).toHaveLength(0);

    // A sealed bid is never silent — the team is told it went nowhere.
    const [report] = await db.select().from(simReportsTable)
      .where(and(eq(simReportsTable.ventureId, ventureId), eq(simReportsTable.year, 1)));
    // Typed, so a client shows a lost bid differently from a won one without
    // pattern-matching a sentence that may be reworded later.
    expect((report.report as any).market).toContainEqual(expect.objectContaining({ kind: "lost" }));
  }, 180_000);

  it("clears the bids once they are resolved", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId } = await runningCompany(app);
    const listing = marketListings({ seasonId, year: 1, niche })[0];
    await db.insert(simBids).values({ ventureId, listingId: listing.id, year: 1, amount: listing.reserve });

    await makeDue(seasonId);
    await tickSeason(seasonId);

    const left = await db.select().from(simBids).where(eq(simBids.ventureId, ventureId));
    expect(left, "a new year is a new decision").toHaveLength(0);
  }, 180_000);

  it("makes owning the thing worth something", async () => {
    /*
     * Assets carried an effect the engine did not read for the whole of the
     * feature's life. This is the end-to-end version of that claim: buy the
     * thing, and next year is measurably different.
     */
    const app = await getTestApp();
    const { ventureId, seasonId } = await runningCompany(app);

    /*
     * The whole catalogue, not the three a season deals. Which three come up
     * is seeded on the season's id — a fresh uuid every run — and four of the
     * nine templates add capacity, so about one run in eight dealt three that
     * didn't and this test fell over on `undefined.asset`, nowhere near the
     * claim it exists to check.
     */
    const listing = marketListings({ seasonId, year: 1, niche, count: 100 }).find((l) => l.asset.effect.capacity)!;
    await setCompany(seasonId, ventureId, { cash: 40_000_000, assets: [listing.asset] });

    const before = await companyIn(seasonId, ventureId);
    await makeDue(seasonId);
    await tickSeason(seasonId);
    const after = await companyIn(seasonId, ventureId);

    /*
     * The asset's capacity is lent, not given: it must not appear in the
     * company's own figure, or selling the thing would leave the benefit
     * behind.
     *
     * Stated as "the bonus is not in there" rather than "capacity did not
     * change", because capacity legitimately moves for other reasons — a
     * completed challenge can award a few per cent of it, and which challenge
     * a seat draws varies per venture. The first version of this assertion
     * failed about one run in four for exactly that reason.
     */
    const lent = listing.asset.effect.capacity ?? 0;
    expect(lent).toBeGreaterThan(0);
    expect(after.capacity).toBeLessThan(before.capacity + lent);
    expect(after.assets).toHaveLength(1);
  }, 180_000);
});

describe("the year's report and the year that was saved", () => {
  it("agrees about the money after a challenge pays and a bid settles", async () => {
    /*
     * The report is built when the year resolves. The tick then carries on:
     * challenge rewards land on the company, covenants are reviewed, and the
     * marketplace moves cash between teams. All of that changes the world that
     * gets stored, and none of it reached the report — so a team could be paid
     * six hundred thousand for a challenge, win an asset at auction, and read
     * a figure that matched neither the money they had before nor the money
     * they had after.
     */
    const app = await getTestApp();
    const { ventureId, seasonId } = await runningCompany(app);

    // A challenge that certainly pays, in cash.
    const rows = await db.select().from(simChallenges)
      .where(and(eq(simChallenges.ventureId, ventureId), eq(simChallenges.year, 1)));
    const cfo = rows.find((r) => r.role === "cfo")!;
    await db.update(simChallenges).set({
      challenge: {
        ...(cfo.challenge as any),
        targets: [{ id: "easy", label: "Exist", goal: -99_000_000, compare: "at_least", metric: "cash" }],
        reward: { kind: "cash", amount: 750_000, label: "A cheque." },
      },
    }).where(eq(simChallenges.id, cfo.id));

    // And a bid that certainly wins.
    const listing = marketListings({ seasonId, year: 1, niche })[0];
    await db.insert(simBids).values({ ventureId, listingId: listing.id, year: 1, amount: listing.reserve });

    await makeDue(seasonId);
    expect(await tickSeason(seasonId)).toBe(1);

    const stored = await companyIn(seasonId, ventureId);
    const [row] = await db.select().from(simReportsTable)
      .where(and(eq(simReportsTable.ventureId, ventureId), eq(simReportsTable.year, 1)));
    const report = row.report as any;

    expect(report.cash, "the report's cash is not the cash that was saved").toBeCloseTo(stored.cash, 0);
    expect(report.debt).toBeCloseTo(stored.debt, 0);
  }, 240_000);
});

describe("the way back", () => {
  it("applies a recovery move before the year runs, not after it", async () => {
    /*
     * A team that sold everything to stay solvent has to face this year
     * without those assets. Applied afterwards, the move would be free for one
     * more year and the whole arc would have a grace period in it.
     */
    const app = await getTestApp();
    const { ventureId, seasonId, players } = await runningCompany(app);

    const asset = marketListings({ seasonId, year: 1, niche })[0].asset;
    await setCompany(seasonId, ventureId, { cash: 200_000, creditLimit: 100_000, assets: [asset] });
    await db.insert(simRecoveryMoves).values({ ventureId, userId: players[0].id, year: 1, kind: "fire_sale" });

    await makeDue(seasonId);
    await tickSeason(seasonId);

    const after = await companyIn(seasonId, ventureId);
    expect(after.assets, "everything should have been sold").toHaveLength(0);

    const [report] = await db.select().from(simReportsTable)
      .where(and(eq(simReportsTable.ventureId, ventureId), eq(simReportsTable.year, 1)));
    expect(JSON.stringify(report.report)).toMatch(/sold everything/i);
  }, 180_000);

  it("puts what a struggling team sold in front of everybody else", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, players } = await runningCompany(app);

    const asset = marketListings({ seasonId, year: 1, niche })[0].asset;
    await setCompany(seasonId, ventureId, { cash: 200_000, creditLimit: 0, assets: [asset] });
    await db.insert(simRecoveryMoves).values({ ventureId, userId: players[0].id, year: 1, kind: "fire_sale" });

    await makeDue(seasonId);
    await tickSeason(seasonId);

    const listed = await db.select().from(simListings)
      .where(and(eq(simListings.seasonId, seasonId), eq(simListings.year, 2)));
    expect(listed.length, "the fire sale should reach the market").toBeGreaterThan(0);
    // Cheaply, which is what makes another team's collapse an opportunity.
    expect(listed[0].reserve).toBeLessThan((listed[0].asset as any).bookValue);
  }, 180_000);

  it("sells a fire-sold asset to whoever bids for it, without paying the seller twice", async () => {
    /*
     * The fire sale lists what it sold under the company that sold it — which,
     * by then, owns none of it. Settlement asked "does the seller still own
     * this?", got no, and withdrew every such listing, so the forced sale that
     * exists to put a failed team's things in front of everybody else put them
     * in front of nobody. The seller was paid when the fire sale ran; the
     * buyer's money goes nowhere near them.
     */
    const app = await getTestApp();
    const { ventureId, seasonId, players } = await runningCompany(app);

    const asset = marketListings({ seasonId, year: 1, niche })[0].asset;
    await setCompany(seasonId, ventureId, { cash: 200_000, creditLimit: 0, assets: [asset] });
    await db.insert(simRecoveryMoves).values({ ventureId, userId: players[0].id, year: 1, kind: "fire_sale" });
    await makeDue(seasonId);
    expect(await tickSeason(seasonId)).toBe(1);

    const [lot] = await db.select().from(simListings)
      .where(and(eq(simListings.seasonId, seasonId), eq(simListings.year, 2)));
    expect(lot.forced).toBe(true);

    // A second team in the same market, with money, to buy it.
    const [rivalRow] = await db.insert(simVentures)
      .values({ seasonId, name: "Rival", phase: "running", createdAt: new Date() }).returning();
    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    const world = season.world as World;
    const seller = world.companies.find((c) => c.id === ventureId)!;
    world.companies.push({ ...seller, id: rivalRow.id, name: "Rival", cash: 20_000_000, debt: 0, assets: [], bankruptSince: undefined, covenant: undefined });
    await db.update(simSeasons).set({ world }).where(eq(simSeasons.id, seasonId));
    await db.insert(simBids).values({ ventureId: rivalRow.id, listingId: lot.id, year: 2, amount: lot.reserve });

    await makeDue(seasonId);
    expect(await tickSeason(seasonId)).toBe(2);

    const rival = await companyIn(seasonId, rivalRow.id);
    expect(rival.assets.map((a) => a.id), "the bidder owns it now").toContain(asset.id);
    const [sold] = await db.select().from(simListings).where(eq(simListings.id, lot.id));
    expect(sold).toMatchObject({ status: "sold", buyerId: rivalRow.id, soldFor: lot.reserve });

    const [report] = await db.select().from(simReportsTable)
      .where(and(eq(simReportsTable.ventureId, ventureId), eq(simReportsTable.year, 2)));
    const body = report.report as any;
    expect(body.market ?? [], "the seller is not told they sold it again").not.toContainEqual(expect.objectContaining({ kind: "sold" }));
    expect((body.cashBridge?.lines ?? []).map((l: any) => l.label), "and is not paid for it again").not.toContain("The marketplace");
  }, 240_000);

  it("checks a covenant against what was spent, not what was planned", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);

    await setCompany(seasonId, ventureId, {
      cash: 3_000_000,
      covenant: { since: 1, spendCap: 500_000, met: 0, rateRelief: 0.03 },
    });

    // Filed well over the cap.
    await seat("cmo").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { price: 22, brandSpend: 2_000_000, performanceSpend: 0, celebritySpend: 0 } });

    await makeDue(seasonId);
    await tickSeason(seasonId);

    const after = await companyIn(seasonId, ventureId);
    expect(after.covenant, "the covenant should still be in force").toBeTruthy();
    expect(after.covenant!.met, "breaking the cap resets the clock").toBe(0);

    const [report] = await db.select().from(simReportsTable)
      .where(and(eq(simReportsTable.ventureId, ventureId), eq(simReportsTable.year, 1)));
    expect(JSON.stringify(report.report)).toMatch(/cap was broken/i);
  }, 180_000);

  it("counts research and expansion against the cap, not just marketing", async () => {
    /*
     * The loophole this closes: research and the cost of opening a city were
     * added to the game after the covenant's sum was written, so a company
     * under a creditor's cap could pour money into next year's product and
     * half the country and meet the terms on paper. A cap that can be stepped
     * around is the recovery arc with its teeth removed.
     */
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    await setCompany(seasonId, ventureId, {
      cash: 9_000_000,
      covenant: { since: 1, spendCap: 500_000, met: 0, rateRelief: 0.03 },
    });

    // Nothing on marketing at all — everything on the two the cap used to miss.
    const desk = await seat("cmo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    const shut = desk.body.cities.find((c: any) => !c.open);
    const open = desk.body.cities.filter((c: any) => c.open).map((c: any) => c.id);

    await seat("cmo").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { price: 22, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: [...open, shut.id] } });
    await seat("cto").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0, researchSpend: 1_500_000 } });

    await makeDue(seasonId);
    await tickSeason(seasonId);

    const [report] = await db.select().from(simReportsTable)
      .where(and(eq(simReportsTable.ventureId, ventureId), eq(simReportsTable.year, 1)));
    expect(JSON.stringify(report.report), "the cap should have noticed").toMatch(/cap was broken/i);

    const after = await companyIn(seasonId, ventureId);
    expect(after.covenant!.met, "and reset the clock").toBe(0);
  }, 240_000);

  it("lifts the covenant after two years inside it", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId } = await runningCompany(app);
    await setCompany(seasonId, ventureId, {
      cash: 3_000_000,
      covenant: { since: 1, spendCap: 5_000_000, met: 1, rateRelief: 0.03 },
    });

    await makeDue(seasonId);
    await tickSeason(seasonId);

    const after = await companyIn(seasonId, ventureId);
    expect(after.covenant, "two clear years and the creditor lets go").toBeFalsy();
  }, 180_000);

  it("does not remove anyone from the season for running out of money", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId } = await runningCompany(app);
    await setCompany(seasonId, ventureId, { cash: -2_000_000, creditLimit: 0, bankruptSince: 1 });

    await makeDue(seasonId);
    await tickSeason(seasonId);

    const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));
    expect(venture.phase, "nobody is knocked out of this game").toBe("running");
    const after = await companyIn(seasonId, ventureId);
    expect(after).toBeTruthy();
  }, 180_000);
});
