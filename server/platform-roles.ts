/**
 * Who is allowed to release other people's money.
 *
 * Backing payouts are approved by hand, so this module is the boundary between
 * held backer funds and whoever asks for them. Two rules follow from that:
 *
 *  1. The role is never settable through the API. There is no "make me a
 *     reviewer" endpoint to find, because the promotion list lives in the
 *     environment and is applied at boot.
 *  2. Demotion is applied too. Removing an address from the allowlist takes
 *     the role away on the next restart; a leaver who keeps approving payouts
 *     is the failure mode worth designing against.
 */
import { db } from "./db";
import { users } from "@shared/schema";
import { eq, and, inArray, notInArray, sql } from "drizzle-orm";
import type { RequestHandler } from "express";

export type PlatformRole = "user" | "reviewer" | "admin";

const RANK: Record<PlatformRole, number> = { user: 0, reviewer: 1, admin: 2 };

const asRole = (value: string | null | undefined): PlatformRole =>
  value === "admin" || value === "reviewer" ? value : "user";

export function atLeast(role: string | null | undefined, minimum: PlatformRole): boolean {
  return RANK[asRole(role)] >= RANK[minimum];
}

function allowlist(): string[] {
  return (process.env.PLATFORM_REVIEWER_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Brings the `platform_role` column in line with the environment allowlist.
 *
 * Run once at boot. Listed addresses become admins; anyone holding a platform
 * role who is no longer listed drops back to "user".
 */
export async function syncPlatformRoles(): Promise<void> {
  const emails = allowlist();

  try {
    // Compared case-insensitively: nothing stops an account being created as
    // Hunter@… and an allowlist written as hunter@…, and the failure mode of
    // an exact match is silent — the sync reports success and the reviewer
    // simply never gets the role.
    const emailLower = sql`lower(${users.email})`;

    if (emails.length > 0) {
      const promoted = await db.update(users).set({ platformRole: "admin" })
        .where(and(inArray(emailLower, emails), eq(users.platformRole, "user")))
        .returning({ id: users.id });
      if (promoted.length > 0) {
        console.log(`[platform-roles] Promoted ${promoted.length} account(s) to admin.`);
      }
    }

    // Revoke anything not on the list, including when the list is empty.
    const revoke = emails.length > 0
      ? and(notInArray(users.platformRole, ["user"]), notInArray(emailLower, emails))
      : notInArray(users.platformRole, ["user"]);
    await db.update(users).set({ platformRole: "user" }).where(revoke);

    /*
     * Report what the database actually says, not what the allowlist hoped
     * for. The first version of this logged the size of the allowlist, which
     * read as confirmation while a typo in the address meant nobody had been
     * promoted at all.
     */
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` })
      .from(users).where(notInArray(users.platformRole, ["user"]));
    if (emails.length > 0 && n === 0) {
      console.warn(
        `[platform-roles] PLATFORM_REVIEWER_EMAILS lists ${emails.length} address(es) but ` +
        "none matched a registered account — check for typos. Nobody can approve a payout.",
      );
    }

    if (emails.length === 0) {
      console.warn(
        "[platform-roles] PLATFORM_REVIEWER_EMAILS is empty — nobody can approve " +
        "a backing payout. Set it to your address to review held funds.",
      );
    } else {
      console.log(`[platform-roles] ${n} account(s) hold a platform role.`);
    }
  } catch (err) {
    // A boot-time role sync must never take the server down with it.
    console.error("[platform-roles] Failed to sync platform roles:", err);
  }
}

/**
 * The one account that may watch what everyone else is doing.
 *
 * Deliberately not the reviewer role. Reviewers exist so someone can be handed
 * the report queue and the payout queue without also being handed a live feed
 * of every person's movements around the site — those are different kinds of
 * trust, and collapsing them means the only way to get help with moderation is
 * to give away everything.
 *
 * One address, and it fails closed: unset means nobody, including whoever is
 * already an admin.
 */
function ownerEmail(): string | null {
  return (process.env.PLATFORM_OWNER_EMAIL || "").trim().toLowerCase() || null;
}

export function isOwner(email: string | null | undefined): boolean {
  const owner = ownerEmail();
  return !!owner && !!email && email.trim().toLowerCase() === owner;
}

/** Gate for the analytics console. Nothing else uses it. */
export const requireOwner: RequestHandler = (req: any, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Not signed in" });
  if (!isOwner(req.user.email)) {
    // 404, like requireReviewer: don't confirm the console exists to someone
    // who found the URL.
    return res.status(404).json({ message: "Not found" });
  }
  next();
};

/** Gate for anything that moves money that isn't the caller's. */
export const requireReviewer: RequestHandler = (req: any, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Not signed in" });
  if (!atLeast(req.user.platformRole, "reviewer")) {
    // Deliberately not "you are not a reviewer" — don't confirm the shape of
    // the permission system to someone probing for it.
    return res.status(404).json({ message: "Not found" });
  }
  next();
};
