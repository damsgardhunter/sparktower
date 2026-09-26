/**
 * What a picture costs.
 *
 * Images are the one thing in this product that costs real money on every
 * press — several times what a paragraph of text costs, and some routes make
 * five of them in a single request. Under the ordinary rules they were "small
 * actions", which meant a dollar day pass bought unlimited image generation,
 * and a single small action bought a five-scene storyboard. That is the one
 * line on the price list that could cost more in a night than the rest earns
 * in a month.
 *
 * So they have their own rule, and it is short:
 *
 *   - the first generation for a project is free, and so is the first for each
 *     badge — enough to see what Nova makes of your thing before deciding
 *     anything, and not enough to run the picture machine for nothing;
 *   - after that it is the image pass: five dollars for a day of them;
 *   - and the pass is capped at fifty an hour, because "unlimited" has to mean
 *     unlimited for a person and not for a script.
 *
 * Badges themselves stay free — free to earn, free to keep, free to show. It
 * is only regenerating their art past the first go that asks for anything.
 */
import type { Response } from "express";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { aiImageRuns, users } from "@shared/schema";
import {
  FREE_IMAGE_RUNS, IMAGE_PASS_HOURLY_LIMIT, IMAGE_PASS_HOURS, OUTCOME_PRICE_CENTS,
  formatMoney,
} from "@shared/plans";
import { paymentRequired } from "./entitlements";
import { walletOf, spend } from "./wallet";
import { refuseWithRetry } from "./moderation";

/**
 * What a free go belongs to. A project and a badge each get one; "account"
 * covers the images that belong to no project — a post image written from the
 * feed — so those get one free per person rather than one free per post,
 * which would be no limit at all.
 */
export type ImageScope = "project" | "badge" | "account";

/** Is the image pass running right now? Compared in SQL, like every other clock question here. */
export async function imagePassActive(userId: string): Promise<boolean> {
  const [row] = await db.select({ live: sql<boolean>`${users.imagePassUntil} > now()` })
    .from(users).where(eq(users.id, userId));
  return !!row?.live;
}

/** Whether this project (or badge) has had its free go yet. */
export async function freeRunUsed(scope: ImageScope, scopeId: string): Promise<boolean> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` })
    .from(aiImageRuns)
    .where(and(eq(aiImageRuns.scope, scope), eq(aiImageRuns.scopeId, scopeId)));
  return (row?.n ?? 0) >= FREE_IMAGE_RUNS;
}

/** Images this account has made in the last hour — the ceiling on the pass. */
export async function imagesThisHour(userId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`coalesce(sum(${aiImageRuns.images}), 0)::int` })
    .from(aiImageRuns)
    .where(and(eq(aiImageRuns.userId, userId), gte(aiImageRuns.createdAt, sql`now() - interval '1 hour'`)));
  return row?.n ?? 0;
}

/** Buys a day of images. Returns null when the balance won't cover it. */
export async function buyImagePass(userId: string): Promise<{ until: Date } | null> {
  const cents = OUTCOME_PRICE_CENTS.imagePass;
  if (!(await spend(userId, cents, { outcome: "imagePass", note: "A day of images" }))) return null;
  const until = new Date(Date.now() + IMAGE_PASS_HOURS * 60 * 60_000);
  await db.update(users).set({ imagePassUntil: until }).where(eq(users.id, userId));
  return { until };
}

export interface ImagePermit {
  /** Called once the pictures exist, with how many were actually made. */
  record(images: number): Promise<void>;
  /** True when this was the free one, for the route's own copy. */
  free: boolean;
}

/**
 * The guard every image route goes through.
 *
 * Returns a permit when the work may happen, or null after writing the
 * refusal — callers `return` immediately on null, as with requireCredits.
 *
 * Nothing is recorded up front, unlike the money guards: an image run is
 * recorded by its permit once the pictures exist, so a generation that fails
 * never spends the project's free go. The pass is time, not a balance, so
 * there is nothing to hold and nothing to give back.
 *
 * `wanted` is how many pictures the route intends to make, so the hourly
 * ceiling refuses a five-scene storyboard that would cross it rather than
 * letting it through and going over.
 */
export async function requireImages(
  res: Response,
  userId: string,
  opts: { scope: ImageScope; scopeId: string; wanted?: number; label: string },
): Promise<ImagePermit | null> {
  const wanted = Math.max(1, opts.wanted ?? 1);
  const record = async (images: number, free: boolean) => {
    await db.insert(aiImageRuns).values({
      userId, scope: opts.scope, scopeId: opts.scopeId, images: Math.max(1, images), free,
    }).catch((err) => console.error("[images] couldn't record the run:", err));
  };

  // The free go. Per project and per badge, not per account.
  if (!(await freeRunUsed(opts.scope, opts.scopeId))) {
    return { free: true, record: (images) => record(images, true) };
  }

  if (await imagePassActive(userId)) {
    const already = await imagesThisHour(userId);
    if (already + wanted > IMAGE_PASS_HOURLY_LIMIT) {
      /*
       * The ceiling, in the shape every other refusal has. Said as the hour it
       * is, not as a failure: they have paid, and the honest answer is that
       * the next one is a few minutes away.
       */
      refuseWithRetry(res, {
        action: "ai",
        message:
          `That's ${already} images in the last hour, and the pass allows ${IMAGE_PASS_HOURLY_LIMIT}. ` +
          `It frees up as the hour rolls on — nothing was charged.`,
        retryAfterSeconds: 300,
        code: "image_hourly_limit",
        extra: { madeThisHour: already, hourlyLimit: IMAGE_PASS_HOURLY_LIMIT, wanted },
      });
      return null;
    }
    return { free: false, record: (images) => record(images, false) };
  }

  const cents = OUTCOME_PRICE_CENTS.imagePass;
  const wallet = await walletOf(userId);
  res.status(402).json(paymentRequired({
    message:
      `${opts.label} needs a day of images — ${formatMoney(cents)} for ${IMAGE_PASS_HOURS} hours of them, ` +
      `up to ${IMAGE_PASS_HOURLY_LIMIT} an hour. The first set for each project and each badge is free, and this one has had its.`,
    label: "A day of images",
    outcome: "imagePass",
    cents,
    wallet,
  }));
  return null;
}
