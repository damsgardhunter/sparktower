/**
 * Ending a simulation year on demand (server/season-control.ts).
 *
 * The lines worth pinning are the ones around who may: a developer may move
 * any season but only with a second factor, because a public season is
 * strangers' game; on a local development server that opts in
 * (SIM_DEV_ADVANCE=1), anyone seated in the season may, and production ignores
 * the flag; everybody else is told the season doesn't exist.
 *
 * The company cases are kept, skipped, for when company accounts reach main.
 */
import { describe, it, expect, afterAll, afterEach, beforeEach } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { passMfa } from "../helpers/mfa";
import { db } from "../../server/db";
import { moderationLog, simReports, simSeasons, simVentures, users } from "@shared/schema";
import { startReadySeasons } from "../../server/simulation-tick";
import { devAdvanceOn } from "../../server/season-control";

afterAll(async () => { await closeTestApp(); });
/*
 * The flag is off unless a test turns it on, whatever the machine's own .env
 * says. Restoring the inherited value between tests meant that on a developer
 * box running with SIM_DEV_ADVANCE=1 — which is exactly who has it set — the
 * cases asserting the *default* (a player sees no clock) inherited the flag
 * and failed. What a test claims must not depend on whose laptop runs it.
 */
const flagBefore = process.env.SIM_DEV_ADVANCE;
beforeEach(() => { delete process.env.SIM_DEV_ADVANCE; });
afterEach(() => {
  if (flagBefore === undefined) delete process.env.SIM_DEV_ADVANCE;
  else process.env.SIM_DEV_ADVANCE = flagBefore;
});

const NICHE = "dating_apps";
const ROLES = ["ceo", "cmo", "cfo", "cto", "coo"];

/* A range no other spec uses: registering counts against a per-address budget. */
let n = 0;
async function player(app: any, firstName = `A${n + 1}`) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.172.${(n % 200) + 20}`;
  const email = `adv-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

async function developer(app: any, withSecondFactor = true) {
  const p = await player(app, "Dev");
  await db.update(users).set({ platformRole: "admin" }).where(eq(users.id, p.id));
  if (withSecondFactor) await passMfa(p.agent);
  return p;
}

/** Five strangers at one public table, the season started. */
async function publicSeason(app: any) {
  const people = [];
  for (let i = 0; i < 5; i++) people.push(await player(app));
  let ventureId = "";
  for (const p of people) ventureId = (await p.agent.post("/api/sim/join").send({ nicheId: NICHE })).body.ventureId;
  for (const [i, p] of people.entries()) await p.agent.post(`/api/sim/ventures/${ventureId}/claim`).send({ role: ROLES[i] });
  await people[0].agent.post(`/api/sim/ventures/${ventureId}/name`).send({ name: "Public Co" });
  const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));
  expect(await startReadySeasons()).toContain(venture.seasonId);
  return { seasonId: venture.seasonId, ventureId, people };
}

/** A company with an owner and `staff` colleagues, and a private season whose table they fill. */
async function companySeason(app: any, staff = 5) {
  const owner = await player(app, "Owner");
  const made = await owner.agent.post("/api/companies").send({ name: "Northwind Trading" });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const companyId = made.body.company.id as string;
  const people = [];
  for (let i = 0; i < staff; i++) {
    const p = await player(app);
    const link = await owner.agent.post(`/api/companies/${companyId}/invite-link`).send({});
    const token = new URL(link.body.url).searchParams.get("invite");
    expect((await p.agent.post("/api/company-invites/accept").send({ token })).status).toBe(200);
    people.push(p);
  }
  const season = await owner.agent.post(`/api/companies/${companyId}/seasons`)
    .send({ nicheId: NICHE, name: "Away day", yearMinutes: 30, totalYears: 4 });
  expect(season.status, JSON.stringify(season.body)).toBe(201);
  return { owner, companyId, people, seasonId: season.body.seasonId as string, inviteCode: season.body.inviteCode as string };
}

async function fillTable(people: any[], code: string) {
  let ventureId = "";
  for (const p of people.slice(0, 5)) ventureId = (await p.agent.post("/api/sim/join-code").send({ code })).body.ventureId;
  for (const [i, p] of people.slice(0, 5).entries()) {
    const claim = await p.agent.post(`/api/sim/ventures/${ventureId}/claim`).send({ role: ROLES[i] });
    expect(claim.status, JSON.stringify(claim.body)).toBe(200);
  }
  await people[0].agent.post(`/api/sim/ventures/${ventureId}/name`).send({ name: "Blue Harbour" });
  return ventureId;
}

describe("a developer", () => {
  it("can end a public season's year, is shown the control, and it goes on the record", async () => {
    const app = await getTestApp();
    const { seasonId, ventureId, people } = await publicSeason(app);
    const dev = await developer(app);

    // The players see no control; nor can they use it.
    const desk = await people[0].agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(desk.status).toBe(200);
    expect(desk.body.canAdvance).toBeNull();
    expect(desk.body.seasonId).toBe(seasonId);
    const refused = await people[0].agent.post(`/api/sim/seasons/${seasonId}/advance`).send({});
    expect(refused.status, "a player cannot run the clock on their neighbours").toBe(404);

    const res = await dev.agent.post(`/api/sim/seasons/${seasonId}/advance`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ resolvedYear: 1, year: 2, status: "running" });

    const [after] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    expect(after.year).toBe(2);
    const untilNext = after.nextTickAt!.getTime() - Date.now();
    expect(untilNext, "the next year is a whole year away, not overdue").toBeGreaterThan(23 * 60 * 60_000);
    const reports = await db.select().from(simReports).where(and(eq(simReports.seasonId, seasonId), eq(simReports.ventureId, ventureId)));
    expect(reports.map((r) => r.year)).toContain(1);

    const [logged] = await db.select().from(moderationLog)
      .where(and(eq(moderationLog.action, "sim.advance_year"), eq(moderationLog.targetId, seasonId)));
    expect(logged).toMatchObject({ actorId: dev.id, targetType: "sim_season" });
    expect(logged.details).toMatchObject({ as: "developer", companyId: null });
  }, 180_000);

  it("needs a second factor: a password alone does not move a market", async () => {
    const app = await getTestApp();
    const { seasonId } = await publicSeason(app);
    const dev = await developer(app, false);

    const res = await dev.agent.post(`/api/sim/seasons/${seasonId}/advance`).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("mfa_enrollment_required");
    const [still] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    expect(still.year).toBe(1);
  }, 180_000);

  it("is told plainly when there is no year to end", async () => {
    const app = await getTestApp();
    const dev = await developer(app);
    // One person in a lobby: a season still forming, with no year running.
    const early = await player(app);
    const ventureId = (await early.agent.post("/api/sim/join").send({ nicheId: NICHE })).body.ventureId;
    const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));
    const seasonId = venture.seasonId;
    const res = await dev.agent.post(`/api/sim/seasons/${seasonId}/advance`).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("not_running");
    expect((await dev.agent.post(`/api/sim/seasons/no-such-season/advance`).send({})).status).toBe(404);
  }, 120_000);
});

describe("a local development server with SIM_DEV_ADVANCE", () => {
  it("lets anyone seated end the year, without a second factor, and logs it as the flag", async () => {
    const app = await getTestApp();
    process.env.SIM_DEV_ADVANCE = "1";
    const { seasonId, ventureId, people } = await publicSeason(app);
    const cmo = people[1];

    const desk = await cmo.agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(desk.body.canAdvance, "the marketing seat is shown the control").toBe("dev_flag");

    const res = await cmo.agent.post(`/api/sim/seasons/${seasonId}/advance`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ resolvedYear: 1, year: 2, status: "running" });

    const [logged] = await db.select().from(moderationLog)
      .where(and(eq(moderationLog.action, "sim.advance_year"), eq(moderationLog.targetId, seasonId)));
    expect(logged).toMatchObject({ actorId: cmo.id });
    expect(logged.details).toMatchObject({ as: "dev_flag" });
  }, 180_000);

  it("still reaches only a season you are seated in", async () => {
    const app = await getTestApp();
    process.env.SIM_DEV_ADVANCE = "1";
    const { seasonId } = await publicSeason(app);
    const outsider = await player(app);
    expect((await outsider.agent.post(`/api/sim/seasons/${seasonId}/advance`).send({})).status).toBe(404);
  }, 180_000);

  it("does nothing when off, and nothing in production whatever it says", async () => {
    expect(devAdvanceOn({ SIM_DEV_ADVANCE: "1", NODE_ENV: "development" } as any)).toBe(true);
    expect(devAdvanceOn({ SIM_DEV_ADVANCE: "1", NODE_ENV: "test" } as any)).toBe(true);
    expect(devAdvanceOn({ SIM_DEV_ADVANCE: "1", NODE_ENV: "production" } as any), "production ignores it").toBe(false);
    expect(devAdvanceOn({ SIM_DEV_ADVANCE: "true", NODE_ENV: "development" } as any), "only the exact opt-in").toBe(false);
    expect(devAdvanceOn({ NODE_ENV: "development" } as any)).toBe(false);

    const app = await getTestApp();
    delete process.env.SIM_DEV_ADVANCE;
    const { seasonId, ventureId, people } = await publicSeason(app);
    expect((await people[1].agent.get(`/api/sim/ventures/${ventureId}/desk`)).body.canAdvance).toBeNull();
    expect((await people[1].agent.post(`/api/sim/seasons/${seasonId}/advance`).send({})).status).toBe(404);
  }, 180_000);
});

/* Company training seasons: the routes these use arrive with company accounts. */
describe.skip("a company", () => {
  it("can end its own training season's year, without a second factor, and its staff cannot", async () => {
    const app = await getTestApp();
    const { owner, people, seasonId, inviteCode } = await companySeason(app);
    const ventureId = await fillTable(people, inviteCode);
    expect(await startReadySeasons()).toContain(seasonId);

    const staffDesk = await people[0].agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(staffDesk.body.canAdvance, "an ordinary member has no clock").toBeNull();
    expect((await people[0].agent.post(`/api/sim/seasons/${seasonId}/advance`).send({})).status).toBe(404);

    const res = await owner.agent.post(`/api/sim/seasons/${seasonId}/advance`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ resolvedYear: 1, year: 2, status: "running" });

    // A four-year season: the fourth press ends it.
    let last: any = res;
    for (const year of [2, 3, 4]) {
      last = await owner.agent.post(`/api/sim/seasons/${seasonId}/advance`).send({});
      expect(last.status, JSON.stringify(last.body)).toBe(200);
      expect(last.body.resolvedYear).toBe(year);
    }
    expect(last.body.status).toBe("finished");
    expect((await owner.agent.post(`/api/sim/seasons/${seasonId}/advance`).send({})).body.code).toBe("not_running");

    const [logged] = await db.select().from(moderationLog)
      .where(and(eq(moderationLog.action, "sim.advance_year"), eq(moderationLog.targetId, seasonId), eq(moderationLog.actorId, owner.id)));
    expect(logged.details).toMatchObject({ as: "company" });
  }, 240_000);

  it("reaches no other company's season, and no public one", async () => {
    const app = await getTestApp();
    const theirs = await companySeason(app, 0);
    const other = await companySeason(app, 0);
    const { seasonId: publicId } = await publicSeason(app);

    // 404, not 409: another company's season is not theirs to know about, running or not.
    expect((await other.owner.agent.post(`/api/sim/seasons/${theirs.seasonId}/advance`).send({})).status).toBe(404);
    expect((await other.owner.agent.post(`/api/sim/seasons/${publicId}/advance`).send({})).status).toBe(404);
  }, 180_000);
});
