#!/usr/bin/env tsx
/**
 * Fill a database with people, projects and a feed — or empty it again.
 *
 *   npx tsx script/seed-demo.ts           # write the community
 *   npx tsx script/seed-demo.ts --clear   # remove every trace of it
 *   npx tsx script/seed-demo.ts --reseed  # clear, then write it fresh
 *
 * Everything it writes belongs to a user whose address ends in the demo
 * domain, which is how `--clear` finds it all again. It refuses to run against
 * anything that looks like production — see `assertSafeTarget` — because seed
 * data in a real feed is not a thing you can quietly take back.
 *
 * No money is ever written: no campaigns, no pledges, no balances. Checked at
 * the end of the run rather than promised in a comment.
 */
import { loadEnvFile } from "../test/setup/env";
import { seedDemo, clearDemo, DEMO_DOMAIN } from "./demo/seed";

loadEnvFile();

const args = new Set(process.argv.slice(2));
const where = (process.env.DATABASE_URL ?? "").replace(/:[^:@/]+@/, ":***@");

async function main() {
  console.log(`Demo data → ${where}`);
  if (args.has("--clear") || args.has("--reseed")) {
    const gone = await clearDemo();
    console.log(`  cleared ${gone} demo ${gone === 1 ? "person" : "people"} and everything they owned`);
    if (!args.has("--reseed")) return;
  }
  const made = await seedDemo();
  console.log(`  ${made.people} people, ${made.projects} projects, ${made.posts} posts`);
  console.log(`  all of them ${DEMO_DOMAIN} — run with --clear to remove`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("Demo seed failed:", err?.message ?? err);
  process.exit(1);
});
