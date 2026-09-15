/**
 * The server's signing and encryption keys, and the only place they're read.
 *
 * No fallbacks, in any environment. A missing SESSION_SECRET used to mean a
 * hard-coded development string (and, for 2FA challenges, an empty HMAC key):
 * harmless on a laptop, and forgeable sessions for every account on any deploy
 * where NODE_ENV wasn't exactly "production". Now the server refuses to start.
 *
 * In production a value is also refused when it's short, or one that's been
 * published anywhere (the old fallback is in this repository's history).
 */
import crypto from "node:crypto";

export type SecretName = "SESSION_SECRET" | "MOBILE_TOKEN_SECRET";

const GENERATE = `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`;
export const MIN_PRODUCTION_SECRET_LENGTH = 32;
/** Values known to the whole internet: refused in production however they got there. */
const PUBLISHED_VALUES = new Set(["dev-session-secret", "changeme", "change-me", "secret", "password", "your-secret-here"]);

const isProduction = () => process.env.NODE_ENV === "production";

function checked(name: SecretName, value: string): string {
  if (isProduction()) {
    if (PUBLISHED_VALUES.has(value.toLowerCase())) throw new Error(`${name} is set to a publicly known value; refusing to start in production. Generate a real one: ${GENERATE}`);
    if (value.length < MIN_PRODUCTION_SECRET_LENGTH) throw new Error(`${name} is shorter than ${MIN_PRODUCTION_SECRET_LENGTH} characters; refusing to start in production. Generate a real one: ${GENERATE}`);
  }
  return value;
}

/** A secret that must be set. Throws — in every environment — when it isn't. */
export function requireSecret(name: SecretName): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set; the server has no default for it. Generate one: ${GENERATE}`);
  return checked(name, value);
}

/** A secret that may be absent (the caller has a real alternative, not a default); held to the same rules when set. */
export function optionalSecret(name: SecretName): string | null {
  const value = process.env[name]?.trim();
  return value ? checked(name, value) : null;
}

/** Signs session cookies; the root every other key here is derived from. */
export const sessionSecret = () => requireSecret("SESSION_SECRET");

/**
 * A purpose-bound key: HMAC-SHA256 of a label under a root secret, so one
 * secret can back several keys without any two being the same.
 */
export const deriveKey = (root: string, label: string) => crypto.createHmac("sha256", root).update(label).digest();

/** Labels the key derived for mobile access tokens when there's no MOBILE_TOKEN_SECRET. Changing it signs everyone's access tokens out (refresh tokens are unaffected). */
export const ACCESS_TOKEN_KEY_LABEL = "sparktower/mobile-access-token/v1";

/**
 * The key mobile access tokens are signed with: MOBILE_TOKEN_SECRET, or a key
 * derived from SESSION_SECRET (never SESSION_SECRET itself). Throws when
 * neither is set. See server/mobile-auth.ts.
 */
export function mobileTokenKey(): string {
  return optionalSecret("MOBILE_TOKEN_SECRET") ?? deriveKey(sessionSecret(), ACCESS_TOKEN_KEY_LABEL).toString("base64url");
}

/**
 * Called first at boot (server/index.ts): a deploy missing its secrets, or
 * using weak ones in production, stops there with the reason — not on the
 * first sign-in.
 */
export function assertSecretsAtBoot(): void {
  sessionSecret();
  optionalSecret("MOBILE_TOKEN_SECRET");
}
