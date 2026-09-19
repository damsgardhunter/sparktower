import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

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
  /**
   * The last subscription payment that failed and hasn't been fixed since —
   * set by invoice.payment_failed, cleared by the next paid invoice. What the
   * app shows as "update your card"; the tier itself still follows the
   * subscription's status events.
   */
  paymentFailedAt: timestamp("payment_failed_at"),
  paymentFailureMessage: text("payment_failure_message"),
  /** A subscription payment refunded in full, which took the paid plan away until the next one is paid. */
  subscriptionRefundedAt: timestamp("subscription_refunded_at"),
  stripeConnectAccountId: varchar("stripe_connect_account_id"),
  /**
   * Platform-side authority, distinct from a user's role on any one project.
   *
   * Only "reviewer" and above may approve a backing payout, so this is the
   * column standing between held backer money and whoever asks for it. It is
   * never settable through the API — see PLATFORM_REVIEWER_EMAILS in
   * server/platform-roles.ts, which promotes a fixed allowlist at boot.
   */
  platformRole: varchar("platform_role").default("user").notNull(),
  /**
   * A bot: an account the product plays, not a person who signed up.
   *
   * Bots fill seats in a simulation lobby nobody else joined and partner
   * somebody who has waited alone in the sprint queue — an empty room is the
   * fastest way to lose the person who did turn up. They carry ordinary names
   * so a league table reads naturally, and every surface that shows one labels
   * it, because a bot that passes for a person is the product telling somebody
   * something untrue about who they are playing with.
   *
   * The flag is what keeps them out of the places a person is counted:
   * matches, Discover, the leaderboards and any number quoted as usage. It is
   * set when the row is created and never through the API — nothing signs in
   * as a bot, and bot rows carry no password hash.
   */
  isBot: boolean("is_bot").default(false).notNull(),
  /**
   * Set when an account is suspended. Checked on every authenticated request,
   * so a suspension takes effect on the suspended person's next action rather
   * than whenever their session happens to expire.
   */
  suspendedAt: timestamp("suspended_at"),
  /**
   * Access tokens issued before this are refused, though their signature and
   * expiry are fine: set by sign-out-everywhere and by refresh-token reuse, so
   * a copied access token dies with the sessions instead of living out its 15 minutes.
   */
  accessTokensRevokedAt: timestamp("access_tokens_revoked_at"),

  /**
   * Set when the person deleted their account. The row stays as a tombstone —
   * moderation records and anything they chose to leave behind (shown as
   * "Deleted account") still point at it — but everything personal on it is
   * scrubbed and nothing can sign in as it again. See server/account-data.ts.
   */
  deletedAt: timestamp("deleted_at"),
  /**
   * Two-factor sign-in (server/mfa.ts). The authenticator secret, sealed
   * (server/secret-box.ts) — never plaintext. Required for reviewers, admins
   * and the platform owner; once enabled, every sign-in asks for a code.
   */
  mfaSecret: text("mfa_secret"),
  /** A secret being set up, sealed, until the first code from it proves the app has it. */
  mfaPendingSecret: text("mfa_pending_secret"),
  mfaEnabledAt: timestamp("mfa_enabled_at"),
  /** The last time step a code was accepted from: a code works once. */
  mfaLastStep: integer("mfa_last_step"),
  /**
   * When the subscription state this account carries was decided — the Stripe
   * event's own timestamp, not ours. Stripe makes no promise about delivery
   * order, so an older event arriving after a newer one would otherwise
   * downgrade a live plan or bring a cancelled one back (server/webhookHandlers.ts).
   */
  subscriptionEventAt: timestamp("subscription_event_at"),
  suspendedReason: text("suspended_reason"),
  /**
   * When this address was confirmed by someone who can read mail sent to it.
   * Null means the account works, but nothing that reaches other people does
   * (server/email-verification.ts). Google accounts arrive confirmed — Google
   * has already checked — and accounts that predate this were backfilled.
   */
  emailVerifiedAt: timestamp("email_verified_at"),
  /*
   * Where this account came from, captured on the visitor's first page and
   * written here once, when the account is created. First touch: the link that
   * brought someone here is the one that did the work, even if they signed up
   * three visits later. Never updated afterwards — see server/attribution.ts.
   */
  signupSource: varchar("signup_source"),
  signupMedium: varchar("signup_medium"),
  signupCampaign: varchar("signup_campaign"),
  /** The external page that linked here. Null for direct arrivals. */
  signupReferrer: text("signup_referrer"),
  /** The first page they landed on, query string included. */
  signupLandingPath: text("signup_landing_path"),
  /** Every tracked parameter that was on that link. Allowlisted, never the raw query. */
  signupParams: jsonb("signup_params"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/**
 * Links sent to confirm an address, stored by hash.
 *
 * By hash for the same reason as every other credential here: the database is
 * not a place where a working sign-in link should sit in plaintext. One row
 * per send, so a resend doesn't invalidate a link already in flight, and each
 * is good once — `usedAt` is set when it's spent.
 *
 * The address is kept alongside: a link is for the address it was sent to, so
 * changing the account's email leaves old links useless.
 */
export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** SHA-256 of the token in the link. */
  tokenHash: varchar("token_hash").notNull().unique(),
  /** The address it was sent to, lowercased. */
  email: varchar("email").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  byUser: index("email_verification_user_idx").on(table.userId),
}));

/**
 * Links that let someone set a new password without knowing the old one.
 *
 * Stored by hash, like the verification links above and for the same reason,
 * except more so: this token IS the account. Anyone holding it can take over,
 * so the database must not hold a working one, the window is short, and it is
 * spent the first time it's used.
 *
 * The address is kept alongside the user id because the link belongs to the
 * address it was sent to. If the account's email changes after a link goes
 * out, that link is for an address its owner no longer controls, and must
 * stop working.
 *
 * `requestedIp` is not for rate limiting — the limiter has its own table — but
 * for the question asked after the fact: who asked for this, and did the
 * person whose account it is recognise them.
 */
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** SHA-256 of the token in the link. */
  tokenHash: varchar("token_hash").notNull().unique(),
  /** The address it was sent to, lowercased. */
  email: varchar("email").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  requestedIp: varchar("requested_ip"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  byUser: index("password_reset_user_idx").on(table.userId),
}));

/**
 * One-time links from the app into the website, signed in.
 *
 * The phone signs in with a Bearer token; its in-app browser has no cookie,
 * so opening a web page the app doesn't have yet (a company, a challenge, a
 * season invite) landed on the signed-out home page and lost where it was
 * going. The app asks for one of these, and the browser trades it for a
 * session on the page it was sent to. Single use, a minute long, stored only
 * as a hash — the link is a password for as long as it lives.
 */
export const webHandoffTokens = pgTable("web_handoff_tokens", {
  /** SHA-256 of the token in the link. */
  tokenHash: varchar("token_hash").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Whether the app's own sign-in passed a second factor; the web session inherits exactly that. */
  mfa: boolean("mfa").notNull().default(false),
  /** Where to land: a path on this site, checked when it was issued. */
  next: text("next").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull(),
}, (table) => ({
  byUser: index("web_handoff_user_idx").on(table.userId),
}));

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
    /** This session passed a second factor at sign-in; its access tokens carry it, and rotation keeps it. */
    mfa: boolean("mfa").default(false).notNull(),
    lastUsedAt: timestamp("last_used_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("IDX_mobile_refresh_user").on(table.userId)]
);

/**
 * Personal access tokens for the editor bridge.
 *
 * Neither existing style fits a CLI. A cookie session belongs to a browser,
 * and the mobile access token lives fifteen minutes and refreshes itself —
 * fine for an app that runs a refresh loop, useless for an MCP process that a
 * user pastes a secret into once and forgets about.
 *
 * So: a long-lived token, shown once at creation and stored only as a
 * SHA-256, revocable from the web app, optionally pinned to one project so a
 * token pasted into a repo's config can't reach the rest of the account.
 */
export const mcpTokens = pgTable(
  "mcp_tokens",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id),
    tokenHash: varchar("token_hash").notNull().unique(),
    /** The user's own name for it, e.g. "MacBook · Claude Code". */
    label: varchar("label").notNull(),
    /** First characters of the token, so a row is recognisable in a list without being usable. */
    prefix: varchar("prefix").notNull(),
    /** When set, the token may only act on this project. */
    projectId: varchar("project_id"),
    expiresAt: timestamp("expires_at"),
    revokedAt: timestamp("revoked_at"),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("IDX_mcp_tokens_user").on(table.userId)]
);

export type McpToken = typeof mcpTokens.$inferSelect;

export type UpsertUser = typeof users.$inferInsert;
export type UserRow = typeof users.$inferSelect;
export type MobileRefreshToken = typeof mobileRefreshTokens.$inferSelect;
export type User = typeof users.$inferSelect;
