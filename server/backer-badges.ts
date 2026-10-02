/**
 * The badge a backer earns and pins to their profile.
 *
 * Generated once from the project's own logo, in low-poly 3D, tinted by the
 * level the backer reached. Generated once and stored, never rendered on
 * demand: it costs a model call, and a badge that looked different every time
 * someone opened the profile it's pinned to wouldn't be a keepsake.
 *
 * The level is derived from the backer's *total* across every pledge to that
 * project, so backing again upgrades a badge in place. It reads as "how far I
 * went for this project", not "how many times I paid".
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { toFile } from "openai";
import { db } from "./db";
import {
  backerBadges, projects, projectBackings, projectBackerTiers, projectBackingCampaigns,
} from "@shared/schema";
import { openai } from "./replit_integrations/image/client";
import { IMAGE_MODEL } from "./aiModels";
import { ModelResponseError } from "./ai-json";
import { ObjectStorageService } from "./replit_integrations/object_storage";
import { badgeLevelForAmount, badgeLevel, BADGE_LEVELS, MAX_SHOWCASE_BADGES, FOUNDER_LEVEL } from "@shared/backing";

/**
 * The look. Deliberately specific — "make a badge" produces a different style
 * every call, and these sit next to each other on a profile.
 */
export function badgePrompt(opts: { projectTitle: string; metal: string; hex: string; withLogo: boolean; creator?: boolean }) {
  return [
    `A collectible achievement badge rendered as a low-poly 3D object: faceted geometric surfaces,`,
    `visible polygon edges, soft studio lighting with crisp specular highlights.`,
    opts.creator
      ? `The badge is a rounded hexagonal creator's medallion made of ${opts.metal}. The gradient is the whole identity of the badge: keep those three colours, in that order and direction, clearly visible across the face.`
      : `The badge is a rounded hexagonal medallion made of ${opts.metal} (${opts.hex}).`,
    opts.withLogo
      ? `Set the supplied logo into the centre of the medallion as an embossed relief, keeping its shapes and proportions recognisable.`
      : `Emboss a simple abstract geometric emblem into the centre of the medallion.`,
    `Centred, front-facing, filling the frame with a small margin.`,
    `Fully transparent background. No text, no lettering, no words, no numbers anywhere in the image.`,
  ].join(" ");
}

/**
 * Recomputes what someone has earned on a project from their pledges.
 *
 * Counts held and released money only. A refunded pledge shouldn't leave a
 * gold badge on a profile.
 */
async function earnedForProject(userId: string, projectId: string) {
  const rows = await db.select({
    amountCents: projectBackings.amountCents,
    believerNumber: projectBackings.believerNumber,
    digitalRewards: projectBackerTiers.digitalRewards,
  }).from(projectBackings)
    .leftJoin(projectBackerTiers, eq(projectBackerTiers.id, projectBackings.tierId))
    .where(and(
      eq(projectBackings.backerId, userId),
      eq(projectBackings.projectId, projectId),
      inArray(projectBackings.status, ["held", "released"]),
    ));

  if (rows.length === 0) return null;

  const totalCents = rows.reduce((sum, r) => sum + r.amountCents, 0);
  const numbers = rows.map((r) => r.believerNumber).filter((n): n is number => n != null);
  return {
    totalCents,
    // The earliest number they hold — being early is the thing being recorded.
    believerNumber: numbers.length ? Math.min(...numbers) : null,
    foundingBeliever: rows.some((r) => (r.digitalRewards || []).includes("founding_believer")),
  };
}

/**
 * Brings the badge row into line with what somebody has actually paid.
 *
 * Called on every successful pledge, so the record exists immediately — the
 * picture is made separately and can fail without losing the entitlement — and
 * on every refund, which is the direction this used to be missing entirely.
 *
 * ## A refund takes the badge with it
 *
 * Four separate paths move a backing to `refunded`: the backer's own account
 * closure, the sweep for a campaign that was never approved, a refund issued
 * from the Stripe dashboard, and a chargeback the platform lost. None of them
 * touched `backer_badges`, and the old version of this function returned early
 * the moment there were no settled pledges left — so it could upgrade a badge
 * and never remove one. The pledge dropped off the backer wall, which filters
 * to held and released, while the badge stayed pinned to the profile at its
 * old level. Money went back and the reward for it did not.
 *
 * So a badge with nothing left behind it is deleted rather than kept at zero.
 * That is a judgement rather than a bug fix: the badge says somebody backed
 * this project, and somebody who was refunded, in the end, did not. A badge
 * that survives having been paid back is a badge that means nothing, which
 * costs every honest one its value. A partial refund is not a deletion — the
 * level is simply recomputed from what is left, so two $20 pledges less one is
 * silver again rather than gold.
 */
export async function reconcileBackerBadge(userId: string, projectId: string) {
  const earned = await earnedForProject(userId, projectId);

  const [existing] = await db.select().from(backerBadges)
    .where(and(eq(backerBadges.userId, userId), eq(backerBadges.projectId, projectId)));

  // A creator's founder badge isn't a pledge, so no pledge — and no refund — is its business.
  if (existing?.level === FOUNDER_LEVEL.key) return existing;

  if (!earned) {
    /*
     * Nothing held or released is left. The showcase keeps whatever order it
     * had: `showcaseOrder` is only ever read sorted, so the gap this leaves
     * behind orders exactly as it did before, and the next badge earned fills
     * the freed slot because the pinned *count* is what decides that.
     */
    if (existing) {
      await db.delete(backerBadges).where(eq(backerBadges.id, existing.id));
      console.log(`[badges] ${userId}'s badge for project ${projectId} removed: no settled pledge remains`);
    }
    return null;
  }

  const level = badgeLevelForAmount(earned.totalCents);

  if (!existing) {
    const [created] = await db.insert(backerBadges).values({
      userId, projectId,
      level: level.key,
      totalCents: earned.totalCents,
      believerNumber: earned.believerNumber,
      foundingBeliever: earned.foundingBeliever,
    }).returning();
    return created;
  }

  /*
   * A level change invalidates the artwork — the metal is the whole point —
   * so the image is dropped and the badge goes back to pending. Everything
   * else can be updated without touching it.
   */
  const levelChanged = existing.level !== level.key;
  const [updated] = await db.update(backerBadges).set({
    level: level.key,
    totalCents: earned.totalCents,
    believerNumber: earned.believerNumber,
    foundingBeliever: earned.foundingBeliever,
    ...(levelChanged ? { imageUrl: null, status: "pending" as const, generatedAt: null } : {}),
  }).where(eq(backerBadges.id, existing.id)).returning();
  return updated;
}

/**
 * Draws one badge and returns the PNG bytes.
 *
 * The single place badge artwork is produced. The creator's preview and the
 * badge a backer actually receives both come through here, so a preview that
 * disagrees with the real thing isn't possible — the same mistake the merch
 * previews were one refactor away from making.
 *
 * Uses the image *edit* endpoint when there's a logo, so the badge is visibly
 * derived from that project rather than generic art beside its name.
 */
export async function renderBadgeImage(
  levelKey: string, projectTitle: string, logo: Buffer | null,
): Promise<Buffer> {
  const level = badgeLevel(levelKey) ?? BADGE_LEVELS[0];
  const prompt = badgePrompt({
    projectTitle, metal: level.metal, hex: level.hex, withLogo: !!logo, creator: level.key === FOUNDER_LEVEL.key,
  });

  /*
   * Transparency is a parameter, not a prompt instruction. Asking for a
   * "fully transparent background" in the prompt produced a badge on a solid
   * gradient every time, which reads as a coloured square once it's inside the
   * round frame on a profile. `background: transparent` requires a PNG output.
   */
  const common = {
    model: IMAGE_MODEL,
    prompt,
    size: "1024x1024" as const,
    background: "transparent" as const,
    output_format: "png" as const,
  };

  const response = logo
    ? await openai.images.edit({
        ...common,
        image: [await toFile(logo, "logo.png", { type: "image/png" })],
      })
    : await openai.images.generate(common);

  const b64 = response.data?.[0]?.b64_json;
  /*
   * The typed error, not a plain one.
   *
   * A reply with no picture in it is the image model's version of unreadable
   * JSON, and every other model route says so with a 502 and
   * `model_unreadable` — the difference between "it had a bad day, try again"
   * and "this feature is broken", which is the difference between retrying and
   * giving up. A plain Error fell through `respondToAiError` to a generic 500,
   * which is what test/integration/ai-metering-sweep.test.ts objected to: it
   * calls every AI route with a model that answers with nothing and holds each
   * one to the same shape.
   */
  if (!b64) throw new ModelResponseError("badge image");
  return Buffer.from(b64, "base64");
}

/**
 * Which logo a badge is built from.
 *
 * The project's own logo first, then whatever the merch designer was given.
 * Without the second fallback a creator who uploaded a logo only under Merch
 * got badges with a generic emblem while their shirts carried their brand —
 * two different answers to "what does this project look like".
 */
export function badgeLogoUrl(projectLogo: string | null, merchConfig: unknown): string | null {
  const merchLogo = (merchConfig as { logoUrl?: string | null } | null)?.logoUrl ?? null;
  return projectLogo || merchLogo || null;
}

/** Reads a project's logo out of storage, or null when there isn't one. */
export async function projectLogoBuffer(logoUrl: string | null): Promise<Buffer | null> {
  if (!logoUrl?.startsWith("/objects/")) return null;
  return new ObjectStorageService()
    .readObjectBuffer(logoUrl, 8 * 1024 * 1024)
    .then((r) => r.buffer)
    .catch(() => null);
}

/**
 * Makes the picture for one earned badge and stores it against that badge.
 */
export async function generateBadgeArt(badgeId: string): Promise<string> {
  const [row] = await db.select({
    badge: backerBadges,
    projectTitle: projects.title,
    projectLogo: projects.logoUrl,
    merchConfig: projectBackingCampaigns.merchConfig,
  }).from(backerBadges)
    .innerJoin(projects, eq(projects.id, backerBadges.projectId))
    .leftJoin(projectBackingCampaigns, eq(projectBackingCampaigns.projectId, backerBadges.projectId))
    .where(eq(backerBadges.id, badgeId));
  if (!row) throw new Error("Badge not found");

  const storage = new ObjectStorageService();
  const logo = await projectLogoBuffer(badgeLogoUrl(row.projectLogo, row.merchConfig));

  try {
    const png = await renderBadgeImage(row.badge.level, row.projectTitle, logo);
    // A badge is a thing backers show off — it hangs on public profiles and
    // goes out in shared links, fetched by <img> with no credentials. Public
    // on purpose, with the badge's holder recorded as its owner, rather than
    // public because nobody set a policy.
    const objectPath = await storage.writeObjectBuffer(png, "image/png", {
      owner: row.badge.userId,
      visibility: "public",
    });

    await db.update(backerBadges).set({
      imageUrl: objectPath,
      status: "ready",
      lastError: null,
      generatedAt: new Date(),
    }).where(eq(backerBadges.id, badgeId));

    return objectPath;
  } catch (err: any) {
    await db.update(backerBadges).set({
      status: "failed",
      lastError: String(err?.message || err).slice(0, 500),
    }).where(eq(backerBadges.id, badgeId));
    throw err;
  }
}

/**
 * Pins a set of badges to a profile, in the order given.
 *
 * Replaces the whole selection rather than toggling one at a time — the order
 * matters and a per-badge toggle can't express it.
 */
export async function setShowcase(userId: string, badgeIds: string[]) {
  const capped = badgeIds.slice(0, MAX_SHOWCASE_BADGES);

  await db.update(backerBadges)
    .set({ showcaseOrder: null })
    .where(and(eq(backerBadges.userId, userId), isNotNull(backerBadges.showcaseOrder)));

  for (const [i, id] of capped.entries()) {
    // Scoped to the caller so nobody can pin a badge that isn't theirs.
    await db.update(backerBadges).set({ showcaseOrder: i })
      .where(and(eq(backerBadges.id, id), eq(backerBadges.userId, userId)));
  }

  return db.select().from(backerBadges)
    .where(and(eq(backerBadges.userId, userId), isNotNull(backerBadges.showcaseOrder)))
    .orderBy(backerBadges.showcaseOrder);
}

/**
 * Every project someone created gets them a Founder badge, pinned to their
 * profile while there's room. Private projects don't: a badge is public, and
 * its title would say what the project is. Safe to call as often as you like —
 * it only adds what's missing, and never re-pins something the creator unpinned.
 *
 * No artwork is generated here: that's a model call, made when the creator
 * asks. Until then the badge shows the project's own logo inside the founder
 * ring, which is already recognisably theirs.
 */
export async function ensureCreatorBadges(userId: string): Promise<string[]> {
  const owned = await db.select({ id: projects.id }).from(projects)
    .where(and(eq(projects.ownerId, userId), eq(projects.isPrivate, false)));
  if (!owned.length) return [];
  const held = await db.select({ projectId: backerBadges.projectId, showcaseOrder: backerBadges.showcaseOrder })
    .from(backerBadges).where(eq(backerBadges.userId, userId));
  const missing = owned.filter((p) => !held.some((h) => h.projectId === p.id));
  let pinned = held.filter((h) => h.showcaseOrder != null).length;
  let nextOrder = Math.max(-1, ...held.map((h) => h.showcaseOrder ?? -1)) + 1;
  const created: string[] = [];
  for (const p of missing) {
    const pin = pinned < MAX_SHOWCASE_BADGES;
    const [row] = await db.insert(backerBadges).values({
      userId, projectId: p.id, level: FOUNDER_LEVEL.key, totalCents: 0,
      ...(pin ? { showcaseOrder: nextOrder } : {}),
    }).onConflictDoNothing().returning({ id: backerBadges.id });
    if (row) {
      created.push(row.id);
      if (pin) { pinned++; nextOrder++; }
    }
  }
  return created;
}

/**
 * Mints the badge for every project someone has actually backed.
 *
 * `reconcileBackerBadge` runs from the Stripe webhook, which is the only path a
 * real pledge takes — so for a long time "every settled backing has a badge"
 * was true by construction and nothing needed to check it. It is not true of
 * any backing written another way: the demo and seed scripts insert
 * `project_backings` rows directly, and those backers appear on the wall with
 * the level their amount clears and nothing on their profile at all. They
 * earned a badge, there was no row for it, and the picker had nothing to offer
 * them.
 *
 * The counterpart to `ensureCreatorBadges`, and deliberately the same shape:
 * safe to call as often as you like, adds only what is missing, pins what it
 * creates while there is room, and never re-pins something that was unpinned.
 * Call it after the creator pass so a founder badge takes the slot — a project
 * you built outranks a project you backed when there are five places and six
 * badges.
 *
 * Private projects get a row but not a pin. The row is theirs either way and
 * shows on their own profile; the pin is a public slot, and the public endpoint
 * filters a private project's badge out of a stranger's view anyway, so pinning
 * one would spend a slot on something most visitors cannot see.
 */
export async function ensureBackerBadges(userId: string): Promise<string[]> {
  const backed = await db.selectDistinct({
    projectId: projectBackings.projectId,
    isPrivate: projects.isPrivate,
  }).from(projectBackings)
    .innerJoin(projects, eq(projects.id, projectBackings.projectId))
    .where(and(
      eq(projectBackings.backerId, userId),
      inArray(projectBackings.status, ["held", "released"]),
    ));
  if (!backed.length) return [];

  const held = await db.select({ projectId: backerBadges.projectId, showcaseOrder: backerBadges.showcaseOrder })
    .from(backerBadges).where(eq(backerBadges.userId, userId));
  const missing = backed.filter((b) => !held.some((h) => h.projectId === b.projectId));
  if (!missing.length) return [];

  let pinned = held.filter((h) => h.showcaseOrder != null).length;
  let nextOrder = Math.max(-1, ...held.map((h) => h.showcaseOrder ?? -1)) + 1;
  const created: string[] = [];

  for (const b of missing) {
    /*
     * Through the ordinary reconcile rather than an insert of its own, so the
     * level, the total, the believer number and the founding-believer flag are
     * all derived the one way they are ever derived. A second copy of that
     * arithmetic here is how a backfilled badge ends up a level off a minted
     * one for the same pledges.
     */
    const row = await reconcileBackerBadge(userId, b.projectId);
    if (!row) continue;
    created.push(row.id);
    if (!b.isPrivate && pinned < MAX_SHOWCASE_BADGES) {
      await db.update(backerBadges).set({ showcaseOrder: nextOrder })
        .where(eq(backerBadges.id, row.id));
      pinned++;
      nextOrder++;
    }
  }
  return created;
}
