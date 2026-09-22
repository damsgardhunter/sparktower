/**
 * Putting a table or column name into SQL, safely.
 *
 * Values go in as parameters — `$1` — and every value in these scripts already
 * does. Identifiers cannot: Postgres has no parameter for "which table", so a
 * maintenance script that walks a list of tables has to build that part of the
 * string itself. That is the one place injection can still get in, and the
 * usual defence — "the list is a constant in this file, nobody can reach it" —
 * is a statement about today's code rather than about the query. The next
 * person to add `--tables` to the command line makes it untrue without ever
 * looking at the string being built.
 *
 * So identifiers are checked against what a name in this schema can actually
 * be, and quoted. A name with a quote, a semicolon, a space, a comment marker
 * or anything else outside `[a-z_][a-z0-9_]*` is refused outright rather than
 * escaped: nothing in this database is called that, so a name that looks like
 * that is a mistake at best.
 */

/** What a table or column is called here: lower snake case, as the schema writes them. */
export const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** Postgres allows 63 bytes; longer is silently truncated, which is its own bug. */
export const MAX_IDENTIFIER_LENGTH = 63;

export class UnsafeIdentifierError extends Error {
  constructor(raw) {
    super(`Refusing to build SQL with ${JSON.stringify(String(raw))} as a name.`);
    this.name = "UnsafeIdentifierError";
  }
}

/**
 * A table or column name, checked and quoted for interpolation.
 *
 * Returns the name wrapped in double quotes, so even a valid name that happens
 * to be a reserved word ("user", "order") is unambiguous. Throws on anything
 * else — the caller is a script that should stop, not carry on against a
 * table it cannot name.
 */
export function quoteIdentifier(raw) {
  if (typeof raw !== "string") throw new UnsafeIdentifierError(raw);
  const name = raw.trim();
  if (!name || name.length > MAX_IDENTIFIER_LENGTH || !IDENTIFIER.test(name)) throw new UnsafeIdentifierError(raw);
  return `"${name}"`;
}

/**
 * The same check, against a known set as well.
 *
 * Belt and braces for a script that already has its list: even a well-formed
 * name is refused if it is not one this script was written to touch, so
 * widening what it can reach has to be a deliberate edit to the list rather
 * than a flag somebody passes.
 */
export function quoteKnownIdentifier(raw, allowed) {
  const name = typeof raw === "string" ? raw.trim() : raw;
  if (!allowed.includes(name)) throw new UnsafeIdentifierError(raw);
  return quoteIdentifier(name);
}
