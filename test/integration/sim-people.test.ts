/**
 * The people responsibilities through the real tick: a chief executive's
 * stretch reaching next year's objective, and a firing that moves a real
 * person to another table in the same market rather than out of the game.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { notifications, simChallenges, simSeasons, simSeats, simVentures } from "@shared/schema";
import { botIdentity } from "@shared/bots";
import { ensureBotUser } from "../../server/bot-accounts";
import { startReadySeasons, tickSeason } from "../../server/simulation-tick";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function player(app: any) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.174.${(n % 200) + 20}`;
  const email = `ppl-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
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


describe("the chief executive's people levers, through the tick", () => {
  it("pushes next year's objective as hard as the chief executive set it", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat } = await runningCompany(app);
    await nextYear(seasonId);
    await nextYear(seasonId);

    const set = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/decisions`).send({
      decision: { focus: "growth", positioning: "", rehire: "", targets: { cmo: "aggressive", cto: "easy" } },
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    await nextYear(seasonId);

    const rows = await db.select().from(simChallenges).where(and(eq(simChallenges.ventureId, ventureId), eq(simChallenges.year, 4)));
    const title = (role: string) => (rows.find((r) => r.role === role)?.challenge as any)?.title ?? "";
    expect(title("cmo")).toMatch(/pushed hard/);
    expect(title("cto")).toMatch(/kept easy/);
    expect(title("coo")).not.toMatch(/pushed hard|kept easy/);

    const desk = await seat("ceo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    const cmo = desk.body.table.find((s: any) => s.role === "cmo");
    expect(cmo.person).toMatchObject({ stretch: "aggressive" });
    expect(desk.body.table.find((s: any) => s.role === "ceo").person, "nobody tracks the chief executive's loyalty").toBeNull();
  }, 240_000);

  it("moves a fired person to a table that has a bot in the same chair", async () => {
    const app = await getTestApp();
    const { ventureId, seasonId, seat, players } = await runningCompany(app);
    for (let i = 0; i < 5; i++) await nextYear(seasonId);

    // Another table in the same market, with a bot running marketing.
    const [elsewhere] = await db.insert(simVentures).values({ seasonId, name: "Elsewhere", phase: "running" }).returning();
    const botId = await ensureBotUser(botIdentity(7));
    await db.insert(simSeats).values({ ventureId: elsewhere.id, userId: botId!, role: "cmo", claimedAt: new Date() });

    const desk = await seat("ceo").agent.get(`/api/sim/ventures/${ventureId}/desk`);
    expect(desk.body.year).toBe(6);
    const replace = desk.body.fields.find((f: any) => f.id === "replaceSeat");
    expect(replace.options.map((o: any) => o.value)).toEqual(["", "cmo", "cfo", "cto", "coo"]);

    const fire = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/decisions`).send({
      decision: { focus: "growth", positioning: "", rehire: "", replaceSeat: "cmo", replaceBid: 500_000 },
    });
    expect(fire.status, JSON.stringify(fire.body)).toBe(200);
    await nextYear(seasonId);

    const marketing = players[1];
    const theirSeats = await db.select().from(simSeats).where(eq(simSeats.userId, marketing.id));
    expect(theirSeats.map((s) => [s.ventureId, s.role]), "they moved, same chair").toEqual([[elsewhere.id, "cmo"]]);

    const [old] = await db.select().from(simSeats).where(and(eq(simSeats.ventureId, ventureId), eq(simSeats.role, "cmo")));
    expect(old.userId, "a new hire sits in the old chair").not.toBe(marketing.id);

    const told = await db.select().from(notifications).where(eq(notifications.recipientId, marketing.id));
    expect(told.some((n) => n.kind === "sim_nudge" && (n.excerpt ?? "").includes("Elsewhere"))).toBe(true);

    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    const company = (season.world as any).companies.find((c: any) => c.id === ventureId);
    expect(company.people.cmo.loyalty).toBe(75);
  }, 300_000);
});
