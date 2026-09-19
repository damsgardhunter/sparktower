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
import { enforceRateLimit } from "./moderation";
import { nicheById } from "@shared/simulation/niches";
import { ROLE_TITLES, ROLE_LEVERS, type Role, type World, type Company } from "@shared/simulation/types";
import type { TeamDecisions } from "@shared/simulation/decisions";
import { LEVER_FIELDS, cleanDecision, defaultDraft, validateDecision, draftPreview } from "@shared/simulation/levers";
import { economyFor } from "@shared/simulation/season";
import { debtDrag } from "@shared/simulation/decisions";
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
      niche: { id: niche.id, name: niche.name, premise: niche.premise },
      year,
      totalYears: season.totalYears,
      /** Null when the season has finished; otherwise when this year resolves. */
      resolvesAt: season.nextTickAt,

      yourRole: seat.role,
      yourTitle: seat.role ? ROLE_TITLES[seat.role as Role] : null,
      yourLevers: seat.role ? ROLE_LEVERS[seat.role as Role] : [],
      /*
       * The seat's levers, with the ones whose choices depend on this company
       * filled in: which seats could be rehired, and which segments this market
       * actually has. A static list cannot know either.
       */
      fields: seat.role ? LEVER_FIELDS[seat.role as Role].map((field) => {
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
        capacity: company.capacity,
        unitCost: Math.round(company.unitCost * 100) / 100,
        price: Math.round(company.price),
        customers: Object.values(company.customers).reduce((sum, n) => sum + n, 0),
        bankruptSince: company.bankruptSince ?? null,
        /** What the founders still own. Raising money is what spends this. */
        founderShare: company.founderShare ?? 1,
        /** Research finished and not yet shipped — it lands next year, whatever happens. */
        pipeline: Math.round((company.pipeline ?? 0) * 10) / 10,
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

      segments: niche.segments.map((s) => ({
        id: s.id, name: s.name, description: s.description,
        referencePrice: s.referencePrice, loyalty: s.loyalty,
        yours: company.customers[s.id] ?? 0,
      })),
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
      })),
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
    const payload = req.body?.decision;
    const check = validateDecision(role, payload, company);
    if (!check.ok) return res.status(400).json({ message: "Some of that doesn't add up.", errors: check.errors });

    // Only the fields this seat owns, taken from the lever list rather than
    // from the request — the same cleaning a bot's decision goes through.
    const clean = cleanDecision(role, payload, niche.cities.map((c) => c.id));

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
