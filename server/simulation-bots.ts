/**
 * Putting the bots from `@shared/simulation/bots` into the database.
 *
 * Two jobs, both idempotent, both safe to run from the tick loop and from a
 * lobby screen's poll at the same moment:
 *
 *   - **Filling a room.** A venture that has been waiting a minute with at
 *     least one real person in it gets topped up to the lobby size. The unique
 *     index on (venture, user) is what makes a double-fill a no-op rather than
 *     ten seats.
 *   - **Filing their decisions.** Before a year resolves, every bot-held seat
 *     that hasn't filed gets one. Not filing is a real move for a person — the
 *     absence note exists — but a bot that abstains is just a seat that does
 *     nothing, which is what filling the room was meant to avoid.
 *
 * Nothing here decides anything: what a bot files comes from the pure module,
 * seeded on the venture, year, role and field, so a season replays identically
 * and a surprising result can be traced.
 */
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "./db";
import { simBids, simDecisions, simSeasons, simSeats, simVentures, users } from "@shared/schema";
import { LOBBY_SIZE } from "@shared/simulation/lobby";
import { pick } from "@shared/simulation/random";
import { BOT_FILL_AFTER_SECONDS, botBids, botDecision, botsForVenture, botsNeeded, type BotSkill } from "@shared/simulation/bots";
import { cleanDecision } from "@shared/simulation/levers";
import { dealsFor } from "@shared/simulation/world";
import { valuation } from "@shared/simulation/mergers";
import { isUnlocked } from "@shared/simulation/responsibilities";
import { ensureBotUser } from "./bot-accounts";
import type { Listing } from "@shared/simulation/assets";
import type { Company, Niche, Role } from "@shared/simulation/types";

/**
 * Top a waiting room up with bots, if it has waited long enough.
 *
 * Returns how many were seated. Zero is the ordinary answer: the room is full,
 * or nobody is in it, or it has only just opened.
 */
export async function fillVentureWithBots(ventureId: string): Promise<number> {
  const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));
  // Only a room still gathering people. Once seats are being claimed, adding a
  // player would change the game under the people already arguing about roles.
  if (!venture || venture.phase !== "filling") return 0;

  /*
   * What kind of table this is, which the venture does not know and the season
   * does. Two seasons now decline the fill entirely: a solo founder's, whose
   * table is one chair, and any season whose seats were bought for named
   * people, who are on their way. Seating Nova in front of them a minute
   * before they arrive is the failure this guard exists to prevent — and it
   * is worse than a slow lobby, because the person who does turn up is put in
   * a room of their own instead.
   */
  const [season] = await db
    .select({ seatCount: simSeasons.seatCount, botFill: simSeasons.botFill })
    .from(simSeasons).where(eq(simSeasons.id, venture.seasonId));
  const lobbySize = season?.seatCount ?? LOBBY_SIZE;
  if (season && (!season.botFill || lobbySize <= 1)) return 0;

  const seats = await db
    .select({ userId: simSeats.userId, joinedAt: simSeats.joinedAt, isBot: users.isBot })
    .from(simSeats)
    .leftJoin(users, eq(users.id, simSeats.userId))
    .where(eq(simSeats.ventureId, ventureId));

  const humans = seats.filter((s) => !s.isBot);
  const already = seats.filter((s) => s.isBot);
  const needed = botsNeeded({ humans: humans.length, lobbySize }) - already.length;
  if (needed <= 0) return 0;

  /*
   * Has the room waited? Asked of Postgres, and asked in UTC.
   *
   * `joined_at` is a `timestamp` without a zone, and Drizzle writes a JS Date
   * into one as UTC — so the cutoff it is compared against has to be UTC too.
   * Bare `now()` is a `timestamptz` rendered in the *database session's* zone,
   * which is wrong by that zone's offset: bots fill instantly on a server west
   * of Greenwich and never on one east of it.
   *
   * Note what this deliberately does not do, because I got it wrong here once:
   * it does not interpolate a JS Date into this template. A Date bound into a
   * raw `sql` fragment does not pass through the column's mapper the way
   * `lte(column, date)` does — the driver serialises it as *this process's*
   * local wall clock instead, reintroducing the same offset from the other
   * side. Inside raw SQL, build the time in SQL.
   *
   * Measured from the most recent arrival, not the first.
   *
   * What bots are for is a room that has stalled — somebody sitting alone
   * while a fifteen-minute clock runs down. A room that gains a real player
   * every twenty seconds has not stalled, and filling it would seat bots in
   * front of the next person to arrive, who then gets a room of their own.
   * The product would be manufacturing the loneliness it exists to prevent.
   *
   * The cost is that one person joining at second fifty-nine buys the room
   * another minute. That is the right trade: a minute of waiting is cheaper
   * than displacing somebody who actually turned up.
   */
  const [waited] = await db
    .select({
      ok: sql<boolean>`max(${simSeats.joinedAt}) <= (now() at time zone 'utc') - make_interval(secs => ${BOT_FILL_AFTER_SECONDS})`,
    })
    .from(simSeats)
    .innerJoin(users, eq(users.id, simSeats.userId))
    .where(and(eq(simSeats.ventureId, ventureId), eq(users.isBot, false)));
  if (!waited?.ok) return 0;

  /*
   * The whole cast is drawn, not just the missing few: a room part-filled by
   * an earlier run already holds the first of them, and asking for `needed`
   * would return those same names again and seat nobody.
   */
  const cast = botsForVenture(ventureId, lobbySize);
  const taken = new Set(already.map((s) => s.userId));

  let seated = 0;
  for (const bot of cast) {
    /*
     * The room is counted again before every seat, rather than counting down
     * from `needed`.
     *
     * Two fills running at once — a poll and the minute job, which is the
     * ordinary case — each seat the bots the other hasn't got to yet, and each
     * one's own tally says it is still short. Counting locally that way put a
     * sixth player in a five-person company. The database is the only thing
     * that knows how full the room actually is.
     */
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(simSeats)
      .where(eq(simSeats.ventureId, ventureId));
    if (count >= lobbySize) break;

    const userId = await ensureBotUser(bot);
    if (!userId || taken.has(userId)) continue;
    const put = await db.insert(simSeats)
      // UTC explicitly, like every other seat — see the join route.
      .values({ ventureId, userId, joinedAt: new Date() })
      // Already in this room: a second fill running alongside this one, which
      // is exactly the case the unique index is there for.
      .onConflictDoNothing({ target: [simSeats.ventureId, simSeats.userId] })
      .returning({ id: simSeats.id });
    if (put.length > 0) seated += 1;
  }

  if (seated > 0) console.log(`[sim] seated ${seated} bot(s) in venture ${ventureId}`);
  return seated;
}

/**
 * Companies made entirely of bots, to fill out a season nobody else is in.
 *
 * A season with one real table in it is a company with no competition: every
 * price is the right price, nobody takes your customers, and the lesson a team
 * comes away with is wrong. Rather than wait for nine other tables to exist, a
 * company running its own season can seat them.
 *
 * Whole rooms, not spare seats. Each gets five bot chairs with the five roles
 * claimed, a name, and the "running" phase — a room that has finished arguing
 * about who does what — so the starter treats it exactly like a room of
 * people, and everything downstream (the auction, the deals, the standings)
 * needs to know nothing about how it was filled.
 *
 * Idempotent on the count: it seats however many are missing, so calling it
 * twice on the same season does not double the market.
 */
export async function seatBotCompanies(seasonId: string, wanted: number): Promise<number> {
  if (wanted <= 0) return 0;

  const existing = await db
    .select({ id: simVentures.id, botOnly: simVentures.botOnly })
    .from(simVentures)
    .where(and(eq(simVentures.seasonId, seasonId), eq(simVentures.botOnly, true)));
  const missing = wanted - existing.length;
  if (missing <= 0) return 0;

  let made = 0;
  for (let i = 0; i < missing; i++) {
    const [venture] = await db.insert(simVentures).values({
      seasonId,
      // Named here rather than by a bot chief executive: the naming phase is a
      // conversation, and there is nobody in this room to have it.
      name: botCompanyName(`${seasonId}:${existing.length + i}`),
      phase: "running",
      botOnly: true,
    } as any).returning({ id: simVentures.id });
    if (!venture) continue;

    const cast = botsForVenture(venture.id, LOBBY_SIZE);
    let seated = 0;
    for (const [index, bot] of cast.entries()) {
      const userId = await ensureBotUser(bot);
      if (!userId) continue;
      const put = await db.insert(simSeats)
        .values({ ventureId: venture.id, userId, role: BOT_ROLES[index], joinedAt: new Date() } as any)
        .onConflictDoNothing({ target: [simSeats.ventureId, simSeats.userId] })
        .returning({ id: simSeats.id });
      if (put.length > 0) seated += 1;
    }

    /*
     * A room that could not be seated is retired rather than left standing.
     * An empty "running" room would hold the season open forever, waiting for
     * players who are never coming.
     */
    if (seated === 0) {
      await db.update(simVentures).set({ phase: "retired" }).where(eq(simVentures.id, venture.id));
      continue;
    }
    made += 1;
  }

  if (made > 0) console.log(`[sim] seated ${made} bot-run company(s) in season ${seasonId}`);
  return made;
}

/** The five chairs, in the order the cast is drawn. */
const BOT_ROLES: Role[] = ["ceo", "cmo", "cfo", "cto", "coo"];

/**
 * What a bot-run company calls itself.
 *
 * Plain, plausible names of the kind a team would pick in thirty seconds, so
 * the standings read like a market rather than like a test fixture.
 */
const BOT_COMPANY_WORDS = [
  ["North", "Ember", "Tide", "Lantern", "Harbour", "Vantage", "Kestrel", "Meridian", "Orchard", "Copper"],
  ["bound", "line", "works", "field", "point", "wright", "stone", "haven", "crest", "gate"],
];

export function botCompanyName(seed: string): string {
  const first = pick(`${seed}:name:first`, BOT_COMPANY_WORDS[0]);
  const second = pick(`${seed}:name:second`, BOT_COMPANY_WORDS[1]);
  return `${first}${second}`;
}

/** Every venture still gathering players, so the sweep doesn't need a caller. */
export async function fillWaitingLobbies(): Promise<number> {
  const waiting = await db
    .select({ id: simVentures.id })
    .from(simVentures)
    .where(and(
      eq(simVentures.phase, "filling"),
      /*
       * A cheap pre-filter only. `created_at` comes from the column's default,
       * which Postgres writes in the session's zone rather than UTC, so this
       * bound is loose by the server's offset — deliberately in the permissive
       * direction. `fillVentureWithBots` measures the real wait from when the
       * first person actually joined, and that one is exact.
       */
      lte(simVentures.createdAt, new Date(Date.now() - BOT_FILL_AFTER_SECONDS * 1000)),
    ))
    .limit(100);

  let seated = 0;
  for (const v of waiting) {
    try {
      seated += await fillVentureWithBots(v.id);
    } catch (err) {
      console.error(`[sim] filling lobby ${v.id} failed:`, err);
    }
  }
  return seated;
}

/**
 * File this year for every bot-held seat that hasn't filed one.
 *
 * Called just before a year resolves, so a person who files at the last second
 * is never overwritten by a bot that ran first — the insert names the seat's
 * own (venture, role, year) and does nothing if something is already there.
 *
 * `previous` is last year's decision, which is what `defaultDraft` builds a
 * form from: a bot carries its own plan forward and nudges it, rather than
 * starting from the company's current numbers every year.
 */
export async function fileBotDecisions(input: {
  companies: { id: string; company: Company }[];
  year: number;
  niche: Niche;
  /** The season, so a bot can answer the offers this season put in front of its company. */
  seasonId?: string;
  /** Everyone in the market, for the same reason. */
  world?: { companies: Company[]; periodsPerYear?: number };
  /**
   * How well these companies play. A season can ask for rivals that are
   * actually trying rather than warm bodies — see `BotSkill`.
   */
  skill?: BotSkill;
}): Promise<number> {
  const { companies, year, niche, seasonId, world, skill = "filler" } = input;
  if (companies.length === 0) return 0;
  const ventureIds = companies.map((c) => c.id);

  const seats = await db
    .select({ ventureId: simSeats.ventureId, userId: simSeats.userId, role: simSeats.role })
    .from(simSeats)
    .innerJoin(users, eq(users.id, simSeats.userId))
    .where(and(inArray(simSeats.ventureId, ventureIds), eq(users.isBot, true)));

  const botSeats = seats.filter((s) => s.role);
  if (botSeats.length === 0) return 0;

  // Last year's, to carry forward. Year one has none, and `defaultDraft`
  // handles that by starting from the company.
  const previous = year > 1
    ? await db
      .select({ ventureId: simDecisions.ventureId, role: simDecisions.role, payload: simDecisions.payload })
      .from(simDecisions)
      .where(and(inArray(simDecisions.ventureId, ventureIds), eq(simDecisions.year, year - 1)))
    : [];

  const cityIds = niche.cities.map((c) => c.id);
  let filed = 0;

  for (const seat of botSeats) {
    const company = companies.find((c) => c.id === seat.ventureId)?.company;
    if (!company) continue;
    const role = seat.role as Role;
    const last = previous.find((p) => p.ventureId === seat.ventureId && p.role === role)?.payload;

    const decision = botDecision({
      ventureId: seat.ventureId,
      year,
      role,
      company,
      previous: (last as Record<string, any>) ?? undefined,
      // So it can price what a choice costs, and aim at real regions and segments.
      niche,
      /*
       * And everyone else in the market. What to charge and who to aim at are
       * only decisions against somebody; without the rivals a bot files what
       * it always did, however skilled it is asked to be.
       */
      rivals: (world?.companies ?? []).filter((c) => c.id !== seat.ventureId),
      skill,
      // Every budget a bot sets is an annual one, and this is how often it is asked.
      periods: world?.periodsPerYear ?? 1,
    });

    /*
     * The year's offers, which a bot can only know about here: the season and
     * the market are what decide them. A bot chief executive puts every offer
     * to the table rather than deciding alone — the humans in the room should
     * get that call — and a bot in any other chair votes for a partnership and
     * against being bought.
     */
    if (seasonId && isUnlocked(role, role === "ceo" ? "deals" : "dealVotes", year, world?.periodsPerYear ?? 1)) {
      const offers = dealsFor({
        seasonId, year, company, niche,
        incumbents: (world?.companies ?? []).filter((c) => c.kind === "incumbent"),
        worth: valuation(company).fair,
      });
      if (offers.length > 0) {
        if (role === "ceo") decision.deals = Object.fromEntries(offers.map((o) => [o.id, "vote"]));
        else decision.dealVotes = Object.fromEntries(offers.map((o) => [o.id, o.kind === "buyout" ? "no" : "yes"]));
      }
    }

    const put = await db.insert(simDecisions)
      .values({
        ventureId: seat.ventureId,
        userId: seat.userId,
        role,
        year,
        // The same cleaning a person's submission goes through, so there is one
        // definition of what a seat may file and no second path that can drift.
        payload: cleanDecision(role, decision, cityIds, { year, periods: world?.periodsPerYear ?? 1, segmentIds: niche.segments.map((s) => s.id) }),
        // Passed, not defaulted: the column's DEFAULT now() is the session's clock, not UTC.
        submittedAt: new Date(),
      })
      /*
       * Never replaces. A person can hold a bot's seat after a takeover, and
       * more importantly a bot must not overwrite a decision filed a second
       * before the tick — the whole table would have watched their plan
       * disappear with no explanation.
       */
      .onConflictDoNothing({ target: [simDecisions.ventureId, simDecisions.role, simDecisions.year] })
      .returning({ id: simDecisions.id });

    if (put.length > 0) filed += 1;
  }

  return filed;
}

/**
 * Bid, for the companies whose chief executive is a bot.
 *
 * Called from the tick just before the auction settles, so a person who bids
 * in the last minute is never overwritten: the insert names the seat's own
 * (venture, listing, year) and does nothing if a bid is already there. Which
 * also makes it safe on a re-run — the second pass finds its own bid and
 * leaves it alone.
 *
 * Only the chief executive's chair is asked, because that is the seat the
 * market screen belongs to. A company with a person in that chair bids for
 * itself, whatever the other four seats are.
 */
export async function fileBotBids(input: {
  companies: { id: string; company: Company }[];
  listings: Listing[];
  year: number;
}): Promise<number> {
  const { companies, listings, year } = input;
  if (companies.length === 0 || listings.length === 0) return 0;

  const chairs = await db
    .select({ ventureId: simSeats.ventureId })
    .from(simSeats)
    .innerJoin(users, eq(users.id, simSeats.userId))
    .where(and(
      inArray(simSeats.ventureId, companies.map((c) => c.id)),
      eq(simSeats.role, "ceo"),
      eq(users.isBot, true),
    ));
  if (chairs.length === 0) return 0;

  let placed = 0;
  for (const chair of chairs) {
    const company = companies.find((c) => c.id === chair.ventureId)?.company;
    if (!company) continue;
    for (const bid of botBids({ ventureId: chair.ventureId, year, company, listings })) {
      const put = await db.insert(simBids)
        .values({ ventureId: bid.ventureId, listingId: bid.listingId, year, amount: bid.amount })
        .onConflictDoNothing({ target: [simBids.ventureId, simBids.listingId, simBids.year] })
        .returning({ id: simBids.id });
      if (put.length > 0) placed += 1;
    }
  }
  return placed;
}
