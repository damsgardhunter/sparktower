/**
 * Filing a year, against a real database.
 *
 * Two things worth testing here beyond the happy path. One is a security
 * claim: the engine reads decisions by role, so if a request could name its
 * own role or smuggle extra fields, a marketing seat could take out a loan the
 * finance seat never agreed to. The other is the whole point of the screen —
 * that what the five of them have committed between them is visible to each of
 * them before the tick rather than after it.
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
  const ip = `198.51.152.${(n % 200) + 20}`;
  const email = `desk-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
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

describe("opening the desk", () => {
  it("gives a seat its own levers and the company's position in one request", async () => {
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);

    const res = await seat("cmo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.phase).toBe("running");
    expect(res.body.year).toBe(1);
    expect(res.body.yourRole).toBe("cmo");

    // The marketing seat gets marketing levers, not everyone's.
    const ids = res.body.fields.map((f: any) => f.id);
    expect(ids).toContain("price");
    expect(ids).not.toContain("borrow");

    // Enough to decide with, without a second request.
    expect(res.body.company.cash).toBeGreaterThan(0);
    expect(res.body.segments.length).toBeGreaterThan(0);
    expect(res.body.rivals.length).toBeGreaterThan(0);
    expect(res.body.table).toHaveLength(5);
    // Year one has nothing behind it, and says so rather than inventing one.
    expect(res.body.lastYear).toBeNull();
  }, 120_000);

  it("tells a stranger nothing, including that the company exists", async () => {
    const app = await getTestApp();
    const { ventureId } = await runningCompany(app);
    const stranger = await player(app);

    const res = await stranger.agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/cash|Northbound|seats/);
  }, 120_000);
});

describe("filing a decision", () => {
  it("stores it, and shows it to the rest of the table", async () => {
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);

    const filed = await seat("cmo").agent.post(`/api/sim/ventures/${ventureId}/decisions`).send({
      decision: { price: 19, brandSpend: 400_000, performanceSpend: 200_000, celebritySpend: 0 },
    });
    expect(filed.status, JSON.stringify(filed.body)).toBe(200);

    // The operations seat can see what marketing committed — which is the
    // entire point, because they are the one who has to serve it.
    const theirs = await seat("coo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(theirs.body.filed.cmo.brandSpend).toBe(400_000);
    expect(theirs.body.table.find((t: any) => t.role === "cmo").filed).toBe(true);
    expect(theirs.body.table.find((t: any) => t.role === "coo").filed).toBe(false);
  }, 120_000);

  it("lets someone change their mind right up to the tick", async () => {
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);

    await seat("cmo").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { price: 19, brandSpend: 400_000, performanceSpend: 0, celebritySpend: 0 } });
    await seat("cmo").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { price: 25, brandSpend: 100_000, performanceSpend: 0, celebritySpend: 0 } });

    const rows = await db.select().from(simDecisions)
      .where(and(eq(simDecisions.ventureId, ventureId), eq(simDecisions.role, "cmo")));
    // Replaced, not stacked.
    expect(rows).toHaveLength(1);
    expect((rows[0].payload as any).price).toBe(25);
  }, 120_000);

  it("will not let one seat file another seat's levers", async () => {
    /*
     * The engine reads decisions by role. A marketing seat that could smuggle a
     * `borrow` into its payload would be taking out a loan in the finance
     * seat's name, and the CFO would find out on the tick.
     */
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);

    const res = await seat("cmo").agent.post(`/api/sim/ventures/${ventureId}/decisions`).send({
      decision: { price: 19, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, borrow: 5_000_000, capacityTarget: 1 },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const [row] = await db.select().from(simDecisions)
      .where(and(eq(simDecisions.ventureId, ventureId), eq(simDecisions.role, "cmo")));
    expect(row.payload).not.toHaveProperty("borrow");
    expect(row.payload).not.toHaveProperty("capacityTarget");
  }, 120_000);

  it("refuses what the engine could not act on, and says which field", async () => {
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);

    const res = await seat("cfo").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { borrow: 0, repay: 9_000_000, cashBuffer: 0 } });
    expect(res.status).toBe(400);
    // Nobody owes anything in year one.
    expect(res.body.errors.repay).toBeTruthy();
  }, 120_000);

  it("refuses a drawdown the credit line cannot cover, and says how much there is", async () => {
    /*
     * `borrow` used to be taken at face value: fifty million against a line of
     * a couple of million funded the lot. The desk now refuses it under the
     * field, in the same words the phone shows before the round trip.
     */
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);

    const res = await seat("cfo").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { borrow: 50_000_000, repay: 0, cashBuffer: 0 } });
    expect(res.status).toBe(400);
    expect(res.body.errors.borrow).toMatch(/at most|fully drawn/);
  }, 120_000);

  it("refuses a seat that is not yours to file from", async () => {
    const app = await getTestApp();
    const { ventureId } = await runningCompany(app);
    const stranger = await player(app);

    const res = await stranger.agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { focus: "growth" } });
    expect(res.status).toBe(404);
  }, 120_000);
});

describe("what the table has committed", () => {
  it("shows every seat the sum none of them could see alone", async () => {
    /*
     * Three people each commit two million, which is reasonable on each of
     * their own screens. The fourth opens theirs and the company has committed
     * six million against six million of cash plus a salary bill. That number
     * has to be on the screen before the tick, not explained after it.
     */
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);

    await seat("cmo").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { price: 22, brandSpend: 2_000_000, performanceSpend: 0, celebritySpend: 0 } });
    await seat("cto").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { featureSpend: 2_000_000, reliabilitySpend: 0, techDebtPaydown: 0 } });
    // Capacity held where it is: building more is operations' money too now, and this is about the other three.
    const before = await seat("coo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    const last = await seat("coo").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { capacityTarget: before.body.company.capacity, supportSpend: 2_000_000, efficiencySpend: 0, headcount: 0 } });

    // The seat that files last is told immediately, without another request.
    expect(last.body.preview.commitment.spend).toBe(6_000_000);

    // And so is everyone else when they look.
    const cfo = await seat("cfo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    const money = cfo.body.preview.commitment;
    expect(money.spend).toBe(6_000_000);
    expect(money.bySeat.find((s: any) => s.role === "cmo").spend).toBe(2_000_000);
    expect(money.fixed).toBeGreaterThan(0);
    expect(cfo.body.preview.warnings.length).toBeGreaterThan(0);
  }, 120_000);

  /*
   * When marketing outruns capacity, operations is told — by the year's report,
   * from what actually happened.
   *
   * This used to assert a warning on the desk *before* the year ran, built
   * from an estimate of demand. That estimate was off by a factor of about
   * fifty (see `shared/simulation/decisions.ts`), so the pre-tick warning was
   * removed on purpose rather than left to fire on nearly every team. What the
   * operations seat is owed is the truth afterwards: how many people wanted
   * the company and could not be served, and that some went to a rival.
   */
  it("tells operations, once the year runs, that marketing outran them", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);

    await seat("cmo").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { price: 22, brandSpend: 3_000_000, performanceSpend: 3_000_000, celebritySpend: 0 } });
    await seat("coo").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { capacityTarget: 1_000, supportSpend: 0, efficiencySpend: 0, headcount: 0 } });

    await db.update(simSeasons)
      .set({ nextTickAt: new Date(Date.now() - 1000), startsAt: new Date(Date.now() - 60_000) })
      .where(eq(simSeasons.id, seasonId));
    expect(await tickSeason(seasonId)).toBe(1);

    const [report] = await db.select().from(simReports).where(and(
      eq(simReports.seasonId, seasonId), eq(simReports.ventureId, ventureId), eq(simReports.year, 1),
    ));
    const notes = ((report?.report as any)?.notes ?? []).join(" ");
    expect(notes, notes).toMatch(/could not be served/i);
  }, 120_000);
});

describe("the decisions that make it a business", () => {
  it("offers every seat a full desk rather than one dial", async () => {
    /*
     * The complaint this answers: every seat but marketing had three levers or
     * fewer and the chief executive had exactly one, so most of the table had
     * almost nothing to decide on a given day.
     */
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);

    for (const role of ROLES) {
      const desk = await seat(role).agent.get(`/api/sim/ventures/${ventureId}/desk`);
      expect(desk.body.fields.length, `${role} has too little to do`).toBeGreaterThanOrEqual(3);
      for (const field of desk.body.fields) {
        expect(field.help.length, `${role}.${field.id} explains nothing`).toBeGreaterThan(20);
      }
    }
  }, 180_000);

  it("sends the marketing seat the places it could open, and which are already open", async () => {
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);

    const desk = await seat("cmo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(desk.body.cities.length).toBeGreaterThan(1);
    expect(desk.body.cities.some((c: any) => c.open), "a company sells somewhere").toBe(true);
    expect(desk.body.cities.some((c: any) => !c.open), "and not everywhere").toBe(true);
    for (const city of desk.body.cities) {
      expect(city.entryCost).toBeGreaterThan(0);
      expect(city.note.length).toBeGreaterThan(10);
    }

    const cityField = desk.body.fields.find((f: any) => f.id === "targetCities");
    expect(cityField.kind).toBe("cities");
  }, 180_000);

  it("fills the chief executive's choices from this company's own position", async () => {
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);

    const desk = await seat("ceo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    const positioning = desk.body.fields.find((f: any) => f.id === "positioning");
    expect(positioning.kind).toBe("segment");
    // Every segment in this market, plus the option of being for everybody.
    expect(positioning.options.length).toBe(desk.body.segments.length + 1);

    // Nobody has been dissolved, so there is nobody to rehire.
    const rehire = desk.body.fields.find((f: any) => f.id === "rehire");
    expect(rehire.options).toHaveLength(0);
    expect(desk.body.dissolvedSeats).toHaveLength(0);
  }, 180_000);

  it("stores the new decisions and acts on them", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);

    const desk = await seat("cmo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    const shut = desk.body.cities.find((c: any) => !c.open);
    const open = desk.body.cities.filter((c: any) => c.open).map((c: any) => c.id);

    const filed = await seat("cmo").agent.post(`/api/sim/ventures/${ventureId}/decisions`).send({
      decision: { price: 22, brandSpend: 500_000, performanceSpend: 0, celebritySpend: 0, targetCities: [...open, shut.id] },
    });
    expect(filed.status, JSON.stringify(filed.body)).toBe(200);

    await seat("cfo").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { borrow: 0, repay: 0, cashBuffer: 0, raiseAmount: 3_000_000 } });
    await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { focus: "quality", positioning: desk.body.segments[0].id, rehire: "" } });
    await seat("cto").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0, researchSpend: 600_000 } });

    await db.update(simSeasons)
      .set({ nextTickAt: new Date(Date.now() - 1000), startsAt: new Date(Date.now() - 60_000) })
      .where(eq(simSeasons.id, seasonId));
    expect(await tickSeason(seasonId)).toBe(1);

    const after = await seat("cmo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    // The city was opened and charged for.
    expect(after.body.cities.find((c: any) => c.id === shut.id).open).toBe(true);
    // The raise cost them ownership.
    expect(after.body.company.founderShare).toBeLessThan(1);
    // The research is banked. It lands in two years, not next (see `lag.ts`).
    expect(after.body.company.pipelineLater).toBeGreaterThan(0);
    // And the positioning stuck.
    expect(after.body.company.positioning).toBe(desk.body.segments[0].id);
  }, 240_000);

  it("ranks a year by what the founders own rather than by headcount of customers", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);

    await db.update(simSeasons)
      .set({ nextTickAt: new Date(Date.now() - 1000), startsAt: new Date(Date.now() - 60_000) })
      .where(eq(simSeasons.id, seasonId));
    await tickSeason(seasonId);

    const desk = await seat("ceo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(desk.body.lastYear.founderValue).toBeGreaterThanOrEqual(0);
    expect(desk.body.lastYear.founderShare).toBe(1);

    const standings = await seat("ceo").agent.get(`/api/sim/ventures/${ventureId}/standings`);
    const values = standings.body.rows.map((r: any) => r.founderValue);
    expect(values, "the table should be ordered by what each side owns")
      .toEqual([...values].sort((a: number, b: number) => b - a));
  }, 240_000);
});

describe("the year after", () => {
  it("resolves what was filed and hands back a desk for the next year", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);

    await seat("cmo").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { price: 17, brandSpend: 800_000, performanceSpend: 400_000, celebritySpend: 0 } });

    await db.update(simSeasons)
      .set({ nextTickAt: new Date(Date.now() - 1000), startsAt: new Date(Date.now() - 60_000) })
      .where(eq(simSeasons.id, seasonId));
    expect(await tickSeason(seasonId)).toBe(1);

    const desk = await seat("cmo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(desk.body.year).toBe(2);
    // Last year is there to read before deciding this one.
    expect(desk.body.lastYear).toBeTruthy();
    expect(desk.body.lastYear.year).toBe(1);
    expect(Array.isArray(desk.body.lastYear.notes)).toBe(true);
    // The price they chose is the company's price now.
    expect(desk.body.company.price).toBe(17);
    // And the new year's form starts from what they did, not from zero.
    expect(desk.body.draft.brandSpend).toBe(800_000);
    expect(desk.body.submitted, "a new year is not already filed").toBe(false);
  }, 180_000);
});

describe("a desk before year one", () => {
  /*
   * These two used to be one answer. Whether the season was a minute from
   * starting or was never going to start, the desk said "waiting for year
   * one" and kept saying it — and the second case is the one where a person
   * sits there refreshing a screen that has already ended.
   */
  it("says what the wait is on, and that the room doesn't need more people", async () => {
    const app = await getTestApp();
    const p = await player(app);
    const join = await p.agent.post("/api/sim/join").send({ nicheId: NICHE });

    const res = await p.agent.get(`/api/sim/ventures/${join.body.ventureId}/desk`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.phase).toBe("not_started");
    expect(res.body.roomsStillChoosing, "its own room is still in the lobby").toBeGreaterThanOrEqual(1);
  }, 120_000);

  it("tells a room whose season closed that it closed, rather than waiting for ever", async () => {
    const app = await getTestApp();
    const p = await player(app);
    const join = await p.agent.post("/api/sim/join").send({ nicheId: NICHE });
    const ventureId = join.body.ventureId as string;
    const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));

    await db.update(simVentures).set({ phase: "retired" }).where(eq(simVentures.id, ventureId));
    await db.update(simSeasons).set({ status: "abandoned" }).where(eq(simSeasons.id, venture.seasonId));

    const res = await p.agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(res.status).toBe(200);
    expect(res.body.phase).toBe("over");
  }, 120_000);
});

/*
 * The live projection: the year run on a copy, as filed and with the viewer's
 * unfiled draft on top. See `@shared/simulation/projection`.
 */
describe("the projection", () => {
  it("shows the year as filed, and what a seat's unfiled draft does to it", async () => {
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);

    const plain = await seat("cmo").agent.get(`/api/sim/ventures/${ventureId}/projection`);
    expect(plain.status, JSON.stringify(plain.body)).toBe(200);
    expect(plain.body.filed.revenue).toBeGreaterThanOrEqual(0);
    expect(plain.body.drafted, "no draft, no difference").toEqual(plain.body.filed);

    const draft = { price: 40, brandSpend: 3_000_000, performanceSpend: 0, celebritySpend: 0, targetCities: [] };
    const moved = await seat("cmo").agent
      .get(`/api/sim/ventures/${ventureId}/projection?draft=${encodeURIComponent(JSON.stringify(draft))}`);
    expect(moved.status).toBe(200);
    expect(moved.body.drafted.cashEnd, "spending three million leaves less in the bank").toBeLessThan(moved.body.filed.cashEnd);
  }, 120_000);

  /*
   * The draft is cleaned against the viewer's own seat, so a projection
   * cannot be asked what a lever the seat does not own would do.
   */
  it("only lets a seat project its own levers", async () => {
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);
    const sneaky = { borrow: 50_000_000 };
    const res = await seat("cmo").agent
      .get(`/api/sim/ventures/${ventureId}/projection?draft=${encodeURIComponent(JSON.stringify(sneaky))}`);
    expect(res.status).toBe(200);
    // A CMO "borrowing" fifty million must not show up as fifty million in the bank.
    expect(res.body.drafted.cashEnd).toBeLessThan(res.body.filed.cashEnd + 50_000_000);
  }, 120_000);

  it("tells a stranger nothing, including that the company exists", async () => {
    const app = await getTestApp();
    const { ventureId } = await runningCompany(app);
    const outsider = await player(app);
    expect((await outsider.agent.get(`/api/sim/ventures/${ventureId}/projection`)).status).toBe(404);
  }, 120_000);

  it("refuses a draft it cannot read", async () => {
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);
    expect((await seat("cmo").agent.get(`/api/sim/ventures/${ventureId}/projection?draft=%7Bnot-json`)).status).toBe(400);
  }, 120_000);
});

/*
 * The investors' board, once it has removed the chief executive. A filing
 * from the removed seat must be refused out loud, not accepted and ignored.
 */
describe("when the board has taken the chair", () => {
  it("refuses the removed chief executive's filing and says why", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);

    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    const world = season.world as any;
    world.companies = world.companies.map((c: any) => c.id === ventureId
      ? { ...c, investors: { since: 1, raised: 2_000_000, target: 9_000_000, targetYear: 5, strikes: 2, inCharge: true } }
      : c);
    await db.update(simSeasons).set({ world }).where(eq(simSeasons.id, seasonId));

    const res = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { focus: "margin", positioning: "", rehire: "" } });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("board_in_charge");

    // Everyone else still files as normal.
    const cmo = await seat("cmo").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { price: 40, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: [] } });
    expect(cmo.status, JSON.stringify(cmo.body)).toBe(200);
  }, 120_000);
});

/**
 * Opening a region is the decision that commits the company for years, so it
 * stopped being one seat's to take. What has to hold over HTTP: every seat is
 * sent the same region and the same price, a vote only counts once operations
 * has put it up, the running count is the server's rather than the screen's,
 * and the table comes back with faces on it.
 */
describe("the table votes on where to expand", () => {
  it("sends every seat the region, counts only what operations put up, and carries a face", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);

    // Year four, which is when the lever arrives.
    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    const world = { ...(season.world as any), year: 4 };
    await db.update(simSeasons).set({ world, year: 4 }).where(eq(simSeasons.id, seasonId));

    const desk = async (role: "ceo" | "cmo" | "cfo" | "cto" | "coo") =>
      (await seat(role).agent.get(`/api/sim/ventures/${ventureId}/desk`)).body;

    const coo = await desk("coo");
    expect(coo.expansion, "a region is announced for year four").toBeTruthy();
    const region = coo.expansion.region.id as string;
    expect(coo.expansion.proposed).toBe(false);
    expect(coo.expansion.carried, "nothing is carried before it is put up").toBe(false);

    // The voting seats are sent the same region, at the same price.
    const cfoBefore = await desk("cfo");
    expect(cfoBefore.expansion.region.id).toBe(region);
    expect(cfoBefore.expansion.cost).toBe(coo.expansion.cost);
    const voteField = cfoBefore.fields.find((f: any) => f.id === "expandVote");
    expect(voteField.options.map((o: any) => o.value)).toEqual([region]);

    // A vote filed before operations puts it up counts for nothing.
    const against = { expandVote: { [region]: "no" } };
    expect((await seat("cfo").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { borrow: 0, repay: 0, cashBuffer: 0, raiseAmount: 0, ...against } })).status).toBe(200);
    expect((await desk("cfo")).expansion.votes, "nothing is on the table yet").toEqual({});

    // Operations puts it up, which is its own vote for.
    expect((await seat("coo").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { supportSpend: 0, efficiencySpend: 0, headcount: 0, expand: region } })).status).toBe(200);

    const now = await desk("cmo");
    expect(now.expansion.proposed).toBe(true);
    expect(now.expansion.votes).toEqual({ coo: "yes", cfo: "no" });
    expect(now.expansion.carried, "one each is a tie, and a tie leaves it shut").toBe(false);
    expect(now.expansion.yes).toBe(1);
    expect(now.expansion.no).toBe(1);

    // One more for, and it carries — counted by the server, the same way the engine will.
    expect((await seat("cmo").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { price: 40, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: [], expandVote: { [region]: "yes" } } })).status).toBe(200);
    const carried = await desk("ceo");
    expect(carried.expansion.carried).toBe(true);
    expect(carried.expansion.yes).toBe(2);

    // And the table carries what the screen needs to put a face against a vote.
    expect(carried.table.every((t: any) => "avatarUrl" in t)).toBe(true);
    expect(carried.table.map((t: any) => t.role).sort()).toEqual(["ceo", "cfo", "cmo", "coo", "cto"]);
  }, 120_000);

  it("asks nobody to vote once the operations seat is gone", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);

    /*
     * Dissolving a seat stops that seat's decisions for good, and putting the
     * region up is operations'. The other four must not be shown a region and
     * asked to vote on a proposal that can never be made.
     */
    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    const world = {
      ...(season.world as any),
      year: 4,
      companies: (season.world as any).companies.map((c: any) => c.id === ventureId
        ? { ...c, seats: c.seats.filter((r: string) => r !== "coo") }
        : c),
    };
    await db.update(simSeasons).set({ world, year: 4 }).where(eq(simSeasons.id, seasonId));

    const desk = (await seat("cfo").agent.get(`/api/sim/ventures/${ventureId}/desk`)).body;
    expect(desk.expansion, "no operations seat, no proposal, nothing to vote on").toBeNull();
    expect(desk.fields.find((f: any) => f.id === "expandVote").options).toEqual([]);
  }, 120_000);
});

/**
 * A founder holding every desk files once and gets all of it back.
 *
 * Their filing is written as five rows, one per role, because the engine reads
 * decisions per role and a role with no row for the period is treated as
 * absent — "that part of the year ran on last year's plan at about 60%". That
 * half worked. The read-back did not: the desk handed over
 * `decisions[seat.role]`, which is the chief executive's row and nothing else,
 * so every price, spend and target filed from the other four desks came back
 * empty the moment the page remounted. Nothing was lost — it was in the
 * database the whole time, in the four rows that line did not read — but a
 * person switching tabs saw their decisions reset to zero, which is the same
 * thing from where they are sitting.
 */
describe("a solo founder's filing", () => {
  it("comes back whole after the page is reloaded", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);

    // One chair: the same shape a project's solo season is built with.
    await db.update(simSeasons).set({ seatCount: 1 }).where(eq(simSeasons.id, seasonId));

    const ceo = seat("ceo");
    const filed = await ceo.agent.post(`/api/sim/ventures/${ventureId}/decisions`).send({
      decision: {
        focus: "growth",
        price: 20,
        brandSpend: 5_000,
        capacityTarget: 10_000,
        borrow: 1_000,
        featureSpend: 2_500,
      },
    });
    expect(filed.status, JSON.stringify(filed.body)).toBe(200);

    const again = await ceo.agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(again.status).toBe(200);
    expect(again.body.solo, "one chair is a solo table").toBe(true);
    expect(again.body.submitted, "every desk they hold has a row").toBe(true);

    // The part that was broken: four desks' worth of fields, not one.
    expect(again.body.draft.focus, "the chief executive's own").toBe("growth");
    expect(again.body.draft.price, "marketing's").toBe(20);
    expect(again.body.draft.brandSpend).toBe(5_000);
    expect(again.body.draft.capacityTarget, "operations'").toBe(10_000);
    expect(again.body.draft.borrow, "finance's").toBe(1_000);
    expect(again.body.draft.featureSpend, "technology's").toBe(2_500);
  }, 120_000);

  /* And a five-person table is untouched: each seat still gets its own desk. */
  it("does not hand a shared table somebody else's levers", async () => {
    const app = await getTestApp();
    const { ventureId, seat } = await runningCompany(app);

    await seat("cmo").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { price: 30, brandSpend: 1_000 } });
    const cfo = await seat("cfo").agent.get(`/api/sim/ventures/${ventureId}/desk`);

    expect(cfo.body.solo).toBe(false);
    expect(cfo.body.draft.price, "the finance seat does not file a price").toBeUndefined();
  }, 120_000);
});
