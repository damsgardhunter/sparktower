/**
 * Puts demo accounts on a project's backer wall.
 *
 * The companion to `unseed-collaborators`. That one takes seeded people out of
 * a project's Team, where they were ten strangers with no tasks; this one puts
 * them where a person who likes a project but is not building it actually
 * belongs. Between them, "they should only show up on the backer wall" is a
 * thing you can make true.
 *
 * It does everything the real pledge path does apart from taking money:
 * `recordBacking` writes the backing, takes a believer number from the
 * campaign's counter, snapshots the rung the amount bought and mints the badge.
 * Those last three are the difference between a name on a wall and a row that
 * reads "Priya Ferreira · Gold · #0006 · The Shirt", and they are why a backing
 * inserted by hand always looks half-finished.
 *
 * The amounts walk up the project's own rungs rather than being one flat figure,
 * so the wall shows what the levels look like next to each other — which is the
 * point of a demo wall, and was not true of the ones the reputation seeder made
 * (every single one $20, every badge silver).
 *
 * ## What it changes that you can see
 *
 * The project's public "raised" figure, which is the sum of its settled
 * backings. It does *not* touch `projects.total_donations`, which is what the
 * reputation index reads for dollars pledged — so this makes the wall fuller
 * without moving that score. It does add distinct backers, which the index does
 * count.
 *
 *   DATABASE_URL=… npx tsx script/seed-backer-wall.ts <project title or id> \
 *     --people a@b.test,c@d.test [--apply]
 *
 * Reports by default; `--apply` writes.
 */
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { db } from "../server/db";
import {
  projectBackerTiers, projectBackingCampaigns, projectBackings, projects, users,
} from "@shared/schema";
import { badgeLevelForAmount } from "@shared/backing";
import { ensureBackerBadges } from "../server/backer-badges";
import { assignBelieverNumbers, nameTiers } from "./backfill-backer-badges";

/** When no campaign rungs exist, a ladder that still shows every badge level. */
const DEFAULT_LADDER = [500, 1_500, 3_500, 7_500];

/** How far back to spread the pledges, so a wall is not all one timestamp. */
const WEEKS = 12;

/**
 * Refuses an ambiguous title rather than taking the first one.
 *
 * Titles are not unique and nothing says they should be. There are two projects
 * called "SparkTower" in the development database — one of them somebody's test
 * fixture — and picking whichever row came back first would have written seven
 * pledges onto a stranger's project with no sign anything was wrong. A name that
 * means two things is not an argument this can act on.
 */
async function resolveProject(what: string) {
  const rows = await db.select({
    id: projects.id, title: projects.title, ownerEmail: users.email,
  }).from(projects)
    .leftJoin(users, eq(users.id, projects.ownerId))
    .where(or(eq(projects.id, what), eq(projects.title, what)));
  if (!rows.length) throw new Error(`No project matches ${JSON.stringify(what)}.`);
  if (rows.length > 1) {
    const lines = rows.map((r) => `  ${r.id}  ${r.title} — ${r.ownerEmail ?? "no owner"}`).join("\n");
    throw new Error(`${rows.length} projects are called ${JSON.stringify(what)}. Name one by id:\n${lines}`);
  }
  return rows[0];
}

async function resolvePeople(list: string[]) {
  if (!list.length) throw new Error("Nobody named. Pass --people with emails or ids.");
  const rows = await db.select({
    id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName,
  }).from(users).where(or(inArray(users.id, list), inArray(users.email, list)));
  const missing = list.filter((w) => !rows.some((r) => r.id === w || r.email === w));
  if (missing.length) throw new Error(`No account matches: ${missing.join(", ")}`);
  return rows;
}

export async function seedWall(projectWhat: string, people: string[], apply: boolean): Promise<number> {
  const project = await resolveProject(projectWhat);
  const everyone = await resolvePeople(people);

  const [campaign] = await db.select().from(projectBackingCampaigns)
    .where(eq(projectBackingCampaigns.projectId, project.id));
  if (!campaign) throw new Error(`${project.title} is not taking backing — there is no wall to be on.`);

  /* Already on the wall is already done; backing twice would be a second pledge, not a fix. */
  const existing = await db.select({ backerId: projectBackings.backerId })
    .from(projectBackings)
    .where(and(
      eq(projectBackings.projectId, project.id),
      inArray(projectBackings.status, ["held", "released"]),
    ));
  const already = new Set(existing.map((r) => r.backerId));
  const toAdd = everyone.filter((p) => !already.has(p.id));

  const tiers = await db.select().from(projectBackerTiers)
    .where(eq(projectBackerTiers.projectId, project.id))
    .orderBy(projectBackerTiers.amountCents);
  const ladder = tiers.length ? tiers.map((t) => t.amountCents) : DEFAULT_LADDER;

  const planned = toAdd.map((person, i) => {
    const amountCents = ladder[i % ladder.length];
    return {
      person,
      amountCents,
      level: badgeLevelForAmount(amountCents).key,
      tierName: tiers.find((t) => t.amountCents === amountCents)?.name ?? null,
      weeksAgo: (i % WEEKS) + 1,
    };
  });

  const name = (p: { firstName: string | null; lastName: string | null; email: string | null }) =>
    [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email || "somebody";

  console.log(`\n${project.title}`);
  for (const p of everyone.filter((p) => already.has(p.id))) {
    console.log(`  ${name(p).padEnd(20)} already backs it — left alone`);
  }
  for (const p of planned) {
    console.log(`  ${name(p.person).padEnd(20)} $${(p.amountCents / 100).toFixed(2).padStart(7)}  ${p.level}${p.tierName ? ` · ${p.tierName}` : ""}`);
  }
  const added = planned.reduce((sum, p) => sum + p.amountCents, 0);
  console.log(`\n${planned.length} pledge(s) to add, $${(added / 100).toFixed(2)} on the project's raised figure.`);

  if (!apply) {
    console.log("Report only. Pass --apply to write them.");
    return 0;
  }
  if (!planned.length) return 0;

  for (const p of planned) {
    await db.insert(projectBackings).values({
      projectId: project.id,
      backerId: p.person.id,
      amountCents: p.amountCents,
      status: "released",
      tierNameAtBacking: p.tierName,
      tierId: tiers.find((t) => t.amountCents === p.amountCents)?.id ?? null,
      createdAt: sql`(now() at time zone 'utc') - (${p.weeksAgo} * interval '1 week')`,
    } as any);
  }

  /*
   * The rest of what a real pledge gets, through the same functions the live
   * path and the backfill use. Numbering covers everyone unnumbered on this
   * project, not only the new ones — a wall where some rows have a believer
   * number and some do not reads as broken rather than as partly seeded.
   */
  const numbered = await assignBelieverNumbers(project.id);
  const named = await nameTiers(project.id);
  let badges = 0;
  for (const p of planned) badges += (await ensureBackerBadges(p.person.id)).length;

  console.log(`\nAdded ${planned.length}. Numbered ${numbered} backing(s) on this project, named the rung on ${named}, minted ${badges} badge(s).`);
  console.log("No artwork was drawn — that is a paid model call, made when a badge's owner asks for it.");
  return 0;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const what = args.find((a) => !a.startsWith("--"));
  const peopleArg = args.find((a) => a.startsWith("--people="))?.slice("--people=".length)
    ?? (args.includes("--people") ? args[args.indexOf("--people") + 1] : undefined);
  if (!what || !peopleArg) {
    console.error("Usage: npx tsx script/seed-backer-wall.ts <project title or id> --people a@b,c@d [--apply]");
    return 1;
  }
  const people = peopleArg.split(",").map((s) => s.trim()).filter(Boolean);
  return seedWall(what, people, args.includes("--apply"));
}

/* Only as a command, never on import — see the note in script/reputation-gap.ts. */
const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => { console.error(err); process.exit(1); },
  );
}
