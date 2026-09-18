#!/usr/bin/env node
/**
 * Bring stored email addresses down to lowercase, and find the accounts that
 * were split in two before they were.
 *
 * Nothing used to normalise an address, and Postgres compares text exactly — so
 * `Hunter@gmail.com` and `hunter@gmail.com` were two rows, the unique
 * constraint permitted both, and signing in with the wrong capitalisation was
 * told "invalid email or password". The way people met it: sign up with a
 * password, then use Sign in with Google, whose address came back in a
 * different case. The lookup missed and Google made a second account for the
 * same person, then walked them into onboarding as though they were new.
 *
 * The code no longer does that (server/replit_integrations/auth/storage.ts).
 * This is for rows written before it stopped.
 *
 * Two accounts for one person cannot be merged by a script without deciding
 * whose projects, posts and subscription win, so this never merges: it lowercases
 * what it safely can and prints the collisions for a human.
 *
 *   DATABASE_URL=… node scripts/normalize-emails.mjs            # look
 *   DATABASE_URL=… node scripts/normalize-emails.mjs --apply    # lowercase the safe ones
 */
import pg from "pg";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Usage: DATABASE_URL=… node scripts/normalize-emails.mjs [--apply]");
  process.exit(2);
}

const local = /localhost|127\.0\.0\.1/.test(url);
const pool = new pg.Pool({ connectionString: url, ...(local ? {} : { ssl: { rejectUnauthorized: false } }) });

const { rows: collisions } = await pool.query(`
  select lower(email) as address, count(*)::int as n, array_agg(email order by created_at) as forms,
         array_agg(id order by created_at) as ids, array_agg(created_at order by created_at) as created
  from users where email is not null
  group by lower(email) having count(*) > 1
`);

const { rows: mixed } = await pool.query(`
  select id, email from users
  where email is not null and email <> lower(email)
    and lower(email) not in (select lower(email) from users where email is not null group by lower(email) having count(*) > 1)
  order by created_at
`);

console.log(`${mixed.length} address${mixed.length === 1 ? "" : "es"} stored with capitals and safe to lowercase.`);
for (const r of mixed.slice(0, 20)) console.log(`  ${r.email}  →  ${r.email.toLowerCase()}`);
if (mixed.length > 20) console.log(`  … ${mixed.length - 20} more`);

if (collisions.length) {
  console.log(`\n${collisions.length} address${collisions.length === 1 ? " is" : "es are"} held by more than one account. These are NOT touched:`);
  for (const c of collisions) {
    console.log(`\n  ${c.address}`);
    c.ids.forEach((id, i) => console.log(`    ${c.forms[i].padEnd(34)} id=${id}  created ${new Date(c.created[i]).toISOString().slice(0, 10)}`));
  }
  console.log(
    `\nOne person, two accounts — almost always a password sign-up and a Google sign-in that\n` +
    `missed each other. Decide which one keeps the projects and posts, move anything worth\n` +
    `keeping, then delete the other through the app so its content is handled properly\n` +
    `(server/account-data.ts). A script cannot choose for you.`,
  );
}

if (!apply) {
  console.log(`\nLooked, changed nothing. Add --apply to lowercase the ${mixed.length} safe one${mixed.length === 1 ? "" : "s"}.`);
} else if (!mixed.length) {
  console.log("\nNothing to change.");
} else {
  const { rowCount } = await pool.query(`
    update users set email = lower(email), updated_at = now()
    where email is not null and email <> lower(email)
      and lower(email) not in (select lower(email) from users where email is not null group by lower(email) having count(*) > 1)
  `);
  console.log(`\nLowercased ${rowCount} address${rowCount === 1 ? "" : "es"}.`);
}

await pool.end();
process.exit(collisions.length ? 1 : 0);
