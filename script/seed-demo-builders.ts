/**
 * Puts the sixteen demo builders into a database.
 *
 * An empty Discover page tells a visitor that nobody is here, which is the one
 * thing a network cannot recover from saying. This fills it with sixteen
 * complete profiles — headshot, resume, project — written in script/seed/.
 *
 * ## What it creates, and how to undo it
 *
 * Every account is `is_bot = true` with `auth_provider = 'bot'`, the same
 * mechanism the simulation opponents use: nothing can sign in as one, and the
 * whole set is one query away.
 *
 *   select * from users where is_bot and auth_provider = 'bot';
 *
 * They carry no visible marker on the profile card. A visitor reading Discover
 * will take them for real builders, which is the owner's decision, and is
 * written down here so nobody has to rediscover it.
 *
 * ## Running it
 *
 *   DATABASE_URL=… npx tsx script/seed-demo-builders.ts              # report only
 *   DATABASE_URL=… npx tsx script/seed-demo-builders.ts --apply
 *   DATABASE_URL=… npx tsx script/seed-demo-builders.ts --apply --follow hunterd987@gmail.com
 *
 * Idempotent: every insert is keyed on something unique (the email, the
 * username, the follow pair), so running it twice adds nothing. Re-running
 * after editing a persona updates the profile in place.
 *
 * ## The photographs
 *
 * On a database with no bucket configured (development), they are copied into
 * `local_objects/`, which is where the object routes look when
 * PRIVATE_OBJECT_DIR is unset. Against production, where a bucket *is*
 * configured, this refuses and says so: uploading sixteen files into somebody's
 * bucket is not something a seed script should do quietly.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { pathToFileURL } from "node:url";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../server/db";
import { users, userProfiles, projects, userFollows, projectFollows } from "@shared/schema";
import { instantiatePathTree } from "../server/phase-trees";
import { DEMO_BUILDERS, type DemoBuilder } from "./seed/demo-builders";

const apply = process.argv.includes("--apply");
const followArg = process.argv.indexOf("--follow");
const FOLLOW_EMAIL = followArg > -1 ? process.argv[followArg + 1] : "hunterd987@gmail.com";

const HEADSHOTS = path.resolve("attached_assets/headshots");
const LOCAL_OBJECTS = process.env.LOCAL_OBJECT_ROOT || path.resolve("local_objects");
/** Where the avatars live, under the object root and so under /objects/. */
const AVATAR_PREFIX = "demo-builders";

/** A demo account's address. The domain is reserved and cannot receive mail. */
const emailFor = (b: DemoBuilder) => `${b.username}@demo.sparktower.invalid`;
const avatarPathFor = (b: DemoBuilder) => `/objects/${AVATAR_PREFIX}/${b.username}.png`;

/**
 * Copies a headshot in at a sensible size.
 *
 * The originals are two megabytes each, which is a fine thing to generate and
 * a poor thing to serve as a 48-pixel avatar sixteen times on one page. `sips`
 * ships with macOS; anywhere without it the file is copied as it is, since a
 * heavy avatar is better than none.
 */
function placeHeadshot(b: DemoBuilder): { at: string; bytes: number } {
  const source = path.join(HEADSHOTS, b.photo);
  if (!existsSync(source)) throw new Error(`No headshot at ${source} for ${b.username}`);
  const dir = path.join(LOCAL_OBJECTS, AVATAR_PREFIX);
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${b.username}.png`);
  try {
    execFileSync("sips", ["-Z", "640", source, "--out", target], { stdio: "ignore" });
  } catch {
    writeFileSync(target, readFileSync(source));
  }
  return { at: target, bytes: readFileSync(target).length };
}

async function seedOne(b: DemoBuilder): Promise<{ userId: string; projects: number }> {
  const email = emailFor(b);

  await db.insert(users).values({
    email,
    firstName: b.firstName,
    lastName: b.lastName,
    // No password hash and no provider anybody can use: nothing signs in as one.
    authProvider: "bot",
    isBot: true,
    /* Verified so they behave like finished accounts rather than sitting in
       the half-registered state every gate checks for. */
    emailVerifiedAt: new Date(),
    profileImageUrl: avatarPathFor(b),
  } as any).onConflictDoNothing({ target: users.email });

  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!row) throw new Error(`could not create or find ${email}`);

  const profile = {
    userId: row.id,
    displayName: `${b.firstName} ${b.lastName}`,
    username: b.username,
    headline: b.headline,
    bio: b.bio,
    skills: b.skills,
    interests: b.interests,
    experienceLevel: b.experienceLevel,
    location: b.location,
    avatarUrl: avatarPathFor(b),
    hoursPerWeek: b.hoursPerWeek,
    riskTolerance: b.riskTolerance,
    speedVsPolish: b.speedVsPolish,
    scheduleStyle: b.scheduleStyle,
    conflictStyle: b.conflictStyle,
    builderType: b.builderType,
    experience: b.experience,
    education: b.education,
    /* Discover lists people whose profile says it is finished, and an
       unfinished one would never appear — which would make the whole exercise
       pointless (server/discover-search.ts). */
    isOnboarded: true,
  } as any;

  await db.insert(userProfiles).values(profile)
    .onConflictDoUpdate({ target: userProfiles.userId, set: profile });

  let made = 0;
  for (const p of b.projects) {
    const existing = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.ownerId, row.id), eq(projects.title, p.title)));
    let projectId = existing[0]?.id;
    if (!projectId) {
      const [created] = await db.insert(projects).values({
        ownerId: row.id,
        title: p.title,
        description: p.description,
        category: p.category,
        goal: p.goal,
        subcategory: p.subcategory,
      } as any).returning({ id: projects.id });
      projectId = created.id;
      made += 1;
    }

    /*
     * The path's tasks, which an insert alone does not create.
     *
     * Creating a project through the API instantiates the tree; inserting the
     * row does not, so the first version of this left twenty projects with no
     * tasks at all — a dashboard with nothing on it, and nothing for Nova to
     * build.
     *
     * `instantiatePathTree` rather than `startTrack`: a project's own goal is
     * already its primary track and needs no row, so startTrack correctly
     * answers "already started" and does nothing. It is the tree underneath
     * that is missing. This one returns early when the backbone tasks exist,
     * so it is safe to repeat.
     */
    await instantiatePathTree(projectId, p.goal, p.subcategory, { keepRoadmap: true });
  }

  return { userId: row.id, projects: made };
}

async function main(): Promise<number> {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL.");
  if (process.env.PRIVATE_OBJECT_DIR) {
    console.error("PRIVATE_OBJECT_DIR is set, so this database has a real bucket behind it.");
    console.error("This script only writes avatars to local disk. Upload the headshots to the bucket");
    console.error(`under ${AVATAR_PREFIX}/<username>.png first, then run it with that variable unset.`);
    return 1;
  }

  const [target] = await db.select({ id: users.id, email: users.email })
    .from(users).where(eq(users.email, FOLLOW_EMAIL));
  if (!target) {
    console.error(`No account for --follow ${FOLLOW_EMAIL}; nobody would have anyone to follow.`);
    return 1;
  }
  const theirProjects = await db.select({ id: projects.id, title: projects.title })
    .from(projects).where(eq(projects.ownerId, target.id));

  console.log(`database:   ${new URL(process.env.DATABASE_URL).pathname.slice(1)}`);
  console.log(`builders:   ${DEMO_BUILDERS.length}`);
  console.log(`projects:   ${DEMO_BUILDERS.reduce((n, b) => n + b.projects.length, 0)}`);
  console.log(`following:  ${target.email} and their ${theirProjects.length} project(s)`);

  if (!apply) {
    console.log("\nreport only — rerun with --apply.");
    return 0;
  }

  let people = 0, made = 0;
  const ids: string[] = [];
  for (const b of DEMO_BUILDERS) {
    const { bytes } = placeHeadshot(b);
    const { userId, projects: n } = await seedOne(b);
    ids.push(userId);
    people += 1; made += n;
    console.log(`  ${b.username.padEnd(16)} ${(bytes / 1024).toFixed(0).padStart(4)}kB  +${n} project(s)`);
  }

  /* Follow the owner, and every project they own. */
  for (const id of ids) {
    await db.insert(userFollows).values({ followerId: id, followeeId: target.id })
      .onConflictDoNothing();
    for (const p of theirProjects) {
      await db.insert(projectFollows).values({ projectId: p.id, userId: id }).onConflictDoNothing();
    }
  }

  console.log(`\n${people} builders, ${made} new project(s), all following ${target.email}.`);
  console.log(`Undo: delete from users where is_bot and auth_provider = 'bot' and email like '%@demo.sparktower.invalid';`);
  return 0;
}

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => { console.error(err); process.exit(1); },
  );
}
