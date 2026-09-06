import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  passwordHash: varchar("password_hash"),
  authProvider: varchar("auth_provider").default("local"),
  googleId: varchar("google_id").unique(),
  stripeCustomerId: varchar("stripe_customer_id"),
  stripeSubscriptionId: varchar("stripe_subscription_id"),
  subscriptionTier: varchar("subscription_tier").default("free"),
  creditsUsed: integer("credits_used").default(0).notNull(),
  creditsResetAt: timestamp("credits_reset_at"),
  stripeConnectAccountId: varchar("stripe_connect_account_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/**
 * Refresh tokens for the native mobile apps.
 *
 * The web app uses cookie sessions, but a native client can't rely on cookies
 * (no shared cookie jar with the API origin, and `sameSite` rules break it),
 * so mobile authenticates with a short-lived access token plus a rotating
 * refresh token stored here.
 *
 * Only a SHA-256 hash of the refresh token is persisted — a database leak
 * must not hand out working sessions.
 */
export const mobileRefreshTokens = pgTable(
  "mobile_refresh_tokens",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id),
    tokenHash: varchar("token_hash").notNull().unique(),
    /** Free-form client label, e.g. "iPhone 15 · iOS 18". */
    device: varchar("device"),
    expiresAt: timestamp("expires_at").notNull(),
    /** Set when rotated or explicitly signed out. */
    revokedAt: timestamp("revoked_at"),
    lastUsedAt: timestamp("last_used_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("IDX_mobile_refresh_user").on(table.userId)]
);

export type UpsertUser = typeof users.$inferInsert;
export type UserRow = typeof users.$inferSelect;
export type MobileRefreshToken = typeof mobileRefreshTokens.$inferSelect;
export type User = typeof users.$inferSelect;
