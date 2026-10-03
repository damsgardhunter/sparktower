/**
 * Gives every settled backing the badge it earned, and a believer number.
 *
 * `recordBacking` mints the badge inside the same transaction as the pledge, so
 * for a real backer this has nothing to do. What it is for is every backing
 * written another way — the demo seeds, `script/seed-max-reputation.ts`, a hand
 * repair, an import — which insert `project_backings` directly and so skip both
 * the badge and the believer counter. Those backers show up on the wall with the
 * level their amount clears, no number, and nothing whatsoever on their profile:
 * they are owed a badge, there is no row for it, and nobody can equip what does
 * not exist.
 *
 * The badges are minted through `ensureBackerBadges`, which is the same function
 * the signed-in paths call, so a backfilled badge cannot come out a level away
 * from a minted one. No artwork is drawn — that is a paid model call per badge,
 * asked for by the badge's owner. Until then the medal wears the project's own
 * logo in that level's metal, which is what the wall and the profile already
 * show for a badge that has not been generated.
 *
 * Believer numbers are assigned in the order the pledges were made, after
 * whatever numbers were already handed out, and the campaign's counter is moved
 * up to match so the next real pledge cannot be given a number twice.
 *
 * Tier names are filled in the same way the live path resolves them: from the
 * project's own rungs, by the amount pledged. A seeded backing has no tier at
 * all, so the wall reads "Fred · Silver" with nothing after it where every real
 * pledge names what it bought. Nothing is invented — a project with no rungs
 * set up leaves its backings tierless, because there is no answer to take.
 *
 * Idempotent: run it as often as you like. Nothing is overwritten — a badge that
 * exists is left alone and a backing that already has a number keeps it.
 *
 *   DATABASE_URL=… npx tsx script/backfill-backer-badges.ts [--dry-run]
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { db } from "../server/db";
import { projectBackerTiers, projectBackingCampaigns, projectBackings, projects } from "@shared/schema";
import { ensureBackerBadges } from "../server/backer-badges";
import { badgeLevelForAmount, tierForAmount } from "@shared/backing";

const SETTLED = ["held", "released"] as const;

/**
 * Hands out the numbers one project is missing.
 *
 * Numbering starts above the highest number already on that project rather
 * than at 1: a project with real backers and seeded ones must not give #0003
 * to two people, and the number is the one thing on the wall somebody would
 * notice twice.
 */
export async function assignBelieverNumbers(projectId: string, dryRun = false): Promise<number> {
  const unnumbered = await db.select({ id: projectBackings.id })
    .from(projectBackings)
    .where(and(
      eq(projectBackings.projectId, projectId),
      inArray(projectBackings.status, [...SETTLED]),
      isNull(projectBackings.believerNumber),
    ))
    .orderBy(asc(projectBackings.createdAt), asc(projectBackings.id));
  if (!unnumbered.length) return 0;

  const [{ highest }] = await db.select({
    highest: sql<number>`coalesce(max(${projectBackings.believerNumber}), 0)::int`,
  }).from(projectBackings).where(eq(projectBackings.projectId, projectId));

  if (dryRun) return unnumbered.length;

  let next = highest;
  for (const row of unnumbered) {
    next += 1;
    await db.update(projectBackings).set({ believerNumber: next })
      .where(eq(projectBackings.id, row.id));
  }

  /*
   * And the counter the live path reads. `recordBacking` takes the next number
   * from `believerCount` on the campaign row, so leaving it behind the numbers
   * actually in use would hand the next real backer a number somebody is
   * already wearing.
   */
  await db.update(projectBackingCampaigns)
    .set({ believerCount: sql`greatest(${projectBackingCampaigns.believerCount}, ${next})` })
    .where(eq(projectBackingCampaigns.projectId, projectId));

  return unnumbered.length;
}

/**
 * Names the rung each tierless pledge actually bought.
 *
 * `tierForAmount` is the same resolution checkout uses — the most expensive
 * rung the amount clears, rather than whatever was clicked — so a backfilled
 * name cannot disagree with the one a real pledge would have been given. Both
 * the id and the snapshot of the name are written, which is what the live path
 * stores: the id for the entitlements, the name so renaming a rung later
 * cannot rewrite history.
 */
export async function nameTiers(projectId: string, dryRun = false): Promise<number> {
  const tierless = await db.select({
    id: projectBackings.id,
    amountCents: projectBackings.amountCents,
  }).from(projectBackings)
    .where(and(
      eq(projectBackings.projectId, projectId),
      inArray(projectBackings.status, [...SETTLED]),
      isNull(projectBackings.tierId),
      isNull(projectBackings.tierNameAtBacking),
    ));
  if (!tierless.length) return 0;

  const tiers = await db.select().from(projectBackerTiers)
    .where(eq(projectBackerTiers.projectId, projectId));
  if (!tiers.length) return 0;

  let named = 0;
  for (const backing of tierless) {
    const tier = tierForAmount(tiers, backing.amountCents);
    if (!tier) continue; // Pledged less than the cheapest rung. Nothing bought, nothing to name.
    named += 1;
    if (dryRun) continue;
    await db.update(projectBackings)
      .set({ tierId: tier.id, tierNameAtBacking: tier.name })
      .where(eq(projectBackings.id, backing.id));
  }
  return named;
}

export async function backfill(dryRun: boolean): Promise<number> {
  const rows = await db.selectDistinct({
    backerId: projectBackings.backerId,
    projectId: projectBackings.projectId,
  }).from(projectBackings)
    .innerJoin(projects, eq(projects.id, projectBackings.projectId))
    .where(inArray(projectBackings.status, [...SETTLED]));

  if (!rows.length) {
    console.log("No settled backings. Nothing to do.");
    return 0;
  }

  const projectIds = [...new Set(rows.map((r) => r.projectId))];
  const backerIds = [...new Set(rows.map((r) => r.backerId))];
  console.log(`${rows.length} settled (backer, project) pairs across ${projectIds.length} project(s), ${backerIds.length} backer(s).`);

  let numbered = 0;
  let named = 0;
  for (const projectId of projectIds) {
    numbered += await assignBelieverNumbers(projectId, dryRun);
    named += await nameTiers(projectId, dryRun);
  }
  console.log(`${dryRun ? "Would number" : "Numbered"} ${numbered} backing(s) that had no believer number.`);
  console.log(`${dryRun ? "Would name" : "Named"} the rung on ${named} backing(s) that had no tier.`);

  let minted = 0;
  if (dryRun) {
    /*
     * Counted rather than minted, through the same amounts the real thing
     * derives from — so the dry run reports the levels that would be struck
     * and not merely how many rows would appear.
     */
    const totals = await db.select({
      backerId: projectBackings.backerId,
      projectId: projectBackings.projectId,
      totalCents: sql<number>`sum(${projectBackings.amountCents})::int`,
    }).from(projectBackings)
      .where(inArray(projectBackings.status, [...SETTLED]))
      .groupBy(projectBackings.backerId, projectBackings.projectId);
    const byLevel = new Map<string, number>();
    for (const t of totals) {
      const key = badgeLevelForAmount(t.totalCents).key;
      byLevel.set(key, (byLevel.get(key) ?? 0) + 1);
    }
    console.log(`Would ensure ${totals.length} badge(s): ${[...byLevel].map(([k, n]) => `${n} ${k}`).join(", ")}.`);
    console.log("Dry run — nothing was written.");
    return 0;
  }

  for (const backerId of backerIds) {
    const created = await ensureBackerBadges(backerId);
    minted += created.length;
  }
  console.log(`Minted ${minted} badge(s). The artwork is not drawn here — each badge's owner asks for that from their profile.`);
  return 0;
}

async function main(): Promise<number> {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("Dry run: reporting only.\n");
  return backfill(dryRun);
}

/* Only as a command, never on import — see the note in script/reputation-gap.ts. */
const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => { console.error(err); process.exit(1); },
  );
}
