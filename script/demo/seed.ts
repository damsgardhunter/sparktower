/**
 * Filling the place up: people, projects, pictures, and a feed with things in it.
 *
 * An empty product is a hard thing to judge. A visitor cannot tell whether
 * Discover is broken or simply new, whether the feed is quiet because nobody
 * posts or because nobody is here, and every screen built to rank, filter and
 * compare has nothing to do. This writes a community in so the whole thing can
 * be looked at as it would be with people in it.
 *
 * ## What it deliberately does not do
 *
 * **No money, anywhere.** No backing campaigns, no pledges, no merch, no
 * balances. Invented people must never be able to take a real pound off a real
 * visitor, and a demo project with a funding bar on it is an invitation to try.
 * `assertNoMoney` at the bottom fails the run if any of it appears, so this
 * stays true if somebody later adds a line that seeds a campaign.
 *
 * **No real faces.** Every picture is drawn from the name — see
 * `./pictures` — rather than fetched from a stock library or a model. Nothing
 * here is a photograph of a person who did not consent to being a fictional
 * founder.
 *
 * ## Finding them again
 *
 * Every row this writes belongs to a user whose email ends in DEMO_DOMAIN.
 * That is the handle for `--clear`, and it is the reason the domain is a
 * constant rather than typed twice.
 */
import { eq, inArray, like, sql } from "drizzle-orm";
import { db } from "../../server/db";
import {
  users, userProfiles, projects, feedPosts, userFollows, projectFollows, connections,
  feedReactions, feedComments, projectBackingCampaigns, projectBackings,
} from "@shared/schema";
import { instantiatePathTree } from "../../server/phase-trees";
import { PEOPLE, PROJECTS, CHATTER } from "./cast";
import { avatarFor, logoFor, coverFor } from "./pictures";

/** The mark of an invented person. Everything demo hangs off this. */
export const DEMO_DOMAIN = "@demo.sparktower.invalid";

/** Deterministic pseudo-randomness, so two runs produce the same community. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/**
 * Refuses to run anywhere that looks like production.
 *
 * Seed data in a real database is not a mistake you can tidy up afterwards:
 * the fake people are in the feed, in search, in everybody's Discover, and in
 * whatever anybody has already emailed a link to.
 */
function assertSafeTarget(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "yes") {
    throw new Error("Refusing to seed demo data with NODE_ENV=production. Set ALLOW_DEMO_SEED=yes if you truly mean it.");
  }
  if (/(prod|live)/i.test(url) && process.env.ALLOW_DEMO_SEED !== "yes") {
    throw new Error(`Refusing to seed demo data into a database whose URL looks like production. Set ALLOW_DEMO_SEED=yes to override.`);
  }
}

/** Everything the demo has ever written, by the only mark it leaves. */
async function demoUserIds(): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(users).where(like(users.email, `%${DEMO_DOMAIN}`));
  return rows.map((r) => r.id);
}

export async function clearDemo(): Promise<number> {
  const ids = await demoUserIds();
  if (!ids.length) return 0;
  /*
   * Closed the way a real account closes, rather than by deleting rows.
   *
   * A user is referenced from thirty-odd tables and only some of them cascade;
   * deleting the row by hand fails on the first foreign key and leaves the
   * community half-removed. `deleteAccount` already knows every table keyed to
   * a person — it is the thing the MINE / CHOICE / KEPT lists in
   * server/account-data.ts exist for — so clearing the demo uses it, which has
   * the happy side effect of exercising that path every time somebody reseeds.
   *
   * `keepPosts: false`, because an anonymised post from a person who never
   * existed is worse than no post.
   */
  const { deleteAccount } = await import("../../server/account-data");
  for (const id of ids) {
    await deleteAccount(id, { keepPosts: false }).catch((err) => {
      console.error(`  couldn't close demo account ${id}:`, err?.message ?? err);
    });
  }
  /*
   * And then the tombstone, which is the one thing a real close leaves behind
   * and a demo must not.
   *
   * Closing an account keeps the row — renamed to `deleted+<id>@deleted.invalid`
   * with `deletedAt` stamped — so that anything still pointing at it has
   * something to point at and the address can be signed up again. Exactly
   * right for a person, and litter here: reseeding four times would leave
   * ninety-six dead rows that no longer carry the demo domain, so nothing
   * would ever find them again. The ids are held from before the close for
   * that reason.
   */
  await db.delete(users).where(inArray(users.id, ids)).catch((err) => {
    console.error("  some demo tombstones could not be removed:", err?.message ?? err);
  });
  return ids.length;
}

/** No demo row may ever carry money. Checked, not promised. */
async function assertNoMoney(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const owned = await db.select({ id: projects.id }).from(projects)
    .where(sql`${projects.ownerId} = any(${sql.raw(`ARRAY['${ids.join("','")}']::varchar[]`)})`);
  const projectIds = owned.map((p) => p.id);
  if (!projectIds.length) return;
  const arr = sql.raw(`ARRAY['${projectIds.join("','")}']::varchar[]`);
  const [campaigns] = await db.select({ n: sql<number>`count(*)::int` }).from(projectBackingCampaigns)
    .where(sql`${projectBackingCampaigns.projectId} = any(${arr})`);
  const [pledges] = await db.select({ n: sql<number>`count(*)::int` }).from(projectBackings)
    .where(sql`${projectBackings.projectId} = any(${arr})`);
  if (campaigns?.n || pledges?.n) {
    throw new Error(`Demo projects must never take money, and ${campaigns?.n ?? 0} campaigns / ${pledges?.n ?? 0} backings exist. Refusing to finish.`);
  }
}

export async function seedDemo(): Promise<{ people: number; projects: number; posts: number }> {
  assertSafeTarget();
  const rand = rng(20260924);

  /* ---- people ------------------------------------------------------------ */
  const ids: string[] = [];
  for (const [i, p] of PEOPLE.entries()) {
    const name = `${p.first} ${p.last}`;
    const email = `${p.first}.${p.last}`.toLowerCase().replace(/[^a-z.]/g, "") + DEMO_DOMAIN;
    const [row] = await db.insert(users).values({
      email,
      firstName: p.first,
      lastName: p.last,
      /*
       * No password hash and no verified address: these accounts exist to be
       * looked at, not signed into. Anyone who tries the address gets the
       * ordinary "no such account" path.
       */
      profileImageUrl: avatarFor(name),
      createdAt: daysAgo(180 - i * 5),
    } as any).onConflictDoNothing().returning({ id: users.id });
    let id = row?.id;
    if (!id) {
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
      id = existing?.id;
    }
    if (!id) continue;
    ids.push(id);
    /*
     * The profile, which is where a person actually lives.
     *
     * The headline, the bio, the skills and the picture are all on `profiles`
     * rather than `users` — and Discover's people search filters on
     * `isOnboarded`, so a user row without one of these is invisible no matter
     * how complete it looks in the table. Seeding twenty-four users and no
     * profiles produced exactly that: "24 projects · 0 people".
     */
    await db.insert(userProfiles).values({
      userId: id,
      displayName: name,
      username: `${p.first}${p.last}`.toLowerCase().replace(/[^a-z0-9]/g, ""),
      headline: p.headline,
      bio: p.bio,
      skills: p.skills,
      location: p.location,
      avatarUrl: avatarFor(name),
      coverUrl: coverFor(name),
      isOnboarded: true,
      experienceLevel: (["intermediate", "expert", "intermediate"] as const)[i % 3],
      hoursPerWeek: [10, 20, 40, 15][i % 4],
      builderType: (["long-term", "experimental", "both"] as const)[i % 3],
    } as any).onConflictDoNothing().catch(() => {});
  }

  /* ---- projects, each with a real path under it -------------------------- */
  let madeProjects = 0;
  const projectIds: string[] = [];
  for (const [i, p] of PROJECTS.entries()) {
    const ownerId = ids[p.owner];
    if (!ownerId) continue;
    const [row] = await db.insert(projects).values({
      ownerId,
      title: p.title,
      description: p.description,
      category: p.category,
      goal: p.goal,
      subcategory: p.subcategory,
      stage: p.stage,
      currency: p.currency,
      logoUrl: logoFor(p.title),
      soloBuild: true,
      isPrivate: false,
      createdAt: daysAgo(150 - i * 4),
    } as any).returning({ id: projects.id });
    if (!row) continue;
    projectIds.push(row.id);
    madeProjects += 1;
    /*
     * The path is what makes a project look like a project rather than a
     * title. Built through the real instantiator so these rows are the same
     * shape as everybody else's, and so Discover's progress figures have
     * something true to count.
     */
    await instantiatePathTree(row.id, p.goal, p.subcategory).catch(() => {});
  }

  /* ---- the feed ---------------------------------------------------------- */
  let posts = 0;
  const postIds: string[] = [];
  for (const [i, p] of PROJECTS.entries()) {
    const ownerId = ids[p.owner];
    const projectId = projectIds[i];
    if (!ownerId || !projectId) continue;
    for (const [j, u] of p.updates.entries()) {
      const [row] = await db.insert(feedPosts).values({
        authorId: ownerId, projectId, postType: u.type as any, content: u.text,
        /* A picture on the first update of each project, so the feed is not a wall of text. */
        mediaUrls: j === 0 ? [coverFor(`${p.title}-${j}`)] : [],
        createdAt: daysAgo(40 - i - j * 3),
      } as any).returning({ id: feedPosts.id });
      if (row) { postIds.push(row.id); posts += 1; }
    }
  }
  for (const [i, c] of CHATTER.entries()) {
    const ownerId = ids[c.owner];
    if (!ownerId) continue;
    const [row] = await db.insert(feedPosts).values({
      authorId: ownerId, postType: c.type as any, content: c.text,
      createdAt: daysAgo(30 - i * 2),
    } as any).returning({ id: feedPosts.id });
    if (row) { postIds.push(row.id); posts += 1; }
  }

  /* ---- and the fact that they know each other ---------------------------- */
  for (let i = 0; i < ids.length; i += 1) {
    for (let k = 1; k <= 3; k += 1) {
      const other = ids[(i + k * 3 + Math.floor(rand() * 2)) % ids.length];
      if (!other || other === ids[i]) continue;
      await db.insert(userFollows).values({ followerId: ids[i], followeeId: other } as any).onConflictDoNothing();
      if (rand() < 0.35) {
        await db.insert(connections).values({
          requesterId: ids[i], receiverId: other, status: "accepted",
        } as any).onConflictDoNothing().catch(() => {});
      }
    }
    for (let k = 0; k < 2; k += 1) {
      const pid = projectIds[Math.floor(rand() * projectIds.length)];
      if (pid) await db.insert(projectFollows).values({ projectId: pid, userId: ids[i] } as any).onConflictDoNothing().catch(() => {});
    }
  }

  /* Reactions and a few replies, so the feed is not a wall of monologues. */
  for (const postId of postIds) {
    const howMany = Math.floor(rand() * 6);
    for (let k = 0; k < howMany; k += 1) {
      const who = ids[Math.floor(rand() * ids.length)];
      if (who) await db.insert(feedReactions).values({ postId, userId: who, reaction: "like" } as any).onConflictDoNothing().catch(() => {});
    }
    if (rand() < 0.3) {
      const who = ids[Math.floor(rand() * ids.length)];
      if (who) {
        await db.insert(feedComments).values({
          postId, authorId: who,
          content: ["Watching this one.", "How did you get the first ten?", "This is the bit everybody skips. Good.", "Same problem here, different industry."][Math.floor(rand() * 4)],
        } as any).catch(() => {});
      }
    }
  }

  await assertNoMoney(ids);
  return { people: ids.length, projects: madeProjects, posts };
}
