/**
 * The clock the simulation runs on: one real day is one simulated year.
 *
 * Two jobs, both idempotent, both safe to run from more than one process:
 *
 *   - **Settling lobbies.** A room only moved forward when somebody looked at
 *     it, which meant a room everyone abandoned sat in "waiting for players"
 *     for ever and its season could never start. Nothing else in the system
 *     was going to notice, because noticing required someone to be there.
 *   - **Resolving years.** Every season whose next tick is due gets its year
 *     run: decisions in, world out, a report per company, the year advanced.
 *
 * ## Why this is written to be re-runnable rather than run-once
 *
 * A tick does several writes — reports for six companies, a new world, a new
 * year — and a process can die in the middle of any of them. The choice is
 * between making that impossible and making it harmless. Impossible is a lie
 * on any system with more than one process, so: the engine is pure and
 * deterministic, reports are unique per company per year, and the year only
 * advances on a conditional update that names the year it expects to find. Run
 * the same tick twice and the second one does nothing.
 */
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db, pool } from "./db";
import {
  simSeasons, simVentures, simSeats, simDecisions, simReports,
  simChallenges, simListings, simBids, simRecoveryMoves, simOffers, users,
} from "@shared/schema";
import { nicheById } from "@shared/simulation/niches";
import { nicheForScope, type Scope } from "@shared/simulation/geography";
import { resolveYear } from "@shared/simulation/resolve";
import { ROLE_TITLES, repairCompany, type Role, type World } from "@shared/simulation/types";
import type { TeamDecisions } from "@shared/simulation/decisions";
import {
  buildWorld, decisionsForYear, economyFor, absenceNote, tickDueAt, seasonOver, DAY_MS,
} from "@shared/simulation/season";
import { advanceVenture } from "./simulation-routes";
import { fileBotBids, fileBotDecisions, fillWaitingLobbies } from "./simulation-bots";
import { marketListings, resolveBids, biddableFunds, type Bid, type Listing } from "@shared/simulation/assets";
import { applyRecovery, reviewCovenant, type RecoveryKind } from "@shared/simulation/recovery";
import { challengeFor, checkChallenge, applyReward, discretionarySpend, type Challenge } from "@shared/simulation/challenges";
import { applyAcquisition } from "@shared/simulation/mergers";
import { closeYear, stretchChallenge, whoWasRight } from "@shared/simulation/people";
import { takings } from "@shared/simulation/responsibilities";
import { applySeatMoves } from "./simulation-people";
import type { Company, CompanyAsset } from "@shared/simulation/types";

/** What the market did to one company in one year. */
type MarketOutcome = { kind: "won" | "lost" | "sold" | "unsold"; text: string };

/**
 * What happened at one lot, once the year is over.
 *
 * Bids are sealed while they can still be changed, and the rows are deleted
 * the moment they settle — so a team could lose a third of its cash at
 * auction and find no record of it anywhere afterwards but one line of prose.
 * This is the record: what was up, who bid, who took it and for how much.
 * Written after the auction has run, when there is nothing left to leak.
 */
export type AuctionRow = {
  listingId: string;
  name: string;
  kind: string;
  reserve: number;
  /** How many companies put money on it. */
  bidders: number;
  winner: string | null;
  winnerId: string | null;
  price: number | null;
  /** Filled in per company as the reports are written. */
  yourBid?: number | null;
};

/** Distinct from the backing jobs' lock ids so the two never wait on each other. */
const LOCK_SIM_TICK = 918_2711;

/**
 * How long a season waits between finishing its lobbies and year one.
 *
 * Long enough that the five people who just argued about seats are still
 * there to see the market they have walked into, short enough that nobody
 * closes the app first.
 */
const FIRST_YEAR_DELAY_MS = 2 * 60_000;

async function withLock<T>(key: number, run: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [key]);
    if (!rows[0]?.ok) return null; // Another process is already on it.
    try {
      return await run();
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [key]);
    }
  } finally {
    client.release();
  }
}

/**
 * How long one simulated year lasts in this season.
 *
 * A day, unless a company running a private training season asked for
 * minutes (`yearMinutes`, see sim_seasons in shared/schema.ts): a workshop
 * that meets for an afternoon cannot wait a day between years. Public seasons
 * never set it, so they are unchanged. Every place that schedules a year goes
 * through this, so the two clocks cannot drift apart.
 */
export const yearMsOf = (season: { yearMinutes: number | null }): number =>
  season.yearMinutes ? season.yearMinutes * 60_000 : DAY_MS;

/**
 * Push every stalled lobby forward.
 *
 * The room screens call this too, on every poll, which covers every room
 * somebody is watching. This covers the rest: the room where all five people
 * closed the tab, which otherwise waits for a deadline that nothing is
 * checking and holds up the season behind it.
 */
export async function settleLobbies(): Promise<number> {
  const stale = await db
    .select({ id: simVentures.id })
    .from(simVentures)
    .where(and(
      inArray(simVentures.phase, ["filling", "claiming", "naming"]),
      /*
       * A Date, compared through the column — not SQL's `now()`.
       *
       * `phase_ends_at` is a `timestamp` without a zone, and Drizzle writes a
       * JS Date into one as UTC. `now()` is a `timestamptz`, rendered in the
       * *database session's* zone, so comparing the two is out by that zone's
       * offset: on a database running in US Central every deadline looked five
       * hours further away than it was, and abandoned rooms sat there half a
       * day before anything swept them.
       *
       * Passing the Date to `lte` sends it through the same column mapper the
       * deadline was written with, so both sides are UTC by construction and
       * nothing depends on how either the database or this process is
       * configured. `(now() at time zone 'utc')` is equally correct and was
       * what stood here before; this is the version that does not require the
       * reader to know which way Drizzle writes.
       *
       * What is *not* equivalent, and cost me an afternoon: interpolating a
       * Date into a raw `sql` fragment. That skips the column mapper — the
       * driver serialises it as this process's local wall clock instead — and
       * puts the offset back in from the other direction. There is one such
       * fragment left in server/simulation-bots.ts, and it builds its cutoff
       * in SQL for exactly this reason.
       */
      lte(simVentures.phaseEndsAt, new Date()),
    ))
    .limit(200);

  for (const v of stale) {
    try {
      await advanceVenture(v.id);
    } catch (err) {
      console.error(`[sim] settling lobby ${v.id} failed:`, err);
    }
  }
  return stale.length;
}

/**
 * Start seasons whose rooms have all stopped arguing.
 *
 * A season waits for every one of its rooms to leave the lobby before year one
 * begins, so that everybody in a season lives through the same years. The wait
 * is bounded by the lobby's own deadlines — twenty minutes at the very worst —
 * and `settleLobbies` above guarantees they expire whether or not anyone is
 * watching, so this can never hang on an empty room. (Public matchmaking also
 * stops adding rooms to a season that has kept a ready room waiting; see
 * /api/sim/join.)
 *
 * Public seasons only. A company's training season is started by the company
 * (POST /api/companies/:id/seasons/:seasonId/start): its tables fill with bots
 * after a minute like any other, so "every room is out of the lobby" can be
 * true while half the workshop is still finding the link, and a season that
 * started itself then left them nowhere to sit.
 */
export async function startReadySeasons(): Promise<string[]> {
  /*
   * `abandoned` is in here as well as `forming`, and that is not tidiness.
   *
   * A season is abandoned when every room in it fell apart, which is a fair
   * thing to conclude and an unrecoverable one to be wrong about: the status
   * is read nowhere except here, so a season marked abandoned while a company
   * was still alive could never be started by anything, and the people in that
   * company sit on "waiting for year one" for ever. That happened in this
   * database — one room, one real chief executive, four bots, the company
   * running, the season abandoned around it — and nothing in the product could
   * have noticed, because noticing was this function's job and this function
   * had stopped looking at the season.
   *
   * So abandonment is treated as a conclusion rather than a fact: if the rooms
   * disagree with it, the rooms win. A season with a running company in it
   * starts, whatever its status says. One with nothing running is left alone.
   */
  const candidates = await db
    .select({ id: simSeasons.id })
    .from(simSeasons)
    .where(and(inArray(simSeasons.status, ["forming", "abandoned"]), isNull(simSeasons.companyId)))
    .limit(50);

  const started: string[] = [];
  for (const season of candidates) {
    try {
      const outcome = await startSeason(season.id);
      if (outcome.outcome === "started") started.push(season.id);
    } catch (err) {
      console.error(`[sim] starting season ${season.id} failed:`, err);
    }
  }

  await retireOrphanedRooms().catch((err) => console.error("[sim] retiring orphaned rooms failed:", err));
  return started;
}

export type StartOutcome =
  | { outcome: "started"; startsAt: Date; nextTickAt: Date; teams: number }
  /** Some room is still in its lobby. */
  | { outcome: "waiting"; rooms: number; ready: number }
  /** Nobody has sat down yet. */
  | { outcome: "empty" }
  /** Every room fell apart, or the market no longer exists. */
  | { outcome: "abandoned" }
  /** Already running or finished, or not there at all. */
  | { outcome: "not_forming" };

/**
 * Start one season, if every room in it is ready.
 *
 * ## Under the joiners' own locks
 *
 * Both ways into a season take an advisory lock for the whole of their
 * choose-a-room-and-sit-down transaction: public matchmaking locks the market
 * (so two joiners who both find no season cannot both make one), and a
 * company's invite code locks the season. Starting used to take neither. A
 * join that read "forming", and committed its new room a moment after this
 * read the season's rooms, left that room in a season that had started
 * without it: not in the world, so never resolved, its five people on
 * "waiting for year one" with nothing anywhere that would ever move them on.
 *
 * So this takes the same locks, in the same order a joiner would meet them —
 * market, then season — and reads the rooms again only once it holds them.
 * Any join has then either committed (and its room is counted, and holds the
 * season in "waiting" until it is ready) or has not begun (and will find the
 * season running: the public path matches only forming seasons, the code path
 * re-reads the status under the season lock and refuses). Rooms stranded by
 * the race before this existed are swept by `retireOrphanedRooms`.
 */
export async function startSeason(seasonId: string): Promise<StartOutcome> {
  const result = await db.transaction(async (tx): Promise<{ outcome: StartOutcome; world?: World; niche?: NonNullable<ReturnType<typeof nicheById>> }> => {
    const [peek] = await tx.select({ nicheId: simSeasons.nicheId, companyId: simSeasons.companyId })
      .from(simSeasons).where(eq(simSeasons.id, seasonId));
    if (!peek) return { outcome: { outcome: "not_forming" } };
    if (!peek.companyId) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${peek.nicheId}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`season:${seasonId}`}, 0))`);

    const [season] = await tx.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
    if (!season || (season.status !== "forming" && season.status !== "abandoned")) {
      return { outcome: { outcome: "not_forming" } };
    }

    const ventures = await tx
      .select({ id: simVentures.id, name: simVentures.name, phase: simVentures.phase })
      .from(simVentures)
      .where(eq(simVentures.seasonId, season.id));

    if (ventures.length === 0) return { outcome: { outcome: "empty" } };
    const live = ventures.filter((v) => v.phase !== "retired");
    // Still arguing. Come back next pass.
    if (live.some((v) => v.phase !== "running")) {
      return { outcome: { outcome: "waiting", rooms: live.length, ready: live.filter((v) => v.phase === "running").length } };
    }

    const playing = live;
    if (playing.length === 0) {
      // Every room fell apart. Nothing to run.
      if (season.status !== "abandoned") {
        await tx.update(simSeasons).set({ status: "abandoned" }).where(eq(simSeasons.id, season.id));
      }
      return { outcome: { outcome: "abandoned" } };
    }

    if (season.status === "abandoned") {
      console.warn(`[sim] season ${season.id} was abandoned with ${playing.length} company(s) still running; starting it anyway`);
    }

    const market = nicheById(season.nicheId);
    if (!market) {
      console.error(`[sim] season ${season.id} names a market that no longer exists: ${season.nicheId}`);
      if (season.status !== "abandoned") {
        await tx.update(simSeasons).set({ status: "abandoned" }).where(eq(simSeasons.id, season.id));
      }
      return { outcome: { outcome: "abandoned" } };
    }

    /*
     * The market as this season plays it.
     *
     * A season can be the market's own regions (every public one), the whole
     * map, or one continent of it. Scoping it here and once means the world
     * carries its own map from then on — the engine, the desks and the bots
     * all read `world.niche` and none of them has to know a season was scoped
     * at all.
     */
    const niche = nicheForScope(market, (season.scope ?? "home") as Scope);

    /*
     * Who is in each chair, and whether they are a person.
     *
     * The chief executive's chair decides where the company opens: a bot-run
     * company picks its own home (see `openingRegion`), a team with a person
     * in that chair gets the same defensible home every season. It is the
     * same rule the auction uses to decide who bids.
     */
    const seats = await tx
      .select({ ventureId: simSeats.ventureId, role: simSeats.role, isBot: users.isBot })
      .from(simSeats)
      .innerJoin(users, eq(users.id, simSeats.userId))
      .where(inArray(simSeats.ventureId, playing.map((v) => v.id)));

    const world = buildWorld({
      seasonId: season.id,
      niche,
      teams: playing.map((v) => ({
        id: v.id,
        name: v.name ?? "Unnamed",
        seats: seats.filter((s) => s.ventureId === v.id && s.role).map((s) => s.role as Role),
        botRun: seats.some((s) => s.ventureId === v.id && s.role === "ceo" && s.isBot),
      })),
    });

    const startsAt = new Date(Date.now() + FIRST_YEAR_DELAY_MS);
    const nextTickAt = tickDueAt(startsAt, 1, yearMsOf(season));
    // Conditional on the status still being the one that was read, so two
    // processes starting the same season at the same moment cannot both seed a
    // world. (The season lock already serialises them; this keeps the rule
    // true for any writer that does not take it.)
    const claimed = await tx
      .update(simSeasons)
      .set({ status: "running", year: 1, world, startsAt, nextTickAt })
      .where(and(eq(simSeasons.id, season.id), eq(simSeasons.status, season.status)))
      .returning({ id: simSeasons.id });
    if (claimed.length === 0) return { outcome: { outcome: "not_forming" } };

    return { outcome: { outcome: "started", startsAt, nextTickAt, teams: playing.length }, world, niche };
  });

  if (result.outcome.outcome === "started" && result.world && result.niche) {
    // Year one's objectives, so nobody's first day is the one day they have
    // nothing of their own to aim at. After the commit: these read the seats
    // through their own connections.
    await setChallenges({ world: result.world, year: 1 });
    await fileBotDecisionsFor(result.world, 1, result.niche, seasonId);
    console.log(`[sim] season ${seasonId} (${result.niche.name}) starts with ${result.outcome.teams} team(s)`);
  }
  return result.outcome;
}

/**
 * Close rooms stranded outside a season that has already started.
 *
 * A room belongs to a season's play only if it is in that season's world;
 * the world is fixed when the season starts. A room that is not in it — one
 * that sat down in the instant before the start, back when starting took none
 * of the joiners' locks — is never resolved, never finished, and never told
 * so: its people see "waiting for year one" for the rest of the season. Now
 * that `startSeason` takes those locks no new one can appear, but the ones
 * already out there will not close themselves.
 *
 * Retired rather than deleted, so anyone still sitting in one lands on the
 * ordinary "this table closed" screen and can join another.
 */
async function retireOrphanedRooms(): Promise<number> {
  const result: any = await db.execute(sql`
    update ${simVentures} v
       set phase = 'retired'
      from ${simSeasons} s
     where s.id = v.season_id
       and s.status in ('running', 'finished')
       and v.phase <> 'retired'
       and not exists (
         select 1 from jsonb_array_elements(coalesce(s.world->'companies', '[]'::jsonb)) c
          where c->>'id' = v.id
       )
  `);
  const count = result?.rowCount ?? 0;
  if (count > 0) console.warn(`[sim] retired ${count} room(s) left outside a season that had already started`);
  return count;
}

/**
 * Said to anyone who tries to change this year once it has started closing.
 *
 * From the moment a year is due until the tick has written the next one, the
 * tick is reading decisions, bids, listings and recovery moves — and anything
 * filed after it read them was accepted and then silently ignored, which is
 * worse than being refused: the person believes they acted. So the routes
 * that file those refuse with this instead, and the client can say "a moment"
 * rather than "something went wrong".
 */
export const YEAR_CLOSING = {
  code: "year_closing",
  message: "This year is closing — it'll open for next year in a moment.",
} as const;

/** Whether a season's current year is due, and so no longer taking changes. */
export const yearClosing = (season: { nextTickAt: Date | null }, now = new Date()): boolean =>
  !!season.nextTickAt && now.getTime() >= season.nextTickAt.getTime();

/**
 * Resolve one year for one season.
 *
 * Returns the year that was resolved, or null if there was nothing to do —
 * which is the normal answer when another process got there first.
 *
 * ## One tick per season at a time, whoever asks
 *
 * The minute job used to be the only caller, and it runs under its own lock,
 * so "the whole tick is inside an advisory lock" was true and several things
 * below leaned on it. Then two buttons arrived — a developer's "advance year"
 * and a company's "end this year now" — and both called this directly. A
 * double-click, or a click landing while the minute's pass was mid-tick, ran
 * the same year twice at once. The conditional update on the year meant only
 * one of them saved a world, but everything either had already written stood:
 * the loser's marketplace withdrew and settled listings against its own copy
 * of the world, so a seller could see their asset marked sold to a buyer whose
 * purchase was then thrown away, and every fire sale was listed twice.
 *
 * So the lock lives here, where no caller can go round it: a session advisory
 * lock keyed on the season, on a connection of its own. It *waits* rather
 * than giving up — the second caller blocks until the first has committed,
 * then reads the season afresh, finds the year already moved on and its next
 * tick not due, and returns null having written nothing. That is the no-op
 * the callers already handle (the manual routes report the year as it now
 * stands), and it is decided by the database rather than by timing.
 *
 * Keyed with a prefix of its own so it never collides with the join paths'
 * `season:<id>` transaction lock, which guards something else entirely.
 */
export async function tickSeason(seasonId: string, now = new Date()): Promise<number | null> {
  const key = `sim_tick:${seasonId}`;
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [key]);
    try {
      return await resolveSeasonYear(seasonId, now);
    } finally {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key]);
      } catch (err) {
        // A connection that cannot unlock is thrown away rather than pooled
        // with the lock still on it; closing it releases the lock.
        broken = err as Error;
      }
    }
  } finally {
    client.release(broken);
  }
}

async function resolveSeasonYear(seasonId: string, now: Date): Promise<number | null> {
  const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
  if (!season || season.status !== "running" || !season.world) return null;
  if (!season.nextTickAt || season.nextTickAt > now) return null;

  const market = nicheById(season.nicheId);
  if (!market) return null;
  /*
   * Scoped the same way it was when the world was built, for the same reason
   * the market itself is re-attached below: the map a season plays on is the
   * season's, and the balance inside it is the code's.
   */
  const niche = nicheForScope(market, (season.scope ?? "home") as Scope);

  const year = season.year;
  const stored = season.world as World;
  /*
   * The niche is re-attached from code rather than trusted from the stored
   * world. Segments and incumbent behaviour are balance, and balance gets
   * edited; a season that stored a copy in year one would keep playing last
   * month's balance for a fortnight, and two seasons running side by side
   * would be playing different games.
   */
  /*
   * Repaired on the way in. A world saved while the engine could still spread
   * a NaN would otherwise carry it forever — every tick reading the broken
   * figure, producing another, and writing it back, with nothing recovering on
   * its own.
   */
  const world: World = { ...stored, niche, year, companies: (stored.companies ?? []).map(repairCompany) };

  let teams = world.companies.filter((c) => c.kind === "player");
  if (teams.length === 0) return null;

  /*
   * Each company's cash at every point the tick moves money, so the year's
   * cash bridge can name every step. The engine accounts for the year itself;
   * these are the steps either side of it — deals and rescues before, rewards
   * and the marketplace after — and a bridge that left them out would not
   * land on the bank balance the team actually has.
   */
  const cashNow = (companies: Company[]) => new Map(companies.map((c) => [c.id, c.cash]));
  const cashAtStart = cashNow(world.companies);

  /*
   * Recovery moves happen before the year does.
   *
   * A team that sold everything to stay solvent has to face this year without
   * those assets, not after it — otherwise the move is free for one more year
   * and the whole arc has a twelve-month grace period in it.
   */
  const recoveryNotes = new Map<string, string[]>();
  const addNote = (id: string, ...lines: string[]) =>
    recoveryNotes.set(id, [...(recoveryNotes.get(id) ?? []), ...lines]);

  /*
   * Acquisitions settle first, before anything else touches the world.
   *
   * A company that was bought has no customers this year and the buyer has
   * twice as many; running the year first and then moving the business would
   * resolve a market that no longer exists. Ordered ahead of recovery moves
   * too, since being paid for the business is exactly the kind of thing that
   * makes a fire sale unnecessary.
   */
  const accepted = await db
    .select()
    .from(simOffers)
    .where(and(
      eq(simOffers.seasonId, seasonId),
      eq(simOffers.year, year),
      eq(simOffers.status, "accepted"),
    ));

  const soldThisTick = new Set<string>();
  const boughtThisTick = new Set<string>();
  /*
   * Settled oldest first, so which of two acceptances lands is a fact about
   * when people agreed rather than about what order Postgres felt like
   * returning rows in. A company changing hands for millions should not turn
   * on that.
   */
  for (const offer of [...accepted].sort((a, b) => a.id < b.id ? -1 : 1)) {
    const buyer = world.companies.find((c) => c.id === offer.fromVentureId);
    const seller = world.companies.find((c) => c.id === offer.toVentureId);
    if (!buyer || !seller || buyer.kind !== "player" || seller.kind !== "player") continue;
    /*
     * A company is sold once and buys once, however many acceptances reach
     * here.
     *
     * The seller half was already guarded. The buyer half was written and then
     * never armed — `soldThisTick.has(buyer.id)` was checked and no buyer was
     * ever added to it — so one team could hold two offers open at three
     * million each with three million in reach, have both accepted, and pay
     * six. Nothing moved between the two acceptances, so the affordability
     * check the route ran passed both times against the same money.
     *
     * One purchase a year is also the right rule on its own terms: an
     * acquisition is supposed to be the decision that costs you your own year.
     */
    if (soldThisTick.has(seller.id) || boughtThisTick.has(buyer.id)) continue;
    /*
     * And a company that has just sold its own business is not in a position
     * to buy one in the same breath — it has a cheque and no operation, and
     * letting it round-trip would make "sell to fund a purchase" a free move.
     */
    if (soldThisTick.has(buyer.id)) {
      addNote(buyer.id, `Your agreement to buy ${seller.name} fell through: you sold your own business this year, and the two cannot happen at once.`);
      addNote(seller.id, `${buyer.name} could not complete — they sold their own business the same year. You keep everything.`);
      await db.update(simOffers).set({ status: "lapsed" }).where(eq(simOffers.id, offer.id));
      continue;
    }

    /*
     * Can they still pay for it?
     *
     * The route checked when the offer was made, against a world that has
     * since had a year run through it. A buyer who agreed to three million in
     * a good year and arrives here insolvent must not complete — the seller
     * would be handing over a business for money that does not exist.
     */
    const reach = buyer.cash + Math.max(0, buyer.creditLimit - buyer.debt);
    if (offer.amount > reach) {
      addNote(buyer.id, `Your agreement to buy ${seller.name} for ${offer.amount.toLocaleString()} fell through — the year left you unable to pay it.`);
      addNote(seller.id, `${buyer.name} agreed to buy the business and could not raise the money. You keep everything, including the year you spent expecting otherwise.`);
      await db.update(simOffers).set({ status: "lapsed" }).where(eq(simOffers.id, offer.id));
      continue;
    }

    soldThisTick.add(seller.id);
    boughtThisTick.add(buyer.id);

    const out = applyAcquisition({ buyer, seller, amount: offer.amount, year });
    world.companies = world.companies.map((c) =>
      c.id === buyer.id ? out.buyer : c.id === seller.id ? out.seller : c);
    addNote(buyer.id, ...out.buyerNotes);
    addNote(seller.id, ...out.sellerNotes);
  }

  const cashAfterDeals = cashNow(world.companies);

  /*
   * Everything still sitting unanswered stops being an offer. A live offer
   * would otherwise tie up a rival's decision-making for a fortnight at no
   * cost to the buyer, and the answer to "do you want to sell" changes every
   * time the market does.
   */
  await db.update(simOffers)
    .set({ status: "lapsed" })
    .where(and(eq(simOffers.seasonId, seasonId), eq(simOffers.year, year), eq(simOffers.status, "pending")));

  const moves = await db
    .select()
    .from(simRecoveryMoves)
    .where(and(inArray(simRecoveryMoves.ventureId, teams.map((t) => t.id)), eq(simRecoveryMoves.year, year)));

  const releasedByTeam = new Map<string, CompanyAsset[]>();

  for (const move of moves) {
    const company = world.companies.find((c) => c.id === move.ventureId);
    if (!company || company.kind !== "player") continue;
    const out = applyRecovery({ company, kind: move.kind as RecoveryKind, year, seat: move.seat ?? undefined });
    world.companies = world.companies.map((c) => (c.id === company.id ? out.company : c));
    addNote(company.id, ...out.notes);
    if (out.released.length > 0) releasedByTeam.set(company.id, out.released);
  }
  teams = world.companies.filter((c) => c.kind === "player");
  const cashAfterRecovery = cashNow(world.companies);

  /*
   * A safety net: bots normally filed when the year opened (see
   * `fileBotDecisionsFor`). This catches any seat that didn't — a filing that
   * failed, a season from before bots filed early — so a bot never abstains,
   * which is the thing filling the room was meant to prevent. Idempotent: a
   * seat that has already filed is left exactly as it is.
   */
  await fileBotDecisions({
    companies: teams.map((t) => ({ id: t.id, company: t })),
    year,
    niche,
    seasonId,
    world,
  }).catch((err) => console.error(`[sim] bot decisions for season ${seasonId} failed:`, err));

  /*
   * Everything submitted for this year, and each seat's most recent filing
   * before it.
   *
   * "Before it" used to mean "last year" and nothing older. That is fine for a
   * seat that missed one year and ruinous for a seat that missed two: in year
   * three the operations chair that last filed in year one had no row in year
   * two, so its caretaker was handed nothing — and nothing, to the engine, is
   * a headcount of zero, no support spend, no capacity plan. Everybody fired
   * because the person was away for a weekend, while the colleagues who did
   * file (and so kept the "previous" year non-empty) watched it happen.
   *
   * So each role's fallback is that role's own last real decision, however far
   * back it was — the same rule the comment below has always promised. A role
   * that has never filed at all has no decision to fall back on, and
   * `decisionsForYear` gives it the opening plan for that key alone.
   */
  const rows = await db
    .select({ ventureId: simDecisions.ventureId, role: simDecisions.role, year: simDecisions.year, payload: simDecisions.payload })
    .from(simDecisions)
    .where(and(
      inArray(simDecisions.ventureId, teams.map((t) => t.id)),
      lte(simDecisions.year, year),
    ));

  const decisions: TeamDecisions[] = [];
  const absences = new Map<string, { absent: Role[]; seats: number }>();
  /** Overrules, with what the overruled seat had filed, so the year can be run the other way. */
  const overrules = new Map<string, { role: Role; filed: any }>();

  for (const team of teams) {
    const submitted: Partial<Record<Role, any>> = {};
    const previousParts: Partial<Record<Role, any>> = {};
    const previousYear: Partial<Record<Role, number>> = {};
    for (const r of rows) {
      if (r.ventureId !== team.id) continue;
      const role = r.role as Role;
      if (r.year === year) submitted[role] = r.payload;
      else if (r.year < year && r.year > (previousYear[role] ?? 0)) {
        previousParts[role] = r.payload;
        previousYear[role] = r.year;
      }
    }

    /*
     * Last year's plan is rebuilt from what was submitted then, not from a
     * stored copy of what the caretaker ran. Otherwise a team that misses two
     * years in a row has its spending multiplied down twice — 60% of 60% — and
     * a fortnight's absence compounds into a company nobody can rescue. One
     * step down from the last real decision is the fair reading of silence,
     * however long the silence goes on.
     */
    const previous: TeamDecisions | undefined = year > 1 && Object.keys(previousParts).length > 0
      ? { companyId: team.id, ...previousParts } as TeamDecisions
      : undefined;

    const { decisions: theirs, absent, overruled } = decisionsForYear({
      company: team,
      niche,
      submitted,
      previous,
    });
    decisions.push(theirs);
    if (absent.length > 0) absences.set(team.id, { absent, seats: team.seats.length });
    if (overruled) overrules.set(team.id, overruled);
  }

  const economy = economyFor(seasonId, year);
  const { world: nextWorld, reports } = resolveYear(world, decisions, economy);

  // Name the empty chairs, so a thin year has an explanation attached to it.
  for (const report of reports) {
    const gap = absences.get(report.companyId);
    const note = gap ? absenceNote(gap.absent, ROLE_TITLES, gap.seats) : null;
    if (note) report.notes = [note, ...report.notes];
    // And what a recovery move did, which happened before any of this.
    const rescue = recoveryNotes.get(report.companyId);
    if (rescue) report.notes = [...rescue, ...report.notes];
  }

  /*
   * Everything that happens *because* of the year, in the order it has to.
   *
   * Challenges are marked against the report, then their rewards land on the
   * company; covenants are reviewed against what was actually spent; and the
   * marketplace settles last, because a challenge reward can be the credit
   * that makes a bid affordable. Reordering these changes outcomes, so the
   * order is fixed here rather than left to whoever reads it next.
   */
  const challengeResults = await markChallenges({ ventureIds: teams.map((t) => t.id), year, reports, world: nextWorld, decisions });
  for (const [ventureId, results] of challengeResults) {
    const report = reports.find((r) => r.companyId === ventureId);
    // Every seat's, not whichever one the database happened to return last.
    for (const result of results) {
      const company = nextWorld.companies.find((c) => c.id === ventureId);
      if (!company) continue;
      nextWorld.companies = nextWorld.companies.map((c) => (c.id === ventureId ? applyReward(c, result.reward) : c));
      if (report) report.notes.push(result.note);
    }
  }

  const cashAfterRewards = cashNow(nextWorld.companies);

  /*
   * The people side of the year: who was right about an overrule (the year
   * run again the other way, without its news, so only the one decision
   * differs), loyalty from each seat's objective, the bonus pot, the
   * executive market, and resignations. See `closeYear` in people.ts.
   */
  const verdicts = new Map<string, { role: Role; right: "ceo" | "seat" }>();
  for (const [ventureId, o] of overrules) {
    try {
      const asRun = resolveYear(world, decisions, economy, { withoutEvent: true });
      const otherWay = resolveYear(world, decisions.map((d) => d.companyId === ventureId ? { ...d, [o.role]: o.filed } : d), economy, { withoutEvent: true });
      const worth = (r: typeof asRun) => r.reports.find((x) => x.companyId === ventureId)?.founderValue ?? 0;
      verdicts.set(ventureId, { role: o.role, right: whoWasRight(worth(asRun), worth(otherWay)) });
    } catch (err) {
      console.error(`[sim] judging the overrule for ${ventureId} failed:`, err);
    }
  }
  const outcomes = new Map<string, { role: Role; outcome: "met" | "partial" | "missed" }[]>();
  for (const [ventureId, results] of challengeResults) outcomes.set(ventureId, results.map((r) => ({ role: r.role, outcome: r.outcome })));
  const closed = closeYear({ seasonId, year, companies: nextWorld.companies, decisions: decisions as any, outcomes, verdicts });
  nextWorld.companies = closed.companies;
  for (const [ventureId, lines] of closed.notes) {
    const report = reports.find((r) => r.companyId === ventureId);
    if (report) report.notes.push(...lines);
  }
  const cashAfterPeople = cashNow(nextWorld.companies);

  // Covenants, against what the team actually spent rather than what it planned.
  for (const company of nextWorld.companies) {
    if (company.kind !== "player" || !company.covenant) continue;
    const theirs = decisions.find((d) => d.companyId === company.id);
    /*
     * The same sum the challenge targets use, plus what opening a city cost.
     *
     * A cap that ignored either would be a cap in name only: a team could
     * agree to one, then spend freely on research and on opening half the
     * country, and meet the creditor's terms on paper while doing exactly what
     * the terms exist to stop.
     */
    const before = world.companies.find((c) => c.id === company.id);
    const openedThisYear = niche.cities
      .filter((city) =>
        (theirs?.cmo?.targetCities ?? []).includes(city.id) &&
        !(before?.cities ?? niche.cities.map((c) => c.id)).includes(city.id))
      .reduce((sum, city) => sum + city.entryCost, 0);
    const spent = discretionarySpend(theirs) + openedThisYear;
    const review = reviewCovenant(company.covenant, spent);
    nextWorld.companies = nextWorld.companies.map((c) =>
      c.id === company.id ? { ...c, covenant: review.covenant } : c);
    const report = reports.find((r) => r.companyId === company.id);
    if (report && review.note) report.notes.push(review.note);
  }

  // The marketplace settles, and things change hands.
  const { notes: marketNotes, writes: marketWrites, auctions, bidsBy } = await settleMarket({ seasonId, year, niche, world: nextWorld, releasedByTeam });
  for (const [ventureId, outcomes] of marketNotes) {
    const report = reports.find((r) => r.companyId === ventureId);
    if (report) report.market = outcomes;
  }
  /*
   * And the year's auctions as a record rather than as prose, each company's
   * own bid beside the result. Every team gets the same rows: the seal is on
   * a bid that can still be changed, and this is written once it cannot.
   */
  if (auctions.length > 0) {
    for (const report of reports) {
      const mine = bidsBy.get(report.companyId);
      report.auctions = auctions.map((row) => ({ ...row, yourBid: mine?.get(row.listingId) ?? null }));
    }
  }

  /*
   * Bring the reports back in line with the world that is about to be saved.
   *
   * `resolveYear` builds each report from the year it just resolved, and then
   * the tick carries on: challenge rewards land on companies, covenants are
   * reviewed, and the marketplace moves cash and assets between teams. All of
   * that changes what gets stored and none of it reached the report — so a
   * team could be paid for a challenge, win an asset at auction, and read a
   * figure that matched neither the money they had before nor the money they
   * had after. The report is the year's record; it has to describe the year
   * that was kept.
   *
   * The trading figures are deliberately left alone. Revenue, costs and profit
   * are what the company earned and spent trading, and a cheque for finishing
   * a challenge is not revenue.
   */
  for (const report of reports) {
    const company = nextWorld.companies.find((c) => c.id === report.companyId);
    if (!company) continue;
    const units = Object.values(company.customers).reduce((sum, n) => sum + n, 0);

    /*
     * The cash bridge, extended to the steps outside the engine. Each is the
     * change in cash across one stage, named for what the stage was — so a
     * team that sold its business, or won a lot at auction, sees that as a
     * line rather than a total that silently disagrees with the one above it.
     */
    if (report.cashBridge) {
      const bridge = report.cashBridge;
      const step = (from: Map<string, number>, to: Map<string, number>) =>
        (to.get(company.id) ?? 0) - (from.get(company.id) ?? 0);
      const before: { label: string; amount: number }[] = [];
      const deal = step(cashAtStart, cashAfterDeals);
      if (Math.abs(deal) >= 1) before.push({ label: deal > 0 ? "Sold the business" : "Bought a business", amount: deal });
      const rescue = step(cashAfterDeals, cashAfterRecovery);
      if (Math.abs(rescue) >= 1) before.push({ label: "Recovery move", amount: rescue });

      const after: { label: string; amount: number }[] = [];
      const rewards = (cashAfterRewards.get(company.id) ?? 0) - bridge.closing;
      if (Math.abs(rewards) >= 1) after.push({ label: "Objectives met", amount: rewards });
      const people = (cashAfterPeople.get(company.id) ?? 0) - (cashAfterRewards.get(company.id) ?? 0);
      if (Math.abs(people) >= 1) after.push({ label: "Bonuses and hiring", amount: people });
      const market = company.cash - (cashAfterPeople.get(company.id) ?? company.cash);
      if (Math.abs(market) >= 1) after.push({ label: "The marketplace", amount: market });

      bridge.opening = cashAtStart.get(company.id) ?? bridge.opening;
      bridge.lines = [...before, ...bridge.lines, ...after];
      bridge.closing = company.cash;
      // Anything else — there should be nothing — is shown rather than hidden.
      const residual = bridge.closing - bridge.opening - bridge.lines.reduce((sum, l) => sum + l.amount, 0);
      if (Math.abs(residual) >= 1) bridge.lines.push({ label: "Other", amount: residual });
    }
    const assets = company.assets.reduce((sum, a) => sum + a.bookValue * 0.8, 0);

    report.cash = company.cash;
    report.debt = company.debt;
    report.reputation = company.reputation;
    report.quality = company.quality;
    report.brand = company.brand;
    report.service = company.service;
    report.founderShare = company.founderShare ?? 1;
    // What its customers actually pay, tier by tier — the same valuation the engine uses.
    report.value = Math.max(0, Math.round(takings(company, company.customers, niche.segments).revenue * 1.2 + assets - company.debt));
    void units;
    report.founderValue = Math.round(report.value * report.founderShare);
    report.bankrupt = !!company.bankruptSince;
  }

  const finished = seasonOver(year + 1, season.totalYears);
  const yearMs = yearMsOf(season);
  let startsAt = season.startsAt;
  let nextTickAt = startsAt && !finished ? tickDueAt(startsAt, year + 1, yearMs) : null;
  /*
   * Never schedule the next year in the past.
   *
   * The schedule is counted from the season's start, so after a stretch of
   * downtime — a deploy that took the night, a database that was away — every
   * year the clock thinks should have happened is already overdue, and the
   * minute job resolved them one a minute, back to back. A table that closed
   * the app on year three came back to year seven, with four years of
   * caretaker decisions made for them and nobody having been given a day to
   * read any of it.
   *
   * So when the next due time has already passed, the clock is moved rather
   * than obeyed: the start shifts so that the coming year lasts a full year
   * from now, exactly as a manual advance does (server/season-control.ts).
   * The years that were missed are not made up; they were never played.
   */
  if (startsAt && nextTickAt && nextTickAt.getTime() <= now.getTime()) {
    startsAt = new Date(now.getTime() - year * yearMs);
    nextTickAt = tickDueAt(startsAt, year + 1, yearMs);
  }

  let saved = false;
  await db.transaction(async (tx) => {
    /*
     * Reports first, then the year. If this dies in between, the next pass
     * resolves the same year again: the engine is deterministic so it produces
     * the same reports, the unique index drops the duplicates, and the year
     * advances on the retry. The other order would lose a year's reports with
     * no way to tell they were missing.
     */
    await tx.insert(simReports).values(reports.map((r) => ({
      seasonId,
      ventureId: teams.some((t) => t.id === r.companyId) ? r.companyId : null,
      companyId: r.companyId,
      year,
      report: r,
    }))).onConflictDoNothing();

    const advanced = await tx
      .update(simSeasons)
      .set({
        world: { ...nextWorld, year: year + 1 },
        year: year + 1,
        nextTickAt,
        startsAt,
        status: finished ? "finished" : "running",
      })
      .where(and(eq(simSeasons.id, seasonId), eq(simSeasons.year, year)))
      .returning({ id: simSeasons.id });

    // Another process resolved this year while we were working. Its writes are
    // identical to ours, so there is nothing to correct — just nothing to do.
    if (advanced.length === 0) return;
    saved = true;

    /*
     * The marketplace's writes, now that the year is known to have moved —
     * in the same transaction, so a listing is marked sold if and only if the
     * world that paid for it is the one that was saved. See `MarketWrites`.
     */
    for (const { id, set } of marketWrites.listings) {
      await tx.update(simListings).set(set).where(eq(simListings.id, id));
    }
    if (marketWrites.spentBids && marketWrites.spentBids.listingIds.length > 0) {
      await tx.delete(simBids).where(and(
        eq(simBids.year, marketWrites.spentBids.year),
        inArray(simBids.listingId, marketWrites.spentBids.listingIds),
      ));
    }
    if (marketWrites.fireSales.length > 0) {
      await tx.insert(simListings).values(marketWrites.fireSales);
    }

    /*
     * Each venture keeps a copy of its own company for the screens, written in
     * the same transaction as the world it came from. Derived, never the
     * source: the season's world is what the next tick reads.
     */
    for (const company of nextWorld.companies) {
      if (company.kind !== "player") continue;
      await tx.update(simVentures)
        .set({ state: company, phase: finished ? "retired" : "running" })
        .where(eq(simVentures.id, company.id));
    }
  });

  /*
   * Seats change hands only once the year that caused it is saved, and only by
   * the process that saved it — so a retried year never moves anybody twice.
   */
  if (saved && closed.moves.length > 0) await applySeatMoves({ seasonId, year, moves: closed.moves });

  // Next year's objectives, set against where each company now stands.
  if (!finished) await setChallenges({ world: nextWorld, year: year + 1 });
  if (!finished) await fileBotDecisionsFor(nextWorld, year + 1, niche, seasonId);

  return year;
}

/**
 * Set each seat's objective for the coming year.
 *
 * Written down rather than recomputed on demand. `challengeFor` is pure, but
 * it reads the company's position — and that position changes the moment the
 * year resolves, so a challenge regenerated later would quietly become a
 * different challenge and a player would be marked against a target they were
 * never shown.
 */
/**
 * Bots file the moment a year opens, not at the end of it.
 *
 * They used to file only as the year resolved. For the whole of the day in
 * between, every bot seat sat on the desk as "still deciding" and the
 * committed-spend preview — the number the finance seat reads to see whether
 * the table is about to overspend — left out everything the bots were going to
 * spend. A person cannot react to a plan they cannot see, and the day is
 * exactly when they are trying to.
 *
 * Never fatal: a season must start, and a year must open, even if the bots'
 * filing fails. The resolution-time call catches anything missed here.
 */
async function fileBotDecisionsFor(world: World, year: number, niche: any, seasonId: string): Promise<void> {
  const teams = world.companies.filter((c) => c.kind === "player");
  await fileBotDecisions({ companies: teams.map((t) => ({ id: t.id, company: t })), year, niche, seasonId, world })
    .catch((err) => console.error(`[sim] bot decisions for season ${seasonId} year ${year} failed:`, err));
}

async function setChallenges(input: { world: World; year: number }): Promise<void> {
  const { world, year } = input;
  const players = world.companies.filter((c) => c.kind === "player");
  if (players.length === 0) return;

  const seats = await db
    .select({ ventureId: simSeats.ventureId, userId: simSeats.userId, role: simSeats.role })
    .from(simSeats)
    .where(inArray(simSeats.ventureId, players.map((p) => p.id)));

  const rows = [];
  for (const seat of seats) {
    if (!seat.role) continue;
    const company = players.find((p) => p.id === seat.ventureId);
    // A dissolved seat has nobody to set an objective for.
    if (!company || !company.seats.includes(seat.role as Role)) continue;
    rows.push({
      ventureId: seat.ventureId,
      userId: seat.userId,
      role: seat.role,
      year,
      // Pushed as hard as the chief executive set it (see `stretchChallenge`).
      challenge: stretchChallenge(
        challengeFor({ company, world, role: seat.role as Role, year, ventureId: seat.ventureId }),
        company.people?.[seat.role as Role]?.stretch,
      ),
    });
  }

  if (rows.length > 0) await db.insert(simChallenges).values(rows).onConflictDoNothing();
}

/**
 * Mark the year's objectives, one per seat.
 *
 * ## Keyed by company, holding a list
 *
 * This returned a `Map<ventureId, result>` and wrote into it once per
 * challenge row. There are up to five rows per company per year — one per seat,
 * which is the whole point of them — so each seat's result overwrote the last
 * and four of the five were silently dropped on the floor.
 *
 * Every seat's row was still updated, so all five players saw "done" on their
 * own desk. The company was paid once. The year's report carried one note
 * instead of five. A table where all five people met their objective got a
 * fifth of what they had earned, and the desk says in as many words: "Everyone
 * on the team gets it — that is why they want you to win yours."
 *
 * A list per company, and the caller pays every one of them.
 */
async function markChallenges(input: {
  ventureIds: string[];
  year: number;
  reports: { companyId: string }[];
  world: World;
  decisions: TeamDecisions[];
}): Promise<Map<string, ReturnType<typeof checkChallenge>[]>> {
  const { ventureIds, year, world, decisions } = input;
  const out = new Map<string, ReturnType<typeof checkChallenge>[]>();
  if (ventureIds.length === 0) return out;

  const set = await db
    .select()
    .from(simChallenges)
    .where(and(inArray(simChallenges.ventureId, ventureIds), eq(simChallenges.year, year)));

  for (const row of set) {
    const company = world.companies.find((c) => c.id === row.ventureId);
    const report = (input.reports as any[]).find((r) => r.companyId === row.ventureId);
    if (!company || !report) continue;

    const result = checkChallenge({
      challenge: row.challenge as Challenge,
      report,
      company,
      decisions: decisions.find((d) => d.companyId === row.ventureId),
    });

    await db.update(simChallenges)
      .set({ result, outcome: result.outcome })
      .where(eq(simChallenges.id, row.id));

    const theirs = out.get(row.ventureId);
    if (theirs) theirs.push(result);
    else out.set(row.ventureId, [result]);
  }

  return out;
}

/**
 * What settling the marketplace wants written, held back until the year is
 * known to advance.
 *
 * Settlement used to write as it went — listings marked sold or withdrawn,
 * bids deleted, fire-sold assets listed for next year — all before the
 * transaction that advances the year. A tick that died after those writes and
 * before the commit left them standing against a year that had not moved, and
 * the retry then ran against a different database: the bids it should have
 * resolved were gone, so the winners it had already credited in the discarded
 * world were never credited in the saved one, and the sellers whose listings
 * said "sold" were never paid. Held here and applied inside the year's own
 * transaction, they land exactly when the world they describe does, or not at
 * all.
 */
interface MarketWrites {
  listings: { id: string; set: Partial<typeof simListings.$inferInsert> }[];
  fireSales: (typeof simListings.$inferInsert)[];
  spentBids: { year: number; listingIds: string[] } | null;
}

/**
 * The marketplace, settled.
 *
 * Bids are sealed until this moment: everyone committed a number without
 * seeing anyone else's, and the highest one over the reserve takes it. What
 * makes this safe to re-run is that the open market's listings are generated
 * from the season and year rather than stored, so the same tick run twice
 * deals the same hand and awards the same things — and that nothing here
 * writes to the database: the changes come back as `writes`, for the caller to
 * apply in the transaction that advances the year.
 */
async function settleMarket(input: {
  seasonId: string;
  year: number;
  niche: NonNullable<ReturnType<typeof nicheById>>;
  world: World;
  releasedByTeam: Map<string, CompanyAsset[]>;
}): Promise<{ notes: Map<string, MarketOutcome[]>; writes: MarketWrites; auctions: AuctionRow[]; bidsBy: Map<string, Map<string, number>> }> {
  const { seasonId, year, niche, world, releasedByTeam } = input;
  const notes = new Map<string, MarketOutcome[]>();
  const auctions: AuctionRow[] = [];
  /** What each company offered, by listing, kept for the record written below. */
  const bidsBy = new Map<string, Map<string, number>>();
  const writes: MarketWrites = { listings: [], fireSales: [], spentBids: null };
  const add = (id: string, kind: MarketOutcome["kind"], text: string) =>
    notes.set(id, [...(notes.get(id) ?? []), { kind, text }]);

  const open = await db
    .select()
    .from(simListings)
    .where(and(eq(simListings.seasonId, seasonId), eq(simListings.year, year), eq(simListings.status, "open")));

  /*
   * Which listings a fire sale put up. Kept beside the engine's `Listing`
   * rather than on it: the auction itself treats every lot the same, and the
   * only differences — who owns the thing, and who is paid — are this
   * function's business.
   */
  const forced = new Set(open.filter((row) => row.forced).map((row) => row.id));

  const listings: Listing[] = [
    ...marketListings({ seasonId, year, niche }),
    ...open.map((row) => ({
      id: row.id,
      asset: row.asset as CompanyAsset,
      blurb: row.forced ? "From a fire sale." : "Second-hand.",
      reserve: row.reserve,
      sellerId: row.sellerId,
    })),
  ];

  if (listings.length > 0) {
    /*
     * The bot-run companies bid last, and only now: a sealed auction means
     * nobody sees anybody else's number, and the bots are held to that too —
     * their bids are seeded on the venture and the year, not on what is already
     * in the table. A human's bid for the same lot is never replaced.
     *
     * Inside the guard, because with nothing on the market there is nothing to
     * bid on, and an empty auction should cost no work at all.
     */
    await fileBotBids({
      companies: world.companies.filter((c) => c.kind === "player").map((c) => ({ id: c.id, company: c })),
      listings,
      year,
    });

    const bidRows = await db
      .select()
      .from(simBids)
      .where(and(eq(simBids.year, year), inArray(simBids.listingId, listings.map((l) => l.id))));

    const funds: Record<string, number> = {};
    for (const company of world.companies) {
      if (company.kind === "player") funds[company.id] = biddableFunds(company);
    }

    const bids: Bid[] = bidRows.map((b) => ({ ventureId: b.ventureId, listingId: b.listingId, amount: b.amount }));
    const awards = resolveBids(listings, bids, funds);

    for (const b of bids) {
      const mine = bidsBy.get(b.ventureId) ?? new Map<string, number>();
      mine.set(b.listingId, b.amount);
      bidsBy.set(b.ventureId, mine);
    }

    for (const award of awards) {
      const listing = listings.find((l) => l.id === award.listingId)!;
      const nameOf = (id: string | null) => world.companies.find((c) => c.id === id)?.name ?? null;
      auctions.push({
        listingId: listing.id,
        name: listing.asset.name,
        kind: listing.asset.kind,
        reserve: listing.reserve,
        bidders: bids.filter((b) => b.listingId === listing.id).length,
        winner: award.winnerId ? nameOf(award.winnerId) : null,
        winnerId: award.winnerId ?? null,
        price: award.winnerId ? award.price : null,
      });
      const isForced = forced.has(listing.id);
      /*
       * Who, if anyone, is paid. A fire sale's seller was paid in full, at the
       * forced price, the moment the fire sale ran — they do not own the thing
       * and have no claim on what it fetches now. Paying them again would make
       * collapsing a profitable way to sell.
       */
      const payee = isForced ? undefined : listing.sellerId;

      /*
       * Does the seller still own the thing?
       *
       * Settlement happens after the recovery moves, and a fire sale releases
       * every asset the company has. So a team could list an asset, file a fire
       * sale, and be paid twice for it in the same year: once by the forced sale
       * and once by the auction, which handed a live copy to the winner while
       * the seller's `assets.filter` removed an asset that was already gone. The
       * same shape applies after an acquisition, which moves the seller's assets
       * to the buyer and leaves the seller's listing standing.
       *
       * Nothing is sold out from under anybody: the listing is withdrawn and
       * everyone who bid is told, because a sealed bid that vanishes without a
       * word is indistinguishable from the auction losing it.
       *
       * Not for a fire sale's own listing, though. Those are listed under the
       * company that sold them, which by construction no longer owns them, and
       * asking the question withdrew every single one: the forced sale that is
       * supposed to put a failed team's things in front of everybody else put
       * them in front of nobody.
       */
      if (listing.sellerId && !isForced) {
        const seller = world.companies.find((c) => c.id === listing.sellerId);
        if (!seller || !seller.assets.some((a) => a.id === listing.asset.id)) {
          writes.listings.push({ id: listing.id, set: { status: "withdrawn" } });
          add(listing.sellerId, "unsold", `${listing.asset.name} came off the market — it had already left the company before the auction ran.`);
          for (const b of bids.filter((x) => x.listingId === listing.id)) {
            add(b.ventureId, "lost", `${listing.asset.name} was withdrawn before the auction — the seller no longer had it. Your money stays where it is.`);
          }
          continue;
        }
      }

      if (!award.winnerId) {
        // Everyone who tried is told it went nowhere, so a sealed bid is never silent.
        for (const b of bids.filter((x) => x.listingId === listing.id)) {
          add(b.ventureId, "lost", award.couldNotAfford.includes(b.ventureId)
            ? `Your bid for ${listing.asset.name} cleared the reserve, but the money had already gone on another lot.`
            : award.note);
        }
        if (listing.sellerId) {
          if (payee) add(payee, "unsold", `Nobody met your reserve on ${listing.asset.name}.`);
          writes.listings.push({ id: listing.id, set: { status: "unsold" } });
        }
        continue;
      }

      /*
       * Money moves, then the asset. A seller gets what the winner paid — the
       * discount on a second-hand thing is already in the reserve they chose,
       * so taking another cut here would charge them for it twice.
       *
       * A winner who bid beyond their cash is drawing on credit, and that has to
       * land as debt. It used to come straight out of `cash` and nowhere else,
       * so a team could finish the year overdrawn with nothing on the balance
       * sheet saying they had borrowed a penny — no interest, no covenant, and
       * no insolvency until the following year happened to notice.
       */
      world.companies = world.companies.map((c) => {
        if (c.id === award.winnerId) {
          const fromCash = Math.min(Math.max(0, c.cash), award.price);
          const borrowed = award.price - fromCash;
          return {
            ...c,
            cash: c.cash - fromCash,
            debt: c.debt + borrowed,
            assets: [...c.assets, listing.asset],
          };
        }
        if (payee && c.id === payee) {
          return { ...c, cash: c.cash + award.price, assets: c.assets.filter((a) => a.id !== listing.asset.id) };
        }
        return c;
      });

      add(award.winnerId, "won", `Won ${listing.asset.name} for ${award.price.toLocaleString()}.`);
      /*
       * And the teams whose bid was good and whose money was gone. Silence here
       * reads as the auction having lost their bid.
       */
      for (const id of award.couldNotAfford) {
        add(id, "lost", `Your bid for ${listing.asset.name} cleared the reserve, but the money had already gone on another lot. Sealed bids are committed in the order the lots are listed.`);
      }
      for (const b of bids.filter((x) => x.listingId === listing.id && x.ventureId !== award.winnerId)) {
        add(b.ventureId, "lost", `${listing.asset.name} went to somebody who bid more. Your money stays where it is.`);
      }
      if (listing.sellerId) {
        if (payee) add(payee, "sold", `Sold ${listing.asset.name} for ${award.price.toLocaleString()}.`);
        writes.listings.push({ id: listing.id, set: { status: "sold", buyerId: award.winnerId, soldFor: award.price } });
      }
    }

    // Bids are spent once resolved: a new year is a new decision.
    writes.spentBids = { year, listingIds: listings.map((l) => l.id) };
  }

  /*
   * A fire sale puts the company's things in front of everybody else next
   * year. That is the point of the discount: what one team could not afford to
   * keep, another can afford to buy.
   *
   * These used to be inserted here, outside the year's transaction, and so
   * needed a read-before-insert to stop a retried tick listing everything
   * twice. Written in the transaction that advances the year they cannot be
   * written twice: the retry of a tick that committed finds the year already
   * moved, and the retry of one that did not finds nothing to duplicate.
   */
  for (const [ventureId, assets] of releasedByTeam) {
    for (const asset of assets) {
      writes.fireSales.push({
        seasonId,
        sellerId: ventureId,
        year: year + 1,
        asset,
        // Already sold at a forced price for cash; this is the market's copy.
        reserve: Math.round(asset.bookValue * 0.35),
        forced: true,
        createdAt: new Date(),
      });
    }
  }

  return { notes, writes, auctions, bidsBy };
}

/** Resolve every season that is due. */
export async function runDueTicks(now = new Date()): Promise<number> {
  const due = await db
    .select({ id: simSeasons.id })
    .from(simSeasons)
    .where(and(eq(simSeasons.status, "running"), lte(simSeasons.nextTickAt, now)))
    .limit(100);

  let resolved = 0;
  for (const season of due) {
    try {
      if (await tickSeason(season.id, now)) resolved++;
    } catch (err) {
      console.error(`[sim] tick for season ${season.id} failed:`, err);
    }
  }
  return resolved;
}

/** One pass of everything, under one lock. Exported so a test can run it directly. */
export async function runSimulationPass(now = new Date()): Promise<{ settled: number; started: number; resolved: number } | null> {
  return withLock(LOCK_SIM_TICK, async () => {
    // Before settling: a room that has waited its minute gets its bots, so the
    // deadline it is about to hit finds five players rather than one.
    await fillWaitingLobbies().catch((err) => console.error("[sim] filling lobbies failed:", err));
    const settled = await settleLobbies();
    const started = (await startReadySeasons()).length;
    const resolved = await runDueTicks(now);
    if (settled || started || resolved) {
      console.log(`[sim] ${settled} lobbies settled, ${started} seasons started, ${resolved} years resolved`);
    }
    return { settled, started, resolved };
  });
}

/**
 * Starts the clock.
 *
 * Every minute, which sounds eager for a job that resolves one year a day and
 * is not: lobby deadlines are measured in minutes, and a room that sat
 * abandoned for an hour before anybody was told is four people deciding the
 * feature is broken. The pass does nothing at all when nothing is due.
 */
export function startSimulationJobs(): void {
  const pass = () => {
    runSimulationPass().catch((err) => console.error("[sim] pass failed:", err));
  };

  setTimeout(pass, 20_000);
  setInterval(pass, 60_000).unref();
}
