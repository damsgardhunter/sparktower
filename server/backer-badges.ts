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
import { ObjectStorageService } from "./replit_integrations/object_storage";
import { badgeLevelForAmount, badgeLevel, BADGE_LEVELS, MAX_SHOWCASE_BADGES } from "@shared/backing";

/**
 * The look. Deliberately specific — "make a badge" produces a different style
 * every call, and these sit next to each other on a profile.
 */
function badgePrompt(opts: { projectTitle: string; metal: string; hex: string; withLogo: boolean }) {
  return [
    `A collectible achievement badge rendered as a low-poly 3D object: faceted geometric surfaces,`,
    `visible polygon edges, soft studio lighting with crisp specular highlights.`,
    `The badge is a rounded hexagonal medallion made of ${opts.metal} (${opts.hex}).`,
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
 * Creates or upgrades the badge row, without generating artwork.
 *
 * Called on every successful pledge so the record exists immediately; the
 * picture is made separately and can fail without losing the entitlement.
 */
export async function upsertBackerBadge(userId: string, projectId: string) {
  const earned = await earnedForProject(userId, projectId);
  if (!earned) return null;

  const level = badgeLevelForAmount(earned.totalCents);
  const [existing] = await db.select().from(backerBadges)
    .where(and(eq(backerBadges.userId, userId), eq(backerBadges.projectId, projectId)));

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
    projectTitle, metal: level.metal, hex: level.hex, withLogo: !!logo,
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
  if (!b64) throw new Error("The image model returned nothing");
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
    const objectPath = await storage.writeObjectBuffer(png, "image/png");

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
