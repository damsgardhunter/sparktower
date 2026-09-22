/**
 * The room that fills itself.
 *
 * A simulation lobby needs three people to start and five to be a company, and
 * it waits fifteen minutes to find them. Early on it usually doesn't, so the
 * one person who turned up watches a clock run down and is then told there was
 * no game — the worst possible first experience of the feature, arriving
 * exactly when there are fewest people to lose.
 *
 * After a minute of waiting, the empty seats get bots. What's under test here
 * is the four properties that keep that from being a lie or a mess:
 *
 *   - an empty room is never filled — bots exist for the person who came, not
 *     to run seasons against each other for nobody;
 *   - filling twice seats five, not ten;
 *   - every seat says whether it's a bot, on every surface that shows one;
 *   - a bot never overwrites a decision a person filed.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { simBids, simDecisions, simSeasons, simSeats, simVentures, users } from "@shared/schema";
import { fileBotBids, fileBotDecisions, fillVentureWithBots } from "../../server/simulation-bots";
import { startReadySeasons } from "../../server/simulation-tick";
import { BOT_FILL_AFTER_SECONDS } from "@shared/simulation/bots";
import { LOBBY_SIZE } from "@shared/simulation/lobby";
import { nicheById } from "@shared/simulation/niches";
import type { Listing } from "@shared/simulation/assets";
import type { Company } from "@shared/simulation/types";

afterAll(async () => { await closeTestApp(); });

/* A range no other spec uses: registering counts against a per-address budget. */
let n = 0;
async function player(app: any) {
  n += 1;
  const agent = request.agent(app);
  const ip = `198.51.180.${(n % 200) + 20}`;
  const email = `simbot-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `B${n}` });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

const NICHE = "dating_apps";

/**
 * Wind the room's clock back past the wait.
 *
 * The alternative is sleeping a minute in a test, which buys nothing: what
 * decides the fill is how long it has been since anybody last arrived, and
 * moving that backwards asks the same question in a millisecond.
 */
async function waitedAMinute(ventureId: string) {
  const long_ago = new Date(Date.now() - (BOT_FILL_AFTER_SECONDS + 5) * 1000);
  await db.update(simSeats).set({ joinedAt: long_ago }).where(eq(simSeats.ventureId, ventureId));
  await db.update(simVentures).set({ createdAt: long_ago }).where(eq(simVentures.id, ventureId));
}

const seatsIn = (ventureId: string) =>
  db.select({ userId: simSeats.userId, role: simSeats.role, isBot: users.isBot })
    .from(simSeats).leftJoin(users, eq(users.id, simSeats.userId))
    .where(eq(simSeats.ventureId, ventureId));

/**
 * One person, alone in a room of their own.
 *
 * Not `POST /api/sim/join`, which hands back whichever room in the niche has
 * space — that is matchmaking's job and it is right, but it means one test's
 * half-filled room becomes the next test's starting position. What's under
 * test here is what happens to a room that waits, so each one gets its own.
 */
async function roomOfOne(app: any) {
  const one = await player(app);
  const ventureId = await emptyRoom();
  // `joinedAt` explicitly, as the join route writes it — see the comment there.
  await db.insert(simSeats).values({ ventureId, userId: one.id, joinedAt: new Date() } as any);
  return { one, ventureId };
}

/** A room in a season of its own, so nothing else can wander into it. */
async function emptyRoom(): Promise<string> {
  const [season] = await db.insert(simSeasons)
    .values({ nicheId: NICHE, name: `Bots ${Date.now()}-${n}` } as any).returning();
  const [venture] = await db.insert(simVentures).values({
    seasonId: season.id,
    phase: "filling",
    phaseEndsAt: new Date(Date.now() + 15 * 60_000),
  } as any).returning();
  return venture.id;
}

describe("filling a waiting room", () => {
  it("does nothing until the room has actually waited", async () => {
    const app = await getTestApp();
    const { ventureId } = await roomOfOne(app);

    expect(await fillVentureWithBots(ventureId), "a room seconds old is not a room to fill").toBe(0);
    expect(await seatsIn(ventureId)).toHaveLength(1);
  }, 120_000);

  it("tops a lone player's room up to a full company", async () => {
    const app = await getTestApp();
    const { one, ventureId } = await roomOfOne(app);
    await waitedAMinute(ventureId);

    expect(await fillVentureWithBots(ventureId)).toBe(LOBBY_SIZE - 1);

    const seats = await seatsIn(ventureId);
    expect(seats).toHaveLength(LOBBY_SIZE);
    expect(seats.filter((s) => s.isBot)).toHaveLength(LOBBY_SIZE - 1);
    expect(seats.filter((s) => !s.isBot).map((s) => s.userId)).toEqual([one.id]);
  }, 120_000);

  /*
   * The property that stops a retry, a poll and the minute job racing each
   * other into a ten-person company. Every path calls this, often at once.
   */
  it("seats the same five however many times it runs", async () => {
    const app = await getTestApp();
    const { ventureId } = await roomOfOne(app);
    await waitedAMinute(ventureId);

    await Promise.all([
      fillVentureWithBots(ventureId),
      fillVentureWithBots(ventureId),
      fillVentureWithBots(ventureId),
    ]);
    expect(await fillVentureWithBots(ventureId), "a full room needs nobody").toBe(0);
    expect(await seatsIn(ventureId)).toHaveLength(LOBBY_SIZE);
  }, 120_000);

  /*
   * The rule that keeps this from being a fake product. A room nobody is in is
   * not a room to fill — it's a room to retire, and filling it would have bots
   * playing seasons against each other for nobody's benefit.
   */
  /*
   * A room gaining a real player every few seconds has not stalled, and this
   * is what bots are for: somebody sitting alone while a fifteen-minute clock
   * runs down. Filling a room people are still walking into would seat bots in
   * front of the next arrival, who then gets a room of their own — the product
   * manufacturing the loneliness it exists to prevent.
   */
  it("waits again when somebody else turns up", async () => {
    const app = await getTestApp();
    const { ventureId } = await roomOfOne(app);
    await waitedAMinute(ventureId);

    const second = await player(app);
    await db.insert(simSeats).values({ ventureId, userId: second.id, joinedAt: new Date() } as any);

    expect(await fillVentureWithBots(ventureId), "a second real player resets the wait").toBe(0);
    expect(await seatsIn(ventureId)).toHaveLength(2);
  }, 120_000);

  it("leaves an empty room empty", async () => {
    const ventureId = await emptyRoom();
    await db.update(simVentures).set({ createdAt: new Date(0) }).where(eq(simVentures.id, ventureId));
    expect(await fillVentureWithBots(ventureId)).toBe(0);
    expect(await seatsIn(ventureId)).toHaveLength(0);
  }, 120_000);

  it("says on every seat what it is, and gives bots ordinary names", async () => {
    const app = await getTestApp();
    const { one, ventureId } = await roomOfOne(app);
    await waitedAMinute(ventureId);
    await fillVentureWithBots(ventureId);

    const room = await one.agent.get(`/api/sim/ventures/${ventureId}`);
    expect(room.status).toBe(200);
    for (const seat of room.body.seats) {
      expect(seat, "a surface that can't tell can't label").toHaveProperty("isBot");
      expect(seat.name, "a lobby of blanks reads as a broken deployment").toBeTruthy();
    }
    expect(room.body.seats.filter((s: any) => s.isBot)).toHaveLength(LOBBY_SIZE - 1);
    expect(room.body.seats.find((s: any) => s.isYou).isBot).toBe(false);
  }, 120_000);

  /*
   * A bot never claims, so a room holding them would otherwise sit out the
   * full claiming clock and then the full naming clock — five minutes of one
   * real person watching nothing happen for choices nobody will make.
   */
  it("starts the season as soon as the person present has chosen", async () => {
    const app = await getTestApp();
    const { one, ventureId } = await roomOfOne(app);
    await waitedAMinute(ventureId);
    await fillVentureWithBots(ventureId);

    // Filling completes, and the room moves on to claiming.
    await db.update(simVentures).set({ phaseEndsAt: new Date(Date.now() - 1000) })
      .where(eq(simVentures.id, ventureId));
    await one.agent.get(`/api/sim/ventures/${ventureId}`);
    expect((await room(ventureId)).phase).toBe("claiming");

    const claim = await one.agent.post(`/api/sim/ventures/${ventureId}/claim`).send({ role: "cmo" });
    expect(claim.status, JSON.stringify(claim.body)).toBe(200);

    // No clock was waited on: everyone who was going to choose has chosen.
    await one.agent.get(`/api/sim/ventures/${ventureId}`);
    await one.agent.get(`/api/sim/ventures/${ventureId}`);

    const after = await room(ventureId);
    expect(after.phase, "nothing left to wait for").toBe("running");
    expect(after.name, "a bot chief executive names nothing, so the room gets a placeholder").toBeTruthy();

    const seats = await seatsIn(ventureId);
    expect(seats.every((s) => !!s.role), "every seat dealt out").toBe(true);
    expect(seats.find((s) => s.userId === one.id)?.role, "the human keeps what they chose").toBe("cmo");
  }, 120_000);
});

/*
 * Bots used to file only as the year resolved, so for the whole day the desk
 * showed every bot seat as "still deciding" and the committed-spend preview the
 * finance seat reads left out everything the bots would spend. A person can't
 * react to a plan they can't see — and the day is when they're trying to.
 */
describe("when the bots' plans are on the table", () => {
  it("files the bots' year-one decisions the moment the season starts", async () => {
    const app = await getTestApp();
    const { one, ventureId } = await roomOfOne(app);
    await waitedAMinute(ventureId);
    await fillVentureWithBots(ventureId);

    await db.update(simVentures).set({ phaseEndsAt: new Date(Date.now() - 1000) })
      .where(eq(simVentures.id, ventureId));
    await one.agent.get(`/api/sim/ventures/${ventureId}`);
    await one.agent.post(`/api/sim/ventures/${ventureId}/claim`).send({ role: "cmo" });
    await one.agent.get(`/api/sim/ventures/${ventureId}`);
    await one.agent.get(`/api/sim/ventures/${ventureId}`);
    expect((await room(ventureId)).phase).toBe("running");

    await startReadySeasons();

    // No tick has run. The bots' year is already on the table.
    const bots = (await seatsIn(ventureId)).filter((s) => s.isBot);
    const filed = await db.select().from(simDecisions)
      .where(and(eq(simDecisions.ventureId, ventureId), eq(simDecisions.year, 1)));
    expect(filed.map((d) => d.userId).sort(), "every bot has filed before anything resolves")
      .toEqual(bots.map((b) => b.userId).sort());
    // And the person's seat is theirs to fill.
    expect(filed.some((d) => d.userId === one.id)).toBe(false);
  }, 120_000);
});

describe("what the bots file", () => {
  const company = (id: string): Company => ({
    id, kind: "player", name: "Test Co", cash: 6_000_000, price: 40,
    capacity: 250_000, positioning: "", cities: [],
  } as any);

  it("files a legal decision for every seat it holds, and only those", async () => {
    const app = await getTestApp();
    const { one, ventureId } = await roomOfOne(app);
    await waitedAMinute(ventureId);
    await fillVentureWithBots(ventureId);
    await db.update(simSeats).set({ role: "ceo" }).where(and(eq(simSeats.ventureId, ventureId), eq(simSeats.userId, one.id)));
    const bots = (await seatsIn(ventureId)).filter((s) => s.isBot);
    for (const [i, bot] of bots.entries()) {
      await db.update(simSeats).set({ role: ["cmo", "cfo", "cto", "coo"][i] })
        .where(and(eq(simSeats.ventureId, ventureId), eq(simSeats.userId, bot.userId)));
    }

    const filed = await fileBotDecisions({
      companies: [{ id: ventureId, company: company(ventureId) }],
      year: 1,
      niche: nicheById(NICHE)!,
    });
    expect(filed).toBe(bots.length);

    const rows = await db.select().from(simDecisions).where(eq(simDecisions.ventureId, ventureId));
    expect(rows.map((r) => r.role).sort()).toEqual(["cfo", "cmo", "coo", "cto"]);
    // The seat that belongs to a person is left alone: not filing is their move to make.
    expect(rows.some((r) => r.role === "ceo"), "the human's seat is the human's").toBe(false);
  }, 120_000);

  /*
   * The one that matters most. Bots file just before the year resolves, which
   * is exactly when somebody is most likely to have filed seconds earlier —
   * and watching your plan silently replaced is worse than any bad year.
   */
  it("never overwrites something already filed", async () => {
    const app = await getTestApp();
    const { ventureId } = await roomOfOne(app);
    await waitedAMinute(ventureId);
    await fillVentureWithBots(ventureId);
    const bot = (await seatsIn(ventureId)).find((s) => s.isBot)!;
    await db.update(simSeats).set({ role: "cmo" })
      .where(and(eq(simSeats.ventureId, ventureId), eq(simSeats.userId, bot.userId)));

    const mine = { price: 12345 };
    await db.insert(simDecisions).values({
      ventureId, userId: bot.userId, role: "cmo", year: 1, payload: mine,
    } as any);

    expect(await fileBotDecisions({
      companies: [{ id: ventureId, company: company(ventureId) }], year: 1, niche: nicheById(NICHE)!,
    })).toBe(0);

    const [row] = await db.select().from(simDecisions)
      .where(and(eq(simDecisions.ventureId, ventureId), eq(simDecisions.role, "cmo")));
    expect(row.payload).toEqual(mine);
  }, 120_000);

  it("files nothing for a company with no bots in it", async () => {
    const app = await getTestApp();
    const { one, ventureId } = await roomOfOne(app);
    await db.update(simSeats).set({ role: "ceo" })
      .where(and(eq(simSeats.ventureId, ventureId), eq(simSeats.userId, one.id)));

    expect(await fileBotDecisions({
      companies: [{ id: ventureId, company: company(ventureId) }], year: 1, niche: nicheById(NICHE)!,
    })).toBe(0);
  }, 120_000);
});

const room = async (id: string) =>
  (await db.select().from(simVentures).where(eq(simVentures.id, id)))[0];

/**
 * Where a bot must never turn up.
 *
 * The whole reason they carry ordinary names is that a league table reading
 * "Bot 3" is worse than one reading "Ada Fournier" — and that is exactly what
 * makes this dangerous. A bot is a row in `users` like any other, so every
 * place the product looks for people will find one unless it is told not to.
 * A co-founder match, a Discover card or a mention suggestion offering an
 * account nobody is behind is the product introducing somebody to nobody.
 */
describe("where bots must never turn up", () => {
  it("is not in a people search, under any part of its name", async () => {
    const app = await getTestApp();
    const { one, ventureId } = await roomOfOne(app);
    await waitedAMinute(ventureId);
    await fillVentureWithBots(ventureId);

    const bot = (await seatsIn(ventureId)).find((s) => s.isBot)!;
    const [row] = await db.select().from(users).where(eq(users.id, bot.userId));

    for (const term of [row.firstName!, row.lastName!, `${row.firstName} ${row.lastName}`]) {
      const found = await one.agent.get(`/api/users/search?q=${encodeURIComponent(term)}`);
      expect(found.status).toBe(200);
      expect(found.body.map((u: any) => u.id), `searching "${term}" surfaced a bot`).not.toContain(bot.userId);
    }
  }, 120_000);

  it("is not offered as somebody to mention in a post", async () => {
    const app = await getTestApp();
    const { one, ventureId } = await roomOfOne(app);
    await waitedAMinute(ventureId);
    await fillVentureWithBots(ventureId);

    const bot = (await seatsIn(ventureId)).find((s) => s.isBot)!;
    const [row] = await db.select().from(users).where(eq(users.id, bot.userId));

    const found = await one.agent.get(`/api/feed/mention-search?q=${encodeURIComponent(row.firstName!)}`);
    expect(found.status).toBe(200);
    const listed = (found.body.users ?? found.body.results ?? found.body ?? []) as any[];
    expect(listed.map((u: any) => u.id)).not.toContain(bot.userId);
  }, 120_000);

  /*
   * Matching draws its whole candidate pool from `searchUsers`, so the check
   * above covers it — but that is a fact about today's implementation, and the
   * cost of it changing quietly is somebody being told a bot is their 94%
   * co-founder match. Asserted directly.
   */
  it("is not in the pool co-founder matching draws from", async () => {
    const app = await getTestApp();
    const { ventureId } = await roomOfOne(app);
    await waitedAMinute(ventureId);
    await fillVentureWithBots(ventureId);
    const bot = (await seatsIn(ventureId)).find((s) => s.isBot)!;

    const { storage } = await import("../../server/storage");
    const pool = await storage.searchUsers("");
    expect(pool.map((u) => u.id), "a match is an introduction to a person").not.toContain(bot.userId);
  }, 120_000);
});

/**
 * The marketplace.
 *
 * Three things come up for sale every year and every team sees the same list,
 * but only a team with a person in the chief executive's chair ever bid — so a
 * company run by bots watched the distribution deal it needed go to whoever
 * turned up. It bids for itself now.
 */
describe("what the bots bid for", () => {
  const rich = (id: string): Company => ({
    id, kind: "player", name: "Test Co", cash: 40_000_000, creditLimit: 10_000_000, debt: 0,
    price: 40, capacity: 250_000, positioning: "", cities: [], customers: {}, assets: [],
  } as any);
  const listings: Listing[] = [
    { id: "lot-a", reserve: 1_000_000, sellerId: null, blurb: "A thing.",
      asset: { id: "ast-a", kind: "distribution", name: "Lot A", effect: { capacity: 50_000 }, bookValue: 1_000_000 } },
    { id: "lot-b", reserve: 2_000_000, sellerId: null, blurb: "Another.",
      asset: { id: "ast-b", kind: "patent", name: "Lot B", effect: { quality: 4 }, bookValue: 2_000_000 } },
  ];

  /**
   * A full room whose chief executive is a bot.
   *
   * The seating is asserted rather than assumed: when this failed in CI it
   * failed as "expected 0 to be greater than 0" from the bidding assertion,
   * which says nothing about whether the room ever had a bot in the chair.
   */
  async function botRunRoom(app: any) {
    const { one, ventureId } = await roomOfOne(app);
    await waitedAMinute(ventureId);
    await fillVentureWithBots(ventureId);
    const bots = (await seatsIn(ventureId)).filter((s) => s.isBot);
    expect(bots.length, "the room filled with bots").toBeGreaterThan(0);

    await db.update(simSeats).set({ role: "cmo" }).where(and(eq(simSeats.ventureId, ventureId), eq(simSeats.userId, one.id)));
    const seated = await db.update(simSeats).set({ role: "ceo" })
      .where(and(eq(simSeats.ventureId, ventureId), eq(simSeats.userId, bots[0].userId)))
      .returning({ id: simSeats.id });
    expect(seated.length, "a bot is in the chief executive's chair").toBe(1);
    return { ventureId, chair: bots[0].userId };
  }

  it("puts money on the table for a company whose chief executive is a bot", async () => {
    const app = await getTestApp();
    const { ventureId } = await botRunRoom(app);

    /*
     * What fileBotBids is about to look for, asked the same way it asks.
     *
     * This failed twice in CI as "expected 0 to be greater than 0", which is
     * true whether nobody bid or nobody was found to bid — and the room's own
     * assertions above had already passed. Naming the chair separately means
     * the next failure says which of the two it is.
     */
    const chairs = await db
      .select({ userId: simSeats.userId, role: simSeats.role, isBot: users.isBot })
      .from(simSeats)
      .innerJoin(users, eq(users.id, simSeats.userId))
      .where(and(eq(simSeats.ventureId, ventureId), eq(simSeats.role, "ceo")));
    expect(chairs.map((c) => c.isBot), "a bot, in the chair, as the query sees it").toEqual([true]);

    const company = rich(ventureId);
    const { botBids } = await import("@shared/simulation/bots");
    const wanted = botBids({ ventureId, year: 1, company, listings });
    expect(wanted.length, `the bot wanted something (cash ${company.cash}, ${listings.length} lots)`).toBeGreaterThan(0);

    const placed = await fileBotBids({ companies: [{ id: ventureId, company }], listings, year: 1 });
    expect(placed, "a bot chair bids").toBe(wanted.length);

    const rows = await db.select().from(simBids).where(eq(simBids.ventureId, ventureId));
    expect(rows.length).toBe(placed);
    for (const row of rows) {
      const lot = listings.find((l) => l.id === row.listingId)!;
      expect(row.amount, "over the reserve, or it buys nothing").toBeGreaterThanOrEqual(lot.reserve);
    }
  }, 120_000);

  it("leaves the bidding to the person when the chair is theirs", async () => {
    const app = await getTestApp();
    const { one, ventureId } = await roomOfOne(app);
    await waitedAMinute(ventureId);
    await fillVentureWithBots(ventureId);
    await db.update(simSeats).set({ role: "ceo" }).where(and(eq(simSeats.ventureId, ventureId), eq(simSeats.userId, one.id)));

    expect(await fileBotBids({ companies: [{ id: ventureId, company: rich(ventureId) }], listings, year: 1 })).toBe(0);
    expect((await db.select().from(simBids).where(eq(simBids.ventureId, ventureId))).length).toBe(0);
  }, 120_000);

  it("never replaces a bid that is already on the table, however it got there", async () => {
    const app = await getTestApp();
    const { ventureId } = await botRunRoom(app);
    await db.insert(simBids).values({ ventureId, listingId: "lot-a", year: 1, amount: 9_999_999 } as any);

    await fileBotBids({ companies: [{ id: ventureId, company: rich(ventureId) }], listings, year: 1 });
    const [kept] = await db.select().from(simBids)
      .where(and(eq(simBids.ventureId, ventureId), eq(simBids.listingId, "lot-a"), eq(simBids.year, 1)));
    expect(kept.amount, "the bid that was there stands").toBe(9_999_999);
  }, 120_000);
});
