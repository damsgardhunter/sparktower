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

  async linkGoogleAccount(userId: string, googleId: string): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ googleId, authProvider: "google", updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }
}

export const authStorage = new AuthStorage();
