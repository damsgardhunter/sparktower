/**
 * Runs Nova's whole-business build over the demo builders' projects.
 *
 * Separate from the seeding because this is the expensive half: each build is
 * dozens of model calls against the real API and takes minutes, so it wants to
 * be restartable, reportable, and interruptible without losing what it has
 * already done.
 *
 * It calls `runBusinessBuild` directly rather than going through
 * `/api/nova/build-my-business`. The route is where the paywall and the
 * authentication live, and neither applies here: these accounts have
 * `auth_provider = 'bot'` and cannot sign in at all, so there is no session to
 * make the request with.
 *
 *   DATABASE_URL=… npx tsx script/seed-demo-builds.ts               # what it would do
 *   DATABASE_URL=… npx tsx script/seed-demo-builds.ts --apply       # all of them
 *   DATABASE_URL=… npx tsx script/seed-demo-builds.ts --apply --limit 1
 *
 * Skips any project that already has a finished build, so an interrupted run
 * is resumed by running it again.
 */
import { pathToFileURL } from "node:url";
import { and, desc, eq, isNotNull, like } from "drizzle-orm";
import { db } from "../server/db";
import { users, projects, novaBuildRuns, projectKanbanTasks } from "@shared/schema";

const apply = process.argv.includes("--apply");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const DEMO_EMAIL = "%@demo.sparktower.invalid";

async function alreadyBuilt(projectId: string): Promise<boolean> {
  const [run] = await db.select({ id: novaBuildRuns.id })
    .from(novaBuildRuns)
    .where(and(eq(novaBuildRuns.projectId, projectId), isNotNull(novaBuildRuns.finishedAt)))
    .orderBy(desc(novaBuildRuns.startedAt)).limit(1);
  return !!run;
}

async function main(): Promise<number> {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL.");

  const rows = await db.select({
    id: projects.id, title: projects.title, ownerId: projects.ownerId, owner: users.firstName,
  }).from(projects).innerJoin(users, eq(users.id, projects.ownerId))
    .where(like(users.email, DEMO_EMAIL))
    .orderBy(projects.createdAt);

  const todo: typeof rows = [];
  for (const r of rows) if (!(await alreadyBuilt(r.id))) todo.push(r);

  console.log(`demo projects: ${rows.length}`);
  console.log(`already built: ${rows.length - todo.length}`);
  console.log(`to build:      ${Math.min(todo.length, LIMIT)}${LIMIT < todo.length ? ` (of ${todo.length}, --limit)` : ""}`);

  if (!apply) {
    for (const r of todo.slice(0, LIMIT)) console.log(`  ${r.owner} — ${r.title}`);
    console.log("\nreport only — rerun with --apply. Each build is minutes of real model calls.");
    return 0;
  }

  /* Imported here so a report-only run never loads the AI stack. */
  const { runBusinessBuild } = await import("../server/nova-build");

  let done = 0, failed = 0;
  const startedAll = Date.now();
  for (const r of todo.slice(0, LIMIT)) {
    const started = Date.now();
    process.stdout.write(`  ${r.owner} — ${r.title} … `);
    try {
      await runBusinessBuild(r.id, r.ownerId);
      const [{ n }] = await db.select({ n: projectKanbanTasks.id }).from(projectKanbanTasks)
        .where(and(eq(projectKanbanTasks.projectId, r.id), eq(projectKanbanTasks.status, "done"))).limit(1)
        .then((x) => [{ n: x.length }]).catch(() => [{ n: 0 }]);
      done += 1;
      console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
      void n;
    } catch (err) {
      failed += 1;
      console.log(`FAILED after ${Math.round((Date.now() - started) / 1000)}s: ${(err as Error)?.message?.slice(0, 120)}`);
    }
  }

  console.log(`\n${done} built, ${failed} failed, ${Math.round((Date.now() - startedAll) / 60000)} minutes.`);
  if (failed) console.log("Run it again — finished builds are skipped, so it resumes.");
  return failed ? 1 : 0;
}

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => { console.error(err); process.exit(1); },
  );
}
