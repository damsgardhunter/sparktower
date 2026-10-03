/**
 * The phone's copy of `client/src/lib/connection-search.ts`.
 *
 * Metro cannot resolve the web app's `@shared` alias, so this is a hand copy
 * rather than a shared import, and `test/unit/mobile-mirror.test.ts` runs both on
 * the same rows to stop it quietly stopping being true. Free of React Native
 * imports, which is what makes that comparison possible — keep it that way.
 *
 * It was inline in `app/(tabs)/messages.tsx` and had drifted in two ways that
 * nothing would have caught: it matched the name and the headline but not the
 * **username**, so searching for a handle — often the only thing you remember
 * about somebody you met here — returned nothing; and it left the list in the
 * order the server sent, which is by when the connection was made. A list you
 * search is a list you scan, and recency is not an order you can scan for a name
 * you already have in mind.
 *
 * ## The one place the two sides deliberately differ
 *
 * The name. `personName` falls back to "Builder" and never shows an email on a
 * phone screen; the web falls back to the address before "User". That is a
 * deliberate rule on this side, and the email is redacted from anybody else's
 * account before it leaves the server anyway (`stripOthersAccountFields`), so in
 * practice both sides are searching the display name, the username and the
 * headline. The mirror test asserts agreement on which rows match and in what
 * order, and says why the nameless fallback is excluded.
 */

/** Only the fields the search reads — the real rows carry much more. */
export interface SearchablePerson {
  firstName?: string | null;
  lastName?: string | null;
}

export interface SearchableProfile {
  displayName?: string | null;
  username?: string | null;
  headline?: string | null;
}

export interface SearchableConnection {
  user: SearchablePerson;
  profile?: SearchableProfile | null;
}

/**
 * What to call a connection on a phone screen.
 *
 * The same order `personName` uses, and the same refusal to print an email:
 * kept here rather than imported from `networkData` so this module stays free of
 * anything that reaches for React Native.
 */
export function connectionName(c: SearchableConnection, fallback = "Builder"): string {
  const full = [c.user?.firstName, c.user?.lastName].filter(Boolean).join(" ").trim();
  return c.profile?.displayName?.trim() || full || fallback;
}

/**
 * The connections matching what was typed, by name.
 *
 * Name, username and headline — because half of knowing who somebody is here is
 * their handle or what they say they do, and searching "design" to find the
 * designer you met should find them.
 */
export function searchConnections<T extends SearchableConnection>(connections: T[], query: string): T[] {
  const rows = [...connections].sort((a, b) => connectionName(a).localeCompare(connectionName(b)));
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((c) => [
    connectionName(c), c.profile?.username, c.profile?.headline,
  ].some((field) => field?.toLowerCase().includes(q)));
}
