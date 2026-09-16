#!/usr/bin/env node
/**
 * Copy one Postgres database over another — development onto a fresh
 * production one, usually, exactly once, at launch.
 *
 * This is a destructive operation with a pasted connection string in it, which
 * is the worst combination in operations: the command that wipes the wrong
 * database looks identical to the one that wipes the right database. So it is a
 * script with a guard rather than a `DROP SCHEMA` in a chat message:
 *
 *  - It refuses a target that already has accounts in it, unless you pass
 *    --force and mean it. A launch copies onto an empty database; anything else
 *    is either a mistake or a decision worth typing out.
 *  - It prints what it found on both sides and asks you to confirm the target
 *    host by name before it touches anything.
 *  - It restores the schema as well as the data, including drizzle's migration
 *    bookkeeping, so the target ends up believing exactly what the source
 *    believed about which migrations have run.
 *  - Sessions are cleared afterwards: they're signed with the source's
 *    SESSION_SECRET and would be dead weight — and confusing dead weight, since
 *    a stale session row looks like a signed-in user.
 *
 * Usage:
 *   node scripts/copy-database.mjs --to "postgresql://…render.com/sparktower"
 *   node scripts/copy-database.mjs --from "$LOCAL" --to "$REMOTE" [--force] [--dry-run]
 *
 * --from defaults to DATABASE_URL in .env, which is the usual source.
 */
import { execFileSync, execFile } from "node:child_process";
import { readFileSync, existsSync, statSync, unlinkSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name) => argv.includes(`--${name}`);

/** The source, from .env when not given — read, never printed. */
function fromEnvFile() {
  if (!existsSync(".env")) return undefined;
  const line = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="));
  return line?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

const source = flag("from") || process.env.SOURCE_DATABASE_URL || fromEnvFile();
const target = flag("to") || process.env.TARGET_DATABASE_URL;

if (!source || !target) {
  console.error("Need both databases.\n  --from  defaults to DATABASE_URL in .env\n  --to    the target, e.g. Render's External Database URL");
  process.exit(1);
}

/** Host and database name only — never the credentials, which end up in shells and logs. */
const describe = (url) => {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}/${u.pathname.replace(/^\//, "")}`;
  } catch { return "(unparseable connection string)"; }
};

if (describe(source) === describe(target)) {
  console.error(`Source and target are the same database (${describe(source)}). Nothing to do, and nothing worth risking.`);
  process.exit(1);
}

const { Pool } = pg;
async function inspect(url, label) {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 15_000 });
  const ask = async (sql) => { try { return (await pool.query(sql)).rows[0]; } catch { return null; } };
  try {
    /*
     * Reachability first, and separately from everything else. Without this the
     * individual questions below each fail, each returns null, and a database
     * this script cannot even connect to is described as "0 tables, no users
     * table" — indistinguishable from an empty one. That is how a run got as
     * far as taking a dump and announcing it would ERASE a database it had
     * never reached.
     */
    try {
      await pool.query("select 1");
    } catch (err) {
      console.log(`${label.padEnd(8)} ${describe(url)}\n         UNREACHABLE: ${String(err.message).split("\n")[0]}`);
      return { unreachable: true, error: err, tables: 0, users: null, schemas: "" };
    }
    const version = await ask("show server_version");
    const size = await ask("select pg_size_pretty(pg_database_size(current_database())) size");
    /*
     * Every schema, not just `public`. The first version of this counted public
     * only, and cheerfully reported success on a copy where the `stripe` schema
     * (stripe-replit-sync's own tables) had failed to restore — a green light
     * over a partial database, which is worse than a red one.
     */
    const tables = await ask("select count(*)::int n from information_schema.tables where table_schema not in ('pg_catalog','information_schema')");
    const schemas = await ask("select string_agg(distinct table_schema, ',' order by table_schema) s from information_schema.tables where table_schema not in ('pg_catalog','information_schema')");
    const users = await ask("select count(*)::int n from users");
    console.log(
      `${label.padEnd(8)} ${describe(url)}\n` +
      `         Postgres ${version?.server_version ?? "?"}, ${size?.size ?? "?"}, ` +
      `${tables?.n ?? 0} tables in [${schemas?.s ?? "none"}], ${users ? `${users.n} accounts` : "no users table"}`,
    );
    return { tables: tables?.n ?? 0, users: users?.n ?? null, version: version?.server_version, schemas: schemas?.s ?? "" };
  } finally {
    await pool.end().catch(() => {});
  }
}

const [from, to] = [await inspect(source, "FROM"), await inspect(target, "TO")];

/*
 * A hostname with no dots is a private one — Render's internal database
 * hostnames look like `dpg-xxxxxxxx-a` and resolve only from inside their
 * network. It is the single most likely reason a laptop can't reach a managed
 * database, and "getaddrinfo ENOTFOUND" doesn't say so.
 */
const looksInternal = (url) => { try { return !new URL(url).hostname.includes("."); } catch { return false; } };

for (const [side, state, url] of [["source", from, source], ["target", to, target]]) {
  if (!state.unreachable) continue;
  console.error(`\nCan't reach the ${side} database, so nothing has been changed.`);
  if (looksInternal(url)) {
    console.error(
      `\nThat looks like an internal hostname (no dots in it). On Render, the Internal Database URL\n` +
      `works only from services running inside Render — not from your machine. Use the\n` +
      `**External Database URL** from the same page: same database, hostname like\n` +
      `dpg-xxxxxxxx-a.oregon-postgres.render.com.`,
    );
  }
  process.exit(1);
}

if (!from.tables) {
  console.error("\nThe source has no tables. Refusing to copy nothing over something.");
  process.exit(1);
}
if (to.users && to.users > 0 && !has("force")) {
  console.error(
    `\nThe target already holds ${to.users} accounts. This would destroy them.\n` +
    `If that is really what you want, pass --force.`,
  );
  process.exit(1);
}

/*
 * Postgres will restore an older dump into a newer server, but not the reverse.
 * Worth saying out loud here rather than discovering it the first time somebody
 * tries to restore a production backup onto their laptop.
 */
const major = (v) => parseInt(String(v ?? "0"), 10);
if (major(to.version) > major(from.version)) {
  console.log(
    `\nNote: the target is Postgres ${major(to.version)} and the source is ${major(from.version)}.\n` +
    `That direction works. The reverse doesn't — a dump from ${major(to.version)} will not restore onto\n` +
    `your ${major(from.version)} machine, which is what a backup rehearsal does (docs/ops/backups.md).`,
  );
}

if (has("dry-run")) {
  console.log("\n--dry-run: stopping here. Nothing was changed.");
  process.exit(0);
}

const confirm = createInterface({ input: process.stdin, output: process.stdout });
const answer = await confirm.question(
  `\nThis will ERASE everything in ${describe(target)} and replace it with a copy of ${describe(source)}.\n` +
  `Type the target's database name to continue: `,
);
confirm.close();
const targetName = describe(target).split("/").pop();
if (answer.trim() !== targetName) {
  console.error(`That isn't "${targetName}". Stopping, unchanged.`);
  process.exit(1);
}

const dumpFile = join(tmpdir(), `copy-database-${Date.now()}.dump`);
const run = (cmd, args, label) => {
  process.stdout.write(`\n${label}… `);
  try {
    execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024 * 512 });
    console.log("done");
  } catch (err) {
    console.log("failed");
    // stderr carries the reason; the connection string is in argv, so it is never echoed.
    console.error(String(err.stderr ?? err.message).split("\n").slice(0, 12).join("\n"));
    if (cmd === "pg_dump" || cmd === "psql") process.exit(1);
    // pg_restore warns about things that are not errors (comments, extensions it can't own).
    console.error("\npg_restore reported the above. Check the counts below before trusting it.");
  }
};

run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", dumpFile, source], `Dumping ${describe(source)}`);
console.log(`         ${(statSync(dumpFile).size / 1024 / 1024).toFixed(1)} MB`);

/*
 * Clear the target. The migrated-but-empty schema is in the way, and so is
 * drizzle's bookkeeping, which travels inside the dump and must not be merged
 * with whatever the target already recorded.
 *
 * `DROP SCHEMA public CASCADE` is the obvious way and it is wrong here: on a
 * managed database the connecting role usually isn't the *owner* of `public`
 * (Postgres 15 changed who is, and hosts vary), so it fails with "must be owner
 * of schema public" after the dump has already been taken. `DROP OWNED BY
 * CURRENT_USER` drops what this role actually owns — every table, sequence and
 * schema it created — which is exactly the set that needs to go, and needs no
 * ownership of the schema itself.
 */
await (async () => {
  process.stdout.write(`\nClearing ${describe(target)}… `);
  const pool = new Pool({ connectionString: target, connectionTimeoutMillis: 15_000 });
  try {
    for (const sql of ["DROP SCHEMA IF EXISTS drizzle CASCADE", "DROP OWNED BY CURRENT_USER CASCADE"]) {
      try { await pool.query(sql); } catch (err) {
        // Not owning `drizzle` is survivable; failing to drop our own objects is not.
        if (!/must be owner/i.test(String(err.message)) || sql.includes("DROP OWNED")) throw err;
      }
    }
    /*
     * Recreate `public` only if dropping ours took it with it. Asking for it
     * unconditionally — even as CREATE SCHEMA IF NOT EXISTS — needs CREATE on
     * the database, which a role that doesn't own the database doesn't have,
     * and it fails on a schema that is already sitting right there.
     */
    const { rows: schemas } = await pool.query("select 1 from information_schema.schemata where schema_name = 'public'");
    if (!schemas.length) await pool.query("CREATE SCHEMA public");
    const { rows } = await pool.query(
      "select count(*)::int n from information_schema.tables where table_schema not in ('pg_catalog','information_schema')",
    );
    if (rows[0].n > 0) {
      console.log("failed");
      console.error(
        `${rows[0].n} tables are still there, owned by another role. This database isn't empty and\n` +
        `restoring into it would half-merge two schemas. Drop and recreate it, or use a fresh one.`,
      );
      process.exit(1);
    }
    console.log("done");
  } catch (err) {
    console.log("failed");
    console.error(String(err.message).split("\n").slice(0, 6).join("\n"));
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
})();

run("pg_restore", ["--no-owner", "--no-privileges", "--no-comments", "--dbname", target, dumpFile], "Restoring");

// Signed with the source's SESSION_SECRET, so meaningless here — and a stale row reads like a signed-in person.
run("psql", ["--quiet", "--no-psqlrc", "-c", "TRUNCATE sessions;", target], "Clearing copied sessions");

unlinkSync(dumpFile);

console.log("\nAfter:");
const after = await inspect(target, "TO");
const ok = after.tables >= from.tables && after.users === from.users && after.schemas === from.schemas;
console.log(
  ok
    ? `\nCopied. ${after.users} accounts and ${after.tables} tables, matching the source.\n` +
      `Next: run \`DATABASE_URL="<target>" npm run db:migrate\` — it should report nothing to apply,\n` +
      `which proves the migration bookkeeping came across. Then restart the service.`
    : `\nThe target does not match the source.\n` +
      `  tables:  ${from.tables} → ${after.tables}\n` +
      `  accounts: ${from.users} → ${after.users}\n` +
      `  schemas: [${from.schemas}] → [${after.schemas}]\n` +
      `Read the pg_restore output above before going any further. A missing schema usually means the\n` +
      `target's role may not create schemas — on a managed host, use the database's own owner role.`,
);
process.exit(ok ? 0 : 1);
