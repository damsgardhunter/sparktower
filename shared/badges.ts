/**
 * The badge catalog.
 *
 * Badges existed as three database tables, an award function, a profile panel
 * and an API route — and not one badge. `createBadge` had no caller, no
 * migration inserted a row, and the only award site looked one up *by name*
 * and quietly did nothing when it found nothing. Every part of the feature
 * worked; the feature did not exist, and nothing anywhere said so.
 *
 * So the catalog lives here, in code, with stable ids rather than generated
 * uuids. That is the part that makes the rest safe: an award site can name
 * the badge it means (`BADGE.firstProject`) and be wrong loudly at boot if
 * that badge is not in the catalog, instead of being wrong silently forever
 * at the moment somebody earns it. `ensureBadgeCatalog` (server/badges.ts)
 * upserts these on startup, so the catalog is whatever this file says.
 *
 * Deliberately small. Three badges that can actually be earned beat forty that
 * cannot, and every one of these is awarded at a milestone the product already
 * had a line of code for. Adding a fourth means adding the award site in the
 * same change — a badge in this list with nothing awarding it is the bug this
 * file was written to end.
 */

export interface BadgeDefinition {
  id: string;
  name: string;
  description: string;
  /** A lucide icon name; the profile panel renders it. */
  icon: string;
  /** What to do to earn it, written to the person who hasn't. Shown on a locked badge. */
  howTo: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  category: string;
}

/**
 * Stable ids, referenced by every award site.
 *
 * Never renamed: the id is the foreign key in `user_badges`, so changing one
 * orphans every award of it. Retiring a badge means removing it from
 * `BADGE_CATALOG` and leaving the awards alone — see `ensureBadgeCatalog`,
 * which never deletes.
 */
export const BADGE = {
  firstProject: "first-project",
  profileComplete: "profile-complete",
  aiExplorer: "ai-explorer",
} as const;

export type BadgeId = (typeof BADGE)[keyof typeof BADGE];

export const BADGE_CATALOG: BadgeDefinition[] = [
  {
    id: BADGE.firstProject,
    name: "Shipped Something",
    description: "Posted your first project on SparkTower.",
    icon: "rocket",
    howTo: "Post your first project.",
    rarity: "common",
    category: "building",
  },
  {
    id: BADGE.profileComplete,
    name: "Fully Introduced",
    description: "Finished your profile, so matching and Discover can actually find you.",
    icon: "user-check",
    howTo: "Finish your profile — a headline, what you do, and what you're looking for.",
    rarity: "common",
    category: "profile",
  },
  {
    id: BADGE.aiExplorer,
    name: "AI Explorer",
    description: "Had Nova storyboard one of your projects.",
    icon: "sparkles",
    howTo: "Ask Nova to storyboard one of your projects.",
    rarity: "common",
    category: "ai",
  },
];

/** Every id in the catalog, for the boot-time check that award sites name real badges. */
export const BADGE_IDS: ReadonlySet<string> = new Set(BADGE_CATALOG.map((b) => b.id));
