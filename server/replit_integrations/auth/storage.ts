import { users, type User, type UpsertUser } from "@shared/schema";
import { db } from "../../db";
import { eq, sql } from "drizzle-orm";

/**
 * An address, as the one thing it is.
 *
 * Nothing normalised these, and Postgres compares text exactly — so
 * `Hunter@gmail.com` and `hunter@gmail.com` were two accounts, the unique
 * constraint allowed both, and signing in with the wrong capitalisation said
 * "invalid email or password". The way people actually met it: signing up with
 * a password, then using Sign in with Google, whose address came back in a
 * different case — the lookup missed, and Google created a second account for
 * the same person.
 *
 * The local part of an address is case-sensitive by the letter of the spec and
 * by nobody's implementation, and treating it otherwise loses people from their
 * own accounts.
 */
export const normalizeEmail = (email: string | null | undefined): string =>
  String(email ?? "").trim().toLowerCase();

export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  linkGoogleAccount(userId: string, googleId: string): Promise<User>;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  /** Case-insensitively, so an address is the same address however it was typed. */
  async getUserByEmail(email: string): Promise<User | undefined> {
    const wanted = normalizeEmail(email);
    if (!wanted) return undefined;
    const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${wanted}`);
    return user;
  }

  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.googleId, googleId));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    // Stored lowercased, so the row matches what every lookup asks for.
    const values = userData.email ? { ...userData, email: normalizeEmail(userData.email) } : userData;
    const [user] = await db
      .insert(users)
      .values(values)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...values,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  /**
   * Attaches a Google identity to an account that already has this address.
   *
   * The account-takeover this closes, which is the oldest trick against an app
   * that offers both a password and "sign in with Google":
   *
   *   1. Somebody registers victim@gmail.com with a password of their choosing.
   *      Nothing stops them — registration doesn't require proving the address,
   *      and it shouldn't, because that would stop people using the product
   *      while they wait for an email.
   *   2. The real owner of victim@gmail.com later clicks Sign in with Google.
   *   3. The address matches, so Google is attached to the account somebody
   *      else made, and the real owner is signed into it — while the squatter's
   *      password still works. Two people in one account, and only one of them
   *      knows.
   *
   * So: when the existing account never proved it owns the address and Google
   * just did, Google wins. The password on it is cleared, every session and
   * device token is cut, and the address is marked verified — the person who
   * actually controls the mailbox keeps the account, and anyone who was sitting
   * in it is put out. They can set a password again through a reset, which goes
   * to the address they'd have to control.
   *
   * When the account *is* verified, both parties have proved the same address
   * and linking is just linking.
   */
  async linkGoogleAccount(userId: string, googleId: string): Promise<User> {
    const [existing] = await db.select().from(users).where(eq(users.id, userId));
    const unproven = existing && !existing.emailVerifiedAt;

    const [user] = await db
      .update(users)
      .set({
        googleId,
        authProvider: "google",
        updatedAt: new Date(),
        ...(unproven
          ? {
              passwordHash: null,
              emailVerifiedAt: new Date(),
              // Cuts every mobile token issued before now (server/mobile-auth.ts).
              accessTokensRevokedAt: new Date(),
            }
          : {}),
      })
      .where(eq(users.id, userId))
      .returning();

    if (unproven) {
      // And the browser sessions, which live in their own table.
      await db.execute(sql`DELETE FROM sessions WHERE sess->'passport'->>'user' = ${userId}`);
      console.warn(
        `[auth] ${userId} had an unverified password on ${user.email} and Google proved that address: ` +
        `password cleared and sessions ended, so whoever registered it cannot keep using it.`,
      );
    }
    return user;
  }
}

export const authStorage = new AuthStorage();
