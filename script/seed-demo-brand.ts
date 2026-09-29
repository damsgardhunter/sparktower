/**
 * Draws a logo and a cover for each demo builder's project.
 *
 * Separate from the seeding and from the builds because it is the third kind
 * of expensive: two image generations per project, and images cost more per
 * call than the text does. Resumable for the same reason — a project that
 * already has both is skipped, so an interrupted run is resumed by running it
 * again rather than paying twice.
 *
 * It calls `drawBrandKit` directly rather than POSTing to the brand-kit route.
 * The route is where the dollar and the sign-in live, and neither applies:
 * these owners are bot accounts that cannot sign in at all.
 *
 *   DATABASE_URL=… npx tsx script/seed-demo-brand.ts               # what it would draw
 *   DATABASE_URL=… npx tsx script/seed-demo-brand.ts --apply
 *   DATABASE_URL=… npx tsx script/seed-demo-brand.ts --apply --limit 1
 */
import { pathToFileURL } from "node:url";
import { eq, like } from "drizzle-orm";
import { db } from "../server/db";
import { users, projects } from "@shared/schema";
import { DEMO_BUILDERS } from "./seed/demo-builders";

const apply = process.argv.includes("--apply");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

/** The style each project asked for, by title. */
const STYLES = new Map(
  DEMO_BUILDERS.flatMap((b) => b.projects.map((p) => [p.title, p.brandStyle] as const)),
);

async function main(): Promise<number> {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL.");

  const rows = await db.select({
    id: projects.id, title: projects.title, logoUrl: projects.logoUrl, coverUrl: projects.coverUrl,
    owner: users.firstName,
  }).from(projects).innerJoin(users, eq(users.id, projects.ownerId))
    .where(like(users.email, "%@demo.sparktower.invalid"))
    .orderBy(projects.createdAt);

  const todo = rows.filter((r) => !r.logoUrl || !r.coverUrl);
  console.log(`demo projects: ${rows.length}`);
  console.log(`already drawn: ${rows.length - todo.length}`);
  console.log(`to draw:       ${Math.min(todo.length, LIMIT)}`);

  if (!apply) {
    for (const r of todo.slice(0, LIMIT)) console.log(`  ${r.owner} — ${r.title} (${STYLES.get(r.title) ?? "wordmark"})`);
    console.log("\nreport only — rerun with --apply. Two image generations each.");
    return 0;
  }

  const { drawBrandKit } = await import("../server/brand-kit");
  const { logoStyle } = await import("@shared/brand-kit");

  let done = 0, failed = 0, noCover = 0;
  for (const r of todo.slice(0, LIMIT)) {
    const started = Date.now();
    process.stdout.write(`  ${r.owner} — ${r.title} … `);
    try {
      const [project] = await db.select().from(projects).where(eq(projects.id, r.id));
      const { logoUrl, coverUrl } = await drawBrandKit(project, logoStyle(STYLES.get(r.title)));
      await db.update(projects)
        .set({ logoUrl, ...(coverUrl ? { coverUrl } : {}) })
        .where(eq(projects.id, r.id));
      done += 1;
      if (!coverUrl) noCover += 1;
      console.log(`${coverUrl ? "logo + cover" : "logo only"} in ${Math.round((Date.now() - started) / 1000)}s`);
    } catch (err) {
      failed += 1;
      console.log(`FAILED: ${(err as Error)?.message?.slice(0, 120)}`);
    }
  }

  console.log(`\n${done} drawn${noCover ? ` (${noCover} without a cover)` : ""}, ${failed} failed.`);
  return failed ? 1 : 0;
}

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => { console.error(err); process.exit(1); },
  );
}
