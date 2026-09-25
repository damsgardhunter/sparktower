/**
 * The desk: what a seat sees on the day, and what it files.
 *
 * Two routes. One assembles everything a person needs to make this year's
 * decision — where the company stands, what last year did to it, what their
 * four colleagues have already committed, and how long is left. The other
 * takes their decision and replaces whatever they filed before.
 *
 * ## Why the whole table's draft is visible
 *
 * The obvious design is that each seat sees only its own levers. It is also
 * the design that makes the game unplayable: the CMO cannot know the company
 * is out of money, the COO cannot know marketing is about to bring in three
 * times what they can serve, and everybody finds out together on the daily
 * tick when it is a fortnight too late to argue.
 *
 * So a seat sees every filed decision and the running total against the bank
 * balance. Not to remove the difficulty — the difficulty is that five people
 * want different things — but to move it to where it belongs, which is an
 * argument between them rather than an ambush by the engine.
 */
import type { Express } from "express";
import { PERIOD_NAME, periodsPerYear, type Cadence } from "@shared/simulation/cadence";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { simSeasons, simSeats, simVentures, simDecisions, simReports, simChallenges, simRecoveryMoves, users, userProfiles, companies, projects } from "@shared/schema";
import { currencyOf, DEFAULT_CURRENCY, type CurrencyCode } from "@shared/currency";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { enforceRateLimit, rateLimit } from "./moderation";
import { nicheById } from "@shared/simulation/niches";
import { marketOf } from "./simulation-scope";
import { canEnter, continentOf, regionById } from "@shared/simulation/geography";
import { NICHE_HEAD_START_YEARS } from "@shared/simulation/market";
import { ROLE_TITLES, ROLE_LEVERS, ROLES, type Role, type World, type Company, type Niche, type Economy } from "@shared/simulation/types";
import type { TeamDecisions } from "@shared/simulation/decisions";
import { LEVER_FIELDS, cleanDecision, defaultDraft, validateDecision, draftPreview, speak } from "@shared/simulation/levers";
import { economyFor } from "@shared/simulation/season";
import { debtDrag, IDLE_RATE, marketPriceOf, officersOf } from "@shared/simulation/decisions";
import { weightsOf, expectationsFor, shortfalls, describeWeights } from "@shared/simulation/criteria";
import { forecastDemand } from "@shared/simulation/forecast";
import { projectYear } from "@shared/simulation/projection";
import { advanceAuthority, advanceSeasonNow, warnIfDevAdvance } from "./season-control";
import { mfaGate, mfaRequiredFor, mfaSatisfied } from "./mfa";
import { SPENDING_SEATS, arrivingIn, buildCostPerUnit, isUnlocked, leaseCostPerUnit, unlockYear } from "@shared/simulation/responsibilities";
import { STAFF_QUALITY_START, WARN_AT, overrulable, personOf } from "@shared/simulation/people";
import { breachChance, featureCost, featureMenu, outageChance } from "@shared/simulation/product";
import { AUTOMATION_RATE, SHIFT_MAX, SHIFT_RATE, STOCK_RATE } from "@shared/simulation/factory";
import {
  EXPANSION_DISCOUNT, PROGRAMMES, announcedRegion, dealsFor, expansionOutcome, programmeCost, researchCost, statementCost,
  type ProgrammeId,
} from "@shared/simulation/world";
import { valuation } from "@shared/simulation/mergers";
import { incumbentYear } from "@shared/simulation/incumbents";
import { assetEffects } from "@shared/simulation/assets";
import { RATING_START, interestOn, ratingGrade } from "@shared/simulation/finance";
import { postureBlurb } from "@shared/simulation/incumbents";
import { distressOf, DISTRESS_COPY, recoveryOptions } from "@shared/simulation/recovery";
import { startReadySeasons, YEAR_CLOSING, yearClosing } from "./simulation-tick";

/**
 * The desk nudges the season forward, the way the lobby screen nudges the room.
 *
 * Somebody watching "waiting for year one" is watching a background job they
 * cannot see, and if that job is not running — a single-process deploy that
 * missed its timer, a dev server restarted at the wrong moment — the wait has
 * no end and no explanation. Asking here costs three queries and makes the
 * person looking at the screen the thing that starts their own season.
 *
 * Debounced, because this route is polled: at most one sweep every ten
 * seconds however many desks are open. The sweep itself is idempotent, so a
 * duplicate is harmless rather than a second world.
 */
let lastSweep = 0;
function nudgeSeasons(): void {
  if (Date.now() - lastSweep < 10_000) return;
  lastSweep = Date.now();
  void startReadySeasons().catch((err) => console.error("[sim] desk sweep failed:", err));
}

/** The seat this person holds in this venture, or nothing. */

/**
 * The currency of the business a season was built from.
 *
 * A season belongs to a company; a company made from a project carries that
 * project. A company somebody set up directly has no project and gets the
 * default, which is the honest answer — nobody told us otherwise.
 */
export async function currencyForSeason(companyId: string | null | undefined): Promise<CurrencyCode> {
  if (!companyId) return DEFAULT_CURRENCY;
  const [row] = await db
    .select({ currency: projects.currency })
    .from(companies)
    .leftJoin(projects, eq(projects.id, companies.projectId))
    .where(eq(companies.id, companyId));
  return currencyOf(row?.currency);
}

async function seatOf(ventureId: string, userId: string) {
  const [seat] = await db.select().from(simSeats)
    .where(and(eq(simSeats.ventureId, ventureId), eq(simSeats.userId, userId)));
  return seat ?? null;
}

/** Everything filed for a venture in a given year, as the engine's shape. */
async function draftFor(ventureId: string, year: number): Promise<{ decisions: TeamDecisions; filedBy: Record<string, string> }> {
  const rows = await db
    .select({ role: simDecisions.role, payload: simDecisions.payload, userId: simDecisions.userId })
    .from(simDecisions)
    .where(and(eq(simDecisions.ventureId, ventureId), eq(simDecisions.year, year)));

  const decisions: TeamDecisions = { companyId: ventureId };
  const filedBy: Record<string, string> = {};
  for (const r of rows) {
    (decisions as any)[r.role] = r.payload;
    filedBy[r.role] = r.userId;
  }
  return { decisions, filedBy };
}

export function registerSimulationDeskRoutes(app: Express): void {
  warnIfDevAdvance();

  /**
   * End the year being played now — for developers, and for anyone seated in
   * the season when a local development server opts in. Everyone else gets a
   * 404: a clock a person cannot control is none of their business. See
   * `server/season-control.ts`.
   */
  app.post("/api/sim/seasons/:id/advance", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const result = await advanceSeasonNow(String(req.params.id), req.user.id, {
        secondFactor: !mfaRequiredFor(req.user) || mfaSatisfied(req),
      });
      // The admin gate's own refusal, so the client is told to enrol or to re-enter a code.
      if (!result.ok && result.code === "second_factor") return void mfaGate(req, res);
      if (!result.ok) return res.status(result.status).json({ message: result.message, code: result.code });
      const { ok: _, ...body } = result;
      res.json(body);
    } catch (error) {
      console.error("[sim] advance year failed:", error);
      res.status(500).json({ message: "Couldn't resolve the year." });
    }
  });

  /**
   * Everything one seat needs to decide this year.
   *
   * One request rather than five, because this is the screen someone opens on
   * their phone on the way to work and a screen that arrives in pieces is a
   * screen they close.
   */
  app.get("/api/sim/ventures/:id/desk", isAuthenticated, async (req: any, res) => {
    const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, req.params.id));
    if (!venture) return res.status(404).json({ message: "No such company." });

    const seat = await seatOf(venture.id, req.user.id);
    // A stranger is told nothing, including whether this exists.
    if (!seat) return res.status(404).json({ message: "No such company." });

    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, venture.seasonId));
    if (!season) return res.status(404).json({ message: "No such season." });

    if (season.status === "forming" || !season.world) {
      /*
       * Two different things used to look identical here: a season a minute
       * away from year one, and a season that is never going to have one. Both
       * said "waiting for year one", indefinitely, which is the worse of the
       * two answers given to the person it is not true for.
       */
      const rooms = await db
        .select({ id: simVentures.id, phase: simVentures.phase })
        .from(simVentures)
        .where(eq(simVentures.seasonId, season.id));
      const stillPlaying = rooms.filter((r) => r.phase === "running").length;

      if (venture.phase === "retired" || (season.status === "abandoned" && stillPlaying === 0)) {
        return res.json({
          phase: "over",
          ventureId: venture.id,
          name: venture.name,
          yourRole: seat.role,
          yourTitle: seat.role ? ROLE_TITLES[seat.role as Role] : null,
        });
      }

      nudgeSeasons();
      return res.json({
        phase: "not_started",
        ventureId: venture.id,
        name: venture.name,
        yourRole: seat.role,
        yourTitle: seat.role ? ROLE_TITLES[seat.role as Role] : null,
        /** What the season is actually waiting on, so the wait has a shape. */
        roomsStillChoosing: rooms.filter((r) => r.phase !== "running" && r.phase !== "retired").length,
        yourRoomReady: venture.phase === "running",
        /** One chair: nobody else is coming, so the screen must not promise anyone. */
        solo: (season.seatCount ?? 5) <= 1,
      });
    }

    const niche = marketOf(season)!;
    const world = season.world as World;
    const company = world.companies.find((c) => c.id === venture.id);
    if (!company) return res.status(404).json({ message: "No such company." });

    const year = season.year;
    const periods = periodsPerYear(season.cadence as Cadence);
    /** One chair at this table: a founder holding every desk, on one salary. */
    const solo = (season.seatCount ?? 5) <= 1;
    const { decisions, filedBy } = await draftFor(venture.id, year);
    /*
     * And what the table filed last year, which is the only record of it
     * anywhere: the desk has always shown this year's decisions and the
     * report has always shown what they produced, with nothing joining the
     * two. A team could not look back at what it actually decided.
     */
    const lastFiled = year > 1 ? (await draftFor(venture.id, year - 1)) : null;
    const economy = economyFor(season.id, year);
    /*
     * The year's offers, worked out once: the chief executive answers them,
     * everybody else votes on them, and every seat can read them.
     */
    const offers = season.status === "running" && company.kind === "player"
      ? dealsFor({
          seasonId: season.id, year, company, niche,
          incumbents: world.companies.filter((c) => c.kind === "incumbent"),
          worth: valuation(company).fair,
        })
      : [];

    // Last year's result, and what each seat filed then, so a draft can start
    // from what they actually did rather than from zero.
    const [lastReport] = year > 1
      ? await db.select().from(simReports)
        .where(and(eq(simReports.ventureId, venture.id), eq(simReports.year, year - 1)))
      : [];
    const previous = year > 1 ? (await draftFor(venture.id, year - 1)).decisions : undefined;

    const seats = await db
      .select({ userId: simSeats.userId, role: simSeats.role, firstName: users.firstName, lastName: users.lastName, isBot: users.isBot, displayName: userProfiles.displayName, avatarUrl: userProfiles.avatarUrl })
      .from(simSeats)
      .leftJoin(users, eq(users.id, simSeats.userId))
      .leftJoin(userProfiles, eq(userProfiles.userId, simSeats.userId))
      .where(eq(simSeats.ventureId, venture.id));

    const preview = draftPreview({ company, niche, decisions, economy });

    const [mine] = seat.role
      ? await db.select().from(simChallenges).where(and(
          eq(simChallenges.ventureId, venture.id),
          eq(simChallenges.role, seat.role),
          eq(simChallenges.year, year),
        ))
      : [];
    const [previousChallenge] = seat.role && year > 1
      ? await db.select().from(simChallenges).where(and(
          eq(simChallenges.ventureId, venture.id),
          eq(simChallenges.role, seat.role),
          eq(simChallenges.year, year - 1),
        ))
      : [];
    const [recoveryFiled] = await db.select().from(simRecoveryMoves).where(and(
      eq(simRecoveryMoves.ventureId, venture.id),
      eq(simRecoveryMoves.year, year),
    ));

    /*
     * Rivals are shown as they were at the end of last year — their share,
     * their price, and how they behave. Not their plans: an incumbent whose
     * next move was visible would be a puzzle rather than an opponent, and the
     * player teams' drafts are their own business until the tick.
     */
    /*
     * The continent this company is from — the one its first region is on.
     * Being from somewhere is worth more than any amount of money on a guarded
     * market, so everything about entry is measured against it.
     */
    const home = continentOf((company.cities ?? [])[0] ?? "");

    const rivals = world.companies
      .filter((c) => c.id !== company.id)
      .map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        price: Math.round(c.price),
        customers: Object.values(c.customers).reduce((sum, n) => sum + n, 0),
        posture: c.posture ?? null,
        posturedAs: c.posture ? postureBlurb(c.posture) : null,
      }))
      .sort((a, b) => b.customers - a.customers);

    /*
     * Where everybody stands, for a market you can look at rather than read.
     *
     * Price against quality with the size of the company as the size of the
     * dot, plus what each one is rated to borrow at. A rival's standing is
     * already public here — the standings screen shows its distress, and the
     * point of a market is that you can see who you are up against — and a
     * rating nobody can compare theirs to teaches nothing.
     */
    const standing = world.companies.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      isYou: c.id === company.id,
      price: Math.round(c.price),
      quality: Math.round(c.quality),
      service: Math.round(c.service),
      brand: Math.round(c.brand),
      customers: Object.values(c.customers).reduce((sum, n) => sum + n, 0),
      positioning: c.positioning ?? null,
      grade: c.kind === "player" ? ratingGrade(c.creditScore ?? RATING_START) : null,
      creditScore: c.kind === "player" ? Math.round(c.creditScore ?? RATING_START) : null,
    }));

    /*
     * What this company counts its money in.
     *
     * Both desks — the web one and the phone one — had a pound sign written
     * into the formatter, so every season in the game was priced in sterling
     * whatever the business behind it actually used. The season does not carry
     * a currency of its own; the project it was built from does, and that is
     * the business being rehearsed, so it is read from there and falls back to
     * the default rather than to a guess.
     */
    const currency = await currencyForSeason(season.companyId);

    res.json({
      phase: season.status === "finished" ? "finished" : "running",
      ventureId: venture.id,
      name: venture.name,
      product: venture.product,
      currency,
      /*
       * The market's own words, carried to the screen. The engine says
       * "customers" and "capacity" everywhere because the arithmetic is the
       * same in all seven markets; the desk should say covers, or drops a day,
       * or concurrent players, and a player should never be able to tell that
       * underneath it is one spreadsheet.
       */
      niche: { id: niche.id, name: niche.name, premise: niche.premise, voice: niche.voice },
      year,
      totalYears: season.totalYears,
      /**
       * What one decision is called here.
       *
       * The engine has counted periods rather than years for a long time and a
       * season can be run monthly, quarterly or yearly — but every word on the
       * desk said "year", so somebody deciding four times a simulated year was
       * told each of those four was a year, and that the season was fourteen
       * of them. Sent rather than derived on the client so the two cannot come
       * to different conclusions about what a quarter is called.
       *
       * Note what this is *not* for: the parts of the game that are genuinely
       * annual. A salary is paid every year, interest accrues every year, and
       * a licence with four years left has four years left whatever the table
       * is deciding this week. Those stay years on purpose.
       */
      cadence: season.cadence ?? "yearly",
      period: { ...PERIOD_NAME[(season.cadence ?? "yearly") as Cadence], perYear: periods },
      /** Null when the season has finished; otherwise when this period resolves. */
      resolvesAt: season.nextTickAt,
      /**
       * Whether this person may end the year now, and as what — a developer,
       * or (local development, SIM_DEV_ADVANCE) anyone seated in the season.
       * Null for everyone else, who never see the button. See
       * `server/season-control.ts`.
       */
      seasonId: season.id,
      canAdvance: season.status === "running" ? await advanceAuthority(req.user.id, season) : null,

      yourRole: seat.role,
      yourTitle: solo ? "Founder" : (seat.role ? ROLE_TITLES[seat.role as Role] : null),
      yourLevers: solo
        ? ROLES.flatMap((r) => ROLE_LEVERS[r])
        : (seat.role ? ROLE_LEVERS[seat.role as Role] : []),
      /** Every desk is yours, so the screen says so rather than calling you a chief executive. */
      solo,
      /*
       * The seat's levers, with the ones whose choices depend on this company
       * filled in: which seats could be rehired, and which segments this market
       * actually has. A static list cannot know either.
       *
       * A solo founder gets all five desks' levers in one list. Deduplicated
       * by id, because four of the five chairs carry the same `expandVote` and
       * a founder voting with themselves four times is not a decision — the
       * first occurrence wins, which is the chief executive's, in the fixed
       * order the seats are dealt in.
       */
      fields: seat.role ? dedupeById((solo ? [...ROLES] : [seat.role as Role]).flatMap((r) => LEVER_FIELDS[r]
        // Only what this seat has by now: responsibilities arrive a year at a time (see UNLOCKS).
        .filter((base) => isUnlocked(r, base.id, year, periods))
        // Which desk it came from, kept so the unlock year below is asked of
        // the right one — solo puts five desks' levers in a single list.
        .map((base) => ({ base, desk: r }))))
        .map(({ base, desk }) => {
        // Said in this market's words first, then filled in with the choices
        // that depend on this particular company.
        const unlocksIn = unlockYear(desk, base.id);
        const field = { ...speak(base, niche.voice, { ...PERIOD_NAME[(season.cadence ?? "yearly") as Cadence], perYear: periods }), ...(unlocksIn > 1 ? { unlocksIn } : {}) };
        if (field.id === "tiers") {
          return {
            ...field,
            options: niche.segments.map((s) => ({ value: s.id, label: s.name, help: `Pays around ${s.referencePrice} and ${s.priceSensitivity >= 0.6 ? "watches every penny" : s.priceSensitivity <= 0.3 ? "barely looks at the price" : "notices price"}.` })),
          };
        }
        /*
         * The year's offers, for the chief executive to answer and everybody
         * else to vote on. The same list for both, so a seat voting can read
         * exactly what it is voting on.
         */
        if (field.id === "deals" || field.id === "dealVotes") {
          return {
            ...field,
            options: offers.map((o) => ({ value: o.id, label: o.title, help: o.terms })),
          };
        }
        // What to say about last year's shock — and who to blame, if it comes to that.
        if (field.id === "shockAnswer") {
          if (!company.shock) return { ...field, options: [] };
          return {
            ...field,
            label: `Answer: ${company.shock.headline}`,
            options: [
              { value: "statement", label: "Make a statement", help: `Costs ${statementCost(niche).toLocaleString()} to do well, and wins back about half of the ${Math.round(company.shock.reputation)} points of reputation it cost.` },
              { value: "silence", label: "Say nothing", help: "Cheap, and it reads as evasive: a little more reputation goes." },
              ...overrulable(company.seats).map((r) => ({
                value: `blame_${r}`,
                label: `Blame the ${ROLE_TITLES[r].toLowerCase()}`,
                help: `Wins back about 70% of it, and costs that seat 25 points of loyalty. They are at ${Math.round(personOf(company, r).loyalty)}.`,
              })),
            ],
          };
        }
        /*
         * The kinds of customer this company could go looking inside. Its own
         * niche is left off — one a season — and so is a segment somebody has
         * already carved this company's corner out of.
         */
        if (field.id === "openNiche") {
          const opened = ((season.world as World | null)?.openedNiches ?? []);
          if (opened.some((o) => o.openedBy === company.id)) return { ...field, options: [] };
          return {
            ...field,
            options: [
              { value: "", label: "Not this year", help: "Keep the year's research money." },
              ...niche.segments
                .filter((seg) => !opened.some((o) => o.id === seg.id))
                .map((seg) => ({
                  value: seg.id,
                  label: `Look inside ${seg.name.toLowerCase()}`,
                  help: `${seg.description} Costs ${researchCost(niche).toLocaleString()}, and what you find depends on what you are already better at than everyone else.`,
                })),
            ],
          };
        }
        // The improvement programmes not already running, and what one costs.
        if (field.id === "programme") {
          const running = new Set((company.programmes ?? []).map((p) => p.id));
          return {
            ...field,
            options: [
              { value: "", label: "None this year", help: "Keep the money." },
              ...Object.entries(PROGRAMMES).filter(([id]) => !running.has(id as ProgrammeId)).map(([id, p]) => ({
                value: id, label: p.name, help: `${p.blurb} ${programmeCost(niche).toLocaleString()} to start.`,
              })),
            ],
          };
        }
        /*
         * The region announced for next year, if the company has not
         * committed to one already — put up by operations, voted on by the
         * other four. The same region and the same price on both levers, so
         * a seat voting is reading exactly what it is voting on.
         */
        if (field.id === "expand" || field.id === "expandVote") {
          // No operations seat, no proposal, so nothing for anyone to vote on.
          const announced = company.expanding || !company.seats.includes("coo")
            ? null
            : announcedRegion({ niche, seasonId: season.id, year, open: company.cities ?? [] });
          const price = announced ? Math.round(announced.entryCost * EXPANSION_DISCOUNT).toLocaleString() : "";
          if (!announced) return { ...field, options: [] };
          if (field.id === "expandVote") {
            return {
              ...field,
              options: [{
                value: announced.id,
                label: `Open ${announced.name}`,
                help: `${announced.note} ${price} now, opening next year — and in its first year you reach only as far as the brand does. Operations has to put it up for your vote to count.`,
              }],
            };
          }
          return {
            ...field,
            options: [
              { value: "", label: "Not this year", help: "The announcement stands; somebody else may take it." },
              { value: announced.id, label: `Open ${announced.name}`, help: `${announced.note} ${price} now, opening next year — and in its first year you reach only as far as the brand does. Putting it up counts as your vote for it.` },
            ],
          };
        }
        /*
         * This year's feature menu: three ideas, the same for every team in
         * the season, each saying who it is for, whether a rival already has
         * it (so it can be copied), and what it costs.
         */
        if (field.id === "featureBet") {
          const owned = new Set((company.features ?? []).map((f) => f.id));
          const menu = featureMenu(niche, season.id, year).filter((m) => !owned.has(m.id));
          const segName = (id: string) => niche.segments.find((s) => s.id === id)?.name ?? id;
          const build = featureCost(niche, "build");
          const copy = featureCost(niche, "copy");
          return {
            ...field,
            options: [
              { value: "", label: "No bet this year", help: "Keep the money." },
              ...menu.map((m) => ({
                value: m.id,
                label: m.name,
                help: `For ${segName(m.segment).toLowerCase()}. ${m.blurb} Build £${build.toLocaleString()}${m.rivalHas ? ` · a rival already has it: copy £${copy.toLocaleString()}` : ""}.`,
              })),
            ],
          };
        }
        /*
         * Where the marketing goes: the regions this company actually sells
         * in, each saying how big it is and who over-indexes there, because
         * that is the whole basis of the decision.
         */
        if (field.id === "regionFocus") {
          const open = new Set(company.cities ?? niche.cities.map((c) => c.id));
          const segName = (id: string) => niche.segments.find((s) => s.id === id)?.name ?? id;
          return {
            ...field,
            options: niche.cities.filter((c) => open.has(c.id)).map((c) => {
              const leans = Object.entries(c.mix ?? {}).sort((a, b) => b[1] - a[1])[0];
              const character = leans && leans[1] > 1.02 ? ` Leans ${segName(leans[0]).toLowerCase()}.`
                : leans && leans[1] < 0.98 ? "" : "";
              return { value: c.id, label: c.name, help: `${Math.round(c.weight * 100)}% of the market.${character} ${c.note}` };
            }),
          };
        }
        // And who it is for: the segments, with what each is worth.
        if (field.id === "segmentFocus") {
          const market = niche.segments.reduce((sum, s) => sum + s.size, 0) || 1;
          return {
            ...field,
            options: niche.segments.map((s) => ({
              value: s.id,
              label: s.name,
              help: `${Math.round((s.size / market) * 100)}% of the market, paying around ${s.referencePrice}. ${describeWeights(s)}`,
            })),
          };
        }
        // A second shift can only run the plant you have: half as much again, at most.
        if (field.id === "shiftCapacity") {
          return { ...field, max: Math.round(company.capacity * SHIFT_MAX) };
        }
        // The other four chairs, for the chief executive's people levers.
        if (field.id === "targets" || field.id === "overrule" || field.id === "replaceSeat") {
          const others = overrulable(company.seats).map((r) => {
            const person = personOf(company, r);
            const record = person.record ?? [];
            const right = record.filter((x) => x.right === "seat").length;
            return {
              value: r,
              label: ROLE_TITLES[r],
              help: `Loyalty ${Math.round(person.loyalty)}${person.loyalty < WARN_AT ? " — thinking about leaving" : ""} · rated ${person.skill}${record.length ? ` · overruled ${record.length}×, right ${right} of those` : ""}`,
            };
          });
          return {
            ...field,
            options: field.id === "targets" ? others : [{ value: "", label: "Nobody", help: field.id === "overrule" ? "Every seat's own decision stands." : "Keep everybody." }, ...others],
          };
        }
        if (field.id === "budget") {
          return {
            ...field,
            options: SPENDING_SEATS.filter((r) => company.seats.includes(r))
              .map((r) => ({ value: r, label: ROLE_TITLES[r], help: "" })),
          };
        }
        if (field.id === "rehire") {
          return {
            ...field,
            options: (["cmo", "cfo", "cto", "coo"] as Role[])
              .filter((r) => !company.seats.includes(r))
              .map((r) => ({ value: r, label: ROLE_TITLES[r], help: `Costs the salary that was saved, and gives the seat back its decisions.` })),
          };
        }
        if (field.id === "positioning") {
          return {
            ...field,
            options: [
              { value: "", label: "Everybody", help: "No particular allegiance, and no particular advantage anywhere." },
              ...niche.segments.map((s) => ({ value: s.id, label: s.name, help: s.description })),
            ],
          };
        }
        return field;
      }) : [],
      /** What one of each thing costs in this market, for the committed-spend meter. */
      prices: {
        build: buildCostPerUnit(niche), lease: leaseCostPerUnit(niche),
        featureBuild: featureCost(niche, "build"), featureCopy: featureCost(niche, "copy"),
        research: researchCost(niche), programme: programmeCost(niche), statement: statementCost(niche),
        shift: buildCostPerUnit(niche) * SHIFT_RATE, stock: buildCostPerUnit(niche) * STOCK_RATE,
        automation: buildCostPerUnit(niche) * AUTOMATION_RATE,
        expansion: Math.round((announcedRegion({ niche, seasonId: season.id, year, open: company.cities ?? [] })?.entryCost ?? 0) * EXPANSION_DISCOUNT),
      },
      /** The levers this seat gets next year, by label, so nobody is surprised by them. */
      arrivingNextYear: seat.role
        ? arrivingIn(seat.role as Role, year + 1, periods).map((id) => LEVER_FIELDS[seat.role as Role].find((f) => f.id === id)?.label ?? id)
        : [],
      /**
       * What to show in the form: what they filed already, else last period's,
       * else a sensible opening.
       *
       * A solo founder holds all five desks, so their filing is written as
       * five rows — one per role, because the engine reads decisions per role
       * and a role with no row is treated as absent. This is the other half of
       * that, and it was missing: handing back only `decisions[seat.role]` gave
       * them the chief executive's fields and nothing else, so every price,
       * every spend and every target they had filed came back empty the moment
       * the page remounted. The work was never lost — it was in the database
       * the whole time, in the four rows this line did not read.
       */
      draft: seat.role
        ? (solo
            ? Object.assign(
                {},
                ...ROLES.map((r) => (decisions as any)[r] ?? defaultDraft(r, company, (previous as any)?.[r])),
              )
            : (decisions as any)[seat.role] ?? defaultDraft(seat.role as Role, company, (previous as any)?.[seat.role]))
        : null,
      /* Filed when every desk they hold has a row, which for a solo table is all five. */
      submitted: seat.role
        ? (solo ? ROLES.every((r) => !!(decisions as any)[r]) : !!(decisions as any)[seat.role])
        : false,

      company: {
        cash: Math.round(company.cash),
        debt: Math.round(company.debt),
        creditLimit: Math.round(company.creditLimit),
        reputation: Math.round(company.reputation),
        quality: Math.round(company.quality),
        brand: Math.round(company.brand),
        service: Math.round(company.service),
        /** What the company built. The operations lever sets this; it is not all the room there is. */
        capacity: company.capacity,
        /** How automated the plant is, 0–100 — what a point of automation is charged against. */
        automation: Math.round(company.automation ?? 0),
        /** What the company's assets add on top — a distribution deal, a second site. Served from all the same. */
        assetCapacity: assetEffects(company.assets ?? []).capacity,
        unitCost: Math.round(company.unitCost * 100) / 100,
        price: Math.round(company.price),
        customers: Object.values(company.customers).reduce((sum, n) => sum + n, 0),
        bankruptSince: company.bankruptSince ?? null,
        /** What the founders still own. Raising money is what spends this. */
        founderShare: company.founderShare ?? 1,
        /** Quality arriving next year: last year's shipping, and research a year in. See `lag.ts`. */
        pipeline: Math.round((company.pipeline ?? 0) * 10) / 10,
        /** Research still two years out. */
        pipelineLater: Math.round((company.pipelineLater ?? 0) * 10) / 10,
        /** Brand this year's campaigns have bought that lands next year. */
        brandPipeline: Math.round((company.brandPipeline ?? 0) * 10) / 10,
        /** Staff already here since last year — the ones who are any use yet. */
        staff: company.staff ?? 0,
        /** The rating, what it makes borrowing cost, and any emergency loan outstanding. */
        credit: {
          score: company.creditScore ?? RATING_START,
          grade: ratingGrade(company.creditScore ?? RATING_START),
          rate: interestOn(company, economyFor(season.id, year).interestRate).rate,
          emergencyDebt: Math.round(company.emergencyDebt ?? 0),
        },
        /** The investors' terms, if a stake has been sold. */
        investors: company.investors ?? null,
        /*
         * What the product owes itself, and what that is costing right now.
         *
         * Sent with its consequences already worked out rather than as a bare
         * number, because "technical debt: 62" means nothing to four of the
         * five people at the table. "Product spending buys 31% less and every
         * unit costs 21% more" is a thing a marketing seat can argue about.
         */
        techDebt: Math.round(company.techDebt ?? 0),
        techDebtCost: {
          product: Math.round((1 - debtDrag(company.techDebt).product) * 100),
          unitCost: Math.round((debtDrag(company.techDebt).unitCost - 1) * 100),
        },
        positioning: company.positioning ?? null,
        /*
         * The seats the engine still charges a salary for. Sent because the
         * fixed-cost arithmetic cannot be reproduced without it — a client
         * recomputing the table's commitment as someone types would otherwise
         * have to back the executive half out of the server's own total, which
         * is a derivation that silently stops being true the moment a seat is
         * dissolved.
         */
        seats: company.seats,
        /*
         * And the two other things that arithmetic needs, for exactly the same
         * reason. Leaving either out does not fail — it quietly computes a
         * different number than the engine will.
         *
         * `officers` is how many salaries are actually paid, which stopped
         * being "one per seat" when a solo founder started holding all five
         * desks: the browser read five chairs and showed a startup committing
         * £700,000 a year to a board of one person. `scale` is the size of the
         * market this company is in — a Nova-written startup market runs at a
         * hundredth of the catalogue's, so a projection without it overstates
         * every fixed cost on the screen by that factor.
         */
        officers: officersOf(company),
        scale: company.scale ?? 1,
      },
      /*
       * Where the market exists, and where this company sells. The marketing
       * seat picks from this; everyone else needs it to understand why a good
       * product is reaching so few people.
       */
      cities: niche.cities.map((city) => {
        const open = (company.cities ?? niche.cities.map((c) => c.id)).includes(city.id);
        const region = regionById(city.id);
        return {
          ...city,
          open,
          /*
           * Where this region is, and what it costs to be foreign in it.
           *
           * A season played on the map has regions a company cannot simply
           * buy its way into: another continent is dearer and works less
           * well, a guarded market much more so, and a closed one cannot be
           * entered at all from outside. The desk says which, because the
           * alternative is a team filing an expansion that quietly does
           * nothing.
           */
          continent: region?.continent ?? null,
          access: region?.access ?? "open",
          enterable: open || !region || canEnter(region, home),
          foreign: region ? region.continent !== home : false,
        };
      }),
      /** Seats that could be filled again, for the chief executive's rehire lever. */
      dissolvedSeats: (["ceo", "cmo", "cfo", "cto", "coo"] as Role[]).filter((r) => !company.seats.includes(r)),

      /*
       * Each segment with what it actually weighs and what it expects this
       * year — the numbers the engine chooses by, not a description of them —
       * and where this company falls short. That turns "who the company is
       * for" from a flag into a bet you can see the odds of: positioning at
       * the long-haulers means nothing until you can see they want quality of
       * 55 and you have 41.
       */
      segments: niche.segments.map((s) => {
        const expected = expectationsFor(s, year);
        return {
          id: s.id, name: s.name, description: s.description,
          referencePrice: s.referencePrice, loyalty: s.loyalty,
          yours: company.customers[s.id] ?? 0,
          weights: weightsOf(s),
          taste: describeWeights(s),
          floors: expected.floors,
          priceCeiling: expected.priceCeiling,
          shortOf: shortfalls(company, s, year),
        };
      }),

      /*
       * How many people will want the company this year, at the table's
       * current draft — the forecast the operations seat sizes capacity
       * against. Worked out from what has been filed so far, so it moves as
       * the others file: a marketing seat that doubles its spend moves the
       * number the operations seat is building to.
       */
      forecast: forecastDemand({ world: { ...world, niche, year }, companyId: company.id, year, economy, draft: decisions }),
      /** What one unit of empty capacity costs for a year, so the risk can be priced as someone types. */
      idleCostPerUnit: Math.round(marketPriceOf(niche) * IDLE_RATE * 100) / 100,
      economy: { ...economy, outlookMeans: OUTLOOK_MEANS[economy.outlook] },
      /*
       * What the company is worth, and how fast this market moves.
       *
       * Both exist so a screen can show the consequence of a decision before
       * it is taken rather than after: dilution is priced against the
       * valuation, and what a year of research buys scales with the market's
       * pace. Without them a client can only guess, and a guess about how much
       * of your company you are selling is not a thing to put in front of
       * somebody.
       */
      valuation: (() => {
        const units = Object.values(company.customers).reduce((sum, n) => sum + n, 0);
        const assets = company.assets.reduce((sum, a) => sum + a.bookValue * 0.8, 0);
        return Math.max(500_000, Math.round(units * company.price * 1.2 + assets - company.debt));
      })(),
      innovationPace: niche.innovationPace,

      table: seats.map((s) => ({
        userId: s.userId,
        name: s.isBot ? [s.firstName, s.lastName].filter(Boolean).join(" ") : (s.displayName || s.firstName || "Someone"),
        role: s.role,
        title: s.role ? ROLE_TITLES[s.role as Role] : null,
        filed: !!(s.role && filedBy[s.role]),
        // Said on the desk too, not only in the lobby: this is the table you
        // spend a fortnight deciding things with.
        isBot: !!s.isBot,
        isYou: s.userId === req.user.id,
        /** For showing a face against a vote, which is the point of voting at a table. */
        avatarUrl: s.avatarUrl ?? null,
        /** How this chair stands with the room: loyalty, how good, how hard pushed. The chief executive's own is not tracked. */
        person: s.role && s.role !== "ceo" ? (() => {
          const p = personOf(company, s.role as Role);
          return { loyalty: Math.round(p.loyalty), skill: p.skill, stretch: p.stretch ?? "fair", warning: p.loyalty < WARN_AT, record: p.record ?? [] };
        })() : null,
      })),
      /** What the world is offering this year, in full, for every seat to read. */
      offers,
      /*
       * The region on the table, and where the vote stands right now.
       *
       * Counted here rather than on the screen so that what a seat is shown
       * before the year runs and what the engine does when it runs are the
       * same rule. The screen's job is to put a face next to each vote.
       */
      /*
       * The niche this table went and found, if they have one.
       *
       * Worth its own block rather than being left to be inferred from the
       * segment list: a table that spent a year's research on this should be
       * told what it bought, how long the run at those people lasts, and —
       * the part they will most want to know — whether somebody else has
       * turned up in the same corner.
       */
      ours: (() => {
        const opened = ((season.world as World | null)?.openedNiches ?? []);
        const mine = opened.find((o) => o.openedBy === venture.id || (o.alsoFoundBy ?? []).some((a) => a.companyId === venture.id));
        if (!mine) return null;

        const segment = niche.segments.find((sg) => sg.id === mine.id);
        const parent = niche.segments.find((sg) => sg.id === mine.parentId);
        const sharers = [mine.openedBy, ...(mine.alsoFoundBy ?? []).map((a) => a.companyId)].filter((id) => id !== venture.id);
        const since = year - mine.openedInYear;
        return {
          id: mine.id,
          name: mine.name,
          foundInYear: mine.openedInYear,
          from: parent?.name ?? mine.parentId,
          people: segment?.size ?? 0,
          /** What they pay against the segment they came from. */
          premium: Math.round((mine.priceIndex - 1) * 100),
          /** Years left before everybody else has noticed. Zero means they have. */
          headStartLeft: Math.max(0, NICHE_HEAD_START_YEARS - since),
          /** Anybody else who went looking in the same place and found the same people. */
          sharedWith: sharers.map((id) => world.companies.find((c) => c.id === id)?.name ?? "Another company"),
          /** How many of these people are yours. */
          held: Math.round(company.customers?.[mine.id] ?? 0),
        };
      })(),

      expansion: (() => {
        /*
         * Nothing at all if the operations seat is gone.
         *
         * Dissolving a seat stops that seat's decisions "this year or any year
         * after" (see `dissolve_seat` in `shared/simulation/recovery.ts`), and
         * putting the region up is operations'. Without this the other four
         * would be shown a region and asked to vote on a proposal that can
         * never be made — a card that says "operations has not put it up"
         * about a seat that no longer exists.
         */
        const announced = company.expanding
          || !company.seats.includes("coo")
          || !isUnlocked("coo", "expand", year, periods)
          ? null
          : announcedRegion({ niche, seasonId: season.id, year, open: company.cities ?? [] });
        if (!announced) return null;
        const proposed = decisions.coo?.expand === announced.id;
        /*
         * Nothing is counted until operations has put the region up, which is
         * what the engine does: a vote filed against a proposal that does not
         * exist is not a vote. Sending it anyway would draw a tally on the
         * desk that the year would then ignore.
         */
        const votes: Record<string, "yes" | "no"> = {};
        if (proposed) {
          votes.coo = "yes";
          for (const r of ["ceo", "cmo", "cfo", "cto"] as const) {
            const v = (decisions as any)[r]?.expandVote?.[announced.id];
            if (v === "yes" || v === "no") votes[r] = v;
          }
        }
        return {
          region: { id: announced.id, name: announced.name, note: announced.note },
          cost: Math.round(announced.entryCost * EXPANSION_DISCOUNT),
          proposed,
          votes,
          ...expansionOutcome(Object.values(votes)),
        };
      })(),
      /** A shock the chief executive has still to answer, if there is one. */
      shock: company.shock ?? null,
      /** What the table bought: a research report, if the marketing seat filed for one. */
      research: researchFor(decisions.cmo?.research, { niche, year, world, economy }),
      /** The product's risks and its bets, for the technology seat to point at. */
      productRisk: {
        security: Math.round(company.security ?? 0),
        data: Math.round(company.data ?? 0),
        breachChance: isUnlocked("cto", "securitySpend", year, periods) ? Math.round(breachChance(company.security, company.techDebt) * 100) : 0,
        outageChance: Math.round(outageChance(company.techDebt, 0) * 100),
        features: (company.features ?? []).map((f) => ({
          id: f.id, name: f.name, segment: f.segment, mode: f.mode,
          live: f.lands <= year && !f.flopped, flopped: !!f.flopped && f.lands <= year, lands: f.lands,
        })),
      },
      /** How good the staff are at looking after people, 0–100. */
      staffQuality: Math.round(company.staffQuality ?? STAFF_QUALITY_START),
      /** Every filed decision, so nobody has to guess what the others committed. */
      filed: decisions,
      preview,
      lastYear: lastReport?.report ?? null,
      lastFiled: lastFiled ? { decisions: lastFiled.decisions, filedBy: lastFiled.filedBy } : null,
      rivals,
      standing,

      /*
       * This seat's own objective for the year.
       *
       * Read from the row that was written when the year began rather than
       * regenerated here: the challenge is phrased against the company's
       * position at the moment it was set, and regenerating it after anything
       * has moved would quietly mark the player against a target they were
       * never shown.
       */
      challenge: mine?.challenge ?? null,
      lastChallenge: previousChallenge?.result ?? null,

      /*
       * How much trouble the company is in, and what can be done about it.
       *
       * On the desk rather than behind a separate screen, because the moment
       * that matters is the one where somebody is deciding how much to spend —
       * and "there is less than a year of costs in reach" is the single most
       * relevant thing on the page when it is true.
       */
      distress: {
        level: distressOf(company),
        ...DISTRESS_COPY[distressOf(company)],
        options: recoveryOptions(company, year),
        covenant: company.covenant ?? null,
        filed: recoveryFiled ? { kind: recoveryFiled.kind, seat: recoveryFiled.seat } : null,
      },
    });
  });

  /**
   * What this year will do to the company, as filed and with your draft on top.
   *
   * The live half of the desk: called as a seat edits (debounced on the
   * client), so the screen can show revenue, costs, profit and cash moving
   * under the hand that is moving the slider. See `@shared/simulation/projection`
   * for what is run and what is deliberately left out.
   *
   * A GET, because it changes nothing. As a POST it would count against the
   * write floor every write shares, and a seat dragging a slider for ten
   * minutes could lock themselves out of filing the decision they were
   * working towards.
   */
  app.get("/api/sim/ventures/:id/projection", isAuthenticated, async (req: any, res) => {
    const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, req.params.id));
    if (!venture) return res.status(404).json({ message: "No such company." });
    const seat = await seatOf(venture.id, req.user.id);
    // A stranger learns nothing, including that the company exists.
    if (!seat) return res.status(404).json({ message: "No such company." });

    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, venture.seasonId));
    if (!season || season.status !== "running" || !season.world) {
      return res.status(409).json({ message: "This season isn't running.", code: "not_running" });
    }

    const niche = marketOf(season)!;
    const year = season.year;
    const periods = periodsPerYear(season.cadence as Cadence);
    const world = { ...(season.world as World), niche, year };
    /** One chair: the form on this desk carries all five desks' levers. */
    const soloSeason = (season.seatCount ?? 5) <= 1;

    const { decisions: filed } = await draftFor(venture.id, year);
    const previous = year > 1 ? (await draftFor(venture.id, year - 1)).decisions : undefined;

    /*
     * The viewer's unfiled draft for their own seat, and only their own. Put
     * through the same cleaning a filing gets, so a projection cannot be asked
     * about a lever the seat does not own. Not validated beyond that: showing
     * what an overspend would do — an emergency loan, a worse rating — is
     * exactly what the projection is for.
     */
    let draft: { role: Role; decision: any; roles?: Role[]; byRole?: Partial<Record<Role, any>> } | undefined;
    if (seat.role && typeof req.query.draft === "string" && req.query.draft.length < 8_000) {
      try {
        const raw = JSON.parse(req.query.draft);
        const opts = { year: season.year, periods: periodsPerYear(season.cadence as Cadence), segmentIds: niche.segments.map((s) => s.id) };
        const cityIds = niche.cities.map((c) => c.id);
        /*
         * Split per desk, exactly as a filing is.
         *
         * One seat at a five-person table owns one desk's levers and this was
         * always `cleanDecision(seat.role, ...)`. A solo founder owns all five,
         * and their form carries all five — so cleaning it as the chief
         * executive's threw away the price, the capacity and every spend, and
         * the projection came back with the same number however the form was
         * changed. From the keyboard that reads as a screen that has stopped
         * listening, which is what was reported.
         */
        const desks: Role[] = soloSeason ? [...ROLES] : [seat.role as Role];
        const byRole = Object.fromEntries(desks.map((r) => [r, cleanDecision(r, raw, cityIds, opts)])) as Partial<Record<Role, any>>;
        draft = { role: seat.role as Role, decision: byRole[seat.role as Role], roles: desks, byRole };
      } catch {
        return res.status(400).json({ message: "That draft couldn't be read." });
      }
    }

    const { companyId: _, ...filedByRole } = filed as any;
    const pair = projectYear({
      world,
      companyId: venture.id,
      economy: economyFor(season.id, year),
      filed: filedByRole,
      previous,
      draft,
    });
    if (!pair) return res.status(404).json({ message: "No such company." });

    res.json({ year, yourRole: seat.role, ...pair });
  });

  /**
   * File this year's decision for your seat.
   *
   * Replaces whatever was there: a decision is changeable right up to the tick
   * on purpose, because the argument that makes this game worth playing
   * usually happens after somebody has already filed.
   */
  app.post("/api/sim/ventures/:id/decisions", isAuthenticated, async (req: any, res) => {
    if (!(await enforceRateLimit(res, req.user.id, "session"))) return;

    const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, req.params.id));
    if (!venture) return res.status(404).json({ message: "No such company." });

    const seat = await seatOf(venture.id, req.user.id);
    if (!seat) return res.status(404).json({ message: "No such company." });
    if (!seat.role) return res.status(409).json({ message: "You don't have a seat yet.", code: "no_seat" });

    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, venture.seasonId));
    if (!season || season.status !== "running" || !season.world) {
      return res.status(409).json({ message: "This season isn't running.", code: "not_running" });
    }
    // Refused once the year is due: the tick may already have read this year's filings.
    if (yearClosing(season)) return res.status(409).json(YEAR_CLOSING);

    const niche = marketOf(season)!;
    const world = season.world as World;
    const company = world.companies.find((c) => c.id === venture.id);
    if (!company) return res.status(404).json({ message: "No such company." });

    const role = seat.role as Role;
    /** One chair at this table means one founder holding all five desks. */
    const soloSeason = (season.seatCount ?? 5) <= 1;
    /*
     * The investors' board has removed the chief executive and is running that
     * chair itself (see `finance.ts`). Refused, not accepted and ignored: a
     * filing that silently did nothing would leave somebody believing they
     * still ran the company.
     */
    if (role === "ceo" && company.investors?.inCharge) {
      return res.status(409).json({
        code: "board_in_charge",
        message: `The board has removed the chief executive after two missed targets and is running this chair itself. Meet this year's target of £${company.investors.target.toLocaleString()} and the chair comes back.`,
      });
    }
    const payload = req.body?.decision;

    /*
     * Which desks this filing is for.
     *
     * One, normally — a seat files for its own chair and the validator takes
     * only the fields that chair owns. A solo founder holds all five, so one
     * press of Submit has to become five rows, because the engine reads
     * decisions per role and a role with no row for the year is treated as
     * absent: "that part of the year ran on last year's plan at about 60%".
     * Writing only the CEO's row would have penalised a founder for the four
     * meetings they did not hold with themselves.
     *
     * Each desk is validated and cleaned against its own lever list, so the
     * fields are split exactly as they would be if five people had filed them.
     */
    const desks: Role[] = soloSeason ? [...ROLES] : [role];

    for (const desk of desks) {
      const check = validateDecision(desk, payload, company);
      if (!check.ok) return res.status(400).json({ message: "Some of that doesn't add up.", errors: check.errors });
    }

    // Only the fields each seat owns, taken from the lever list rather than
    // from the request — the same cleaning a bot's decision goes through.
    const cleanFor = (desk: Role) => cleanDecision(desk, payload, niche.cities.map((c) => c.id), { year: season.year, periods: periodsPerYear(season.cadence as Cadence), segmentIds: niche.segments.map((s) => s.id) });
    const clean = cleanFor(role);

    await db.transaction(async (tx) => {
      for (const desk of desks) {
        await tx.insert(simDecisions)
          .values({ ventureId: venture.id, userId: req.user.id, role: desk, year: season.year, payload: cleanFor(desk), submittedAt: new Date() })
          .onConflictDoUpdate({
            target: [simDecisions.ventureId, simDecisions.role, simDecisions.year],
            set: { payload: cleanFor(desk), userId: req.user.id, submittedAt: new Date() },
          });
      }
    });

    // Hand back the table's new position, so the screen updates without a second request.
    const { decisions } = await draftFor(venture.id, season.year);
    res.json({
      ok: true,
      year: season.year,
      draft: clean,
      preview: draftPreview({ company, niche, decisions, economy: economyFor(season.id, season.year) }),
    });
  });
}

/**
 * First lever of each id wins.
 *
 * Only ever does anything for a solo founder, whose one list is five desks
 * concatenated: `expandVote` sits on four of the five chairs, and the same
 * lever offered four times is a form, not a decision. Order is the order the
 * desks are listed in, so the chief executive's copy is the one kept.
 */
function dedupeById<T extends { base: { id: string } }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter(({ base }) => !seen.has(base.id) && (seen.add(base.id), true));
}

/** What the coming year's weather means for someone who has not played before. */
const OUTLOOK_MEANS: Record<string, string> = {
  expansion: "Next year looks busier. Capacity built now gets used; capacity built late gets used by somebody else.",
  steady: "Next year looks much like this one.",
  tightening: "Next year looks thinner. Debt taken now is repaid into a worse market.",
};

/**
 * A research report, once the marketing seat has paid for one.
 *
 * Not a hint and not a nudge: the actual numbers, because the report is
 * bought with money that could have been marketing. Expectations are what
 * every segment will demand of a company next year; rivals are what the
 * incumbents are likely to charge, run through the same function that will
 * decide it.
 */
function researchFor(
  bought: string | undefined,
  input: { niche: Niche; year: number; world: World; economy: Economy },
): { kind: "expectations"; segments: { id: string; name: string; floors: { axis: string; atLeast: number }[]; priceCeiling: number }[] }
  | { kind: "rivals"; rivals: { id: string; name: string; priceNow: number; priceNext: number }[] }
  | null {
  const { niche, year, world, economy } = input;
  if (bought === "expectations") {
    return {
      kind: "expectations",
      segments: niche.segments.map((s) => {
        const next = expectationsFor(s, year + 1);
        return { id: s.id, name: s.name, floors: next.floors, priceCeiling: next.priceCeiling };
      }),
    };
  }
  if (bought === "rivals") {
    const players = world.companies.filter((c) => c.kind === "player");
    return {
      kind: "rivals",
      rivals: world.companies.filter((c) => c.kind === "incumbent").map((c) => ({
        id: c.id,
        name: c.name,
        priceNow: Math.round(c.price),
        priceNext: Math.round(incumbentYear(c, players, niche, economy).price),
      })),
    };
  }
  return null;
}
