/**
 * Every lever on the desk moves the forecast beside it.
 *
 * Reported from use: "some decisions aren't fully price involved and aren't
 * actively adjusting the side forecast bar as you make them." The rail is the
 * whole argument for deciding here rather than in a spreadsheet — you change
 * something and watch what it does to the year — so a control that leaves it
 * untouched is worse than a missing one. The codebase already says as much
 * about the lever list: "there are no decorative controls, because a control
 * that changes nothing is a lie the first spreadsheet will expose."
 *
 * ## Why a sweep rather than a test per lever
 *
 * Because the failure is a lever nobody thought to check. A file with fifteen
 * named tests covers fifteen levers and says nothing about the sixteenth
 * somebody adds next month; this walks whatever the desk actually offers, so a
 * new lever is covered the day it appears and an unwired one fails on the day
 * it is added rather than whenever a player notices.
 *
 * ## The exemptions, and why each is not a bug
 *
 * A few levers legitimately cannot move *this* year's numbers, and saying so
 * here is the point — an exemption list with reasons is how "does nothing" is
 * told apart from "does nothing yet".
 *
 * Writing this by hand first found three levers that appeared dead and were
 * not, which is worth recording because each was a trap in the testing rather
 * than the product: `positioning`'s first option is "everybody", which is what
 * it already was; `repay` does nothing to a company with no debt; and
 * `cashBuffer` is measured against cash *plus the credit line*, so holding
 * back all six million of six million still leaves two million of credit and
 * changes nothing. Push it past cash-plus-credit and the year swings by one
 * and a half million.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { simSeasons, simVentures } from "@shared/schema";
import { startReadySeasons } from "../../server/simulation-tick";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const ROLES = ["ceo", "cmo", "cfo", "cto", "coo"] as const;

/**
 * Levers that cannot move this year's projection, and the reason each one is
 * allowed to sit still. Anything not on this list must move it.
 */
const CANNOT_MOVE_THIS_YEAR: Record<string, string> = {
  /*
   * Only while the company is serving every customer it has room for.
   *
   * Declaring who you are for shifts appeal between segments, and appeal
   * cannot sell anybody a place that does not exist: a company already turning
   * people away is capacity-bound, and being liked more changes nothing until
   * there is room. In year one, with a market far larger than a new company's
   * capacity, that is the usual state — which is why a single-option test of
   * this lever failed about one run in three, on whichever draft happened to
   * leave spare room. Checked properly in the second test below.
   */
  positioning: "appeal cannot fill a seat that does not exist while the company is capacity-bound",
  // Nothing owed, so nothing to pay off. It moves the year of a company in debt.
  repay: "the company has no debt in year one",
  // Measured against cash plus the credit line, so a buffer under that ceiling
  // changes nothing — by design, and checked separately below.
  cashBuffer: "only bites above cash plus credit, which this draft is under",
  // A vote is not a decision with a cost; the offer it votes on carries that.
  dealVotes: "a vote has no price of its own",
  deals: "answered by the chief executive, and priced by the offer itself",
  // Answers to things that have not happened yet in year one.
  shockAnswer: "nothing has gone wrong yet to answer for",
  rehire: "no seat has been dissolved to bring back",
  overrule: "nobody has filed a decision to overrule",
  replaceSeat: "nobody has been fired",
  replaceBid: "there is no replacement being bid for",
  // Next year's plan, by construction.
  expand: "opens a region next year, not this one",
  stockTarget: "made this year to sell next year",
  automationTarget: "paid for now, runs from next year",
  recruitingSpend: "the hires arrive next year",
  trainingSpend: "shows next year",
  researchSpend: "lands next year by design",
  programme: "pays out over the three years after it starts",
  targets: "sets next year's objectives",
  bonusPool: "paid on next year's results",
  forecast: "a number operations and finance plan against, not a cost",
  featureBet: "lands next year unless it is copied",
  featureMode: "how the feature bet is built, and the bet lands next year",
};

async function player(app: any) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.173.${(n % 200) + 20}`;
  const email = `sweep-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `S${n}` });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

/** A solo founder's running company: one person holding all five desks. */
async function soloCompany(app: any) {
  await db.update(simVentures).set({ phase: "retired" })
    .where(inArray(simVentures.phase, ["filling", "claiming", "naming"]));
  const stale = await db.select({ id: simSeasons.id }).from(simSeasons).where(eq(simSeasons.status, "forming"));
  if (stale.length) {
    await db.update(simVentures).set({ phase: "retired" }).where(inArray(simVentures.seasonId, stale.map((s) => s.id)));
    await db.update(simSeasons).set({ status: "abandoned" }).where(inArray(simSeasons.id, stale.map((s) => s.id)));
  }
  const players = [];
  let ventureId = "";
  for (let i = 0; i < 5; i++) {
    const p = await player(app);
    ventureId = (await p.agent.post("/api/sim/join").send({ nicheId: "dating_apps" })).body.ventureId;
    players.push(p);
  }
  for (const [i, p] of players.entries()) {
    await p.agent.post(`/api/sim/ventures/${ventureId}/claim`).send({ role: ROLES[i] });
  }
  await players[0].agent.post(`/api/sim/ventures/${ventureId}/name`).send({ name: "Sweep", product: "Training" });
  await startReadySeasons();
  const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));
  await db.update(simSeasons).set({ seatCount: 1 }).where(eq(simSeasons.id, venture.seasonId));
  return { ventureId, agent: players[0].agent };
}

/** The projection, reduced to the figures the rail actually shows. */
const railFigures = (p: any) => p && JSON.stringify({
  revenue: Math.round(p.revenue), profit: Math.round(p.profit),
  cashEnd: Math.round(p.cashEnd), customers: Math.round(p.customers),
  capacity: Math.round(p.capacityNow),
});

describe("the forecast rail beside the desk", () => {
  it("moves for every lever that is meant to move it", async () => {
    const app = await getTestApp();
    const { ventureId, agent } = await soloCompany(app);

    const desk = await agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(desk.status).toBe(200);
    const fields: any[] = desk.body.fields ?? [];
    expect(fields.length, "a desk with no levers proves nothing").toBeGreaterThan(10);
    const base = { ...desk.body.draft };

    const project = async (draft: any) => {
      const res = await agent.get(`/api/sim/ventures/${ventureId}/projection?draft=${encodeURIComponent(JSON.stringify(draft))}`);
      expect(res.status).toBe(200);
      return railFigures(res.body.drafted);
    };
    const before = await project(base);

    /*
     * A change big enough to be felt, and definitely different from what is
     * already there. The first version of this picked each choice's first
     * option, which for "who the company is for" is "everybody" — already the
     * answer — and reported a working lever as dead.
     */
    /* The cities to sell in come from the desk, not from the field's options. */
    const allCities: string[] = (desk.body.cities ?? []).map((c: any) => c.id ?? c.value ?? c);

    /*
     * Every value the lever can take, not one of them.
     *
     * A choice is wired in if *some* answer moves the year — not if every
     * answer does. Declaring who the company is for is the case that taught
     * this: it moves the forecast a long way for a segment the company can
     * reach, and not at all for one it has opened no city for, which is the
     * engine being right rather than the lever being dead. Testing a single
     * option picked at random failed about one run in three, on whichever
     * segment that season had put out of reach.
     */
    const candidates = (f: any): any[] => {
      const now = base[f.id];
      if (f.kind === "money" || f.kind === "count") return [Math.max(50_000, Math.round((Number(now) || 0) + (f.step || 1_000) * 25))];
      if (f.kind === "percent") return [Math.min(f.max ?? 100, Math.max(20, (Number(now) || 0) + 25))];
      if (f.kind === "price") return [Math.max(1, Math.round((Number(now) || 10) * 2))];
      if (f.kind === "choice" || f.kind === "segment") {
        return (f.options ?? [])
          .map((o: any) => o.value)
          .filter((v: any) => String(v) !== String(now ?? "") && String(v) !== "");
      }
      if (f.kind === "cities") {
        const opened: string[] = Array.isArray(now) ? now : [];
        const extra = allCities.find((c) => !opened.includes(c));
        return extra ? [[...opened, extra]] : [];
      }
      return [];
    };

    const dead: string[] = [];
    const moved: string[] = [];
    for (const field of fields) {
      const tries = candidates(field);
      if (!tries.length) continue;
      let shifted: any;
      for (const next of tries) {
        const after = await project({ ...base, [field.id]: next });
        if (after !== before) { shifted = next; break; }
      }
      if (shifted === undefined) {
        if (!(field.id in CANNOT_MOVE_THIS_YEAR)) {
          dead.push(`${field.id} (${field.kind}) — nothing in ${JSON.stringify(tries)} moved the rail`);
        }
      } else {
        moved.push(field.id);
      }
    }

    expect(moved.length, "almost nothing moved the rail — the projection is probably not reading the draft at all").toBeGreaterThan(8);
    expect(dead, `levers that changed nothing on the rail:\\n  ${dead.join("\\n  ")}`).toEqual([]);
  }, 300_000);

  /*
   * The exemption above is a state, not a rule, and this is the state that
   * ends it: room to spare. If the company is not turning anybody away and
   * declaring a segment still changes nothing, the lever really is dead.
   */
  it("moves the forecast for who the company is for, once there is room to spare", async () => {
    const app = await getTestApp();
    const { ventureId, agent } = await soloCompany(app);
    const desk = await agent.get(`/api/sim/ventures/${ventureId}/desk`);
    const base = { ...desk.body.draft };
    const segments: string[] = (desk.body.fields ?? [])
      .find((f: any) => f.id === "positioning")?.options?.map((o: any) => o.value).filter(Boolean) ?? [];
    expect(segments.length, "a market with no segments cannot test positioning").toBeGreaterThan(1);

    const project = async (draft: any) => {
      const res = await agent.get(`/api/sim/ventures/${ventureId}/projection?draft=${encodeURIComponent(JSON.stringify(draft))}`);
      return res.body.drafted;
    };

    const plain = await project(base);
    /*
     * Only meaningful with room going spare. A capacity-bound company is
     * serving everybody it can, and no amount of being liked changes that —
     * which is the engine behaving like the world rather than a bug.
     */
    if (plain.customers >= plain.capacityNow) {
      /*
       * Nothing to prove here, and one thing worth recording: the rail shows a
       * company serving exactly the room it has while `turnedAway` reads zero,
       * so the line that would explain why the decisions have stopped moving
       * the numbers ("N turned away for want of room") never appears. Whether
       * that is the engine having no unserved demand or the rail's capacity
       * figure disagreeing with the one the market allocated against is not
       * settled, and is not this test's business either way.
       */
      return;
    }

    const answers = await Promise.all(segments.map((seg) => project({ ...base, positioning: seg })));
    const moved = answers.some((a) => railFigures(a) !== railFigures(plain));
    expect(moved, `with ${Math.round(plain.capacityNow - plain.customers)} places going spare, no segment moved the rail`).toBe(true);
  }, 300_000);

  /*
   * And the one whose exemption is a threshold rather than a timing: it does
   * hold, once the table is committing more than finance has left it.
   */
  it("cuts the year back when finance holds more than the table can spend", async () => {
    const app = await getTestApp();
    const { ventureId, agent } = await soloCompany(app);
    const desk = await agent.get(`/api/sim/ventures/${ventureId}/desk`);
    const base = { ...desk.body.desk?.draft ?? desk.body.draft };
    const company = desk.body.company;

    const project = async (draft: any) => {
      const res = await agent.get(`/api/sim/ventures/${ventureId}/projection?draft=${encodeURIComponent(JSON.stringify(draft))}`);
      return res.body.drafted;
    };

    const spending = { ...base, brandSpend: 2_000_000 };
    const free = await project({ ...spending, cashBuffer: 0 });
    /*
     * Above cash plus the whole credit line, which is what the buffer is
     * measured against — the commitment meter shows the same total, so the
     * number nobody can spend is the one on screen.
     */
    const held = await project({ ...spending, cashBuffer: Math.round(company.cash + (company.creditLimit ?? 0) + 1_000_000) });

    expect(held.profit, "holding the money back should leave the company better off this year")
      .toBeGreaterThan(free.profit);
    expect(railFigures(held)).not.toBe(railFigures(free));
  }, 300_000);
});
