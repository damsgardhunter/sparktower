/**
 * Table and column names that are safe to put in a query, because they are
 * ones this repository wrote down.
 *
 * An identifier cannot be a bound parameter: `select * from $1` is not a
 * thing Postgres will do. So any script that works across several tables has
 * to build that part of the statement as text, and every such script is one
 * careless edit away from building it out of something a person typed. This
 * is the piece that makes that edit fail loudly instead of quietly working.
 *
 * Two locks, not one:
 *
 *   1. **An allowlist.** The name must be one the caller declared in advance.
 *      Shape checks alone ("no quotes, no semicolons") are a guess at what an
 *      attacker can spell; a list of six table names is not a guess. This is
 *      the lock that matters, and it is why every function here demands one.
 *   2. **The driver's own escaping**, applied after. Belt and braces: if a
 *      name on an allowlist ever contains something strange — a column
 *      genuinely called `order`, say — it is still quoted correctly rather
 *      than changing the statement's meaning.
 *
 * Kept in `scripts/lib` and dependency-free beyond `pg` so any maintenance
 * script can use it without dragging the server's module graph into a
 * one-off task.
 */
import pg from "pg";

/**
 * What a name is allowed to look like at all.
 *
 * Postgres truncates identifiers at 63 bytes, so a longer one is already not
 * the thing the caller thinks it is. Lower case only, because every name in
 * this schema is lower case and accepting mixed case would mean quietly
 * matching `Users` against `users` on the allowlist while Postgres treats
 * them as different tables.
 */
const SHAPE = /^[a-z_][a-z0-9_]*$/;
const MAX_BYTES = 63;

export class UnsafeIdentifierError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsafeIdentifierError";
  }
}

/** The allowlist as a Set, whatever shape it arrived in. */
const asSet = (allowed) => (allowed instanceof Set ? allowed : new Set(Array.isArray(allowed) ? allowed : Object.keys(allowed ?? {})));

/**
 * One identifier, checked against a list the caller wrote, and quoted.
 *
 * Throws rather than returning null or a default: a maintenance script that
 * carries on with the wrong table is worse than one that stops, and every
 * caller here is a person at a terminal who can read the reason.
 */
export function escapeIdentifier(name, allowed) {
  const list = asSet(allowed);
  if (list.size === 0) {
    throw new UnsafeIdentifierError("No allowlist given. An identifier is only safe because something said it was expected.");
  }
  if (typeof name !== "string" || name.length === 0) {
    throw new UnsafeIdentifierError(`Not a name: ${JSON.stringify(name)}`);
  }
  if (Buffer.byteLength(name, "utf8") > MAX_BYTES) {
    throw new UnsafeIdentifierError(`"${name.slice(0, 20)}…" is longer than Postgres will keep (${MAX_BYTES} bytes).`);
  }
  if (!SHAPE.test(name)) {
    throw new UnsafeIdentifierError(`"${name}" is not a plain lower-case identifier — refusing to put it in a statement.`);
  }
  if (!list.has(name)) {
    throw new UnsafeIdentifierError(`"${name}" is not one of the names this script works on (${[...list].sort().join(", ")}).`);
  }
  return pg.escapeIdentifier(name);
}

/**
 * A column of a table, where the allowlist says which columns belong to which
 * table: `{ feed_posts: ["created_at"] }`.
 *
 * Checking the pair rather than each half separately is the point. Two
 * separate checks would happily accept `users` and `body`, a combination no
 * line of the allowlist ever claimed existed.
 */
export function escapeColumnOf(table, column, targets) {
  const tables = asSet(targets);
  const safeTable = escapeIdentifier(table, tables);
  const columns = new Set(targets?.[table] ?? []);
  if (columns.size === 0) {
    throw new UnsafeIdentifierError(`No columns are declared for "${table}".`);
  }
  return { table: safeTable, column: escapeIdentifier(column, columns) };
}

/** Every table/column pair in an allowlist, already checked and quoted. */
export function eachTarget(targets) {
  return Object.entries(targets ?? {}).flatMap(([table, columns]) =>
    (columns ?? []).map((column) => ({ name: { table, column }, ...escapeColumnOf(table, column, targets) })));
}
