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
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { simSeasons, simSeats, simVentures, simDecisions, simReports, simChallenges, simRecoveryMoves, users, userProfiles } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { enforceRateLimit, rateLimit } from "./moderation";
import { nicheById } from "@shared/simulation/niches";
import { ROLE_TITLES, ROLE_LEVERS, type Role, type World, type Company, type Niche, type Economy } from "@shared/simulation/types";
import type { TeamDecisions } from "@shared/simulation/decisions";
import { LEVER_FIELDS, cleanDecision, defaultDraft, validateDecision, draftPreview, speak } from "@shared/simulation/levers";
import { economyFor } from "@shared/simulation/season";
import { debtDrag, IDLE_RATE, marketPriceOf } from "@shared/simulation/decisions";
import { weightsOf, expectationsFor, shortfalls, describeWeights } from "@shared/simulation/criteria";
import { forecastDemand } from "@shared/simulation/forecast";
import { projectYear } from "@shared/simulation/projection";
import { advanceAuthority, advanceSeasonNow, warnIfDevAdvance } from "./season-control";
import { mfaGate, mfaRequiredFor, mfaSatisfied } from "./mfa";
import { SPENDING_SEATS, arrivingIn, buildCostPerUnit, isUnlocked, leaseCostPerUnit, unlockYear } from "@shared/simulation/responsibilities";
import { STAFF_QUALITY_START, WARN_AT, overrulable, personOf } from "@shared/simulation/people";
import { breachChance, featureCost, featureMenu, outageChance } from "@shared/simulation/product";
import {
  EXPANSION_DISCOUNT, PROGRAMMES, announcedRegion, dealsFor, programmeCost, researchCost, statementCost,
  type ProgrammeId,
} from "@shared/simulation/world";
import { valuation } from "@shared/simulation/mergers";
import { incumbentYear } from "@shared/simulation/incumbents";
import { assetEffects } from "@shared/simulation/assets";
import { RATING_START, interestOn, ratingGrade } from "@shared/simulation/finance";
import { postureBlurb } from "@shared/simulation/incumbents";
import { distressOf, DISTRESS_COPY, recoveryOptions } from "@shared/simulation/recovery";
import { startReadySeasons } from "./simulation-tick";

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
      });
    }

    const niche = nicheById(season.nicheId)!;
    const world = season.world as World;
    const company = world.companies.find((c) => c.id === venture.id);
    if (!company) return res.status(404).json({ message: "No such company." });

    const year = season.year;
    const { decisions, filedBy } = await draftFor(venture.id, year);
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
      .select({ userId: simSeats.userId, role: simSeats.role, firstName: users.firstName, lastName: users.lastName, isBot: users.isBot, displayName: userProfiles.displayName })
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

    res.json({
      phase: season.status === "finished" ? "finished" : "running",
      ventureId: venture.id,
      name: venture.name,
      product: venture.product,
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
      /** Null when the season has finished; otherwise when this year resolves. */
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
      yourTitle: seat.role ? ROLE_TITLES[seat.role as Role] : null,
      yourLevers: seat.role ? ROLE_LEVERS[seat.role as Role] : [],
      /*
       * The seat's levers, with the ones whose choices depend on this company
       * filled in: which seats could be rehired, and which segments this market
       * actually has. A static list cannot know either.
       */
      fields: seat.role ? LEVER_FIELDS[seat.role as Role]
        // Only what this seat has by now: responsibilities arrive a year at a time (see UNLOCKS).
        .filter((base) => isUnlocked(seat.role as Role, base.id, year))
        .map((base) => {
        // Said in this market's words first, then filled in with the choices
        // that depend on this particular company.
        const unlocksIn = unlockYear(seat.role as Role, base.id);
        const field = { ...speak(base, niche.voice), ...(unlocksIn > 1 ? { unlocksIn } : {}) };
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
        // The region announced for next year, if the company has not committed to one already.
        if (field.id === "expand") {
          const announced = company.expanding ? null : announcedRegion({ niche, seasonId: season.id, year, open: company.cities ?? [] });
          return {
            ...field,
            options: announced
              ? [
                  { value: "", label: "Not this year", help: "The announcement stands; somebody else may take it." },
                  { value: announced.id, label: `Open ${announced.name}`, help: `${announced.note} ${Math.round(announced.entryCost * EXPANSION_DISCOUNT).toLocaleString()} now, opening next year — and in its first year you reach only as far as the brand does.` },
                ]
              : [],
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
        expansion: Math.round((announcedRegion({ niche, seasonId: season.id, year, open: company.cities ?? [] })?.entryCost ?? 0) * EXPANSION_DISCOUNT),
      },
      /** The levers this seat gets next year, by label, so nobody is surprised by them. */
      arrivingNextYear: seat.role
        ? arrivingIn(seat.role as Role, year + 1).map((id) => LEVER_FIELDS[seat.role as Role].find((f) => f.id === id)?.label ?? id)
        : [],
      /** What to show in the form: what they filed already, else last year's, else a sensible opening. */
      draft: seat.role
        ? (decisions as any)[seat.role] ?? defaultDraft(seat.role as Role, company, (previous as any)?.[seat.role])
        : null,
      submitted: seat.role ? !!(decisions as any)[seat.role] : false,

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
      },
      /*
       * Where the market exists, and where this company sells. The marketing
       * seat picks from this; everyone else needs it to understand why a good
       * product is reaching so few people.
       */
      cities: niche.cities.map((city) => ({
        ...city,
        open: (company.cities ?? niche.cities.map((c) => c.id)).includes(city.id),
      })),
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
        /** How this chair stands with the room: loyalty, how good, how hard pushed. The chief executive's own is not tracked. */
        person: s.role && s.role !== "ceo" ? (() => {
          const p = personOf(company, s.role as Role);
          return { loyalty: Math.round(p.loyalty), skill: p.skill, stretch: p.stretch ?? "fair", warning: p.loyalty < WARN_AT, record: p.record ?? [] };
        })() : null,
      })),
      /** What the world is offering this year, in full, for every seat to read. */
      offers,
      /** A shock the chief executive has still to answer, if there is one. */
      shock: company.shock ?? null,
      /** What the table bought: a research report, if the marketing seat filed for one. */
      research: researchFor(decisions.cmo?.research, { niche, year, world, economy }),
      /** The product's risks and its bets, for the technology seat to point at. */
      productRisk: {
        security: Math.round(company.security ?? 0),
        data: Math.round(company.data ?? 0),
        breachChance: isUnlocked("cto", "securitySpend", year) ? Math.round(breachChance(company.security, company.techDebt) * 100) : 0,
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
      rivals,

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

    const niche = nicheById(season.nicheId)!;
    const year = season.year;
    const world = { ...(season.world as World), niche, year };

    const { decisions: filed } = await draftFor(venture.id, year);
    const previous = year > 1 ? (await draftFor(venture.id, year - 1)).decisions : undefined;

    /*
     * The viewer's unfiled draft for their own seat, and only their own. Put
     * through the same cleaning a filing gets, so a projection cannot be asked
     * about a lever the seat does not own. Not validated beyond that: showing
     * what an overspend would do — an emergency loan, a worse rating — is
     * exactly what the projection is for.
     */
    let draft: { role: Role; decision: any } | undefined;
    if (seat.role && typeof req.query.draft === "string" && req.query.draft.length < 8_000) {
      try {
        const raw = JSON.parse(req.query.draft);
        draft = { role: seat.role as Role, decision: cleanDecision(seat.role as Role, raw, niche.cities.map((c) => c.id), { year: season.year, segmentIds: niche.segments.map((s) => s.id) }) };
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

    const niche = nicheById(season.nicheId)!;
    const world = season.world as World;
    const company = world.companies.find((c) => c.id === venture.id);
    if (!company) return res.status(404).json({ message: "No such company." });

    const role = seat.role as Role;
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
    const check = validateDecision(role, payload, company);
    if (!check.ok) return res.status(400).json({ message: "Some of that doesn't add up.", errors: check.errors });

    // Only the fields this seat owns, taken from the lever list rather than
    // from the request — the same cleaning a bot's decision goes through.
    const clean = cleanDecision(role, payload, niche.cities.map((c) => c.id), { year: season.year, segmentIds: niche.segments.map((s) => s.id) });

    await db.insert(simDecisions)
      .values({ ventureId: venture.id, userId: req.user.id, role, year: season.year, payload: clean })
      .onConflictDoUpdate({
        target: [simDecisions.ventureId, simDecisions.role, simDecisions.year],
        set: { payload: clean, userId: req.user.id, submittedAt: new Date() },
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
