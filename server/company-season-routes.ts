/**
 * Private training seasons: the market simulation, run by a company for its
 * own people.
 *
 *   POST /api/companies/:id/seasons                              → a new private season and its join code (run_seasons)
 *   GET  /api/companies/:id/seasons                              → the company's seasons, with how far along each is
 *   POST /api/companies/:id/seasons/:seasonId/invite             → tell colleagues there's a seat for them (run_seasons)
 *   POST /api/companies/:id/seasons/:seasonId/start              → begin year one once every table is ready (run_seasons)
 *   POST /api/companies/:id/seasons/:seasonId/resolve-year-now   → end this year now rather than at its time (run_seasons)
 *   GET  /api/companies/:id/seasons/:seasonId/report             → the staff report: who played, and how (run_seasons)
 *
 * Joining is POST /api/sim/join-code in server/simulation-routes.ts, next to
 * public matchmaking, because it fills rooms by the same rules. A private
 * season is invisible to public matchmaking — see the `companyId` checks there.
 *
 * ## Who starts it
 *
 * The company does, by pressing start — never the clock. A public season
 * starts itself the moment every room is out of the lobby, and a training
 * season used to as well; but a workshop's tables fill with bots after a
 * minute like any other, so the first table to sit down could be "ready" and
 * the season under way while half the room was still typing in the link, with
 * nowhere left for them to sit. The person running the session knows when
 * everyone is in, and the clock does not.
 *
 * What start will not do is start a table that is still arguing: every room
 * must have finished its lobby (seats taken, company named), or a year would
 * begin with a team that has no chief executive. The button says how many
 * tables are ready so the wait is visible.
 */
import type { Express } from "express";
import crypto from "node:crypto";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "./db";
import { simSeasons, simVentures, simSeats, simDecisions, simChallenges, simReports, users } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { notify } from "./notifications";
import { companyCan, logCompany } from "./company-access";
import { OUTCOME_PRICE_CENTS, OUTCOME_COPY, formatMoney } from "@shared/plans";
import { walletOf, spend, refund } from "./wallet";
import { paymentRequired } from "./entitlements";
import { companyMembersOf } from "./company-routes";
import { SEASON_CODE_ALPHABET } from "./simulation-routes";
import { startSeason, tickSeason, yearMsOf } from "./simulation-tick";
import { nicheById } from "@shared/simulation/niches";
import { ROLE_TITLES, type Role, type World } from "@shared/simulation/types";
import type { CompanyReport } from "@shared/simulation/resolve";

/** Shortest and longest year a company can choose, in minutes. Ten is about the least a table can argue a price in; a day is what the public game uses. */
export const YEAR_MINUTES_MIN = 10;
export const YEAR_MINUTES_MAX = 1440;
/** Fewer than four years and nothing a team does has time to come back to them. */
export const TRAINING_YEARS_MIN = 4;
export const TRAINING_YEARS_MAX = 14;

/**
 * Seats a company buys for a private season: five to a table, and nobody has
 * ever run a workshop for more than a few hundred. The floor of five is the
 * table itself — a season with three seats is a season nobody can play.
 */
export const SEASON_SEATS_MIN = 5;
export const SEASON_SEATS_MAX = 500;

export const joinPathFor = (code: string) => `/join-season/${code}`;

/** Eight characters of Crockford base32 from the OS's CSPRNG: 40 bits, easy to read off a projector, not worth guessing. */
function newSeasonCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) code += SEASON_CODE_ALPHABET[crypto.randomInt(SEASON_CODE_ALPHABET.length)];
  return code;
}

function isUniqueViolation(err: unknown): boolean {
  // Drizzle wraps the driver error; the code is on the cause (see pgErrorCode in simulation-routes.ts).
  for (let e: any = err, hops = 0; e && hops < 5; e = e.cause, hops++) if (e.code === "23505") return true;
  return false;
}

/** A company's season, or null with the response already sent. */
async function seasonOf(res: any, companyId: string, seasonId: string) {
  const [season] = await db.select().from(simSeasons)
    .where(and(eq(simSeasons.id, seasonId), eq(simSeasons.companyId, companyId)));
  if (!season) {
    res.status(404).json({ message: "No such season." });
    return null;
  }
  return season;
}

/** "1st", "2nd", "23rd". */
const ordinal = (n: number) => {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${tail}`;
};

/** How many years of this season have been resolved — the years anyone could have played. */
const yearsResolved = (season: typeof simSeasons.$inferSelect) =>
  season.status === "finished" ? season.totalYears : season.status === "running" ? Math.max(0, season.year - 1) : 0;

export function registerCompanySeasonRoutes(app: Express): void {
  /** Make a private season. It waits, forming, until people join with its code and their tables are ready. */
  app.post("/api/companies/:id/seasons", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const found = await companyCan(res, String(req.params.id), req.user.id, "run_seasons");
      if (!found) return;
      const body = req.body ?? {};
      const niche = nicheById(String(body.nicheId ?? ""));
      if (!niche) return res.status(400).json({ message: "Pick one of the markets.", code: "invalid_input", field: "nicheId" });

      const name = String(body.name ?? "").trim() || `${found.company.name} — ${niche.name}`;
      if (name.length < 2 || name.length > 80) return res.status(400).json({ message: "A season name is 2 to 80 characters.", code: "invalid_input", field: "name" });

      let yearMinutes: number | null = null;
      if (body.yearMinutes != null && body.yearMinutes !== "") {
        yearMinutes = Number(body.yearMinutes);
        if (!Number.isInteger(yearMinutes) || yearMinutes < YEAR_MINUTES_MIN || yearMinutes > YEAR_MINUTES_MAX) {
          return res.status(400).json({ message: `A year lasts between ${YEAR_MINUTES_MIN} and ${YEAR_MINUTES_MAX} minutes, or leave it as a day.`, code: "invalid_input", field: "yearMinutes" });
        }
        // 1440 minutes is a day; storing null keeps "a day" meaning one thing.
        if (yearMinutes === YEAR_MINUTES_MAX) yearMinutes = null;
      }
      const totalYears = body.totalYears == null || body.totalYears === "" ? TRAINING_YEARS_MAX : Number(body.totalYears);
      if (!Number.isInteger(totalYears) || totalYears < TRAINING_YEARS_MIN || totalYears > TRAINING_YEARS_MAX) {
        return res.status(400).json({ message: `A season runs ${TRAINING_YEARS_MIN} to ${TRAINING_YEARS_MAX} years.`, code: "invalid_input", field: "totalYears" });
      }

      /*
       * What a private season costs.
       *
       * The public market is free for everyone and always will be — this is
       * only the private version, run by a company for its own people, and it
       * is priced per seat. The company's **first** one is free, deliberately:
       * a workshop nobody has run before is the thing that sells the second
       * one, and charging for the trial is how a training product never gets
       * tried. "First" means the first season this company ever created, not
       * the first this month and not the first that was played — a season
       * abandoned halfway was still the free one.
       *
       * The charge lands on the person pressing the button, from their
       * balance, because that is where money lives on this platform; the
       * company audit log records who paid and how much.
       */
      const priorSeasons = await db.select({ id: simSeasons.id }).from(simSeasons)
        .where(eq(simSeasons.companyId, found.company.id)).limit(1);
      const isFirst = priorSeasons.length === 0;

      let seats = 0;
      let cents = 0;
      if (!isFirst) {
        seats = body.seats == null || body.seats === "" ? SEASON_SEATS_MIN : Number(body.seats);
        if (!Number.isInteger(seats) || seats < SEASON_SEATS_MIN || seats > SEASON_SEATS_MAX) {
          return res.status(400).json({
            message: `A season is bought ${SEASON_SEATS_MIN} to ${SEASON_SEATS_MAX} seats at a time, at ${formatMoney(OUTCOME_PRICE_CENTS.seasonSeat)} a seat.`,
            code: "invalid_input", field: "seats",
          });
        }
        cents = seats * OUTCOME_PRICE_CENTS.seasonSeat;
      }

      let paid: Awaited<ReturnType<typeof spend>> = null;
      if (cents > 0) {
        paid = await spend(req.user.id, cents, {
          outcome: "seasonSeat",
          note: `${OUTCOME_COPY.seasonSeat.name} — ${seats} seats for ${found.company.name}`,
        });
        if (!paid) {
          const wallet = await walletOf(req.user.id);
          return res.status(402).json(paymentRequired({
            message:
              `${seats} seats is ${formatMoney(cents)} at ${formatMoney(OUTCOME_PRICE_CENTS.seasonSeat)} a seat, ` +
              `and your balance is ${wallet.balanceDisplay}. Your company's first season was free; this one isn't. ` +
              `The public market stays free for everyone.`,
            label: OUTCOME_COPY.seasonSeat.name, outcome: "seasonSeat", cents, wallet,
          }));
        }
      }

      // A code clash is one in a trillion, but the unique index would turn it into a 500; try again instead.
      try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const inviteCode = newSeasonCode();
        try {
          const [season] = await db.insert(simSeasons).values({
            nicheId: niche.id, name, status: "forming", totalYears, yearMinutes,
            companyId: found.company.id, inviteCode, createdAt: new Date(),
            seatsPaid: seats, paidCents: cents,
          }).returning();
          await logCompany(found.company.id, req.user.id, "season_created", null, { seasonId: season.id, name, nicheId: niche.id, seats, paidCents: cents });
          return res.status(201).json({
            seasonId: season.id, inviteCode, joinUrl: joinPathFor(inviteCode),
            seats, paidCents: cents, firstSeasonFree: isFirst,
          });
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
        }
      }
      } catch (err) {
        // Anything that stops the season existing — a clash five times over, or
        // the insert itself failing — gives the seats back. Money for a season
        // that was never created is money taken for nothing.
        if (paid) await refund(req.user.id, cents, { outcome: "seasonSeat", note: "Refunded — the season couldn't be created" });
        throw err;
      }
      if (paid) await refund(req.user.id, cents, { outcome: "seasonSeat", note: "Refunded — the season couldn't be created" });
      res.status(500).json({ message: "Couldn't make a join code. Try again." });
    } catch (error) {
      console.error("Company season create error:", error);
      res.status(500).json({ message: "Couldn't create that season." });
    }
  });

  /** The company's seasons. Every member sees them and their join links — joining is what members are for. */
  app.get("/api/companies/:id/seasons", isAuthenticated, async (req: any, res) => {
    try {
      const found = await companyCan(res, String(req.params.id), req.user.id, "view");
      if (!found) return;
      const seasons = await db.select().from(simSeasons)
        .where(eq(simSeasons.companyId, found.company.id)).orderBy(desc(simSeasons.createdAt)).limit(50);
      const ventures = seasons.length === 0 ? [] : await db
        .select({ id: simVentures.id, seasonId: simVentures.seasonId, phase: simVentures.phase })
        .from(simVentures).where(inArray(simVentures.seasonId, seasons.map((s) => s.id)));
      const seats = ventures.length === 0 ? [] : await db
        .select({ ventureId: simSeats.ventureId, userId: simSeats.userId, isBot: users.isBot })
        .from(simSeats).innerJoin(users, eq(users.id, simSeats.userId))
        .where(inArray(simSeats.ventureId, ventures.map((v) => v.id)));

      res.json({
        seasons: seasons.map((s) => {
          const rooms = ventures.filter((v) => v.seasonId === s.id && v.phase !== "retired");
          const roomIds = new Set(rooms.map((r) => r.id));
          const inRooms = seats.filter((x) => roomIds.has(x.ventureId));
          const mine = inRooms.find((x) => x.userId === req.user.id);
          return {
            id: s.id,
            name: s.name,
            status: s.status,
            niche: { id: s.nicheId, name: nicheById(s.nicheId)?.name ?? s.nicheId },
            /** The year being played now; past the last one once it's over. */
            year: s.year,
            totalYears: s.totalYears,
            yearMinutes: s.yearMinutes,
            nextTickAt: s.nextTickAt,
            rooms: rooms.length,
            roomsReady: rooms.filter((r) => r.phase === "running").length,
            players: inRooms.filter((x) => !x.isBot).length,
            bots: inRooms.filter((x) => x.isBot).length,
            inviteCode: s.inviteCode,
            joinUrl: s.inviteCode ? joinPathFor(s.inviteCode) : null,
            myVentureId: mine?.ventureId ?? null,
            createdAt: s.createdAt,
          };
        }),
      });
    } catch (error) {
      console.error("Company season list error:", error);
      res.status(500).json({ message: "Couldn't load the seasons." });
    }
  });

  /**
   * Tell colleagues there's a seat for them. Only people in the company can be
   * told — anyone else in the list is skipped, not an error, since the list
   * comes from a screen that may be a moment out of date.
   */
  app.post("/api/companies/:id/seasons/:seasonId/invite", isAuthenticated, rateLimit("invite"), async (req: any, res) => {
    try {
      const found = await companyCan(res, String(req.params.id), req.user.id, "run_seasons");
      if (!found) return;
      const season = await seasonOf(res, found.company.id, String(req.params.seasonId));
      if (!season) return;
      if (season.status !== "forming" || !season.inviteCode) {
        return res.status(409).json({ message: "This season has already started, so there are no seats left to offer.", code: "season_started" });
      }
      const members = await companyMembersOf(found.company.id);
      const memberIds = new Set(members.map((m) => m.userId));
      const asked: unknown[] = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
      // No list means everyone: the common case is "tell the whole team".
      const recipients = (asked.length ? asked.map(String) : [...memberIds])
        .filter((id) => memberIds.has(id) && id !== req.user.id);
      await notify({
        recipients, actorId: req.user.id, kind: "season_invite",
        targetId: `${season.id}:${season.inviteCode}`,
        excerpt: `${found.company.name}: ${season.name}`,
      });
      res.json({ invited: recipients.length });
    } catch (error) {
      console.error("Company season invite error:", error);
      res.status(500).json({ message: "Couldn't send those invites." });
    }
  });

  /**
   * Begin year one, now that the company says everyone is in.
   *
   * Refused while any table is still in its lobby, with how many are ready, so
   * the screen can say what it is waiting for. `startSeason` takes the same
   * locks the join-by-code path takes, so nobody can sit down at a new table
   * in the instant between the check and the start and be left outside the
   * season.
   */
  app.post("/api/companies/:id/seasons/:seasonId/start", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const found = await companyCan(res, String(req.params.id), req.user.id, "run_seasons");
      if (!found) return;
      const season = await seasonOf(res, found.company.id, String(req.params.seasonId));
      if (!season) return;

      const result = await startSeason(season.id);
      switch (result.outcome) {
        case "started": {
          await logCompany(found.company.id, req.user.id, "season_started", null, { seasonId: season.id, name: season.name, teams: result.teams });
          return res.json({ status: "running", year: 1, startsAt: result.startsAt, nextTickAt: result.nextTickAt, teams: result.teams });
        }
        case "waiting":
          return res.status(409).json({
            code: "tables_not_ready",
            message: `${result.ready} of ${result.rooms} ${result.rooms === 1 ? "table is" : "tables are"} ready. Every table needs its roles taken and its company named before the season can start.`,
            rooms: result.rooms,
            ready: result.ready,
          });
        case "empty":
          return res.status(409).json({ code: "no_tables", message: "Nobody has sat down yet. Share the join link, and start once the tables are ready." });
        case "abandoned":
          return res.status(409).json({ code: "no_tables", message: "Every table in this season closed before it was ready, so there is nobody to play it." });
        default:
          return res.status(409).json({
            code: season.status === "finished" ? "not_running" : "already_started",
            message: season.status === "finished" ? "This season is over." : "This season has already started.",
          });
      }
    } catch (error) {
      console.error("Company season start error:", error);
      res.status(500).json({ message: "Couldn't start the season." });
    }
  });

  /**
   * End the year being played now, rather than when its time is up.
   *
   * The clock is moved rather than bypassed: the season's start is shifted so
   * that this year is due now and the next is a full year from now. Only
   * setting `nextTickAt` would resolve this year early and then leave the next
   * one due at its old time — which could already have passed, and a room
   * would watch two years resolve back to back.
   */
  app.post("/api/companies/:id/seasons/:seasonId/resolve-year-now", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const found = await companyCan(res, String(req.params.id), req.user.id, "run_seasons");
      if (!found) return;
      const season = await seasonOf(res, found.company.id, String(req.params.seasonId));
      if (!season) return;
      if (season.status !== "running") {
        return res.status(409).json({
          message: season.status === "forming" ? "The season hasn't started yet — its tables are still getting ready." : "This season is over.",
          code: "not_running",
        });
      }
      const now = new Date();
      const yearMs = yearMsOf(season);
      const moved = await db.update(simSeasons)
        .set({ nextTickAt: now, startsAt: new Date(now.getTime() - season.year * yearMs) })
        // Conditional on the year it read, so a tick landing in between isn't rewound.
        .where(and(eq(simSeasons.id, season.id), eq(simSeasons.year, season.year), eq(simSeasons.status, "running")))
        .returning({ id: simSeasons.id });
      if (moved.length === 0) return res.status(409).json({ message: "That year has just been resolved.", code: "already_resolved" });

      /*
       * Resolved here rather than on the next minute's pass, so the room sees
       * results while it's still in the room.
       *
       * `onlyYear` is what makes the double-click safe, and the update above
       * is not: it tests `year` and doesn't change it, so a second request
       * matches the same row just as happily and both arrive here. The lock
       * inside tickSeason serialises them, but serialising is not enough on
       * its own — by the time the second one has the lock, next_tick_at is in
       * the past and the season is on the following year, so it would resolve
       * that one and answer 200. Naming the year turns the loser into the 409
       * it should always have been.
       */
      const resolved = await tickSeason(season.id, now, { onlyYear: season.year });
      if (resolved == null) return res.status(409).json({ message: "That year has just been resolved.", code: "already_resolved" });
      const [after] = await db.select({ year: simSeasons.year, status: simSeasons.status, nextTickAt: simSeasons.nextTickAt })
        .from(simSeasons).where(eq(simSeasons.id, season.id));
      res.json({ resolvedYear: resolved, year: after?.year, status: after?.status, nextTickAt: after?.nextTickAt });
    } catch (error) {
      console.error("Company season resolve error:", error);
      res.status(500).json({ message: "Couldn't resolve the year." });
    }
  });

  /**
   * The staff report: for each colleague who played, what they did and how
   * their table did.
   *
   * Everything in it is counted from what was stored — decisions filed,
   * objectives set and marked, the engine's own year reports. The one line of
   * prose is assembled from those numbers and says nothing they don't.
   */
  app.get("/api/companies/:id/seasons/:seasonId/report", isAuthenticated, async (req: any, res) => {
    try {
      const found = await companyCan(res, String(req.params.id), req.user.id, "run_seasons");
      if (!found) return;
      const season = await seasonOf(res, found.company.id, String(req.params.seasonId));
      if (!season) return;

      const members = await companyMembersOf(found.company.id);
      const memberIds = members.map((m) => m.userId);
      const ventures = await db.select().from(simVentures).where(eq(simVentures.seasonId, season.id));
      const allSeats = ventures.length === 0 || memberIds.length === 0 ? [] : await db.select().from(simSeats)
        .where(and(inArray(simSeats.ventureId, ventures.map((v) => v.id)), inArray(simSeats.userId, memberIds)));
      /*
       * One row per person. Somebody whose first table closed in the lobby and
       * who joined another holds two seats in the season; the report is about
       * the table they actually played at, so a seat on a live table wins, and
       * failing that their latest one.
       */
      const live = new Set(ventures.filter((v) => v.phase !== "retired").map((v) => v.id));
      const bestSeat = new Map<string, (typeof allSeats)[number]>();
      for (const seat of allSeats) {
        const held = bestSeat.get(seat.userId);
        const better = !held
          || (live.has(seat.ventureId) && !live.has(held.ventureId))
          || (live.has(seat.ventureId) === live.has(held.ventureId) && seat.joinedAt.getTime() > held.joinedAt.getTime());
        if (better) bestSeat.set(seat.userId, seat);
      }
      const seats = [...bestSeat.values()];

      const played = yearsResolved(season);
      const ventureIds = [...new Set(seats.map((s) => s.ventureId))];
      const decisions = ventureIds.length === 0 ? [] : await db
        .select({ ventureId: simDecisions.ventureId, userId: simDecisions.userId, role: simDecisions.role, year: simDecisions.year, payload: simDecisions.payload })
        .from(simDecisions).where(inArray(simDecisions.ventureId, ventureIds));
      const challenges = ventureIds.length === 0 ? [] : await db
        .select({ ventureId: simChallenges.ventureId, userId: simChallenges.userId, role: simChallenges.role, year: simChallenges.year, outcome: simChallenges.outcome })
        .from(simChallenges).where(and(inArray(simChallenges.ventureId, ventureIds), isNotNull(simChallenges.outcome)));
      const reports = await db.select({ companyId: simReports.companyId, year: simReports.year, report: simReports.report })
        .from(simReports).where(eq(simReports.seasonId, season.id));

      const world = season.world as World | null;
      const latestYear = reports.reduce((m, r) => Math.max(m, r.year), 0);
      const inLatestYear = reports.filter((r) => r.year === latestYear).length;

      const players = seats.map((seat) => {
        const member = members.find((m) => m.userId === seat.userId)!;
        const venture = ventures.find((v) => v.id === seat.ventureId)!;
        const role = seat.role as Role | null;
        // Filed against this seat by this person: one row per year at most (the unique index).
        const mine = decisions.filter((d) => d.ventureId === seat.ventureId && d.userId === seat.userId && (!role || d.role === role));
        const filedYears = new Set(mine.filter((d) => d.year <= played).map((d) => d.year));
        const filedThisYear = season.status === "running" && mine.some((d) => d.year === season.year);
        const marked = challenges.filter((c) => c.ventureId === seat.ventureId && c.userId === seat.userId);
        const tally = {
          met: marked.filter((c) => c.outcome === "met").length,
          partial: marked.filter((c) => c.outcome === "partial").length,
          missed: marked.filter((c) => c.outcome === "missed").length,
        };
        const own = reports.filter((r) => r.companyId === seat.ventureId).sort((a, b) => b.year - a.year)[0];
        const report = own?.report as CompanyReport | undefined;
        const teamsThatYear = own ? reports.filter((r) => r.year === own.year).length : inLatestYear;

        /*
         * Price against the market, for the seat that sets it. The team's price
         * as the world last saw it, against the plain average of everyone else
         * selling in the same market — the comparison a customer makes.
         */
        let priceVsMarket: number | null = null;
        if (role === "cmo" && world?.companies?.length) {
          const us = world.companies.find((c) => c.id === seat.ventureId);
          const others = world.companies.filter((c) => c.id !== seat.ventureId && Number.isFinite(c.price) && c.price > 0);
          if (us && others.length) {
            const average = others.reduce((sum, c) => sum + c.price, 0) / others.length;
            priceVsMarket = Math.round(((us.price - average) / average) * 100);
          }
        }

        const parts: string[] = [];
        if (played === 0) parts.push(season.status === "forming" ? "Waiting for the season to start" : "No years resolved yet");
        else parts.push(filedYears.size === played ? `Filed all ${played} year${played === 1 ? "" : "s"}` : `Filed ${filedYears.size} of ${played} years`);
        const setTotal = tally.met + tally.partial + tally.missed;
        if (setTotal > 0) parts.push(`met ${tally.met} of ${setTotal} objectives${tally.partial ? ` (${tally.partial} partly)` : ""}`);
        if (priceVsMarket != null) {
          parts.push(priceVsMarket === 0 ? "priced in line with the market"
            : `priced ${Math.abs(priceVsMarket)}% ${priceVsMarket > 0 ? "above" : "below"} the market`);
        }
        if (report) {
          parts.push(season.status === "finished"
            ? `team finished ${ordinal(report.rank)} of ${teamsThatYear}`
            : `team ${ordinal(report.rank)} of ${teamsThatYear} after year ${own!.year}`);
        }
        if (venture.phase === "retired" && season.status !== "finished") parts.push("their table closed before the season started");

        return {
          userId: seat.userId,
          name: member.name,
          avatarUrl: member.avatarUrl,
          role,
          roleTitle: role ? ROLE_TITLES[role] ?? role : null,
          ventureId: seat.ventureId,
          teamName: venture.name,
          yearsFiled: filedYears.size,
          yearsPlayed: played,
          filedThisYear,
          challenges: tally,
          reportYear: own?.year ?? null,
          rank: report?.rank ?? null,
          companiesInMarket: report ? teamsThatYear : null,
          marketShare: report?.marketShare ?? null,
          founderValue: report?.founderValue ?? null,
          profit: report?.profit ?? null,
          priceVsMarket,
          read: `${parts.join("; ")}.`,
        };
      });

      const seated = new Set(players.map((p) => p.userId));
      res.json({
        season: {
          id: season.id, name: season.name, status: season.status, year: season.year,
          totalYears: season.totalYears, yearsResolved: played, niche: { id: season.nicheId, name: nicheById(season.nicheId)?.name ?? season.nicheId },
        },
        players: players.sort((a, b) => (a.teamName ?? "").localeCompare(b.teamName ?? "") || a.name.localeCompare(b.name)),
        notPlaying: members.filter((m) => !seated.has(m.userId)).map((m) => ({ userId: m.userId, name: m.name })),
      });
    } catch (error) {
      console.error("Company season report error:", error);
      res.status(500).json({ message: "Couldn't build the report." });
    }
  });
}
