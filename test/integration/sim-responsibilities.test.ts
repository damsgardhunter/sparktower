/**
 * The responsibilities that arrive during a season, against the real server:
 * a lever appears on the desk in the year it arrives and not before, cannot
 * be filed early by a client that shows it anyway, and once it is there it
 * files, previews and projects like any other.
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

describe("responsibilities arriving over the season", () => {
  it("shows a lever in the year it arrives, marks it new, and says what comes next", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);

    const y1 = await seat("ceo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(y1.body.year).toBe(1);
    expect(idsOf(y1)).not.toContain("budget");
    expect(y1.body.arrivingNextYear).toContain("Split the budget");
    expect(y1.body.prices.lease / y1.body.prices.build).toBeCloseTo(1.4, 6);

    await nextYear(seasonId);
    const y2 = await seat("ceo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(y2.body.year).toBe(2);
    const budget = y2.body.fields.find((f: any) => f.id === "budget");
    expect(budget, "the split arrives in year two").toBeTruthy();
    expect(budget.unlocksIn).toBe(2);
    expect(budget.options.map((o: any) => o.value).sort()).toEqual(["cmo", "coo", "cto"]);
    const cmo2 = await seat("cmo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(idsOf(cmo2)).toContain("forecast");
    expect(idsOf(cmo2), "tiers are a year off yet").not.toContain("tiers");
  }, 180_000);

  it("drops a lever filed before it has arrived", async () => {
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);
    const res = await seat("cmo").agent.post(`/api/sim/ventures/${ventureId}/decisions`).send({
      decision: { price: 30, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: [], tiers: { swipers: 0 }, forecast: 5_000 },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.draft.tiers).toBeUndefined();
    expect(res.body.draft.forecast).toBeUndefined();
  }, 120_000);

  it("files the new levers once they are there, and the year reads them", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    await nextYear(seasonId);
    await nextYear(seasonId);

    const tiers = await seat("cmo").agent.post(`/api/sim/ventures/${ventureId}/decisions`).send({
      // A plan big enough that a 1% share cuts it however much the season has left the company to spend.
      decision: { price: 40, brandSpend: 1_000_000, performanceSpend: 0, celebritySpend: 0, targetCities: [], forecast: 5_000, tiers: { long_haulers: 120, made_up: 3 } },
    });
    expect(tiers.status, JSON.stringify(tiers.body)).toBe(200);
    expect(tiers.body.draft.tiers, "only segments this market has").toEqual({ long_haulers: 120 });

    const split = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/decisions`).send({
      decision: { focus: "growth", positioning: "", rehire: "", budget: { cmo: 80, cto: 40 } },
    });
    expect(split.status, "a split over 100% is refused").toBe(400);
    expect(split.body.errors.budget).toMatch(/120%/);
    const ok = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/decisions`).send({
      decision: { focus: "growth", positioning: "", rehire: "", budget: { cmo: 1, cto: 50, coo: 49 } },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.preview.warnings.join(" "), "the cut is said before the year, not after").toMatch(/split gives marketing 1%/i);

    const projection = await seat("cmo").agent.get(`/api/sim/ventures/${ventureId}/projection`);
    expect(projection.status, JSON.stringify(projection.body)).toBe(200);

    await nextYear(seasonId);
    const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));
    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    const company = (season.world as any).companies.find((c: any) => c.id === ventureId);
    expect(company.tiers, "the tier the marketing seat set is the company's now").toEqual({ long_haulers: 120 });
    expect(venture.phase).toBe("running");
  }, 240_000);

  it("offers the season's feature menu to the technology seat, and a copied feature goes live that year", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    for (let i = 0; i < 3; i++) await nextYear(seasonId);

    const desk = await seat("cto").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(desk.body.year).toBe(4);
    const bet = desk.body.fields.find((f: any) => f.id === "featureBet");
    expect(bet.options[0].value, "no bet is always an answer").toBe("");
    expect(bet.options).toHaveLength(4);
    const copyable = bet.options.find((o: any) => /a rival already has it/.test(o.help));
    expect(copyable, "one of the three can be copied").toBeTruthy();
    expect(desk.body.productRisk).toMatchObject({ security: expect.any(Number), breachChance: expect.any(Number) });

    const filed = await seat("cto").agent.post(`/api/sim/ventures/${ventureId}/decisions`).send({
      decision: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0, researchSpend: 0, featureBet: copyable.value, featureMode: "copy" },
    });
    expect(filed.status, JSON.stringify(filed.body)).toBe(200);
    await nextYear(seasonId);

    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    const company = (season.world as any).companies.find((c: any) => c.id === ventureId);
    expect(company.features.map((f: any) => [f.id, f.mode, f.lands])).toEqual([[copyable.value, "copy", 4]]);
  }, 240_000);

  it("puts the year's offers to the table, and a vote carries one", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    for (let i = 0; i < 4; i++) await nextYear(seasonId);

    const desk = await seat("ceo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(desk.body.year).toBe(5);
    expect(desk.body.offers.length).toBeGreaterThan(0);
    // Whichever partner came this year: the draw decides which, never whether.
    const deal = desk.body.offers.find((o: any) => o.kind !== "buyout");
    expect(deal, "a partner comes to everybody").toBeTruthy();
    const dealsField = desk.body.fields.find((f: any) => f.id === "deals");
    expect(dealsField.options.map((o: any) => o.value)).toContain(deal.id);

    // The chief executive puts it to the table; two seats vote for it.
    const put = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/decisions`).send({
      decision: { focus: "growth", positioning: "", rehire: "", deals: { [deal.id]: "vote" } },
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    for (const role of ["cto", "coo"] as const) {
      const votes = await seat(role).agent.get(`/api/sim/ventures/${ventureId}/desk`);
      const field = votes.body.fields.find((f: any) => f.id === "dealVotes");
      expect(field.options.map((o: any) => o.value)).toContain(deal.id);
      const filed = await seat(role).agent.post(`/api/sim/ventures/${ventureId}/decisions`).send({
        decision: role === "cto"
          ? { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0, researchSpend: 0, dealVotes: { [deal.id]: "yes" } }
          : { capacityTarget: votes.body.company.capacity, supportSpend: 0, efficiencySpend: 0, headcount: 0, dealVotes: { [deal.id]: "yes" } },
      });
      expect(filed.status, JSON.stringify(filed.body)).toBe(200);
    }
    await nextYear(seasonId);

    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    const company = (season.world as any).companies.find((c: any) => c.id === ventureId);
    const [row] = await db.select().from(simReports)
      .where(and(eq(simReports.ventureId, ventureId), eq(simReports.year, 5)));
    const notes = ((row.report as any).notes as string[]).join(" ");
    expect(notes, "the table was asked, and answered").toMatch(/put to the table, 2 for and 0 against\. Taken\./);
    if (deal.kind === "distribution") {
      expect(company.revenueShares, "the partner takes their share for three years").toHaveLength(1);
      expect(company.assets.some((a: any) => a.id === `deal-${deal.id}`)).toBe(true);
    } else {
      expect(notes).toMatch(/joint campaign/);
    }
  }, 300_000);

  it("hands over the research the marketing seat paid for", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    for (let i = 0; i < 5; i++) await nextYear(seasonId);

    const before = await seat("cmo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(before.body.year).toBe(6);
    expect(before.body.research, "nothing bought, nothing to read").toBeNull();

    const filed = await seat("cmo").agent.post(`/api/sim/ventures/${ventureId}/decisions`).send({
      decision: { price: before.body.company.price, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: [], research: "rivals" },
    });
    expect(filed.status, JSON.stringify(filed.body)).toBe(200);

    const after = await seat("cfo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(after.body.research.kind, "the whole table reads it").toBe("rivals");
    expect(after.body.research.rivals.length).toBeGreaterThan(0);
    expect(after.body.research.rivals[0]).toMatchObject({ name: expect.any(String), priceNext: expect.any(Number) });
  }, 300_000);
});
