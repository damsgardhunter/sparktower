/**
 * Searching the people you are allowed to message.
 *
 * Pure, and in its own module rather than inside the Messages page, for two
 * reasons: it is the half of the picker that fails silently — a search that has
 * quietly stopped looking at usernames returns nothing for a handle somebody
 * typed from memory, and "no connection matches" reads as "that person never
 * connected with you" — and the phone has to agree with it.
 *
 * `mobile/src/connectionSearch.ts` is the phone's copy, and
 * `test/unit/mobile-mirror.test.ts` runs both on the same rows. Metro cannot
 * resolve `@shared`, which is why there are two implementations rather than one;
 * keep this file free of React so the comparison stays possible.
 */
import type { User } from "@shared/models/auth";
import type { UserProfile } from "@shared/schema";

/** An accepted connection, as `GET /api/connections` returns it. */
export interface ConnectionRow {
  id: string;
  user: User;
  profile?: UserProfile;
}

/**
 * What to call a connection, in the order the rest of the app does.
 *
 * The display name is the one they chose, then the first and last they signed up
 * with. The email is a last resort that normally is not there at all:
 * `stripOthersAccountFields` redacts it from anybody else's account on every
 * payload, so it only survives for a reviewer or an admin. Kept because it costs
 * nothing and reads better than "User" when it does, not relied on.
 */
export function connectionName(c: ConnectionRow): string {
  return c.profile?.displayName
    || `${c.user.firstName || ""} ${c.user.lastName || ""}`.trim()
    || c.user.email
    || "User";
}

/**
 * The connections matching what was typed, in a predictable order.
 *
 * Matched on more than the display name, because half of knowing who somebody is
 * on this product is their handle or what they say they do: searching "design"
 * to find the designer you met should find them. Sorted by name rather than by
 * when the connection was made — a picker you search is one you scan, and
 * recency is not an order you can scan for a name you already have in mind.
 *
 * Not matched on the email, though a first version was. `stripOthersAccountFields`
 * redacts `email` from anybody else's account before it leaves the server, so
 * for everyone but a reviewer or an admin that was a search over a field that is
 * never present — which is worse than not offering it, because it fails by
 * returning nothing and "no match" reads as "not connected to you".
 *
 * Pure, and exported, because this is the half that fails silently: a search
 * that quietly stops matching usernames looks exactly like a person who has not
 * connected with you yet.
 */
export function searchConnections(connections: ConnectionRow[], query: string): ConnectionRow[] {
  const rows = [...connections].sort((a, b) => connectionName(a).localeCompare(connectionName(b)));
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((c) => [
    connectionName(c), c.profile?.username, c.profile?.headline,
  ].some((field) => field?.toLowerCase().includes(q)));
}
