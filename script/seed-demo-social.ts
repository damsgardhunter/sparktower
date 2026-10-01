/**
 * Dresses a demo project and the creator's inbox: page views, project
 * followers, and connection requests from the demo builders.
 *
 * Separate from `seed-max-reputation.ts` because none of this is scored. Views
 * are not a term in any pillar, followers past the market target are worth
 * nothing more, and a connection request is worth nothing at all — so this is
 * purely about what the screens look like when somebody is shown them. It is
 * the difference between a demo of an empty product and a demo of a used one.
 *
 * Connection requests land on the creator's account only, for the same reason
 * the max-reputation seeder does: a pending request is a claim that a named
 * person wants to work with you, and inventing those about anybody else is
 * putting words in a stranger's mouth. `assertIsCreator` is shared with that
 * script so there is one definition of who the creator is, not two.
 *
 * Local databases only, and idempotent — it tops up to the targets rather than
 * adding on every run.
 *
 *   DATABASE_URL=… npx tsx script/seed-demo-social.ts
 *   DATABASE_URL=… npx tsx script/seed-demo-social.ts --apply
 *   DATABASE_URL=… npx tsx script/seed-demo-social.ts --apply \
 *     --project SparkTower --views 112847 --followers 30 --connections 9
 */
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { assertIsCreator, creatorId } from "./seed-max-reputation";

const apply = process.argv.includes("--apply");
const allowRemote = process.argv.includes("--allow-remote");

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PROJECT = arg("project", "SparkTower");
const VIEWS = Number(arg("views", "112847"));
const FOLLOWERS = Number(arg("followers", "30"));
const CONNECTIONS = Number(arg("connections", "9"));

/** The same refusal as the reputation seeder: fabricated social proof stays off anything real. */
function assertLocal(url: string): void {
  const host = new URL(url).hostname;
  const local = ["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"];
  if (local.includes(host) || allowRemote) return;
  throw new Error(
    `Refusing to write invented views, followers and connection requests to ${host}.\n`
    + `If ${host} really is a throwaway, pass --allow-remote.`,
  );
}

/*
 * What a builder might actually say when asking to connect. Written out rather
 * than generated: nine identical notes reading "Hi, let's connect" is a worse
 * demo than nine empty ones, because it shows the product being used by a bot.
 */
const HELLOS = [
  "Saw SparkTower on the explore page — I'm building something adjacent and would love to compare notes.",
  "Your milestone cadence is ridiculous. How are you keeping that up alongside everything else?",
  "I'm looking for a technical co-founder and your profile keeps coming up in my matches. Worth a chat?",
  "We're solving the same onboarding problem from opposite ends. I'd like to hear how you framed it.",
  "Fellow solo builder here. Would be good to have someone to compare weeks with.",
  "I used your project as a reference when I was scoping mine — thank you, and hello.",
  "Happy to give feedback on the SparkTower brief if it's useful. I've shipped two of these.",
  "Your simulation results are the best I've seen on the leaderboard. What am I doing wrong?",
  "Would like to follow what you're doing more closely than the feed allows.",
  "I think there's a partnership here. Mind if I send over what I'm working on?",
  "New here and working out who's worth learning from. You seem to be top of that list.",
  "I'd like to join a sprint with you if you're ever short a seat.",
];

const rows = async (q: ReturnType<typeof sql>): Promise<any[]> => {
  const r: any = await db.execute(q);
  return (r.rows ?? r) as any[];
};
const one = async (q: ReturnType<typeof sql>): Promise<any> => (await rows(q))[0] ?? {};
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL.");
  assertLocal(url);

  const me = await creatorId();
  if (!me) throw new Error("No admin account on this database, so there is no creator to dress up.");
  await assertIsCreator(me);

  /*
   * The creator's project of that name, not merely any project of that name —
   * the demo builders own a `SparkTower` too, and pointing 112,000 views at the
   * wrong one is the kind of mistake that is invisible until a demo.
   */
  const project = await one(sql`
    select id, title, views, status from projects
    where owner_id = ${me} and title ilike ${PROJECT}
    order by created_at limit 1`);
  if (!project.id) {
    const owned = (await rows(sql`select title from projects where owner_id = ${me} order by created_at`))
      .map((r) => r.title);
    throw new Error(`You own no project called "${PROJECT}". You own: ${owned.join(", ") || "(none)"}`);
  }

  const followersNow = num((await one(sql`
    select count(*)::int n from project_follows where project_id = ${project.id} and user_id <> ${me}`)).n);
  const pendingNow = num((await one(sql`
    select count(*)::int n from connections where receiver_id = ${me} and status = 'pending'`)).n);

  const addFollowers = Math.max(0, FOLLOWERS - followersNow);
  const addConnections = Math.max(0, CONNECTIONS - pendingNow);

  console.log(`\n${project.title} (${project.status}) — owned by the creator`);
  console.log(`  views              ${project.views} → ${VIEWS}`);
  console.log(`  followers          ${followersNow} → ${Math.max(followersNow, FOLLOWERS)}`
    + (addFollowers === 0 ? `  (already past ${FOLLOWERS}, leaving alone)` : ` (+${addFollowers})`));
  console.log(`  pending requests   ${pendingNow} → ${Math.max(pendingNow, CONNECTIONS)}`
    + (addConnections === 0 ? "  (already there)" : ` (+${addConnections})`));

  if (!apply) {
    console.log("\nDry run — rerun with --apply.\n");
    return 0;
  }

  await db.execute(sql`update projects set views = ${VIEWS} where id = ${project.id}`);

  if (addFollowers > 0) {
    /* Demo builders first, so the follower list reads as people rather than test accounts. */
    const who = (await rows(sql`
      select u.id from users u
      where u.id <> ${me} and u.deleted_at is null
        and not exists (select 1 from project_follows f where f.project_id = ${project.id} and f.user_id = u.id)
      order by u.is_bot desc, u.created_at asc
      limit ${addFollowers}`)).map((r) => String(r.id));
    for (const id of who) {
      await db.execute(sql`
        insert into project_follows (project_id, user_id) values (${project.id}, ${id})
        on conflict (project_id, user_id) do nothing`);
    }
  }

  if (addConnections > 0) {
    /*
     * Only accounts with a profile, and only ones not already paired with the
     * creator: `connections_pair_unique` is on the *unordered* pair, so an
     * existing accepted connection in either direction blocks a new request.
     */
    const askers = (await rows(sql`
      select u.id from users u
      join user_profiles p on p.user_id = u.id
      where u.is_bot = true and u.deleted_at is null
        and not exists (
          select 1 from connections c
          where least(c.requester_id, c.receiver_id) = least(u.id, ${me})
            and greatest(c.requester_id, c.receiver_id) = greatest(u.id, ${me})
        )
      order by u.created_at
      limit ${addConnections}`)).map((r) => String(r.id));

    for (const [i, asker] of askers.entries()) {
      const note = HELLOS[i % HELLOS.length].slice(0, 280);
      const conn = await one(sql`
        insert into connections (requester_id, receiver_id, status, note, created_at)
        values (${asker}, ${me}, 'pending', ${note},
                (now() at time zone 'utc') - (${i + 1} * interval '19 hours'))
        returning id`);
      /*
       * And the notification, because the route that normally creates one of
       * these sends it. Without it the requests sit on the connections page with
       * nothing anywhere telling you to go and look.
       */
      if (conn.id) {
        await db.execute(sql`
          insert into notifications (recipient_id, actor_id, kind, target_id, excerpt, created_at)
          values (${me}, ${asker}, ${"connection_request"}, ${String(conn.id)}, ${note},
                  (now() at time zone 'utc') - (${i + 1} * interval '19 hours'))`);
      }
    }
  }

  const after = await one(sql`
    select
      (select views from projects where id = ${project.id}) as views,
      (select count(*)::int from project_follows where project_id = ${project.id} and user_id <> ${me}) as followers,
      (select count(*)::int from connections where receiver_id = ${me} and status = 'pending') as pending`);
  console.log(`\ndone — ${Number(after.views).toLocaleString()} views, `
    + `${after.followers} followers, ${after.pending} pending connection requests.\n`);
  return 0;
}

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(String(err instanceof Error ? err.message : err));
      process.exit(1);
    },
  );
}
