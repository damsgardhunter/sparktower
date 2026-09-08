/**
 * Everything a new account needs before it can be used.
 *
 * There are three ways to become a user here — email registration, Google on
 * the web, and Google from the native apps — and each one used to create a
 * `users` row and stop. Nothing created the `user_profiles` row, so a new
 * account had no display name, no avatar, and no `isOnboarded` flag. The
 * client's onboarding redirect reads `profile && !profile.isOnboarded`, which
 * a missing profile fails, so those accounts were let straight into the app
 * with no way to ever complete setup.
 *
 * One function, called from all three, so a fourth sign-in method can't
 * reintroduce the gap by forgetting a step.
 */
import { eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { users, userProfiles } from "@shared/schema";

export interface ProvisionableUser {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
}

/** "hunter.damsgard" -> "Hunter Damsgard". A better start than an empty box. */
function nameFromEmail(email: string | null | undefined): string | null {
  const local = email?.split("@")[0];
  if (!local) return null;
  const words = local
    .replace(/[._-]+/g, " ")
    .replace(/\d+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return null;
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

/**
 * Creates the profile row for a user if they don't have one yet.
 *
 * Safe to call on *every* sign-in, not just registration — which is how the
 * accounts that predate this fix get healed without anyone running a script.
 * The insert is `onConflictDoNothing` on the unique `userId`, so two
 * simultaneous logins can't produce a duplicate and the common path (profile
 * already exists) costs one no-op statement.
 *
 * `isOnboarded` is deliberately left false: seeding a name from Google gives
 * someone a head start, it doesn't mean they've chosen their skills, their
 * availability, or how they like to work.
 */
export async function ensureUserProfile(user: ProvisionableUser): Promise<{ created: boolean }> {
  if (!user?.id) return { created: false };

  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    nameFromEmail(user.email) ||
    null;

  try {
    const inserted = await db.insert(userProfiles).values({
      userId: user.id,
      displayName,
      // Google hands us a photo; carrying it over means the first screen they
      // see already looks like them rather than like a stranger's account.
      avatarUrl: user.profileImageUrl || null,
      isOnboarded: false,
    }).onConflictDoNothing({ target: userProfiles.userId }).returning({ id: userProfiles.id });

    return { created: inserted.length > 0 };
  } catch (err) {
    /*
     * Never block a sign-in on this. A user who gets in without a profile is
     * recoverable — the next request calls this again — but one who can't log
     * in at all is not.
     */
    console.error(`[provisioning] Could not create profile for ${user.id}:`, err);
    return { created: false };
  }
}

/**
 * Heals every account that predates the fix above.
 *
 * Run once at boot. Per-login provisioning would get there eventually, but
 * only for people who come back, and a half-provisioned user table makes
 * every join that assumes a profile behave differently for different rows.
 */
export async function backfillMissingProfiles(): Promise<number> {
  try {
    const orphaned = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
      })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(isNull(userProfiles.id));

    if (orphaned.length === 0) return 0;

    let created = 0;
    for (const user of orphaned) {
      if ((await ensureUserProfile(user)).created) created++;
    }
    console.log(`[provisioning] Created ${created} missing profile(s).`);
    return created;
  } catch (err) {
    // A boot-time repair must never take the server down with it.
    console.error("[provisioning] Backfill failed:", err);
    return 0;
  }
}
