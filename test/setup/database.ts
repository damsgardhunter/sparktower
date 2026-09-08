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
import { execFileSync } from "child_process";
import pg from "pg";

/**
 * Where the tests point.
 *
 * Derived from DATABASE_URL by suffixing the database name, so a developer who
 * has the app running locally needs no extra configuration — and, more
 * importantly, cannot accidentally point the suite at their real database,
 * because the suite truncates every table it can see.
 */
export function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) return explicit;

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      "Set TEST_DATABASE_URL, or DATABASE_URL to derive it from. " +
      "The test suite truncates every table in whichever database it is given.",
    );
  }

  const url = new URL(base);
  const name = url.pathname.replace(/^\//, "") || "postgres";
  if (name.endsWith("_test")) return base;
  url.pathname = `/${name}_test`;
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
 * Creates the test database if it isn't there.
 *
 * `CREATE DATABASE` can't run inside a transaction and has no `IF NOT EXISTS`
 * before PG 15 in every distribution, so the duplicate error is caught rather
 * than pre-checked — which also makes it safe against two workers racing.
 */
export async function ensureTestDatabase(): Promise<string> {
  const target = testDatabaseUrl();
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
 * Applies the current schema.
 *
 * `drizzle-kit push` rather than a migration folder, because this project has
 * no migrations — push against the schema file is how the real database is
 * built, so it is also how the test one should be. Against a database this
 * empty there is nothing destructive to confirm, so it runs without prompting.
 */
export function applySchema(databaseUrl: string): void {
  execFileSync("npx", ["drizzle-kit", "push"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
    encoding: "utf8",
  });
}

/**
 * Empties every table, leaving the schema alone.
 *
 * One statement for all of them: `TRUNCATE a, b, c CASCADE` sidesteps foreign
 * keys without needing to know the dependency order, which would otherwise be
 * a list to maintain by hand every time a table is added.
 */
export async function truncateAll(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ name: string }>(`
      SELECT quote_ident(tablename) AS name
      FROM pg_tables
      WHERE schemaname = 'public'
    `);
    if (rows.length === 0) return;
    await client.query(
      `TRUNCATE ${rows.map((r) => r.name).join(", ")} RESTART IDENTITY CASCADE`,
    );
  } finally {
    await client.end();
  }
}
