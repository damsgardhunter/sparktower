import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/*
 * Every connection speaks UTC.
 *
 * Timestamps here are zoneless columns holding UTC, which is how Drizzle
 * writes a JS Date. But a column's DEFAULT now(), and any now() in hand-written
 * SQL, is rendered in the database session's zone — so on a database whose
 * zone is US Central, a row stamped by the default was five hours behind every
 * row stamped by the app. It surfaced one symptom at a time: notifications
 * "5h ago" the moment they arrived, "seen" markers that left new feedback
 * looking new for hours, expired invites swept five hours late, lobby joins
 * that looked stale. Fixing each call site left the next one waiting.
 *
 * Setting the session zone makes now() and every default agree with the app,
 * wherever the database happens to run. The explicit (now() at time zone
 * 'utc') forms elsewhere stay correct under it. Queued on the client before
 * anything else it runs, since pg runs a client's queries in order.
 */
pool.on("connect", (client) => {
  client.query("SET TIME ZONE 'UTC'").catch((err) => console.error("[db] couldn't set the session to UTC:", err));
});
export const db = drizzle(pool, { schema });
