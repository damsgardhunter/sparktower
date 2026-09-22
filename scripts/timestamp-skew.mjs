#!/usr/bin/env node
/**
 * Finding — and, with --apply, repairing — times written before the database
 * connection was pinned to UTC.
 *
 * Most time columns in this schema are `timestamp` with no zone. A column
 * defaulting to now() stored the *database session's* wall clock, while the
 * driver reads a zoneless value back as UTC, so on a server whose session zone
 * was not UTC everything the database timestamped for itself was stored ahead
 * of or behind the truth by that zone's offset. A post made a minute ago read
 * "5 hours ago". `server/db.ts` now pins every connection to UTC, which fixes
 * everything written from then on; this is for what was written before.
 *
 * Run it with no flags first: it reports what it would change and nothing else.
 *
 *   node scripts/timestamp-skew.mjs                      # report
 *   node scripts/timestamp-skew.mjs --zone America/Chicago --before '2026-09-22 12:30' --apply
 *
 * What it touches is a short, deliberate list: the columns a person reads as
 * "when did this happen". Tables whose rows the application timestamps itself
 * — bids, matchmaking, tokens, the startup game — are left alone, because
 * those values were always correct and shifting them would break what works.
 *
 * `--before` is the moment the UTC fix reached the server, and rows at or
 * after it are never touched. Without it nothing is applied: repairing rows
 * that were already right is the one mistake this cannot undo.
 *
 * Which is also why a repair writes itself down. Running this twice would move
 * everything twice — the second pass cannot tell a repaired row from a skewed
 * one — so a successful apply leaves a `db.timestamp_repair` row in the
 * moderation log, and a later apply on the same database refuses unless you
 * pass --again and mean it.
 */
import pg from "pg";
import { eachTarget } from "./lib/sql-identifier.mjs";

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
};
const apply = process.argv.includes("--apply");
const zone = arg("zone", "America/Chicago");
const before = arg("before");
const url = arg("url", process.env.DATABASE_URL);

/** table → the columns on it that the database wrote by itself. */
const TARGETS = {
  feed_posts: ["created_at"],
  feed_comments: ["created_at"],
  feed_reactions: ["created_at"],
  notifications: ["created_at"],
  projects: ["created_at"],
  users: ["created_at"],
};

if (!url) {
  console.error("No database: pass --url or set DATABASE_URL.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, options: "-c timezone=UTC" });
await client.connect();

/*
 * What an ordinary connection gets, asked on an ordinary connection.
 *
 * This script pins its own to UTC, like the application now does, so asking
 * this one would always answer "UTC" and every database would look innocent.
 * `reset_val` is no better: a session started with `-c timezone=UTC` resets to
 * UTC too. So a second connection is opened with nothing set on it, which is
 * exactly what the application used before the fix — and therefore the zone
 * its old rows were written in.
 */
const plain = new pg.Client({ connectionString: url });
await plain.connect();
const [{ tz: server_default }] = (await plain.query("select current_setting('TimeZone') tz")).rows;
await plain.end();
const [{ tz }] = (await client.query("select current_setting('TimeZone') tz")).rows;
console.log(`connected: this session ${tz}, an unpinned connection ${server_default}`);
if (server_default === "UTC") {
  console.log("This database always wrote UTC, so nothing here was ever skewed. Expect a report of 0 and do not apply.\n");
} else {
  console.log(`Rows written before the fix hold ${server_default} wall clock — pass --zone ${server_default}.\n`);
}
console.log(`treating stored times as ${zone} wall clock\n`);

const MARKER = "db.timestamp_repair";
const done = await client.query("select details, created_at from moderation_log where action=$1 order by created_at desc", [MARKER]);
if (done.rowCount > 0) {
  const last = done.rows[0];
  console.log(`This database was already repaired: ${JSON.stringify(last.details)}`);
  if (apply && !process.argv.includes("--again")) {
    console.log("Refusing to apply again — a second pass would move every row a second time. Use --again if that is really what you want.");
    await client.end();
    process.exit(1);
  }
}

/*
 * The four statements, written where the identifiers they use were checked.
 *
 * Built in functions rather than at the call, and never out of a value: the
 * only text that varies is two identifiers this script declared and
 * scripts/lib/sql-identifier.mjs approved, and `cutoff`, which is a fixed
 * string holding a placeholder. Every value — the cutoff time, the zone —
 * goes to the driver as a parameter. Written this way so that a reader, and
 * the deterministic security scan, can see at a glance that nothing typed by
 * a person becomes SQL.
 */
const countSql = (table, column, cutoff) =>
  "select count(*)::int n, min(" + column + ") oldest, max(" + column + ") newest"
  + " from " + table + " where " + column + " is not null" + cutoff;

const sampleSql = (table, column, cutoff, zoneParam) =>
  "select to_char(" + column + ", 'YYYY-MM-DD HH24:MI:SS') stored,"
  + " to_char((" + column + " at time zone " + zoneParam + ") at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') fixed"
  + " from " + table + " where " + column + " is not null" + cutoff
  + " order by " + column + " desc limit 1";

const repairSql = (table, column, cutoff, zoneParam) =>
  "update " + table + " set " + column + " = (" + column + " at time zone " + zoneParam + ") at time zone 'UTC'"
  + " where " + column + " is not null" + cutoff;

const COLUMN_EXISTS =
  "select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2";

let total = 0;
/*
 * Names are checked here, once, before a statement is built out of any of
 * them. Today they come from the constant above and are obviously safe; the
 * check exists for the edit that adds a `--table` flag one afternoon and turns
 * that constant into somebody's input. It refuses anything not on the list
 * rather than trusting the shape of it.
 */
for (const { name, table, column } of eachTarget(TARGETS)) {
  const exists = await client.query(COLUMN_EXISTS, [name.table, name.column]);
  if (exists.rowCount === 0) { console.log(`${name.table}.${name.column}: not in this database`); continue; }

  const cutoff = before ? " and " + column + " < $1" : "";
  const params = before ? [before] : [];
  const zoneParam = "$" + (params.length + 1);

  const { rows: [count] } = await client.query(countSql(table, column, cutoff), params);
  if (count.n === 0) { console.log(`${name.table}.${name.column}: nothing to do`); continue; }

  /*
   * Both sides as text, deliberately. Reading a zoneless column back through
   * the driver is what caused the bug this script exists for, and a report
   * that quietly applies the offset a second time would tell you the repair
   * had moved things twice as far as it did. Postgres formats them instead.
   */
  const { rows: [sample] } = await client.query(sampleSql(table, column, cutoff, zoneParam), [...params, zone]);
  console.log(`${name.table}.${name.column}: ${count.n} rows, newest ${sample.stored} → ${sample.fixed} (UTC)`);
  total += count.n;

  if (apply && before) await client.query(repairSql(table, column, cutoff, zoneParam), [...params, zone]);
}

if (apply && before && total > 0) {
  await client.query(
    `insert into moderation_log (action, target_type, details) values ($1, 'database', $2)`,
    [MARKER, JSON.stringify({ zone, before, rows: total, at: new Date().toISOString() })],
  );
}

console.log(`\n${total} row(s) ${apply && before ? "moved" : "would move"}.`);
if (apply && !before) console.log("Nothing was changed: --apply needs --before, so rows written after the fix are left alone.");
if (!apply) console.log("Nothing was changed. Add --apply with --before to do it.");
await client.end();
