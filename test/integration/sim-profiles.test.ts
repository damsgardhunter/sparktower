/**
 * The two screens you open by tapping a name, against a real database.
 *
 * Most of what is worth testing here is what is *not* in the answer. A rival
 * team's profile is a deliberate leak boundary — the standings are public, the
 * bank balance is not — and a boundary like that is not kept by a route being
 * written carefully once. It is kept by somebody noticing when a later change
 * spreads the whole company object into the response, which is the failure this
 * file exists to catch. The same goes for the stranger: a 403 would confirm the
 * company exists, so the answer has to be the same 404 everywhere.
 *
 * The rest is the nudge, which is one notification with a uniqueness rule
 * behind it. A button that can send somebody fourteen reminders in an afternoon
 * is not a reminder, so "tapping twice writes one row" is the behaviour under
 * test rather than an implementation detail.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { simSeasons, simVentures, notifications } from "@shared/schema";
import { startReadySeasons, tickSeason } from "../../server/simulation-tick";
import { nicheById } from "@shared/simulation/niches";

afterAll(async () => { await closeTestApp(); });

/* A range no other spec uses: registering counts against a per-address budget. */
let n = 0;
async function player(app: any) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.153.${(n % 200) + 20}`;
  const email = `prof-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `P${n}` });
  /*
   * The raw text, not just the parsed body. A long combined run occasionally
   * answers this with a 404 whose body is not JSON, and `res.body` is then `{}`
   * — which says nothing at all about what actually came back.
   */
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

const NICHE = "podcasts";
const ROLES = ["ceo", "cmo", "cfo", "cto", "coo"] as const;
type RoleName = typeof ROLES[number];

/** Five players into whichever room the market gives them, seated and named. */
async function fillOneRoom(app: any, name: string) {
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
  await players[0].agent.post(`/api/sim/ventures/${ventureId}/name`)
    .send({ name, product: "A weekly show about nothing in particular" });
  return { players, ventureId };
}

/**
 * A running company with five seated players, and optionally a second one in
 * the same market.
 *
 * The rival room is only built when a test needs it, because it costs five more
 * registrations — but it has to be built the same way the first one was. A
 * player team is a company in the world only once its room reaches `running`,
 * and a season with a room still arguing does not start at all, so a rival
 * faked into the database would either be invisible or would hold the whole
 * season in the lobby.
 */
async function readyRoom(app: any, opts: { withRival?: boolean } = {}) {
  /*
   * Close any room still standing open from an earlier test first.
   *
   * Joining puts you in whichever room in the market has space, which is the
   * product behaving correctly and a trap for a helper that assumes its five
   * players get a room to themselves: a half-filled room left behind swallows
   * the first few, the rest start a second room, and the seats get claimed
   * across two ventures that then never reach `running`.
   */
  await db.update(simVentures).set({ phase: "retired" })
    .where(inArray(simVentures.phase, ["filling", "claiming", "naming"]));
  /*
   * And close any season still taking rooms, so this one gets its own. A season
   * holds every room in its market and a tick moves all of them, so a shared one
   * means a test that resolves a year quietly advances another test's company.
   *
   * Its rooms are retired before the season is marked abandoned: the starter
   * treats abandonment as a conclusion and overturns it if a company in that
   * season is still running, so a cleanup that only set the status would undo
   * itself on the next sweep.
   */
  const stale = await db.select({ id: simSeasons.id }).from(simSeasons).where(eq(simSeasons.status, "forming"));
  if (stale.length > 0) {
    await db.update(simVentures).set({ phase: "retired" })
      .where(inArray(simVentures.seasonId, stale.map((s) => s.id)));
    await db.update(simSeasons).set({ status: "abandoned" })
      .where(inArray(simSeasons.id, stale.map((s) => s.id)));
  }

  const mine = await fillOneRoom(app, "Northbound");
  const rival = opts.withRival ? await fillOneRoom(app, "Southbound") : null;
  if (rival) expect(rival.ventureId, "the rival needs a room of its own").not.toBe(mine.ventureId);

  await startReadySeasons();

  const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, mine.ventureId));
  expect(venture.phase).toBe("running");
  const seat = (role: RoleName) => mine.players[ROLES.indexOf(role)];
  return {
    players: mine.players,
    ventureId: mine.ventureId,
    seasonId: venture.seasonId,
    seat,
    rivalVentureId: rival?.ventureId ?? "",
  };
}

/** Wind a season's clock back so its next tick is due, as the tick specs do. */
async function makeDue(seasonId: string) {
  await db.update(simSeasons)
    .set({ nextTickAt: new Date(Date.now() - 1000), startsAt: new Date(Date.now() - 60_000) })
    .where(eq(simSeasons.id, seasonId));
}

const INCUMBENT = nicheById(NICHE)!.incumbents[0].id;

describe("opening a company", () => {
  it("gives an incumbent a character rather than a row on a table", async () => {
    /*
     * The complaint behind the whole feature: a standings table said "The Daily
     * Brief 33%" and there was nowhere to go from the name. A player who cannot
     * find out who they are up against has no way to decide what to do about it.
     */
    const app = await getTestApp();
    const { ventureId, seat } = await readyRoom(app);

    const res = await seat("ceo").agent.get(`/api/sim/ventures/${ventureId}/companies/${INCUMBENT}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.kind).toBe("incumbent");
    expect(res.body.isYou).toBe(false);

    for (const field of ["tagline", "boss", "character", "known", "knock", "voice"]) {
      expect(typeof res.body.persona?.[field], `persona.${field}`).toBe("string");
      expect(res.body.persona[field].length, `persona.${field} is empty`).toBeGreaterThan(0);
    }

    // The posture is what they will actually do, said in words as well as named.
    expect(res.body.posture).toBeTruthy();
    expect(typeof res.body.posturedAs).toBe("string");
    expect(res.body.posturedAs.length).toBeGreaterThan(10);

    // And where they stand, so the character has something to be true about.
    expect(res.body.standing.rank).toBeGreaterThan(0);
    expect(res.body.standing.of).toBe(5);
    expect(res.body.standing.share).toBeGreaterThan(0);
    // An incumbent is the puzzle, so its numbers are given plainly.
    expect(res.body.reads.map((r: any) => r.verdict).join(" ")).toMatch(/\d/);
  }, 180_000);

  it("does not compare you with yourself", async () => {
    const app = await getTestApp();
    const { ventureId, seat } = await readyRoom(app);

    const res = await seat("cmo").agent.get(`/api/sim/ventures/${ventureId}/companies/${ventureId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.isYou).toBe(true);
    expect(res.body.name).toBe("Northbound");
    // Reading your own profile is reading the standings, not a head-to-head.
    expect(res.body.reads).toEqual([]);
    expect(res.body.contested).toEqual([]);
    // A player team has no author-written character; whatever they do is it.
    expect(res.body.persona).toBeNull();
  }, 180_000);

  it("tells you how a rival team compares without telling you their books", async () => {
    /*
     * The line this route draws. Share, revenue and price are on the league
     * table for everybody, so repeating them leaks nothing; cash, debt, credit
     * and the research pipeline answer the one question that should stay open —
     * can they afford to follow me down? Quality, brand and service sit in
     * between and are given as words, which is both more readable and not
     * reversible into their exact position.
     */
    const app = await getTestApp();
    const { ventureId, rivalVentureId, seat } = await readyRoom(app, { withRival: true });

    const res = await seat("ceo").agent.get(`/api/sim/ventures/${ventureId}/companies/${rivalVentureId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.kind).toBe("player");
    expect(res.body.isYou).toBe(false);
    expect(res.body.name).toBe("Southbound");

    // The first three reads are the observable qualities, and none of them is a number.
    const soft = res.body.reads.slice(0, 3);
    expect(soft).toHaveLength(3);
    for (const read of soft) {
      expect(typeof read.verdict, read.label).toBe("string");
      expect(read.verdict, `${read.label} gives the number away`).not.toMatch(/\d/);
      expect(["them", "you", "level"]).toContain(read.edge);
    }

    /*
     * On the serialised body rather than on the keys: a leak that mattered would
     * arrive nested — a whole company object dropped into `standing`, or a
     * report spread into `history` — and a key-by-key check at the top level
     * would wave it through.
     */
    const body = JSON.stringify(res.body);
    for (const secret of ["cash", "debt", "creditLimit", "pipeline"]) {
      expect(body, `a rival's ${secret} is not yours to read`).not.toMatch(new RegExp(secret, "i"));
    }
  }, 300_000);
});

/*
 * Who is behind a rival, and behind your own table.
 *
 * A rival team used to be a name and a share. The point of a public lobby is
 * that real people are playing it, and until the roster went on this route
 * there was no way to find out who — let alone to follow one of them after the
 * season. The user id is the part that matters: it is what lets a name on this
 * screen reach that person's real profile.
 */
describe("who is at a table", () => {
  it("names the people behind a rival, with ids that reach their profiles", async () => {
    const app = await getTestApp();
    const { ventureId, rivalVentureId, seat } = await readyRoom(app, { withRival: true });

    const res = await seat("ceo").agent.get(`/api/sim/ventures/${ventureId}/companies/${rivalVentureId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Array.isArray(res.body.roster)).toBe(true);
    expect(res.body.roster.length).toBeGreaterThan(0);

    for (const person of res.body.roster) {
      expect(typeof person.userId, "a name with no id cannot be linked anywhere").toBe("string");
      expect(person.userId.length).toBeGreaterThan(0);
      expect(typeof person.name).toBe("string");
      expect(person.name).not.toBe("");
      // Nobody at a rival table is you.
      expect(person.isYou).toBe(false);
    }

    /* The chief executive reads first, whoever joined first. */
    const roles = res.body.roster.map((p: any) => p.role).filter(Boolean);
    if (roles.includes("ceo")) expect(roles[0]).toBe("ceo");
  }, 300_000);

  it("marks you on your own roster", async () => {
    const app = await getTestApp();
    const { ventureId, seat } = await readyRoom(app);

    const res = await seat("cmo").agent.get(`/api/sim/ventures/${ventureId}/companies/${ventureId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const you = res.body.roster.filter((p: any) => p.isYou);
    expect(you, "exactly one person on your own roster is you").toHaveLength(1);
    expect(you[0].role).toBe("cmo");
  }, 300_000);

  /* Nobody is behind an incumbent, and pretending otherwise would be a lie. */
  it("gives an incumbent no roster at all", async () => {
    const app = await getTestApp();
    const { ventureId, seat } = await readyRoom(app);

    const res = await seat("ceo").agent.get(`/api/sim/ventures/${ventureId}/companies/${INCUMBENT}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.roster).toEqual([]);
  }, 300_000);

  /*
   * The roster is names and seats. It must not become a second, quieter way
   * to read a rival's private numbers.
   */
  it("still gives nothing of a rival's position away", async () => {
    const app = await getTestApp();
    const { ventureId, rivalVentureId, seat } = await readyRoom(app, { withRival: true });

    const res = await seat("ceo").agent.get(`/api/sim/ventures/${ventureId}/companies/${rivalVentureId}`);
    const body = JSON.stringify(res.body.roster);
    for (const secret of ["cash", "debt", "creditLimit", "pipeline"]) {
      expect(body, `a rival's ${secret} is not yours to read`).not.toMatch(new RegExp(secret, "i"));
    }
  }, 300_000);
});

describe("somebody with no seat at the table", () => {
  it("is told the same nothing by all three routes", async () => {
    /*
     * 404 rather than 403, and the same 404 everywhere. "You are not allowed to
     * see this company" confirms the company exists, which is a thing a rival
     * should not be able to establish by trying identifiers.
     */
    const app = await getTestApp();
    const { ventureId, players } = await readyRoom(app);
    const stranger = await player(app);

    const company = await stranger.agent.get(`/api/sim/ventures/${ventureId}/companies/${INCUMBENT}`);
    expect(company.status).toBe(404);

    const teammate = await stranger.agent.get(`/api/sim/ventures/${ventureId}/seats/${players[1].id}`);
    expect(teammate.status).toBe(404);

    const nudge = await stranger.agent.post(`/api/sim/ventures/${ventureId}/nudge`)
      .send({ userId: players[1].id });
    expect(nudge.status).toBe(404);

    // And none of the three says anything about who is in there.
    for (const res of [company, teammate, nudge]) {
      expect(JSON.stringify(res.body)).not.toMatch(/Northbound|ceo|cmo|seats/);
    }
  }, 180_000);
});

describe("opening a teammate", () => {
  it("shows their seat and what they have committed, once they commit it", async () => {
    /*
     * Deliberately readable by the whole table. Five people privately making
     * reasonable decisions that are collectively ruinous is the failure this
     * game is built around, and the only defence is seeing what the others have
     * filed while there is still time to argue about it.
     */
    const app = await getTestApp();
    const { ventureId, players, seat } = await readyRoom(app);
    const marketing = players[ROLES.indexOf("cmo")];

    const before = await seat("ceo").agent.get(`/api/sim/ventures/${ventureId}/seats/${marketing.id}`);
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(before.body.role).toBe("cmo");
    expect(before.body.title).toBeTruthy();
    expect(before.body.levers.length).toBeGreaterThan(0);
    expect(before.body.isYou).toBe(false);
    expect(before.body.filed).toBe(false);
    expect(before.body.decision).toBeNull();

    const filed = await seat("cmo").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { price: 19, brandSpend: 300_000, performanceSpend: 100_000, celebritySpend: 0 } });
    expect(filed.status, JSON.stringify(filed.body)).toBe(200);

    const after = await seat("ceo").agent.get(`/api/sim/ventures/${ventureId}/seats/${marketing.id}`);
    expect(after.body.filed).toBe(true);
    expect(after.body.decision.price).toBe(19);
    expect(after.body.decision.brandSpend).toBe(300_000);
    expect(after.body.filedAt).toBeTruthy();
  }, 180_000);

  it("counts a run of missed years rather than leaving it to be felt", async () => {
    /*
     * A teammate who missed one year and a teammate who has never once opened
     * the app are different problems — one needs a nudge, the other needs the
     * seat dissolved — and the screen cannot tell them apart without a count.
     */
    const app = await getTestApp();
    const { ventureId, seasonId, players, seat } = await readyRoom(app);
    const marketing = players[ROLES.indexOf("cmo")];
    const engineering = players[ROLES.indexOf("cto")];
    const turnoutOf = async (userId: string) =>
      (await seat("ceo").agent.get(`/api/sim/ventures/${ventureId}/seats/${userId}`)).body.turnout;

    await seat("cmo").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { price: 19, brandSpend: 100_000, performanceSpend: 0, celebritySpend: 0 } });

    expect((await turnoutOf(marketing.id)).missedRunning, "filed this year").toBe(0);
    expect((await turnoutOf(engineering.id)).missedRunning, "this year and no other").toBe(1);

    await makeDue(seasonId);
    expect(await tickSeason(seasonId)).toBeGreaterThanOrEqual(1);

    // Year two, nobody has filed it yet: one missed year for marketing, two for
    // the seat that has never filed anything.
    expect((await turnoutOf(marketing.id)).missedRunning).toBe(1);
    const cto = await turnoutOf(engineering.id);
    expect(cto.missedRunning).toBe(2);
    expect(cto.filed).toBe(0);
    expect(cto.of).toBe(2);
  }, 300_000);
});

describe("nudging a seat", () => {
  const nudgesTo = (recipientId: string, ventureId: string, year: number) =>
    db.select().from(notifications).where(and(
      eq(notifications.recipientId, recipientId),
      eq(notifications.kind, "sim_nudge"),
      eq(notifications.targetId, `${ventureId}:${year}`),
    ));

  it("reaches the person the table is waiting on", async () => {
    const app = await getTestApp();
    const { ventureId, players, seat } = await readyRoom(app);
    const engineering = players[ROLES.indexOf("cto")];

    const res = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/nudge`)
      .send({ userId: engineering.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.ok).toBe(true);

    const rows = await nudgesTo(engineering.id, ventureId, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].actorId).toBe(players[ROLES.indexOf("ceo")].id);
    // The excerpt has to say which seat and which year, because the bell is all
    // the person ever sees of this.
    expect(rows[0].excerpt).toMatch(/year 1/i);
  }, 180_000);

  it("refuses to remind somebody about the thing they did last night", async () => {
    const app = await getTestApp();
    const { ventureId, players, seat } = await readyRoom(app);
    const marketing = players[ROLES.indexOf("cmo")];

    await seat("cmo").agent.post(`/api/sim/ventures/${ventureId}/decisions`)
      .send({ decision: { price: 19, brandSpend: 100_000, performanceSpend: 0, celebritySpend: 0 } });

    const res = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/nudge`)
      .send({ userId: marketing.id });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe("already_filed");
    expect(await nudgesTo(marketing.id, ventureId, 1)).toHaveLength(0);
  }, 180_000);

  it("refuses to nudge you about yourself", async () => {
    const app = await getTestApp();
    const { ventureId, players, seat } = await readyRoom(app);
    const chief = players[ROLES.indexOf("ceo")];

    const res = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/nudge`)
      .send({ userId: chief.id });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(await nudgesTo(chief.id, ventureId, 1)).toHaveLength(0);
  }, 180_000);

  it("stacks nothing when it is tapped again", async () => {
    /*
     * The uniqueness rule is on (recipient, actor, kind, target) and the target
     * carries the year, which is what keeps this from being a button for sending
     * somebody fourteen notifications in an afternoon. Without it this is not a
     * reminder, it is a reason to leave.
     */
    const app = await getTestApp();
    const { ventureId, players, seat } = await readyRoom(app);
    const operations = players[ROLES.indexOf("coo")];

    const first = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/nudge`)
      .send({ userId: operations.id });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const second = await seat("ceo").agent.post(`/api/sim/ventures/${ventureId}/nudge`)
      .send({ userId: operations.id });
    expect(second.status, JSON.stringify(second.body)).toBe(200);

    // The second tap refreshes the first rather than adding to it.
    expect(await nudgesTo(operations.id, ventureId, 1)).toHaveLength(1);
  }, 180_000);
});
