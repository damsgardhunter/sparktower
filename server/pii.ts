/**
 * The personal data that gets sealed before it's stored, and why the rest isn't.
 *
 * Sealed (AES-256-GCM under a key derived from SESSION_SECRET, server/secret-box.ts):
 *
 *  - `project_backings.shipping_address` — where somebody lives. Written once
 *    at checkout, read by the project's own team and by the fulfilment job.
 *  - `investment_applications.phone` — a personal number, read only by the
 *    project owner reading applications.
 *
 * Not sealed, deliberately:
 *
 *  - `users.email`, `first_name`, `last_name` — every sign-in, invite and
 *    mention looks them up, and a sealed column can't be queried or indexed.
 *    A database dump holds them; the controls are access to the database and
 *    the export/deletion routes (server/account-data.ts), not a cipher the
 *    server would have to undo on every request.
 *  - `users.google_id`, `stripe_customer_id`, `stripe_subscription_id` —
 *    identifiers issued by someone else, useless without that provider's keys.
 *  - `sessions.sess` — holds a user id and flags, no credential.
 *  - `users.password_hash`, `mfa_secret`,
 *    `mobile_refresh_tokens.token_hash` — hashed or sealed already, where they
 *    are defined.
 *
 * Reads tolerate both shapes on purpose: rows written before this is deployed
 * are plain, and they must keep working rather than coming back as null.
 */
import { open, seal } from "./secret-box";

/** A value to store: sealed when there's something to seal. */
export const sealPii = <T>(value: T | null | undefined): string | null =>
  value == null || (typeof value === "string" && !value.trim()) ? null : seal(JSON.stringify(value));

/**
 * A stored value, back. Handles three cases: sealed (a v1. string), plain
 * (written before sealing, or a plain string column), and nothing.
 */
export function openPii<T>(stored: unknown): T | null {
  if (stored == null) return null;
  if (typeof stored === "string") {
    if (!stored.startsWith("v1.")) return stored as unknown as T;
    const plain = open(stored);
    if (plain == null) return null;
    try { return JSON.parse(plain) as T; } catch { return plain as unknown as T; }
  }
  // A jsonb object from before sealing: already the value itself.
  return stored as T;
}
