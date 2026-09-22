/**
 * Getting the badge catalog into the database, and badges onto people.
 *
 * The catalog itself is `@shared/badges`. This is the half that touches
 * Postgres: an upsert on boot so the rows exist, and one award helper every
 * milestone goes through.
 *
 * ## Why the helper exists rather than calling `storage.awardBadge` directly
 *
 * `awardBadge` returns null for an unknown badge id and logs a warning, which
 * is the right behaviour in production — a decoration must never fail the
 * request that earned it. But it is exactly how this feature managed to be
 * completely dead for its whole life: the one award site looked a badge up by
 * *name*, found nothing because no badge had ever been inserted, and did
 * nothing at all, forever, without a single error anywhere. A silence that
 * quiet is indistinguishable from working.
 *
 * So the helper is typed to the catalog, and in development and test it
 * throws when a site names a badge the catalog does not have. The mistake is
 * then made at the moment it is written, not discovered a year later by
 * somebody wondering why nobody has any badges.
 */
import { sql } from "drizzle-orm";
import { db } from "./db";
import { badges } from "@shared/schema";
import { BADGE, BADGE_CATALOG, BADGE_IDS, type BadgeId } from "@shared/badges";
import { storage } from "./storage";

/**
 * Put the catalog in the database, idempotently.
 *
 * Insert-or-update on the stable id, so editing a description in
 * `@shared/badges` is a deploy rather than a migration, and re-running this
 * on every boot costs one statement. Nothing is ever deleted: a row removed
 * from the catalog still has `user_badges` pointing at it, and deleting it
 * would either fail on the foreign key or take somebody's award with it.
 */
export async function ensureBadgeCatalog(): Promise<void> {
  if (BADGE_CATALOG.length === 0) return;
  await db.insert(badges)
    .values(BADGE_CATALOG.map((b) => ({
      id: b.id, name: b.name, description: b.description,
      icon: b.icon, rarity: b.rarity, category: b.category,
    })))
    .onConflictDoUpdate({
      target: badges.id,
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        icon: sql`excluded.icon`,
        rarity: sql`excluded.rarity`,
        category: sql`excluded.category`,
      },
    });
}

/**
 * Give people the badges they have already earned.
 *
 * Awards fire at the moment a milestone happens, which is right — and useless
 * for everybody who passed that milestone before the award site existed. This
 * feature shipped dead, so on the day it came alive every single member had
 * done the things and had nothing to show: shipped projects, finished
 * profiles, storyboards drawn, and an empty badge panel saying so.
 *
 * So the earning rule is stated as a query and run on boot rather than only
 * as a callback. It is idempotent (insert-select, conflict ignored), it costs
 * three statements, and it is self-healing: if an award site is ever broken
 * again, the next deploy quietly gives everyone what they were owed instead
 * of leaving a hole nobody can see. The rules here must match the award sites
 * exactly — when they disagree, this one is the one people will believe,
 * because it is the one that decides what is on the page.
 */
export async function backfillEarnedBadges(): Promise<void> {
  const rules: { badgeId: BadgeId; who: ReturnType<typeof sql> }[] = [
    // Posted a project: the same milestone POST /api/projects awards.
    { badgeId: BADGE.firstProject, who: sql`select distinct owner_id from projects` },
    // Finished onboarding, which is what makes somebody matchable at all.
    // `is_onboarded` lives on the profile row, which is what completeOnboarding sets.
    { badgeId: BADGE.profileComplete, who: sql`select user_id from user_profiles where is_onboarded = true` },
    // Had Nova storyboard a project of theirs.
    {
      badgeId: BADGE.aiExplorer,
      who: sql`select distinct p.owner_id from project_storyboards s join projects p on p.id = s.project_id`,
    },
  ];
  for (const rule of rules) {
    if (!BADGE_IDS.has(rule.badgeId)) continue;
    try {
      await db.execute(sql`
        insert into user_badges (user_id, badge_id)
        select w.id, ${rule.badgeId} from (${rule.who}) as w(id)
        join users u on u.id = w.id
        where u.deleted_at is null
        on conflict do nothing
      `);
    } catch (e) {
      // Never fatal: a badge is a decoration, and the server must boot without it.
      console.error(`[badges] couldn't back-fill "${rule.badgeId}":`, e);
    }
  }
}

/** Whether an unearned-badge mistake should stop the process or just be logged. */
const strict = process.env.NODE_ENV !== "production";

/**
 * Award one, without ever failing the thing that earned it.
 *
 * Awarding is a side effect of a milestone: creating a project, finishing a
 * profile. If the badge write fails, the project still exists and the request
 * must still succeed — so every failure here is swallowed and logged. The one
 * exception is naming a badge that is not in the catalog, which is a bug in
 * this repository rather than a runtime condition, and outside production it
 * is raised immediately.
 */
export async function award(userId: string, badgeId: BadgeId): Promise<void> {
  if (!BADGE_IDS.has(badgeId)) {
    const message = `[badges] "${badgeId}" is not in BADGE_CATALOG; nobody can ever earn it.`;
    if (strict) throw new Error(message);
    console.error(message);
    return;
  }
  try {
    await storage.awardBadge(userId, badgeId);
  } catch (e) {
    console.error(`[badges] couldn't award "${badgeId}" to ${userId}:`, e);
  }
}
