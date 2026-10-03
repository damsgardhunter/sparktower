/**
 * Takes the seeded team back off a project.
 *
 * `seed-max-reputation` could satisfy "shared a project with N people" the only
 * way that term can be satisfied — by adding N people to the project — and the
 * result was ten strangers in the Team section of the flagship project, each
 * reading "contributor · 0 done · 0 in progress · 0 total tasks". Every other
 * thing that script seeds is a number on a card. This one is a cast of people a
 * visitor meets, and it is the one piece of seeded data that makes the product
 * look worse rather than fuller.
 *
 * The seeder no longer does it unless asked (`--collaborators`). This removes
 * the ones already there.
 *
 * ## What it will not touch
 *
 * Only memberships whose role is the literal `contributor`, which nothing in the
 * application writes — it creates `Owner`, `Member` and `Admin`, or whatever an
 * invite carried — and only where that member has no task assigned and has
 * posted nothing. A real collaborator who happened to be given that role, and
 * who has done anything at all, is left alone and named in the output.
 *
 * It is scoped to one account's own projects, like the seeder it undoes.
 *
 *   DATABASE_URL=… npx tsx script/unseed-collaborators.ts <username-or-email-or-id> [--apply]
 *
 * Reports by default; `--apply` is what writes.
 */
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { db } from "../server/db";
import { projectMembers, projects, userProfiles, users } from "@shared/schema";

/** The role the seeder writes, and the application never does. */
const SEEDED_ROLE = "contributor";

interface Seeded {
  memberId: string;
  userId: string;
  person: string;
  projectId: string;
  projectTitle: string;
  tasks: number;
  posts: number;
  backsThis: number;
}

/** Everyone holding a seeded membership on this account's projects, and what they have done. */
export async function seededCollaborators(ownerId: string): Promise<Seeded[]> {
  const rows = await db.execute(sql`
    select
      pm.id            as member_id,
      pm.user_id       as user_id,
      trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) as person,
      p.id             as project_id,
      p.title          as project_title,
      (select count(*)::int from project_kanban_tasks t
         where t.assignee_id = pm.user_id and t.project_id = p.id)      as tasks,
      (select count(*)::int from feed_posts f
         where f.author_id = pm.user_id and f.project_id = p.id)        as posts,
      (select count(*)::int from project_backings b
         where b.backer_id = pm.user_id and b.project_id = p.id
           and b.status in ('held', 'released'))                        as backs_this
    from project_members pm
    join projects p on p.id = pm.project_id
    join users u on u.id = pm.user_id
    where p.owner_id = ${ownerId} and pm.role = ${SEEDED_ROLE}
    order by p.title, person`);
  return (rows as any).rows.map((r: any) => ({
    memberId: String(r.member_id), userId: String(r.user_id), person: String(r.person || "somebody"),
    projectId: String(r.project_id), projectTitle: String(r.project_title),
    tasks: Number(r.tasks), posts: Number(r.posts), backsThis: Number(r.backs_this),
  }));
}

/* The handle is on `user_profiles`, not `users`, so either can name a builder. */
async function resolveOwner(who: string): Promise<{ id: string; email: string | null }> {
  const [row] = await db.select({ id: users.id, email: users.email })
    .from(users)
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(or(eq(users.id, who), eq(users.email, who), eq(userProfiles.username, who)));
  if (!row) throw new Error(`No account matches ${JSON.stringify(who)}.`);
  return { id: row.id, email: row.email };
}

export async function unseed(who: string, apply: boolean): Promise<number> {
  const owner = await resolveOwner(who);
  const all = await seededCollaborators(owner.id);
  if (!all.length) {
    console.log("No seeded collaborators on that account's projects. Nothing to do.");
    return 0;
  }

  /* Anyone who has actually done something is a real member wearing an odd role. */
  const working = all.filter((c) => c.tasks > 0 || c.posts > 0);
  const idle = all.filter((c) => c.tasks === 0 && c.posts === 0);

  for (const [title, group] of groupBy(idle, (c) => c.projectTitle)) {
    console.log(`\n${title}`);
    for (const c of group) {
      const wall = c.backsThis > 0
        ? "backs this project, so stays on its backer wall"
        : "does not back this project — removing leaves them nowhere on it";
      console.log(`  ${c.person.padEnd(20)} ${wall}`);
    }
  }
  if (working.length) {
    console.log(`\nLeft alone — these have done work, whatever their role says:`);
    for (const c of working) console.log(`  ${c.person} on ${c.projectTitle} (${c.tasks} task(s), ${c.posts} post(s))`);
  }

  const orphaned = idle.filter((c) => c.backsThis === 0).length;
  console.log(`\n${idle.length} membership(s) to remove across ${new Set(idle.map((c) => c.projectId)).size} project(s).`);
  if (orphaned) {
    console.log(`${orphaned} of them back nothing on that project, so they will not appear on its wall either.`);
  }
  console.log("Removing them costs 1.5 points of the builder index — the collaborators term is 6 of the contribution pillar's 100, and contribution is a quarter of the index.");

  if (!apply) {
    console.log("\nReport only. Pass --apply to remove them.");
    return 0;
  }
  if (!idle.length) return 0;

  await db.delete(projectMembers).where(inArray(projectMembers.id, idle.map((c) => c.memberId)));
  console.log(`\nRemoved ${idle.length} membership(s).`);
  return 0;
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket) bucket.push(item); else out.set(k, [item]);
  }
  return out;
}

async function main(): Promise<number> {
  const who = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!who) {
    console.error("Usage: npx tsx script/unseed-collaborators.ts <username-or-email-or-id> [--apply]");
    return 1;
  }
  return unseed(who, process.argv.includes("--apply"));
}

/* Only as a command, never on import — see the note in script/reputation-gap.ts. */
const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => { console.error(err); process.exit(1); },
  );
}
