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
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db, pool } from "./db";
import {
  simSeasons, simVentures, simSeats, simDecisions, simReports,
  simChallenges, simListings, simBids, simRecoveryMoves, simOffers,
} from "@shared/schema";
import { nicheById } from "@shared/simulation/niches";
import { resolveYear } from "@shared/simulation/resolve";
import { ROLE_TITLES, type Role, type World } from "@shared/simulation/types";
import type { TeamDecisions } from "@shared/simulation/decisions";
import {
  buildWorld, decisionsForYear, economyFor, absenceNote, tickDueAt, seasonOver,
} from "@shared/simulation/season";
import { advanceVenture } from "./simulation-routes";
import { marketListings, resolveBids, biddableFunds, type Bid, type Listing } from "@shared/simulation/assets";
import { applyRecovery, reviewCovenant, type RecoveryKind } from "@shared/simulation/recovery";
import { challengeFor, checkChallenge, applyReward, discretionarySpend, type Challenge } from "@shared/simulation/challenges";
import { applyAcquisition } from "@shared/simulation/mergers";
import type { Company, CompanyAsset } from "@shared/simulation/types";

/** What the market did to one company in one year. */
type MarketOutcome = { kind: "won" | "lost" | "sold" | "unsold"; text: string };

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
       * UTC explicitly, not bare `now()`.
       *
       * `phase_ends_at` is a `timestamp` without a zone, and Drizzle writes JS
       * Dates into it as UTC. `now()` is a `timestamptz`, and comparing the two
       * converts it to the *session's* zone — so on a server running in, say,
       * US Central, every deadline looked five hours further away than it was
       * and abandoned rooms sat there half a day before anything swept them.
       * It passes in a UTC-configured database and fails everywhere else,
       * which is the worst way for a bug like this to behave.
       */
      lte(simVentures.phaseEndsAt, sql`(now() at time zone 'utc')`),
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
 * watching, so this can never hang on an empty room.
 */
export async function startReadySeasons(): Promise<string[]> {
  const forming = await db
    .select({ id: simSeasons.id, nicheId: simSeasons.nicheId })
    .from(simSeasons)
    .where(eq(simSeasons.status, "forming"))
    .limit(50);

  const started: string[] = [];

  for (const season of forming) {
    const ventures = await db
      .select({ id: simVentures.id, name: simVentures.name, phase: simVentures.phase })
      .from(simVentures)
      .where(eq(simVentures.seasonId, season.id));

    if (ventures.length === 0) continue;
    // Still arguing. Come back next pass.
    if (ventures.some((v) => v.phase !== "running" && v.phase !== "retired")) continue;

    const playing = ventures.filter((v) => v.phase === "running");
    if (playing.length === 0) {
      // Every room fell apart. Nothing to run.
      await db.update(simSeasons).set({ status: "abandoned" }).where(eq(simSeasons.id, season.id));
      continue;
    }

    const niche = nicheById(season.nicheId);
    if (!niche) {
      console.error(`[sim] season ${season.id} names a market that no longer exists: ${season.nicheId}`);
      await db.update(simSeasons).set({ status: "abandoned" }).where(eq(simSeasons.id, season.id));
      continue;
    }

    const seats = await db
      .select({ ventureId: simSeats.ventureId, role: simSeats.role })
      .from(simSeats)
      .where(inArray(simSeats.ventureId, playing.map((v) => v.id)));

    const world = buildWorld({
      seasonId: season.id,
      niche,
      teams: playing.map((v) => ({
        id: v.id,
        name: v.name ?? "Unnamed",
        seats: seats.filter((s) => s.ventureId === v.id && s.role).map((s) => s.role as Role),
      })),
    });

    const startsAt = new Date(Date.now() + FIRST_YEAR_DELAY_MS);
    // Conditional on still being `forming`, so two processes starting the same
    // season at the same moment cannot both seed a world.
    const claimed = await db
      .update(simSeasons)
      .set({ status: "running", year: 1, world, startsAt, nextTickAt: tickDueAt(startsAt, 1) })
      .where(and(eq(simSeasons.id, season.id), eq(simSeasons.status, "forming")))
      .returning({ id: simSeasons.id });

    if (claimed.length > 0) {
      // Year one's objectives, so nobody's first day is the one day they have
      // nothing of their own to aim at.
      await setChallenges({ world, year: 1 });
      started.push(season.id);
      console.log(`[sim] season ${season.id} (${niche.name}) starts with ${playing.length} team(s)`);
    }
  }

  return started;
}

/**
 * Resolve one year for one season.
 *
 * Returns the year that was resolved, or null if there was nothing to do —
 * which is the normal answer when another process got there first.
 */
export async function tickSeason(seasonId: string, now = new Date()): Promise<number | null> {
  const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
  if (!season || season.status !== "running" || !season.world) return null;
  if (!season.nextTickAt || season.nextTickAt > now) return null;

  const niche = nicheById(season.nicheId);
  if (!niche) return null;

  const year = season.year;
  const stored = season.world as World;
  /*
   * The niche is re-attached from code rather than trusted from the stored
   * world. Segments and incumbent behaviour are balance, and balance gets
   * edited; a season that stored a copy in year one would keep playing last
   * month's balance for a fortnight, and two seasons running side by side
   * would be playing different games.
   */
  const world: World = { ...stored, niche, year };

  let teams = world.companies.filter((c) => c.kind === "player");
  if (teams.length === 0) return null;

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

  for (const offer of accepted) {
    const buyer = world.companies.find((c) => c.id === offer.fromVentureId);
    const seller = world.companies.find((c) => c.id === offer.toVentureId);
    if (!buyer || !seller || buyer.kind !== "player" || seller.kind !== "player") continue;

    const out = applyAcquisition({ buyer, seller, amount: offer.amount });
    world.companies = world.companies.map((c) =>
      c.id === buyer.id ? out.buyer : c.id === seller.id ? out.seller : c);
    addNote(buyer.id, ...out.buyerNotes);
    addNote(seller.id, ...out.sellerNotes);
  }

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

  // Everything submitted for this year, and what each team ran last year.
  const rows = await db
    .select({ ventureId: simDecisions.ventureId, role: simDecisions.role, year: simDecisions.year, payload: simDecisions.payload })
    .from(simDecisions)
    .where(and(
      inArray(simDecisions.ventureId, teams.map((t) => t.id)),
      inArray(simDecisions.year, year > 1 ? [year, year - 1] : [year]),
    ));

  const decisions: TeamDecisions[] = [];
  const absences = new Map<string, Role[]>();

  for (const team of teams) {
    const submitted: Partial<Record<Role, any>> = {};
    const previousParts: Partial<Record<Role, any>> = {};
    for (const r of rows) {
      if (r.ventureId !== team.id) continue;
      if (r.year === year) submitted[r.role as Role] = r.payload;
      else previousParts[r.role as Role] = r.payload;
    }

    /*
     * Last year's plan is rebuilt from what was submitted then, not from a
     * stored copy of what the caretaker ran. Otherwise a team that misses two
     * years in a row has its spending multiplied down twice — 60% of 60% — and
     * a fortnight's absence compounds into a company nobody can rescue. One
     * step down from the last real decision is the fair reading of silence,
     * however long the silence goes on.
     */
    const previous: TeamDecisions | undefined = year > 1
      ? { companyId: team.id, ...previousParts } as TeamDecisions
      : undefined;

    const { decisions: theirs, absent } = decisionsForYear({
      company: team,
      niche,
      submitted,
      previous: previous && Object.keys(previousParts).length > 0 ? previous : undefined,
    });
    decisions.push(theirs);
    if (absent.length > 0) absences.set(team.id, absent);
  }

  const economy = economyFor(seasonId, year);
  const { world: nextWorld, reports } = resolveYear(world, decisions, economy);

  // Name the empty chairs, so a thin year has an explanation attached to it.
  for (const report of reports) {
    const absent = absences.get(report.companyId);
    const note = absent ? absenceNote(absent, ROLE_TITLES) : null;
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
  for (const [ventureId, result] of challengeResults) {
    const company = nextWorld.companies.find((c) => c.id === ventureId);
    if (!company) continue;
    nextWorld.companies = nextWorld.companies.map((c) => (c.id === ventureId ? applyReward(c, result.reward) : c));
    const report = reports.find((r) => r.companyId === ventureId);
    if (report) report.notes.push(result.note);
  }

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
  const marketNotes = await settleMarket({ seasonId, year, niche, world: nextWorld, releasedByTeam });
  for (const [ventureId, outcomes] of marketNotes) {
    const report = reports.find((r) => r.companyId === ventureId);
    if (report) report.market = outcomes;
  }

  const finished = seasonOver(year + 1, season.totalYears);
  const nextTickAt = season.startsAt && !finished ? tickDueAt(season.startsAt, year + 1) : null;

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
        status: finished ? "finished" : "running",
      })
      .where(and(eq(simSeasons.id, seasonId), eq(simSeasons.year, year)))
      .returning({ id: simSeasons.id });

    // Another process resolved this year while we were working. Its writes are
    // identical to ours, so there is nothing to correct — just nothing to do.
    if (advanced.length === 0) return;

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

  // Next year's objectives, set against where each company now stands.
  if (!finished) await setChallenges({ world: nextWorld, year: year + 1 });

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
      challenge: challengeFor({ company, world, role: seat.role as Role, year, ventureId: seat.ventureId }),
    });
  }

  if (rows.length > 0) await db.insert(simChallenges).values(rows).onConflictDoNothing();
}

/** Mark the year's objectives, one per seat. */
async function markChallenges(input: {
  ventureIds: string[];
  year: number;
  reports: { companyId: string }[];
  world: World;
  decisions: TeamDecisions[];
}): Promise<Map<string, ReturnType<typeof checkChallenge>>> {
  const { ventureIds, year, world, decisions } = input;
  const out = new Map<string, ReturnType<typeof checkChallenge>>();
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

    out.set(row.ventureId, result);
  }

  return out;
}

/**
 * The marketplace, settled.
 *
 * Bids are sealed until this moment: everyone committed a number without
 * seeing anyone else's, and the highest one over the reserve takes it. What
 * makes this safe to re-run is that the open market's listings are generated
 * from the season and year rather than stored, so the same tick run twice
 * deals the same hand and awards the same things.
 */
async function settleMarket(input: {
  seasonId: string;
  year: number;
  niche: NonNullable<ReturnType<typeof nicheById>>;
  world: World;
  releasedByTeam: Map<string, CompanyAsset[]>;
}): Promise<Map<string, MarketOutcome[]>> {
  const { seasonId, year, niche, world, releasedByTeam } = input;
  const notes = new Map<string, MarketOutcome[]>();
  const add = (id: string, kind: MarketOutcome["kind"], text: string) =>
    notes.set(id, [...(notes.get(id) ?? []), { kind, text }]);

  const open = await db
    .select()
    .from(simListings)
    .where(and(eq(simListings.seasonId, seasonId), eq(simListings.year, year), eq(simListings.status, "open")));

  const listings: Listing[] = [
    ...marketListings({ seasonId, year, niche }),
    ...open.map((row) => ({
      id: row.id,
      asset: row.asset as CompanyAsset,
      blurb: "Second-hand.",
      reserve: row.reserve,
      sellerId: row.sellerId,
    })),
  ];
  if (listings.length === 0) return notes;

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

  for (const award of awards) {
    const listing = listings.find((l) => l.id === award.listingId)!;

    if (!award.winnerId) {
      // Everyone who tried is told it went nowhere, so a sealed bid is never silent.
      for (const b of bids.filter((x) => x.listingId === listing.id)) add(b.ventureId, "lost", award.note);
      if (listing.sellerId) {
        add(listing.sellerId, "unsold", `Nobody met your reserve on ${listing.asset.name}.`);
        await db.update(simListings).set({ status: "unsold" }).where(eq(simListings.id, listing.id));
      }
      continue;
    }

    /*
     * Money moves, then the asset. A seller gets what the winner paid — the
     * discount on a second-hand thing is already in the reserve they chose,
     * so taking another cut here would charge them for it twice.
     */
    world.companies = world.companies.map((c) => {
      if (c.id === award.winnerId) {
        return { ...c, cash: c.cash - award.price, assets: [...c.assets, listing.asset] };
      }
      if (listing.sellerId && c.id === listing.sellerId) {
        return { ...c, cash: c.cash + award.price, assets: c.assets.filter((a) => a.id !== listing.asset.id) };
      }
      return c;
    });

    add(award.winnerId, "won", `Won ${listing.asset.name} for ${award.price.toLocaleString()}.`);
    for (const b of bids.filter((x) => x.listingId === listing.id && x.ventureId !== award.winnerId)) {
      add(b.ventureId, "lost", `${listing.asset.name} went to somebody who bid more. Your money stays where it is.`);
    }
    if (listing.sellerId) {
      add(listing.sellerId, "sold", `Sold ${listing.asset.name} for ${award.price.toLocaleString()}.`);
      await db.update(simListings)
        .set({ status: "sold", buyerId: award.winnerId, soldFor: award.price })
        .where(eq(simListings.id, listing.id));
    }
  }

  /*
   * A fire sale puts the company's things in front of everybody else next
   * year. That is the point of the discount: what one team could not afford to
   * keep, another can afford to buy.
   */
  for (const [ventureId, assets] of releasedByTeam) {
    for (const asset of assets) {
      await db.insert(simListings).values({
        seasonId,
        sellerId: ventureId,
        year: year + 1,
        asset,
        // Already sold at a forced price for cash; this is the market's copy.
        reserve: Math.round(asset.bookValue * 0.35),
      });
    }
  }

  // Bids are spent once resolved: a new year is a new decision.
  await db.delete(simBids).where(and(eq(simBids.year, year), inArray(simBids.listingId, listings.map((l) => l.id))));

  return notes;
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
