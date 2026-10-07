/**
 * Nova filing a year for you, and the only route under `/api/sim/` that costs
 * anything.
 *
 * Its own file for that reason. `test/unit/credit-refresh.test.ts` holds the
 * promise that nothing under `/api/sim/` charges, and it checks that promise by
 * looking for `requireCredits` in a routes file and then flagging every path
 * that file registers. Leaving this beside the desk's other handlers made two
 * routes that charge nothing — filing a year, advancing a season — look like
 * they did. The guard was right to be coarse; the fix is to put the charge
 * where the coarse rule tells the truth.
 */
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { simSeasons, simVentures, simDecisions } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { enforceRateLimit } from "./moderation";
import { marketOf } from "./simulation-scope";
import { ROLES, type Role, type World } from "@shared/simulation/types";
import { cleanDecision, validateDecision, draftPreview } from "@shared/simulation/levers";
import { periodsPerYear, totalPeriods, type Cadence } from "@shared/simulation/cadence";
import { economyFor } from "@shared/simulation/season";
import { projectYear } from "@shared/simulation/projection";
import { optimise } from "@shared/simulation/optimiser";
import { YEAR_CLOSING, yearClosing } from "./simulation-tick";
import { seatOf, draftFor } from "./simulation-desk-routes";
import { requireCredits } from "./entitlements";
import { storage } from "./storage";
import { CHARGEABLE, NOVA_PLAN_ACTIONS } from "@shared/plans";

export function registerNovaPlanRoutes(app: Express): void {
  /**
   * Nova files this year for you, playing the whole company at once.
   *
   * ## Why this is a search and not a model call
   *
   * `shared/simulation/optimiser.ts` already does the hard part and was never
   * called by anything. It hands one budget out a slice at a time, each slice
   * to whichever lever is worth most at the margin, and maximises the forecast
   * a year *out* rather than this year's money — which is the shortest horizon
   * that can see a brand landing, a hire becoming useful or a factory opening,
   * and therefore the shortest one at which this game has anything to decide.
   * Measured over a season it finishes at £15.1m against the best bot's
   * £10.6m.
   *
   * So "the best outlook" here is literal. A language model asked to pick
   * eleven numbers would be guessing at an engine it cannot run; this plays
   * the engine. Nothing is sent to a model and nothing could be hallucinated.
   *
   * ## What it files
   *
   * The desks this seat actually owns. A solo founder holds all five, so one
   * press fills the year — which is the whole point for somebody who was
   * handed a link to a simulation of their own business and wants to see what
   * running it looks like. At a five-person table it fills your chair only,
   * from a plan made for the whole company: the other four are your table's to
   * argue about, and filing for them would be filing as somebody else.
   */
  app.post("/api/sim/ventures/:id/nova-plan", isAuthenticated, async (req: any, res) => {
    if (!(await enforceRateLimit(res, req.user.id, "session"))) return;

    const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, req.params.id));
    if (!venture) return res.status(404).json({ message: "No such company." });
    const seat = await seatOf(venture.id, req.user.id);
    /* A stranger learns nothing, including that the company exists. */
    if (!seat) return res.status(404).json({ message: "No such company." });
    if (!seat.role) return res.status(409).json({ message: "You don't have a seat yet.", code: "no_seat" });

    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, venture.seasonId));
    if (!season || season.status !== "running" || !season.world) {
      return res.status(409).json({ message: "This season isn't running.", code: "not_running" });
    }
    /* Refused once the year is due: the tick may already have read this year's filings. */
    if (yearClosing(season)) return res.status(409).json(YEAR_CLOSING);

    const niche = marketOf(season)!;
    const year = season.year;
    const world = { ...(season.world as World), niche, year };
    const company = world.companies.find((c) => c.id === venture.id);
    if (!company) return res.status(404).json({ message: "No such company." });

    const role = seat.role as Role;
    const soloSeason = (season.seatCount ?? 5) <= 1;
    const periods = periodsPerYear(season.cadence as Cadence);

    /*
     * The desks this press may fill.
     *
     * A solo founder's five, minus the chief executive's chair when the board
     * has taken it — the filing route refuses that chair outright rather than
     * accepting and ignoring it, and a plan that quietly filed it would leave
     * somebody believing they had got the chair back.
     */
    const owned: Role[] = soloSeason ? [...ROLES] : [role];
    const desks = owned.filter((d) => !(d === "ceo" && company.investors?.inCharge));
    if (!desks.length) {
      return res.status(409).json({
        code: "board_in_charge",
        message: `The board has removed the chief executive and is running that chair itself. Meet this year's target of £${company.investors!.target.toLocaleString()} and the chair comes back.`,
      });
    }

    /*
     * Charged before the search, and handed straight back by
     * `credit-reservations` if this route never answers. Several actions
     * rather than one: see `actions` on requireCredits.
     */
    const ent = await requireCredits(res, req.user.id, CHARGEABLE, "Nova's plan for the year", {
      actions: NOVA_PLAN_ACTIONS,
      action: "novaSimPlan",
    });
    if (!ent) return;

    const plan = optimise({
      world,
      companyId: venture.id,
      year,
      economy: economyFor(season.id, year),
      periods,
      totalYears: season.totalYears,
    });
    /*
     * Returns null only when the company is not in the world, which the check
     * above already ruled out — so this is the unreachable branch rather than
     * the ordinary one. Answered rather than thrown, and nothing is charged:
     * the hold is released by the response.
     */
    if (!plan) return res.status(409).json({ message: "Nova couldn't plan this year.", code: "no_plan" });

    const cityIds = niche.cities.map((c) => c.id);
    const cleanFor = (desk: Role) => cleanDecision(desk, (plan.decisions as any)[desk] ?? {}, cityIds, {
      year, periods,
      segmentIds: niche.segments.map((s) => s.id),
      /* Solo reads its own unlock schedule, so no lever arrives before its desk opens. */
      ...(soloSeason ? { soloTotal: totalPeriods(season.totalYears, (season.cadence ?? "yearly") as Cadence) } : {}),
    });

    /*
     * Validated against the same rules a person's filing is.
     *
     * The optimiser keeps a reserve and will not knowingly overspend, but it
     * optimises against the engine rather than against the form — so if the
     * two ever disagree, this is where it is caught, before anything is
     * written and before somebody is told their year is filed.
     */
    for (const desk of desks) {
      const check = validateDecision(desk, cleanFor(desk), company);
      if (!check.ok) {
        return res.status(409).json({
          message: "Nova's plan didn't pass the same checks your own filing does, so nothing was filed.",
          code: "plan_rejected",
          errors: check.errors,
        });
      }
    }

    await db.transaction(async (tx) => {
      for (const desk of desks) {
        await tx.insert(simDecisions)
          .values({ ventureId: venture.id, userId: req.user.id, role: desk, year, payload: cleanFor(desk), submittedAt: new Date() })
          .onConflictDoUpdate({
            target: [simDecisions.ventureId, simDecisions.role, simDecisions.year],
            set: { payload: cleanFor(desk), userId: req.user.id, submittedAt: new Date() },
          });
      }
    });

    /* Settles the hold taken above. Nothing is charged twice. */
    await storage.deductCredits(req.user.id, CHARGEABLE);

    const { decisions } = await draftFor(venture.id, year);
    const { companyId: _plannedFor, ...filedByRole } = decisions as any;
    /*
     * The outlook, from the same function the projection screen uses, so the
     * number Nova shows and the number the desk shows cannot disagree.
     */
    const outlook = projectYear({
      world,
      companyId: venture.id,
      economy: economyFor(season.id, year),
      filed: filedByRole,
      previous: year > 1 ? (await draftFor(venture.id, year - 1)).decisions : undefined,
    });

    res.json({
      ok: true,
      year,
      /* Which chairs it actually filled, so the screen does not claim five on a table of five. */
      filled: desks,
      yourRole: role,
      draft: cleanFor(role),
      expects: { serves: plan.serves, commits: plan.spends },
      preview: draftPreview({ company, niche, decisions, economy: economyFor(season.id, year) }),
      ...(outlook ?? {}),
    });
  });

}
