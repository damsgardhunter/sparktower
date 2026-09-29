/**
 * The test database.
 *
 * Strategy: a **dedicated database with the real schema applied**, truncated
 * between tests. Not transactional rollback, and not a mock.
 *
 * Transactional tests — open a transaction, run the request inside it, roll
 * back — are faster and were the first thing considered. They don't fit this
 * codebase: `server/db.ts` exports a module-level Drizzle singleton that some
 * forty modules import directly, so making a request run inside a test's
 * transaction would mean threading a connection through every one of them, or
 * monkey-patching the singleton and hoping nothing grabbed a reference first.
 * That is a large, invasive change to production code in order to make tests
 * marginally quicker, and the failure mode — a test that quietly commits — is
 * the kind you find out about much later.
 *
 * Truncation is cruder and completely obvious. At this size it costs
 * milliseconds.
 *
 * A real Postgres, rather than an in-memory fake, is not negotiable here. The
 * bugs this suite exists to catch are things like a rate-limit window comparing
 * a `timestamp without time zone` against a JS Date and silently matching
 * nothing — which is exactly the class of bug that only a real database, with
 * real column types and real defaults, can reproduce.
 */
import { applyModerationLogRules } from "../../server/moderation-log-rules";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "path";
import pg from "pg";

/** Relative to the repository root, which is where both test runners start. */
const MIGRATIONS_FOLDER = path.resolve("migrations");

/**
 * Where the tests point.
 *
 * Derived from DATABASE_URL by suffixing the database name, so a developer who
 * has the app running locally needs no extra configuration — and, more
 * importantly, cannot accidentally point the suite at their real database,
 * because the suite truncates every table it can see.
 */
export function testDatabaseUrl(suffix = "_test"): string {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit && suffix === "_test") return explicit;

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      "Set TEST_DATABASE_URL, or DATABASE_URL to derive it from. " +
      "The test suite truncates every table in whichever database it is given.",
    );
  }

  const url = new URL(base);
  const name = url.pathname.replace(/^\//, "") || "postgres";
  if (name.endsWith(suffix)) return base;
  url.pathname = `/${name}${suffix}`;
  return url.toString();
}

/** The same server, but the maintenance database, for CREATE DATABASE. */
function adminUrl(target: string): string {
  const url = new URL(target);
  url.pathname = "/postgres";
  return url.toString();
}

function databaseName(target: string): string {
  return new URL(target).pathname.replace(/^\//, "");
}

/**
 * The last line of defence before anything destructive.
 *
 * `testDatabaseUrl` makes the test database the default, but it trusts
 * TEST_DATABASE_URL verbatim — so a mistyped or copy-pasted value would point
 * the suite at a real database, and nothing downstream would notice. This
 * checks the name itself, not how it was arrived at.
 */
const TEST_DATABASE_SUFFIXES = ["_test", "_e2e"];

function assertTestDatabaseName(name: string): void {
  /*
   * Nothing here should ever run against a live system, whatever the database
   * is called. A production process has no reason to drop or truncate a schema,
   * so the environment is a refusal on its own — checked before the name, so a
   * database that happens to end in "_test" on a production host is still safe.
   */
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DESTRUCTIVE_TEST_DB !== "yes-really") {
    throw new Error(
      `Refusing to touch database "${name}": this is a production process. ` +
      "Test database helpers are for test runs; nothing in production should be dropping or truncating a schema.",
    );
  }
  if (!TEST_DATABASE_SUFFIXES.some((s) => name.endsWith(s))) {
    throw new Error(
      `Refusing to touch database "${name}": test databases must end in ` +
      `${TEST_DATABASE_SUFFIXES.join(" or ")}. Check TEST_DATABASE_URL.`,
    );
  }
}

/** The name check alone, for the test that holds these guards to their word. */
export const assertTestDatabaseNameForTests = assertTestDatabaseName;

/**
 * The same check, asked of the server rather than parsed from the URL: a
 * pooler or service alias can make the two disagree, and the server's answer
 * is the one that counts.
 */
async function assertConnectedToTestDatabase(client: pg.Client): Promise<void> {
  const { rows: [current] } = await client.query<{ name: string }>(
    "SELECT current_database() AS name",
  );
  assertTestDatabaseName(current.name);
}

/**
 * Creates the test database if it isn't there.
 *
 * `CREATE DATABASE` can't run inside a transaction and has no `IF NOT EXISTS`
 * before PG 15 in every distribution, so the duplicate error is caught rather
 * than pre-checked — which also makes it safe against two workers racing.
 */
export async function ensureTestDatabase(suffix = "_test"): Promise<string> {
  const target = testDatabaseUrl(suffix);
  const name = databaseName(target);

  const admin = new pg.Client({ connectionString: adminUrl(target) });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    console.log(`[test-db] created ${name}`);
  } catch (err: any) {
    // 42P04 is duplicate_database: someone else got there first, which is fine.
    if (err?.code !== "42P04") throw err;
  } finally {
    await admin.end();
  }
  return target;
}

/**
 * Empties `public` of everything a migration could create.
 *
 * Not `DROP SCHEMA public`: on PG14 and earlier the schema belongs to the
 * superuser, so the app's own role can't drop it. And not `DROP OWNED BY`,
 * which CI can't use — it runs as the superuser, whose objects the system
 * depends on. So the objects are named one by one, as `truncateAll` does.
 * Tables go in a single CASCADE statement, which removes their serial
 * sequences, indexes, and any views on them without needing an order.
 */
async function dropEverythingInPublic(client: pg.Client): Promise<void> {
  const list = async (sql: string) =>
    (await client.query<{ name: string }>(sql)).rows.map((r) => r.name).join(", ");

  const tables = await list(
    `SELECT 'public.' || quote_ident(tablename) AS name FROM pg_tables WHERE schemaname = 'public'`,
  );
  if (tables) await client.query(`DROP TABLE ${tables} CASCADE`);

  const sequences = await list(`
    SELECT 'public.' || quote_ident(sequence_name) AS name
    FROM information_schema.sequences WHERE sequence_schema = 'public'
  `);
  if (sequences) await client.query(`DROP SEQUENCE ${sequences} CASCADE`);

  // Enums and domains; a table's own row type went with the table.
  const types = await list(`
    SELECT 'public.' || quote_ident(t.typname) AS name
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd')
  `);
  if (types) await client.query(`DROP TYPE ${types} CASCADE`);
}

/**
 * Brings the schema up to date by running the migrations production runs.
 *
 * Only the pending ones: rebuilding from empty on every run would pull the
 * tables out from under anyone else's run against the same database — two
 * sessions, or a watch-mode suite beside a one-off. CI starts from an empty
 * database every time, so building from zero is still proven there.
 *
 * A test database that predates the migrations — built by `drizzle-kit push`,
 * so it has tables but no record of any migration — is emptied once first;
 * otherwise the baseline would fail on its first CREATE TABLE.
 */
export async function applySchema(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await assertConnectedToTestDatabase(client);
    const { rows: [bookkeeping] } = await client.query<{ t: string | null }>(
      "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS t",
    );
    if (!bookkeeping.t) await dropEverythingInPublic(client);
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}

/**
 * Rules drizzle-kit can't express — today, that the moderation log is
 * append-only — applied the same way the server applies them at boot.
 */
export async function applyDatabaseRules(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await applyModerationLogRules((q) => client.query(q));
  } finally {
    await client.end();
  }
}

/**
 * Empties every table, leaving the schema alone.
 *
 * One statement for all of them: `TRUNCATE a, b, c CASCADE` sidesteps foreign
 * keys without needing to know the dependency order, which would otherwise be
 * a list to maintain by hand every time a table is added.
 */
/**
 * Tables holding definitions rather than anybody's data, seeded from code when
 * the app boots and never written by a test. Left alone by `truncateAll` — see
 * the note inside it.
 */
const CATALOG_TABLES = ["badges"];

export async function truncateAll(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await assertConnectedToTestDatabase(client);

    /*
     * Everything except the catalogs.
     *
     * `badges` is reference data derived from code (`shared/badges.ts`) and
     * upserted once when the app boots (`ensureBadgeCatalog`). Truncating it
     * does not reset state, it deletes the definitions — and because the seed
     * only runs at boot, nothing puts them back. `awardBadge` then looks up an
     * id that is no longer there, logs "Skipping unknown badge" and returns
     * null, so every badge award in every test quietly did nothing. The e2e
     * database had zero rows in it for exactly this reason: the server seeds
     * the catalog as it starts, and the global setup truncated it immediately
     * afterwards.
     *
     * The rule is the distinction, not the list: user data is what a test
     * makes and must be cleared between tests; a catalog is what the code is,
     * and clearing it just breaks the feature.
     */
    const { rows } = await client.query<{ name: string }>(`
      SELECT quote_ident(tablename) AS name
      FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> ALL($1::text[])
    `, [CATALOG_TABLES]);
    if (rows.length === 0) return;
    const truncate = `TRUNCATE ${rows.map((r) => r.name).join(", ")} RESTART IDENTITY CASCADE`;

    /*
     * Retried, because the thing it is racing is the product working properly.
     *
     * A request answers and then keeps writing: a notification fans out, an
     * audit line is filed, an analytics event lands, a badge is awarded. Those
     * are deliberately not awaited — nobody should wait for their bell to be
     * rung — so a few are still in flight when the next test starts. TRUNCATE
     * wants an exclusive lock on every table at once, the in-flight write
     * holds a row lock on one of them and wants another, and Postgres breaks
     * the tie by killing somebody: "deadlock detected". When it kills the
     * truncate, the test's `beforeEach` throws and every test in the file
     * fails at once, nowhere near the code they were checking. It cost a
     * whole suite run to find that, twice.
     *
     * A short wait and another go is enough: the stragglers finish in
     * milliseconds. Only deadlock and lock-timeout are retried, so a real
     * failure — a bad statement, the wrong database — still stops immediately.
     */
    for (let attempt = 1; ; attempt++) {
      try {
        await client.query(truncate);
        return;
      } catch (err: any) {
        const contended = err?.code === "40P01" || err?.code === "55P03";
        if (!contended || attempt === 4) throw err;
        await new Promise((r) => setTimeout(r, attempt * 100));
      }
    }
  } finally {
    await client.end();
  }
}
