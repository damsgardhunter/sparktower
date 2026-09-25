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
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "./db";
import { simSeasons, simVentures, simSeats, simDecisions, simChallenges, simReports, simSeatPurchases, users, companies } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { notify } from "./notifications";
import { companyCan, logCompany } from "./company-access";
import { OUTCOME_PRICE_CENTS, OUTCOME_COPY, formatMoney } from "@shared/plans";
import { walletOf, spend, refund, devUnlimited } from "./wallet";
import { paymentRequired } from "./entitlements";
import { companyMembersOf } from "./company-routes";
import { SEASON_CODE_ALPHABET } from "./simulation-routes";
import { startSeason, tickSeason, periodMsOf } from "./simulation-tick";
import { nicheById } from "@shared/simulation/niches";
import { ROLE_TITLES, type Role, type World } from "@shared/simulation/types";
import type { CompanyReport } from "@shared/simulation/resolve";
import { isContinent } from "@shared/simulation/geography";
import { CADENCES, DEFAULT_YEARS, PERIOD_NAME, periodsPerYear, totalPeriods, yearsMax, yearsMin, type Cadence } from "@shared/simulation/cadence";
import { seatBotCompanies } from "./simulation-bots";
import { buildSimulationPrompt, parseSimulationBrief } from "./nova-simulation";
import { getOpenAI, openAiConfigured } from "./openai-client";
import { requireCredits, modelFor } from "./entitlements";
import { CREDIT_COSTS } from "@shared/plans";
import { respondToAiError } from "./ai-json";
import { storage } from "./storage";
import { pathStatus } from "./phase-trees";
import { isStripeConfigured, getUncachableStripeClient } from "./stripeClient";
import { ensureStripeCustomer } from "./stripe-customer";
import { marketNameOf } from "./simulation-scope";

/**
 * Shortest and longest *decision* a company can choose, in minutes.
 *
 * Ten is about the least a table can argue a price in; a day is what the
 * public game uses. This is how much real time one decision gets, which is a
 * separate question from how much simulated time it covers — see
 * `DEFAULT_YEARS` in cadence.ts for why those two are deliberately unhooked.
 */
export const PERIOD_MINUTES_MIN = 10;
export const PERIOD_MINUTES_MAX = 1440;
/**
 * How long a season runs, in simulated years.
 *
 * The real rule is counted in decisions, not years — fewer than four and
 * nothing a team does has time to come back to them — so the bounds depend on
 * the cadence. See `yearsMin` / `yearsMax`. These two stay for the yearly
 * season, which is what most callers still mean.
 */
export const TRAINING_YEARS_MIN = 4;
export const TRAINING_YEARS_MAX = 14;
/**
 * The most companies of bots a season can be seated with.
 *
 * A season with one real table in it is a company with no competition, which
 * teaches the wrong lesson about every decision taken in it. Fifty is the
 * ceiling because a year resolves every company in one pass, and because a
 * market with fifty companies in it is already a crowd.
 */
export const BOT_TEAMS_MAX = 50;
/**
 * What a seat costs, in cents. A seat is for the life of a season, not a month.
 *
 * Two prices, because two different things are being sold. A `play` seat is a
 * person at a table in one of the markets we wrote, taken as it is. A `nova`
 * seat is a person at a table in a season Nova built by reading the company's
 * own project — which costs a model call and is worth more, so it costs more.
 *
 * And two more for how often the table decides. A season run in quarters asks
 * four times as many decisions of the same people and a monthly one twelve —
 * more of the product, and more of everything behind it — so they are their
 * own seats at $6 and $10.
 *
 * They are separate balances rather than one with a discount: buying ten Nova
 * seats does not leave you ten play seats, and buying ten play seats does not
 * entitle you to have Nova build anything. A quarterly seat is the whole of a
 * play seat and the cadence, so somebody holding one needs nothing else.
 */
export const SEAT_PRICE_CENTS = { play: 300, nova: 500, quarterly: 600, monthly: 1000 } as const;
export type SeatKind = keyof typeof SEAT_PRICE_CENTS;

/** What each seat is called when somebody is told they need one. */
export const SEAT_LABEL: Record<SeatKind, string> = {
  play: "play", nova: "Nova", quarterly: "quarterly", monthly: "monthly",
};
export const SEAT_PITCH: Record<SeatKind, string> = {
  play: "A season from our markets",
  nova: "A season Nova builds from your project",
  quarterly: "A season decided four times a year",
  monthly: "A season decided every month",
};

/**
 * Whether a developer may start a season they have not paid for.
 *
 * Local development only, never production — the same rule and the same shape
 * as `devAdvanceOn` in season-control.ts, for the same reason: a switch that
 * can be left on in production is a paywall that is not one.
 */
export const freeSeatsOn = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.SIM_DEV_FREE_SEATS === "1" && env.NODE_ENV !== "production";
export const SEAT_KINDS = Object.keys(SEAT_PRICE_CENTS) as SeatKind[];
const isSeatKind = (v: unknown): v is SeatKind => SEAT_KINDS.includes(v as SeatKind);
/**
 * Which balance a season is paid for from.
 *
 * How often the table decides outranks where the market came from: a monthly
 * season is a monthly season whether Nova wrote the market or we did, and it
 * is the dearer thing. A yearly season falls back to what it has always been.
 */
export const seatKindFor = (origin: string | null | undefined, cadence?: string | null): SeatKind => {
  if (cadence === "monthly") return "monthly";
  if (cadence === "quarterly") return "quarterly";
  return origin === "nova" ? "nova" : "play";
};
/** The column each kind of seat is banked in, so a purchase and the gate agree on where to look. */
export const SEAT_COLUMN = {
  play: "simPlaySeatsPaid",
  nova: "simNovaSeatsPaid",
  quarterly: "simQuarterlySeatsPaid",
  monthly: "simMonthlySeatsPaid",
} as const satisfies Record<SeatKind, keyof typeof companies.$inferSelect>;

/** What a company holds of each seat. */
export const seatsHeld = (company: {
  simPlaySeatsPaid?: number | null; simNovaSeatsPaid?: number | null;
  simQuarterlySeatsPaid?: number | null; simMonthlySeatsPaid?: number | null;
}) => ({
  play: company.simPlaySeatsPaid ?? 0,
  nova: company.simNovaSeatsPaid ?? 0,
  quarterly: company.simQuarterlySeatsPaid ?? 0,
  monthly: company.simMonthlySeatsPaid ?? 0,
});
/**
 * How many people are sitting in this season, and how many it has been paid for.
 *
 * One function because the answer is now asked in three places — inviting
 * somebody, sitting down, and pressing start — and three implementations of
 * "has this been paid for" is three different paywalls. It used to be asked
 * only at the start, which meant a workshop could invite forty people, watch
 * all forty join and go through the lobby, and discover the bill only when
 * the organiser pressed the button with everyone already seated. The charge
 * is unchanged; what changes is that it is now knowable before anybody has
 * wasted their time.
 *
 * Bots are not people and are not counted, which is why `users.isBot` is
 * joined rather than trusted from the seat row.
 */
export async function seatCensus(
  season: { id: string; origin?: string | null; cadence?: string | null },
  company: Parameters<typeof seatsHeld>[0],
): Promise<{ kind: SeatKind; seated: number; paid: number; free: number }> {
  const kind = seatKindFor(season.origin, season.cadence);
  const seated = await db
    .selectDistinct({ userId: simSeats.userId })
    .from(simSeats)
    .innerJoin(simVentures, eq(simVentures.id, simSeats.ventureId))
    .innerJoin(users, eq(users.id, simSeats.userId))
    .where(and(eq(simVentures.seasonId, season.id), eq(users.isBot, false)));
  const paid = seatsHeld(company)[kind];
  return { kind, seated: seated.length, paid, free: Math.max(0, paid - seated.length) };
}

/** The 402 body for a season short of seats, worded for whoever hit it. */
export const seatsRequired = (
  kind: SeatKind, seated: number, paid: number, message: string,
) => ({
  code: "seats_required" as const,
  message,
  seatKind: kind,
  pricePerSeat: SEAT_PRICE_CENTS[kind] / 100,
  people: seated,
  paid,
  shortBy: Math.max(1, seated - paid),
});

/** The most seats one checkout can carry, so a typo is not a four-figure charge. */
export const SEATS_PER_PURCHASE_MAX = 250;

/**
 * Seats a company buys for a private season: five to a table, and nobody has
 * ever run a workshop for more than a few hundred. The floor of five is the
 * table itself — a season with three seats is a season nobody can play.
 */
export const SEASON_SEATS_MIN = 5;
export const SEASON_SEATS_MAX = 500;

export const joinPathFor = (code: string) => `/join-season/${code}`;

/** Eight characters of Crockford base32 from the OS's CSPRNG: 40 bits, easy to read off a projector, not worth guessing. */
export function newSeasonCode(): string {
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

      /*
       * How often the table will decide. Refused rather than quietly
       * downgraded if it is not one of the three: somebody who asked for a
       * monthly season and got a yearly one has been sold the wrong thing.
       */
      const cadence = (body.cadence === undefined || body.cadence === "" ? "yearly" : String(body.cadence)) as Cadence;
      if (!CADENCES.includes(cadence)) {
        return res.status(400).json({ message: "A season runs in years, quarters or months.", code: "invalid_input", field: "cadence" });
      }

      const name = String(body.name ?? "").trim() || `${found.company.name} — ${niche.name}`;
      if (name.length < 2 || name.length > 80) return res.status(400).json({ message: "A season name is 2 to 80 characters.", code: "invalid_input", field: "name" });

      const period = PERIOD_NAME[cadence].one;
      let periodMinutes: number | null = null;
      if (body.periodMinutes != null && body.periodMinutes !== "") {
        periodMinutes = Number(body.periodMinutes);
        if (!Number.isInteger(periodMinutes) || periodMinutes < PERIOD_MINUTES_MIN || periodMinutes > PERIOD_MINUTES_MAX) {
          return res.status(400).json({ message: `A ${period} lasts between ${PERIOD_MINUTES_MIN} and ${PERIOD_MINUTES_MAX} minutes, or leave it as a day.`, code: "invalid_input", field: "periodMinutes" });
        }
        // 1440 minutes is a day; storing null keeps "a day" meaning one thing.
        if (periodMinutes === PERIOD_MINUTES_MAX) periodMinutes = null;
      }
      /*
       * How much of the world, and who else is in it.
       *
       * Both default to the game as it has always been — the market's own
       * regions, and nobody but the people who were invited — because a
       * company that just wants a season should get one without answering
       * questions about continents.
       */
      const scope = String(body.scope ?? "home");
      if (scope !== "home" && scope !== "world" && !isContinent(scope)) {
        return res.status(400).json({ message: "That isn't a place to play.", code: "invalid_input", field: "scope" });
      }
      const botTeams = body.botTeams == null || body.botTeams === "" ? 0 : Number(body.botTeams);
      if (!Number.isInteger(botTeams) || botTeams < 0 || botTeams > BOT_TEAMS_MAX) {
        return res.status(400).json({ message: `A season can seat up to ${BOT_TEAMS_MAX} companies of bots.`, code: "invalid_input", field: "botTeams" });
      }

      /*
       * How much simulated time the season covers, in years, whatever the
       * cadence. The bounds are really about how many *decisions* that comes
       * to, so they narrow as the cadence gets finer: fourteen simulated
       * years of monthly decisions is a hundred and sixty-eight of them.
       */
      const yearsLow = yearsMin(cadence);
      const yearsHigh = yearsMax(cadence);
      const totalYears = body.totalYears == null || body.totalYears === "" ? DEFAULT_YEARS[cadence] : Number(body.totalYears);
      if (!Number.isInteger(totalYears) || totalYears < yearsLow || totalYears > yearsHigh) {
        return res.status(400).json({
          message: yearsLow === yearsHigh
            ? `A ${cadence} season runs ${yearsLow} ${yearsLow === 1 ? "year" : "years"}.`
            : `A ${cadence} season runs ${yearsLow} to ${yearsHigh} years — that is ${totalPeriods(yearsLow, cadence)} to ${totalPeriods(yearsHigh, cadence)} ${PERIOD_NAME[cadence].many} of decisions.`,
          code: "invalid_input", field: "totalYears",
        });
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
        /*
         * Credited to the company, because otherwise this is the same seat
         * sold twice.
         *
         * Two branches grew a way of charging for a seat and the merge brought
         * both: this one, which takes the money when a season is created, and
         * the gate on starting one, which counts the seats the company holds
         * and refuses until it holds enough. Each is defensible alone. Together
         * a company paid $3 a seat here and was then told at the door that it
         * owned none, and had to buy them again — the second purchase being
         * the one that actually let anybody play.
         *
         * Making this payment grant what the gate asks for settles it without
         * removing either: one charge, and the sentence the copy has always
         * ended on ("seats stay with the company for every season after this
         * one") becomes true rather than aspirational.
         */
        if (paid) {
          const kind = seatKindFor("catalogue", cadence);
          await db.update(companies)
            .set({ [SEAT_COLUMN[kind]]: sql`${companies[SEAT_COLUMN[kind]]} + ${seats}` })
            .where(eq(companies.id, found.company.id));
        }
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
            nicheId: niche.id, name, status: "forming", totalYears, periodMinutes,
            companyId: found.company.id, inviteCode, createdAt: new Date(),
            seatsPaid: seats, paidCents: cents,
            scope, botTeams, origin: "catalogue", cadence,
          }).returning();
          await logCompany(found.company.id, req.user.id, "season_created", null, {
            seasonId: season.id, name, nicheId: niche.id, seats, paidCents: cents, scope, botTeams, cadence,
          });
          return res.status(201).json({
            seasonId: season.id, inviteCode, joinUrl: joinPathFor(inviteCode),
            seats, paidCents: cents, firstSeasonFree: isFirst,
            scope, botTeams, cadence,
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

  /**
   * Where the project has actually got to, in the words the app already uses.
   *
   * Nova is designing a simulation of a business, and a business that has
   * shipped nothing is not the same business as one with paying customers.
   * Taken from the path when there is one, and quietly skipped when there
   * isn't — a company with no project still gets a season, built from what it
   * says about itself.
   */
  async function whereTheyAre(projectId: string): Promise<string | null> {
    try {
      const status = await pathStatus(projectId);
      if (!status?.adopted) return null;
      const phases = status.phases ?? [];
      const done = phases.reduce((sum: number, p: any) => sum + (p.done ?? 0), 0);
      const total = phases.reduce((sum: number, p: any) => sum + (p.total ?? 0), 0);
      const current = phases.find((p: any) => (p.done ?? 0) < (p.total ?? 0));
      return [
        `Path: ${status.goal ?? "unnamed"} — ${done} of ${total} milestones done.`,
        current ? `Currently: ${current.title}. Next: ${current.milestones?.find((m: any) => !m.done)?.title ?? "—"}` : "Path complete.",
      ].join("\n");
    } catch {
      return null;
    }
  }

  /**
   * What a seat costs, and how many this company has.
   *
   * A seat is a person at a table for the life of a season rather than a
   * month: buy ten, run a season for ten people, and they are still there for
   * the next one. Asked for by the screen before it offers to build anything,
   * so the price is never a surprise sprung at the end.
   */
  app.get("/api/companies/:id/simulation-seats", isAuthenticated, async (req: any, res) => {
    try {
      const found = await companyCan(res, String(req.params.id), req.user.id, "run_seasons");
      if (!found) return;
      const members = await companyMembersOf(found.company.id);
      const held = seatsHeld(found.company);
      res.json({
        people: members.length,
        currency: "usd",
        /*
         * Both balances, each with its price and what seating everyone in the
         * company would still cost. `shortBy` is against the company's people
         * because that is the most a season could ever need; the gate itself
         * counts who actually sat down, so nobody pays for a colleague who
         * never joined.
         */
        seats: SEAT_KINDS.map((kind) => ({
          kind,
          paid: held[kind],
          pricePerSeat: SEAT_PRICE_CENTS[kind] / 100,
          shortBy: Math.max(0, members.length - held[kind]),
        })),
      });
    } catch (error) {
      console.error("Simulation seats read error:", error);
      res.status(500).json({ message: "Couldn't read your seats." });
    }
  });

  /**
   * Buy seats.
   *
   * A one-off payment rather than a subscription: a seat is a person at a
   * table for the life of a season, and a company that runs one away day a
   * year should not be paying monthly for the eleven months in between.
   *
   * The seats are credited when Stripe says the money arrived, not here — see
   * the note on the webhook. A checkout that is abandoned leaves nothing
   * behind, which is the whole reason for doing it in that order.
   */
  /**
   * Buy seats out of the balance, several at a time.
   *
   * The Stripe checkout below has always sold up to 250 at once, and it is
   * the only way seats could be bought — which meant a card, a redirect and a
   * webhook for something the account may already have the money for. Every
   * other priced outcome in the product comes off the balance; seats were the
   * exception, and the effect was that a project with $40 on it could not put
   * a second person at its own table without going to Stripe.
   *
   * Credited in the same transaction that takes the money, and written to
   * `sim_seat_purchases` with no session id, so the two ways of buying a seat
   * reconcile in one place. A `spend` that comes back null took nothing.
   */
  app.post("/api/companies/:id/simulation-seats/buy", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const found = await companyCan(res, String(req.params.id), req.user.id, "run_seasons");
      if (!found) return;

      const seats = Math.round(Number(req.body?.seats));
      if (!Number.isInteger(seats) || seats < 1 || seats > SEATS_PER_PURCHASE_MAX) {
        return res.status(400).json({ message: `Buy between 1 and ${SEATS_PER_PURCHASE_MAX} seats at a time.`, code: "invalid_input", field: "seats" });
      }
      const kind = req.body?.kind ?? "play";
      if (!isSeatKind(kind)) {
        return res.status(400).json({ message: "That isn't a kind of seat.", code: "invalid_input", field: "kind" });
      }

      const cents = seats * SEAT_PRICE_CENTS[kind];
      const paid = await spend(req.user.id, cents, {
        outcome: "seasonSeat",
        note: `${seats} ${SEAT_LABEL[kind]} ${seats === 1 ? "seat" : "seats"}`,
      });
      if (!paid) {
        const wallet = await walletOf(req.user.id);
        return res.status(402).json({
          code: "payment_required",
          message: `${seats} ${seats === 1 ? "seat is" : "seats are"} $${(cents / 100).toFixed(2)}, and your balance is ${wallet.balanceDisplay}.`,
          price: { cents, display: `$${(cents / 100).toFixed(2)}` },
          wallet,
          remedy: "top_up",
        });
      }

      await db.transaction(async (tx) => {
        await tx.insert(simSeatPurchases).values({
          companyId: found.company.id, seats, kind, amount: cents,
          /*
           * Not a Stripe session, and the column says so.
           *
           * It is NOT NULL and unique — it is the "this event credited this
           * company once" key — so a balance purchase brings its own, taken
           * from the ledger line that paid for it. Namespaced for the same
           * reason `apple:` is namespaced in the wallet: two ways of paying
           * must never collide on the key that decides whether somebody's
           * money bought anything, and whoever reconciles this table against
           * Stripe can see at a glance which rows are not Stripe's.
           */
          stripeSessionId: `balance:${paid.id || crypto.randomUUID()}`,
          boughtBy: req.user.id,
        } as any);
        await tx.update(companies)
          .set({ [SEAT_COLUMN[kind]]: sql`${companies[SEAT_COLUMN[kind]]} + ${seats}` })
          .where(eq(companies.id, found.company.id));
      });

      const [after] = await db.select().from(companies).where(eq(companies.id, found.company.id));
      res.json({
        seats, kind, spentCents: cents,
        held: seatsHeld(after)[kind],
        wallet: await walletOf(req.user.id),
      });
    } catch (error) {
      console.error("Simulation seat purchase error:", error);
      res.status(500).json({ message: "Couldn't buy those seats." });
    }
  });

  app.post("/api/companies/:id/simulation-seats/checkout", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const found = await companyCan(res, String(req.params.id), req.user.id, "run_seasons");
      if (!found) return;

      const seats = Math.round(Number(req.body?.seats));
      if (!Number.isInteger(seats) || seats < 1 || seats > SEATS_PER_PURCHASE_MAX) {
        return res.status(400).json({ message: `Buy between 1 and ${SEATS_PER_PURCHASE_MAX} seats at a time.`, code: "invalid_input", field: "seats" });
      }
      const kind = req.body?.kind ?? "play";
      if (!isSeatKind(kind)) {
        return res.status(400).json({ message: "Buy either a seat to play one of our simulations, or one to have Nova build you a simulation.", code: "invalid_input", field: "kind" });
      }

      if (!isStripeConfigured()) {
        return res.status(503).json({ code: "billing_unavailable", message: "Payments aren't configured here." });
      }
      const stripe = await getUncachableStripeClient();

      const user = await storage.getUser(req.user.id);
      const customerId = await ensureStripeCustomer(stripe, { id: req.user.id, email: user?.email, stripeCustomerId: user?.stripeCustomerId });

      const origin = `${req.protocol}://${req.get("host")}`;
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ["card"],
        mode: "payment",
        line_items: [{
          quantity: seats,
          price_data: {
            currency: "usd",
            unit_amount: SEAT_PRICE_CENTS[kind],
            product_data: {
              name: kind === "nova" ? "Simulation seat — built by Nova" : "Simulation seat",
              description: kind === "nova"
                ? "One person at a table in a simulation Nova builds from your own project. For the life of a season, and the seat stays with the company."
                : "One person at a table in one of our simulations. For the life of a season, and the seat stays with the company.",
            },
          },
        }],
        success_url: `${origin}/companies/${found.company.slug ?? found.company.id}?seats=bought`,
        cancel_url: `${origin}/companies/${found.company.slug ?? found.company.id}?seats=cancelled`,
        /*
         * What the webhook needs to credit the right company. Read from the
         * session rather than from anything the browser sends back, because
         * the browser is not who paid.
         */
        metadata: { companyId: found.company.id, seats: String(seats), kind: "simulation_seats", seatKind: kind, userId: req.user.id },
      });

      res.json({ url: session.url, seats, kind, total: (seats * SEAT_PRICE_CENTS[kind]) / 100 });
    } catch (error) {
      console.error("Simulation seat checkout error:", error);
      res.status(500).json({ message: "Couldn't start that purchase." });
    }
  });

  /**
   * Nova builds the season, from the business the company actually has.
   *
   * The questions a first-time company cannot answer — which of seven markets
   * is shaped like ours, how much of the world, how many rivals, how many
   * years — answered from the project it is already running here, and answered
   * *out loud*: the brief says which market, why, and what each thing in the
   * game stands for in their business. A team that disagrees with the mapping
   * has learned something about their business, which is the point.
   *
   * Behind the seats, because this is the thing worth paying for.
   */
  app.post("/api/companies/:id/seasons/nova", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const found = await companyCan(res, String(req.params.id), req.user.id, "run_seasons");
      if (!found) return;

      const members = await companyMembersOf(found.company.id);
      /*
       * Nova reading the company's project and proposing a market costs a
       * model call, so it is gated before the call rather than at the start
       * line: a company with no Nova seats cannot have one built. How many
       * are needed is settled at start, against the people who actually sat
       * down — this only asks that the company has bought into the tier.
       */
      const seats = seatsHeld(found.company).nova;
      if (seats < 1) {
        return res.status(402).json({
          code: "seats_required",
          message: `A simulation Nova builds from your own project is $${SEAT_PRICE_CENTS.nova / 100} a seat, against $${SEAT_PRICE_CENTS.play / 100} for one of ours. Buy a seat for everyone who will play, and they keep them for every season after this one.`,
          seatKind: "nova",
          pricePerSeat: SEAT_PRICE_CENTS.nova / 100,
          people: members.length,
          paid: seats,
        });
      }

      if (!openAiConfigured()) {
        return res.status(503).json({ code: "nova_unavailable", message: "Nova can't reach the model right now. You can still set a season up yourself." });
      }

      /*
       * Checked before the model runs, charged after its answer is read — the
       * house rule for every route that spends a model call. The seats pay for
       * the simulation; the credit pays for Nova's thinking about it.
       */
      const ent = await requireCredits(res, req.user.id, CREDIT_COSTS.simulationBuild, "Nova building your simulation", { action: "simulationBuild" });
      if (!ent) return;

      const project = found.company.projectId
        ? await storage.getProject(found.company.projectId).catch(() => null)
        : null;

      const prompt = buildSimulationPrompt({
        company: {
          name: found.company.name,
          industry: found.company.industry,
          size: found.company.size,
          description: found.company.description,
        },
        project: project ? { title: project.title, description: project.description, goal: (project as any).goal } : null,
        progress: project ? await whereTheyAre(project.id) : null,
        people: members.length,
      });

      const completion = await getOpenAI().chat.completions.create({
        model: modelFor(ent),
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        response_format: { type: "json_object" },
      });

      const brief = parseSimulationBrief(completion.choices?.[0]?.message?.content ?? "", `${found.company.name} — year one`);
      if (!brief) {
        return res.status(502).json({ code: "model_unreadable", message: "Nova answered with something I couldn't use. Try again, or set the season up yourself." });
      }
      // Charged once the answer is one we can use, and never in an error path.
      await storage.deductCredits(req.user.id, CREDIT_COSTS.simulationBuild);

      const niche = nicheById(brief.nicheId);
      if (!niche) {
        return res.status(502).json({ code: "nova_unreadable", message: "Nova picked a market that doesn't exist." });
      }

      for (let attempt = 0; attempt < 5; attempt++) {
        const inviteCode = newSeasonCode();
        try {
          const [season] = await db.insert(simSeasons).values({
            nicheId: niche.id,
            name: brief.name,
            status: "forming",
            totalYears: brief.totalYears,
            periodMinutes: null,
            companyId: found.company.id,
            inviteCode,
            createdAt: new Date(),
            scope: brief.scope,
            botTeams: brief.botTeams,
            origin: "nova",
          }).returning();
          await logCompany(found.company.id, req.user.id, "season_created", null, {
            seasonId: season.id, name: brief.name, nicheId: niche.id, scope: brief.scope, botTeams: brief.botTeams, byNova: true,
          });
          return res.status(201).json({
            seasonId: season.id,
            inviteCode,
            joinUrl: joinPathFor(inviteCode),
            brief: { ...brief, marketName: niche.name },
          });
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
        }
      }
      res.status(500).json({ message: "Couldn't make a join code. Try again." });
    } catch (error) {
      console.error("Nova season build error:", error);
      respondToAiError(res, error, "Couldn't build that simulation");
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
            niche: { id: s.nicheId, name: marketNameOf(s) },
            /** The year being played now; past the last one once it's over. */
            year: s.year,
            totalYears: s.totalYears,
            periodMinutes: s.periodMinutes,
            cadence: s.cadence,
            nextTickAt: s.nextTickAt,
            rooms: rooms.length,
            roomsReady: rooms.filter((r) => r.phase === "running").length,
            /** The people the start line will charge for. Bots are not people and are not charged for. */
            players: inRooms.filter((x) => !x.isBot).length,
            origin: s.origin,
            /** Which seat this season costs, and therefore which balance pays for it. */
            seatKind: seatKindFor(s.origin),
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

      /*
       * Seats before invitations.
       *
       * Inviting somebody is a promise that there is a place for them, and
       * until now it was a promise nothing checked: the only seat gate was on
       * the start button, so a season could invite the whole company, watch
       * everyone join and sit through the lobby, and produce a bill at the
       * one moment when the cost of refusing it is everybody's time. The
       * check belongs here too, where it is still free to say no.
       *
       * Counted against the seats left rather than the seats held, because
       * whoever is already sitting down has a place and is not being offered
       * one. The inviter's own seat is theirs and is already in `seated`.
       */
      const { kind, seated, paid, free } = await seatCensus(season, found.company);
      const devFreeSeat = freeSeatsOn() || (process.env.NODE_ENV !== "production" && await devUnlimited(req.user.id));
      if (!devFreeSeat && recipients.length > free) {
        return res.status(402).json(seatsRequired(kind, seated + recipients.length, paid,
          free === 0
            ? `Every seat this company holds is taken, so there is nowhere to put ${recipients.length === 1 ? "them" : "them"} yet. `
              + `${SEAT_PITCH[kind]} is $${SEAT_PRICE_CENTS[kind] / 100} a seat, and seats stay with the company for every season after this one.`
            : `You're offering ${recipients.length} places and the company has ${free} ${free === 1 ? "seat" : "seats"} left. `
              + `${SEAT_PITCH[kind]} is $${SEAT_PRICE_CENTS[kind] / 100} a seat, and seats stay with the company for every season after this one.`));
      }
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

      /*
       * The seats, charged where they are actually filled.
       *
       * This is the only gate on playing, and it is here rather than on
       * creating a season because until people have sat down nobody knows how
       * many seats a season needs. Counting company members instead would
       * charge a company of forty for a season five of them play.
       *
       * Bots are not people and are not charged for. The price depends on
       * where the season came from: one of our markets is the cheaper seat,
       * one Nova built from the company's own project is the dearer one, and
       * the two balances do not substitute for each other.
       */
      const { kind, seated, paid } = await seatCensus(season, found.company);
      /*
       * A developer building or demonstrating a season should not have to buy
       * their way past their own paywall. Mirrors `devAdvanceOn`: local
       * development only, never production, and it says so in the log so a
       * season started this way is never mistaken for one somebody paid for.
       */
      /*
       * The same escape, reached the other way.
       *
       * `SIM_DEV_FREE_SEATS` is a server-wide env var, which is the right
       * shape for a workshop machine and the wrong one for somebody clicking
       * the "Everything free" switch in the sidebar: that turns off every
       * other charge in the product, and a season was the one thing it could
       * not get past. Same two guards as everywhere else — never in
       * production, and it says so in the log.
       */
      const devFreeSeat = freeSeatsOn() || (process.env.NODE_ENV !== "production" && await devUnlimited(req.user.id));
      if (devFreeSeat && seated > paid) {
        console.warn(`[sim] development seats — starting season ${season.id} with ${seated} seated and ${paid} ${kind} seat(s) paid for. Development only.`);
      } else if (seated > paid) {
        return res.status(402).json(seatsRequired(kind, seated, paid,
          `${seated} ${seated === 1 ? "person has" : "people have"} sat down and the company has ${paid} ${SEAT_LABEL[kind]} ${paid === 1 ? "seat" : "seats"}. `
          + `${SEAT_PITCH[kind]} is $${SEAT_PRICE_CENTS[kind] / 100} a seat, and seats stay with the company for every season after this one.`));
      }

      /*
       * The rivals the company asked for, seated before the world is built —
       * a bot-run company that arrived afterwards would be a company that did
       * not exist in year one, which the engine has no way to express.
       */
      if ((season.botTeams ?? 0) > 0) {
        await seatBotCompanies(season.id, season.botTeams).catch((err) =>
          console.error(`[sim] seating bot companies for season ${season.id} failed:`, err));
      }

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
      const periodMs = periodMsOf(season);
      const moved = await db.update(simSeasons)
        .set({ nextTickAt: now, startsAt: new Date(now.getTime() - season.year * periodMs) })
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
          totalYears: season.totalYears, yearsResolved: played, niche: { id: season.nicheId, name: marketNameOf(season) },
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
