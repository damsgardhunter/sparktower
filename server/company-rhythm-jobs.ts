/**
 * The company rhythm's background work, and the one helper that ties the
 * rhythm back to the Run path.
 *
 * A rhythm nobody is reminded of stops in week three. So every quarter of an
 * hour this looks for two things: a recurring job that has come due (its
 * owner hears, and its backup too once it is two days late), and a project
 * whose check-in day it is with nothing filed yet (the people it reminds hear).
 * Each is announced once: the reminder is recorded on the row before anyone is
 * told, with an update that only succeeds if nobody recorded it first, so two
 * server processes — or one sweep that overlaps the next — never send it twice.
 *
 * Dates are YYYY-MM-DD in UTC and "now" is a parameter, so the tests can run a
 * sweep on any day they like without touching the clock.
 */
import { and, eq, exists, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "./db";
import {
  projectCheckins, projectKanbanTasks, projectMembers, projectTracks, projects, recurringJobs, rhythmSettings,
} from "@shared/schema";
import { notify } from "./notifications";
import { storage, isTaskOnTime } from "./storage";
import { onPathTaskDone, backboneIdOf, isArchivedPath } from "./phase-trees";
import { todayYmd, weekOf, checkinDayOf, daysOverdue } from "@shared/company-rhythm";

// ─── Closing a Run milestone when the real work happens ─────────────────────

/**
 * Marks a Run path milestone done because the thing it asks for has just
 * happened — the first check-in filed, the third job on the board — if it is
 * still open. Never reopens one, and never fails the action that called it:
 * the check-in was saved whether or not the path noticed.
 *
 * Goes the same way the task board's own "done" does, so everything
 * downstream of a finished step (pace, the next step, the team's
 * notification, companies scouting the project) fires as if someone had
 * ticked it. The update only succeeds while the task is still open, so two
 * requests racing to close it close it once.
 */
export async function completeRunMilestone(projectId: string, milestoneId: string, userId: string): Promise<boolean> {
  try {
    const tag = `backbone:${milestoneId}`;
    const rows = await db.select().from(projectKanbanTasks)
      .where(and(eq(projectKanbanTasks.projectId, projectId), sql`${projectKanbanTasks.tags} @> ARRAY[${tag}]::varchar[]`));
    const task = rows.find((t) => backboneIdOf(t.tags) === milestoneId && !isArchivedPath(t.tags));
    if (!task || task.status === "done") return false;
    const now = new Date();
    const [done] = await db.update(projectKanbanTasks).set({
      status: "done", completedAt: now, completedById: userId,
      ...(task.startedAt ? {} : { startedAt: now, startedById: userId }),
    } as any).where(and(eq(projectKanbanTasks.id, task.id), ne(projectKanbanTasks.status, "done"))).returning();
    if (!done) return false;

    await onPathTaskDone(done as any).catch((e) => console.error("[company-rhythm] pace refresh failed:", e));
    // What the board does for a finished task: whatever waited on it is unblocked, and a first completion is banked.
    await db.update(projectKanbanTasks).set({ blockedByTaskId: null } as any)
      .where(and(eq(projectKanbanTasks.projectId, projectId), eq(projectKanbanTasks.blockedByTaskId, done.id)))
      .catch((e) => console.error("[company-rhythm] couldn't clear blockers:", e));
    if (!task.completedAt) {
      const onTime = isTaskOnTime(done as any);
      await storage.incrementUserTaskCompletion(userId, onTime).catch((e) => console.error("[company-rhythm] couldn't bank completion:", e));
      await storage.recordTaskCompletion({
        projectId, taskId: done.id, completedById: userId, title: done.title, priority: done.priority, onTime, completedAt: done.completedAt ?? now,
      } as any).catch((e) => console.error("[company-rhythm] couldn't archive completion:", e));
    }
    return true;
  } catch (err) {
    console.error(`[company-rhythm] couldn't close ${milestoneId} (non-fatal):`, err);
    return false;
  }
}

// ─── Reminders ───────────────────────────────────────────────────────────────

/*
 * What `recurring_jobs.reminded_for` holds: the due date the owner was told
 * about, and that date with this suffix once the backup has been told as well.
 * Two stages on one column, because the backup's reminder comes days after
 * the owner's for the same occurrence and must also go out only once.
 */
const BACKUP_STAGE = ":backup";
/** How late a job is before its backup hears about it too. */
const BACKUP_AFTER_DAYS = 2;
/** Enough for any real site in one pass; the rest go out fifteen minutes later. */
const BATCH = 500;

const longDate = (ymd: string) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

async function remindJobs(today: string): Promise<{ owners: number; backups: number }> {
  let owners = 0, backups = 0;
  const due = await db.select({ job: recurringJobs, projectOwner: projects.ownerId })
    .from(recurringJobs).innerJoin(projects, eq(projects.id, recurringJobs.projectId))
    .where(and(
      eq(recurringJobs.active, true),
      lte(recurringJobs.nextDue, today),
      sql`${recurringJobs.remindedFor} is distinct from (${recurringJobs.nextDue} || ${BACKUP_STAGE})`,
    ))
    .limit(BATCH);

  for (const { job, projectOwner } of due) {
    const late = daysOverdue(job.nextDue, today);
    const ownerTold = job.remindedFor === job.nextDue;
    const backupDue = late >= BACKUP_AFTER_DAYS;
    // Told the owner already and it isn't the backup's turn yet: nothing to do this pass.
    if (ownerTold && !backupDue) continue;
    const next = backupDue ? `${job.nextDue}${BACKUP_STAGE}` : job.nextDue;
    const [claimed] = await db.update(recurringJobs).set({ remindedFor: next })
      .where(and(
        eq(recurringJobs.id, job.id), eq(recurringJobs.nextDue, job.nextDue),
        job.remindedFor == null ? isNull(recurringJobs.remindedFor) : eq(recurringJobs.remindedFor, job.remindedFor),
      )).returning({ id: recurringJobs.id });
    if (!claimed) continue; // Another pass got there first, or the job was just done.

    // A job nobody owns falls to the person who owns the project.
    const owner = job.ownerId ?? projectOwner;
    const recipients = [
      ...(ownerTold ? [] : [owner]),
      ...(backupDue && job.backupId && job.backupId !== owner ? [job.backupId] : []),
    ];
    if (!recipients.length) continue;
    await notify({
      recipients, actorId: projectOwner, allowSelf: true, once: true,
      kind: "job_due", targetId: `${job.id}:${job.nextDue}`, projectId: job.projectId,
      excerpt: late > 0 ? `${job.title} — overdue since ${longDate(job.nextDue)}` : `${job.title} — due ${longDate(job.nextDue)}`,
    });
    if (!ownerTold) owners++;
    if (recipients.includes(job.backupId ?? "")) backups++;
  }
  return { owners, backups };
}

async function remindCheckins(now: Date): Promise<number> {
  const today = todayYmd(now);
  const week = weekOf(today);
  const day = checkinDayOf(today);
  let sent = 0;

  // Projects on the Run path — as their main path or as a section — whose check-in day is today
  // (Monday when they never chose), not yet reminded this week, with nothing filed for it.
  const onRun = or(
    eq(projects.goal, "run_company"),
    exists(db.select({ one: sql`1` }).from(projectTracks).where(and(eq(projectTracks.projectId, projects.id), eq(projectTracks.goal, "run_company")))),
  );
  const rows = await db.select({
    id: projects.id, title: projects.title, ownerId: projects.ownerId,
    hasSettings: rhythmSettings.projectId, remindUserIds: rhythmSettings.remindUserIds, remindedWeek: rhythmSettings.remindedWeek,
  })
    .from(projects).leftJoin(rhythmSettings, eq(rhythmSettings.projectId, projects.id))
    .where(and(
      onRun,
      sql`coalesce(${rhythmSettings.checkinDay}, 0) = ${day}`,
      sql`${rhythmSettings.remindedWeek} is distinct from ${week}`,
      sql`not exists (select 1 from ${projectCheckins} where ${projectCheckins.projectId} = ${projects.id} and ${projectCheckins.weekOf} = ${week})`,
    ))
    .limit(BATCH);

  for (const p of rows) {
    // Record the week first; only the pass that records it sends the reminder.
    let claimed: unknown[];
    if (p.hasSettings) {
      claimed = await db.update(rhythmSettings).set({ remindedWeek: week, updatedAt: now })
        .where(and(eq(rhythmSettings.projectId, p.id), sql`${rhythmSettings.remindedWeek} is distinct from ${week}`))
        .returning({ id: rhythmSettings.projectId });
    } else {
      claimed = await db.insert(rhythmSettings).values({ projectId: p.id, checkinDay: 0, remindUserIds: [], remindedWeek: week, updatedAt: now })
        .onConflictDoNothing().returning({ id: rhythmSettings.projectId });
    }
    if (!claimed.length) continue;

    const members = new Set([p.ownerId, ...(await db.select({ userId: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, p.id))).map((r) => r.userId)]);
    // The chosen people who are still on the project; everyone when nobody was chosen or all of them have left.
    const chosen = (p.remindUserIds ?? []).filter((id) => members.has(id));
    const recipients = chosen.length ? chosen : [...members];
    await notify({
      recipients, actorId: p.ownerId, allowSelf: true, once: true,
      kind: "checkin_due", targetId: `${p.id}:${week}`, projectId: p.id,
      excerpt: `This week's check-in for ${p.title}`,
    });
    sent++;
  }
  return sent;
}

/**
 * One pass: the jobs that have come due, then today's check-ins. Each half is
 * caught on its own, so a failure in one doesn't cost the other its reminders.
 */
export async function runRhythmReminders(now: Date = new Date()): Promise<{ owners: number; backups: number; checkins: number }> {
  const out = { owners: 0, backups: 0, checkins: 0 };
  try {
    Object.assign(out, await remindJobs(todayYmd(now)));
  } catch (err) {
    console.error("[company-rhythm] job reminders failed:", err);
  }
  try {
    out.checkins = await remindCheckins(now);
  } catch (err) {
    console.error("[company-rhythm] check-in reminders failed:", err);
  }
  return out;
}

/**
 * Every fifteen minutes: often enough that a job due today is mentioned on
 * the morning it's due, rarely enough that a pass with nothing to do costs
 * two small queries. The first pass waits a minute so a cold start isn't
 * doing this alongside everything else.
 */
export function startRhythmJobs(): void {
  const pass = () => {
    runRhythmReminders().catch((err) => console.error("[company-rhythm] reminder pass failed:", err));
  };
  setTimeout(pass, 60_000).unref();
  setInterval(pass, 15 * 60_000).unref();
}
