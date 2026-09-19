/**
 * Moving a simulation season on to its next year, now, instead of when its
 * clock says.
 *
 * A season's year normally lasts a day, and that is right for strangers
 * playing a fortnight around their lives. It is wrong for two groups:
 *
 *   - **Developers**, testing a change to the engine, who cannot wait a real
 *     day to see what year two does with it.
 *   - **Companies**, running a private training season in a workshop, who need
 *     it to move while the room is still there.
 *
 * So both may end the year being played whenever they choose. Nobody else may:
 * in an ordinary season the clock is the one thing every team shares, and a
 * player who could run it forward would be running it forward on four other
 * teams who had not finished deciding.
 *
 * ## Who counts
 *
 * - A **developer** is a platform admin (`platformRole` "admin"). They may
 *   advance any season, public ones included — which moves every team in that
 *   market, so every such advance is written to the moderation log with who
 *   did it and which year.
 * - In **local development only**, with `SIM_DEV_ADVANCE=1` set, anyone seated
 *   at a table in the season — so a developer testing as the marketing seat
 *   need not sign in as an admin to move the year. Ignored entirely when
 *   `NODE_ENV` is "production", and the server says so loudly at startup when
 *   it is on. Logged like every other advance, as "dev_flag".
 *
 * (Companies running their own training seasons will get the same control
 * once company accounts are on main; the company branch lives with that work.)
 *
 * The advance itself moves the clock rather than bypassing it: the season's
 * start is shifted so this year is due now and the next is a full year away.
 * Setting only "due now" would resolve this year and then leave the next one
 * due at its old time — which may already have passed, so the room would
 * watch two years resolve back to back.
 */
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { simSeasons, simSeats, simVentures, users } from "@shared/schema";
import { DAY_MS } from "@shared/simulation/season";
import { atLeast } from "./platform-roles";
import { tickSeason } from "./simulation-tick";
import { logModeration } from "./moderation";

export type AdvanceAuthority = "developer" | "dev_flag";

type SeasonRow = typeof simSeasons.$inferSelect;

/**
 * The local-development opt-in. Read on every call rather than once, so a test
 * can switch it; and never honoured in production, whatever the environment
 * says — a deployment that forgot to unset it must not hand every player the
 * clock of a market full of strangers.
 */
export function devAdvanceOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SIM_DEV_ADVANCE === "1" && env.NODE_ENV !== "production";
}

/** Said once, at startup, so nobody runs with it on without knowing. */
export function warnIfDevAdvance(): void {
  if (process.env.SIM_DEV_ADVANCE === "1" && process.env.NODE_ENV === "production") {
    console.warn("[sim] SIM_DEV_ADVANCE is set in production and is being IGNORED.");
  } else if (devAdvanceOn()) {
    console.warn("\n[sim] ⚠️  SIM_DEV_ADVANCE=1 — anyone seated in a season can end its year, with no second factor. Development only.\n");
  }
}

/** Whether this person holds a seat at any table in the season. */
async function seatedIn(userId: string, seasonId: string): Promise<boolean> {
  const [row] = await db.select({ id: simSeats.id })
    .from(simSeats)
    .innerJoin(simVentures, eq(simVentures.id, simSeats.ventureId))
    .where(and(eq(simSeats.userId, userId), eq(simVentures.seasonId, seasonId)))
    .limit(1);
  return !!row;
}

/**
 * Whether this person may run this season's clock forward, and as what.
 *
 * The platform role is read from the database rather than the session, so a
 * developer whose admin role has been revoked stops being able to do this on
 * their next request rather than whenever their session happens to expire.
 */
export async function advanceAuthority(userId: string, season: Pick<SeasonRow, "id">): Promise<AdvanceAuthority | null> {
  /*
   * The development flag is asked first, and only reaches a season the person
   * is playing in. A developer testing at the table shouldn't be sent for an
   * authenticator code to move their own local game on.
   */
  if (devAdvanceOn() && await seatedIn(userId, season.id)) return "dev_flag";
  const [user] = await db.select({ role: users.platformRole }).from(users).where(eq(users.id, userId));
  return atLeast(user?.role, "admin") ? "developer" : null;
}

export type AdvanceResult =
  | { ok: true; resolvedYear: number; year: number; status: string; nextTickAt: Date | null }
  | { ok: false; status: number; code: string; message: string };

export interface AdvanceOptions {
  now?: Date;
  /**
   * Whether this sign-in has passed the second factor a platform admin needs
   * (`mfaGate` in server/mfa.ts). The developer power moves public markets
   * full of strangers, so it is held to the same bar as every other admin
   * route: a stolen password alone must not be enough. The company power is
   * not — it only reaches the company's own private seasons.
   */
  secondFactor: boolean;
}

/**
 * End the year being played now.
 *
 * Checks who is asking, moves the clock, and resolves the year here and now
 * rather than on the next minute's pass — so the people who pressed the
 * button see the results while they are still looking.
 */
export async function advanceSeasonNow(seasonId: string, userId: string, { now = new Date(), secondFactor }: AdvanceOptions): Promise<AdvanceResult> {
  const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, seasonId));
  if (!season) return { ok: false, status: 404, code: "not_found", message: "No such season." };

  const authority = await advanceAuthority(userId, season);
  // A season a person cannot control is none of their business: 404, not 403.
  if (!authority) return { ok: false, status: 404, code: "not_found", message: "No such season." };
  if (authority === "developer" && !secondFactor) {
    return { ok: false, status: 403, code: "second_factor", message: "Sign in with your authenticator code to use developer controls." };
  }

  if (season.status !== "running") {
    return {
      ok: false, status: 409, code: "not_running",
      message: season.status === "forming" ? "The season hasn't started yet — its tables are still getting ready." : "This season is over.",
    };
  }

  const yearMs = DAY_MS;
  const moved = await db.update(simSeasons)
    .set({ nextTickAt: now, startsAt: new Date(now.getTime() - season.year * yearMs) })
    // Conditional on the year it read, so a tick landing in between is not rewound.
    .where(and(eq(simSeasons.id, season.id), eq(simSeasons.year, season.year), eq(simSeasons.status, "running")))
    .returning({ id: simSeasons.id });
  if (moved.length === 0) {
    return { ok: false, status: 409, code: "already_resolved", message: "That year has just been resolved." };
  }

  const resolved = await tickSeason(season.id, now);
  const [after] = await db.select({ year: simSeasons.year, status: simSeasons.status, nextTickAt: simSeasons.nextTickAt })
    .from(simSeasons).where(eq(simSeasons.id, season.id));

  /*
   * On the record. A developer advancing a public season has moved every team
   * in that market on by a year, and the people in it deserve an answer to
   * "why did that happen overnight".
   */
  await logModeration({
    action: "sim.advance_year",
    actorId: userId,
    targetType: "sim_season",
    targetId: season.id,
    previousState: { year: season.year },
    resultingState: { year: after?.year, status: after?.status },
    details: { as: authority, companyId: null },
  });

  return {
    ok: true,
    resolvedYear: resolved ?? season.year,
    year: after?.year ?? season.year,
    status: after?.status ?? season.status,
    nextTickAt: after?.nextTickAt ?? null,
  };
}
