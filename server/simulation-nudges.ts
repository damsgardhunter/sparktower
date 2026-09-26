/**
 * The two things the simulator can tell somebody that nothing else can.
 *
 * A bell earns its place by being worth the tap. Most of what could be sent
 * from here would not be — "you have not run a simulation lately" is a nag,
 * and a nag is how a person learns to ignore the badge, which costs more than
 * the visit it bought. So there are two, and both carry a finding rather than
 * an invitation:
 *
 *  - **A projection can be marked.** Enough weeks have been filed since a
 *    scenario was run that it can be checked against what actually happened,
 *    and it was wrong in a direction worth knowing about. This is the one
 *    thing this product can tell an owner that they cannot work out for
 *    themselves, and it only becomes true with time — which is exactly what a
 *    notification is for.
 *  - **A scheme is worth testing and never was.** They paid to have it scored,
 *    it scored well, and running it for a year is free. Money already spent,
 *    value not yet taken.
 *
 * Both are `once: true` against a stable target, so a scenario that stays
 * wrong does not say so again every fifteen minutes.
 */
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "./db";
import { projects, projectCheckins, simulationScenarios, marketingSchemes } from "@shared/schema";
import { notify } from "./notifications";
import { markProjection } from "@shared/simulation/hindsight";
import { WORTH_TESTING_AT } from "@shared/simulation/marketing";
import { readWeeklyRevenue } from "@shared/what-would-it-take";
import { businessMoney, currencyOf } from "@shared/currency";
import type { Answer } from "@shared/simulation/decision-sim";
import type { CheckinLike } from "@shared/company-rhythm";

/**
 * How long a projection has to have been standing before it is worth marking.
 *
 * Two months. One is too few to say anything — a single month out is weather,
 * not climate — and waiting longer wastes the correction on somebody who has
 * already made the decision.
 */
const MARKABLE_AFTER_DAYS = 60;

/** Inside this, a projection was right, and being told so is not worth a bell. */
const WORTH_MENTIONING = 0.2;

/** How many to look at in one pass. A sweep, not a report. */
const BATCH = 200;

/**
 * Revenue actually filed, by month of a projection. Mirrors the read the
 * simulations panel does — see `actualMonthsSince` in decision-sim-routes.
 */
function actualByMonth(subcategory: unknown, checkins: CheckinLike[], from: Date, months: number): (number | null)[] {
  const byMonth = new Map<string, number>();
  for (const c of checkins) {
    const one = readWeeklyRevenue(subcategory, [c], 1);
    if (!one) continue;
    const key = String(c.weekOf).slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + one.weekly);
  }
  const out: (number | null)[] = [];
  const cursor = new Date(from);
  for (let i = 0; i < months; i += 1) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    const past = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1) <= new Date();
    out.push(past ? byMonth.get(key) ?? null : null);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

/** Projections old enough to check, that turned out to be worth checking. */
async function markOldProjections(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - MARKABLE_AFTER_DAYS * 86_400_000);
  const rows = await db.select({
    id: simulationScenarios.id,
    projectId: simulationScenarios.projectId,
    months: simulationScenarios.months,
    result: simulationScenarios.result,
    createdAt: simulationScenarios.createdAt,
    ownerId: projects.ownerId,
    title: projects.title,
    subcategory: projects.subcategory,
    currency: projects.currency,
  }).from(simulationScenarios)
    .innerJoin(projects, eq(projects.id, simulationScenarios.projectId))
    .where(lt(simulationScenarios.createdAt, cutoff))
    .orderBy(desc(simulationScenarios.createdAt))
    .limit(BATCH);

  let sent = 0;
  for (const row of rows) {
    const run = (row.result as Answer | null)?.with?.likely;
    if (!run) continue;
    const checkins = await db.select().from(projectCheckins)
      .where(eq(projectCheckins.projectId, row.projectId))
      .orderBy(desc(projectCheckins.weekOf)).limit(80) as unknown as CheckinLike[];
    if (!checkins.length) continue;

    const marked = markProjection(run, actualByMonth(row.subcategory, checkins, row.createdAt, row.months));
    /*
     * Nothing to say, or nothing worth saying. A projection that came in
     * within a fifth either way was a good projection, and telling somebody
     * their forecast was fine is the definition of a notification that trains
     * people to ignore notifications.
     */
    if (!marked || Math.abs(marked.typicalOff) < WORTH_MENTIONING) continue;

    const money = (n: number) => businessMoney(n, currencyOf(row.currency));
    const last = marked.months[marked.months.length - 1];
    await notify({
      recipients: [row.ownerId], actorId: row.ownerId, allowSelf: true, once: true,
      kind: "projection_marked",
      targetId: row.id,
      projectId: row.projectId,
      excerpt: `${marked.lean === "over" ? "Ran high" : "Ran low"} — you projected ${money(last.predicted)} a month and filed ${money(last.actual)}.`,
    });
    sent += 1;
  }
  return sent;
}

/** Schemes that scored well enough to run, and never were. */
async function nudgeUntestedSchemes(): Promise<number> {
  const rows = await db.select({
    id: marketingSchemes.id,
    projectId: marketingSchemes.projectId,
    score: marketingSchemes.score,
    ownerId: projects.ownerId,
    title: projects.title,
  }).from(marketingSchemes)
    .innerJoin(projects, eq(projects.id, marketingSchemes.projectId))
    .where(and(
      isNull(marketingSchemes.test),
      sql`${marketingSchemes.score} >= ${WORTH_TESTING_AT}`,
    ))
    .limit(BATCH);

  let sent = 0;
  for (const row of rows) {
    await notify({
      recipients: [row.ownerId], actorId: row.ownerId, allowSelf: true, once: true,
      kind: "scheme_untested",
      targetId: row.id,
      projectId: row.projectId,
      excerpt: `It scored ${row.score}/100. Running it for a year costs nothing — you've already paid for the reading.`,
    });
    sent += 1;
  }
  return sent;
}

export async function runSimulationNudges(now = new Date()): Promise<{ marked: number; schemes: number }> {
  const marked = await markOldProjections(now).catch((err) => {
    console.error("[sim-nudges] couldn't mark projections:", err);
    return 0;
  });
  const schemes = await nudgeUntestedSchemes().catch((err) => {
    console.error("[sim-nudges] couldn't check schemes:", err);
    return 0;
  });
  return { marked, schemes };
}

/**
 * Once every six hours, and not on the minute the process starts.
 *
 * Nothing here becomes true quickly — a projection needs two months and a week
 * of check-ins — so a tighter loop would be hundreds of queries to find
 * nothing. Six hours is often enough that a finding reaches somebody the day
 * it becomes true.
 */
export function startSimulationNudges(): void {
  const pass = () => {
    runSimulationNudges().catch((err) => console.error("[sim-nudges] pass failed:", err));
  };
  setTimeout(pass, 5 * 60_000).unref();
  setInterval(pass, 6 * 60 * 60_000).unref();
}
