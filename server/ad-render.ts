/**
 * One advert, made: paid for, written, generated, composited, stored.
 *
 * Every piece this joins existed before it did and none of them were connected
 * to a project. The brand kit, the script writer, the shot planner, the Kling
 * client and the compositor were five modules and a set of scripts I drove by
 * hand. This is the thing that makes an advert something a person can ask for.
 *
 * ## Why it is a row and not a request
 *
 * Generation is minutes of somebody else's queue. A request that waited would
 * hold a connection open past every proxy timeout between here and the phone,
 * and a restart halfway through would lose an advert that had already been
 * paid for. So a render is a row that moves through `AD_RENDER_STATUSES`, every
 * step writes what it learned before doing anything else, and `advanceRender`
 * can be called again from nothing but the row.
 *
 * ## Why the money is taken first and given back in full
 *
 * Taken first because generation costs us the moment it starts, and a render
 * that is paid for afterwards is a render somebody can walk away from. Given
 * back in full — not pro rata — because a half-finished advert is worth
 * nothing to the person who ordered one. There is no partial delivery here:
 * either there is a file at the end or there isn't.
 *
 * ## Why each plate is generated once
 *
 * At one attempt per plate every length clears its cost; at three, none of them
 * do (test/unit/ad-pricing.test.ts asserts both). So a plate that comes back
 * bad fails the render and refunds it, and trying again is a new render at the
 * full price. A re-roll included in the price is a re-roll somebody presses
 * until they like it, paid for by us.
 */
import path from "path";
import os from "os";
import { promises as fs } from "fs";
import { randomUUID } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { adRenders, projects } from "@shared/schema";
import { spend, refund } from "./wallet";
import { ObjectStorageService } from "./replit_integrations/object_storage";
import { klingSubmit, klingStatus, klingConfigured, isRateLimited, isTransient, type KlingSubmit, type KlingTask } from "./kling-client";
import { aiStubbed } from "./ai-stub";
import { composeConcat, renderShot, runFfmpeg, ffmpegAvailable, escapeDrawText } from "./ad-compositor";
import { writeAdScript, ScriptUnusableError } from "./ad-script-writer";
import { brandKitFor } from "./ad-brand-routes";
import {
  AD_FORMATS, adFormat, beatPlan, isAdDuration, adOutcome, adPriceCents, plateCostCents,
  type AdDuration, type AdFormatId,
} from "@shared/ads";
import { adStyle, availableStyles } from "@shared/ad-styles";
import { drawKeyframe } from "./ad-keyframe";
import { planShots, planPlates, type Plate, type Shot } from "@shared/ad-shots";
import { platePrompt, plateNegativePrompt } from "@shared/ad-plate-prompt";
import { resolvedBrand, brandVoice, type BrandKitInput } from "@shared/ad-brand";
import { sceneMoments } from "@shared/ad-script";
import { fitLine } from "@shared/ad-type";
import { safeBox, SAFE_AREAS } from "@shared/ad-safe-areas";

/**
 * How many plates are in flight at once.
 *
 * Five, because that is the account's concurrency and a sixth request is
 * refused rather than queued — a refusal costs nothing but it fails a render
 * somebody paid for. Deliberately a constant here rather than read from the
 * environment: the number is a property of the contract, and a server told it
 * had twenty would cheerfully fail four adverts out of five.
 */
export const MAX_CONCURRENT_PLATES = 5;

export interface RenderRequest {
  duration: number;
  format: string;
  style: string;
  brief: string;
}

export type RenderRefusal = { field: string; message: string };

/**
 * What is wrong with the request, or nothing.
 *
 * Checked before a penny moves, and every field named, because a 402 followed
 * by "style is not available" is a person who has been charged for discovering
 * they picked the wrong thing.
 */
export function checkRequest(raw: RenderRequest, has: Parameters<typeof availableStyles>[0]): RenderRefusal | null {
  if (!isAdDuration(raw.duration)) {
    return { field: "duration", message: `An advert is 6, 15 or 30 seconds. Got ${raw.duration}.` };
  }
  if (!adFormat(raw.format)) {
    return { field: "format", message: `Pick a shape: ${AD_FORMATS.map((f) => f.id).join(", ")}.` };
  }
  const style = adStyle(raw.style);
  if (!style) return { field: "style", message: "That isn't one of the advert styles." };
  /*
   * Three styles need evidence the business has supplied — a testimonial needs
   * a quote, a before-and-after needs both halves. Refused here rather than
   * written around, because a social-proof advert with no quote in it is a
   * model inventing a customer.
   */
  if (!availableStyles(has).some((s) => s.id === style.id)) {
    return { field: "style", message: `A ${style.label.toLowerCase()} advert needs something this project hasn't supplied yet.` };
  }
  const brief = raw.brief?.trim() ?? "";
  if (brief.length < 20) {
    return { field: "brief", message: "Say what the business does in a sentence or two — the advert is written from this." };
  }
  return null;
}

export interface RenderQuote {
  durationSeconds: AdDuration;
  priceCents: number;
  outcome: ReturnType<typeof adOutcome>;
  shots: Shot[];
  plates: Plate[];
  /** Seconds the provider will generate, which is more than the advert is long. */
  generatedSeconds: number;
  /** What those plates are expected to cost us. For the margin, not for the person. */
  expectedProviderCents: number;
}

/**
 * The plan and the price, worked out without charging anything.
 *
 * Exported and pure so the screen can show somebody what they are about to buy
 * and how it is put together. The same function produces the plan that is
 * stored on the row, so the quote is not a separate estimate that can disagree
 * with what gets made.
 */
export function quoteRender(duration: AdDuration): RenderQuote {
  const beats = beatPlan(duration);
  /* planShots marks the brand moments itself, and inserts the sweep before the product beat. */
  const shots = planShots(beats);
  const plates = planPlates(shots);
  return {
    durationSeconds: duration,
    priceCents: adPriceCents(duration),
    outcome: adOutcome(duration),
    shots,
    plates,
    generatedSeconds: plates.reduce((n, p) => n + p.seconds, 0),
    expectedProviderCents: plateCostCents(plates.map((p) => p.seconds)),
  };
}

/** A plate as it is tracked on the row. */
interface PlateRecord {
  index: number;
  seconds: number;
  camera: string;
  prompt: string;
  taskId: string | null;
  videoUrl: string | null;
  status: KlingTask["status"] | "pending";
  error: string | null;
  /** True when the clip was made locally because no key was configured. */
  stubbed?: boolean;
  /** The scene the script wrote for this plate, kept so the keyframe can be redrawn. */
  scene?: string;
  /**
   * The drawn first frame, base64, for image-to-video.
   *
   * Deliberately not written to the row — a megabyte of base64 per plate in a
   * jsonb column is a row nobody can read and a query nobody should run. It is
   * carried in memory for the submit and the stored copy is `keyframePath`.
   */
  image?: string;
  /** Where the drawn frame was stored, so a bad advert can be explained. */
  keyframePath?: string;
  /** How many times this plate has been sent. Caps the retry on a busy queue. */
  tries?: number;
}

export type RenderRow = typeof adRenders.$inferSelect;

/**
 * Take the money, write the row.
 *
 * In that order, and not in a transaction together, which is deliberate. The
 * spend is its own transaction with its own ledger entry; if the row insert
 * then failed we would owe a refund, which is recoverable. The other order is
 * not: a row that exists unpaid is an advert the renderer will cheerfully
 * generate for free, and the sweep that picks up queued rows cannot tell the
 * difference.
 */
export async function startRender(
  userId: string,
  projectId: string,
  request: RenderRequest,
  has: Parameters<typeof availableStyles>[0] = {},
): Promise<{ ok: true; render: RenderRow } | { ok: false; refusal: RenderRefusal; status: number }> {
  const refusal = checkRequest(request, has);
  if (refusal) return { ok: false, refusal, status: 400 };

  const duration = request.duration as AdDuration;
  const quote = quoteRender(duration);

  const paid = await spend(userId, quote.priceCents, {
    outcome: quote.outcome,
    note: `A ${duration}-second advert`,
    projectId,
  });
  if (!paid) {
    return {
      ok: false,
      status: 402,
      refusal: { field: "balance", message: `A ${duration}-second advert is ${(quote.priceCents / 100).toFixed(2)} and there isn't that much on the account.` },
    };
  }

  try {
    const kit = await brandKitFor(projectId);
    const [row] = await db.insert(adRenders).values({
      projectId,
      requestedBy: userId,
      durationSeconds: duration,
      format: request.format,
      style: request.style,
      brief: request.brief.trim(),
      /*
       * The brand as it resolves *now*. A kit edited while a render is in
       * flight must not change what is being drawn half way through, and an
       * advert delivered months later should still be explainable from its own
       * row rather than from whatever the brand has become since.
       */
      brand: { kit, resolved: resolvedBrand(kit) },
      plan: { shots: quote.shots, plates: quote.plates, generatedSeconds: quote.generatedSeconds },
      status: "queued",
      chargedCents: paid.amountCents,
    }).returning();
    return { ok: true, render: row };
  } catch (error) {
    /* The money moved and the row did not. Put it back before anything else. */
    await refund(userId, quote.priceCents, {
      outcome: quote.outcome,
      note: "An advert that could not be started",
      projectId,
    });
    throw error;
  }
}

/** The render, with the money put back, once. */
async function failRender(row: RenderRow, reason: string): Promise<RenderRow> {
  /*
   * `refundedCents` guards the double refund. A sweep and a poll can both
   * decide a render has failed, and the condition travels with the update so
   * the database decides which of them is the one that pays.
   */
  const [claimed] = await db.update(adRenders)
    .set({ status: "failed", failure: reason, finishedAt: new Date(), updatedAt: new Date(), refundedCents: row.chargedCents })
    .where(and(eq(adRenders.id, row.id), eq(adRenders.refundedCents, 0)))
    .returning();
  if (!claimed) {
    const [already] = await db.select().from(adRenders).where(eq(adRenders.id, row.id));
    return already;
  }
  await refund(row.requestedBy, row.chargedCents, {
    outcome: adOutcome(row.durationSeconds as AdDuration),
    note: `An advert that didn't finish: ${reason}`.slice(0, 300),
    projectId: row.projectId,
  });
  return claimed;
}

const set = async (id: string, patch: Partial<RenderRow>): Promise<RenderRow> => {
  const [row] = await db.update(adRenders).set({ ...patch, updatedAt: new Date() }).where(eq(adRenders.id, id)).returning();
  return row;
};

/**
 * Move a render one step closer to a file.
 *
 * Idempotent per status, so the caller can be a sweep, a poll from the screen,
 * or a retry after a restart, and none of them need to know what the others
 * did. Returns the row as it now stands.
 */
export async function advanceRender(renderId: string): Promise<RenderRow> {
  const [row] = await db.select().from(adRenders).where(eq(adRenders.id, renderId));
  if (!row) throw new Error(`No render ${renderId}`);
  if (row.status === "ready" || row.status === "failed") return row;

  try {
    if (row.status === "queued") return await beginGenerating(row);
    if (row.status === "generating") return await pollPlates(row);
    if (row.status === "composing") return await composeFinal(row);
    return row;
  } catch (error) {
    const message = error instanceof ScriptUnusableError
      ? error.message
      : `Something went wrong making this advert: ${(error as Error)?.message ?? error}`;
    console.error(`[ad-render] ${renderId} failed:`, error);
    return failRender(row, message.slice(0, 500));
  }
}

/** Write the script, then submit every plate. */
async function beginGenerating(row: RenderRow): Promise<RenderRow> {
  const style = adStyle(row.style)!;
  const brand = (row.brand as any)?.kit as BrandKitInput | null;
  const resolved = (row.brand as any)?.resolved ?? resolvedBrand(brand);
  const plan = row.plan as { shots: Shot[]; plates: Plate[] };
  const beats = beatPlan(row.durationSeconds as AdDuration);

  /* How many clips each beat is cut from, so the script can write one moment per clip. */
  const momentsPerBeat = new Map<string, number>();
  for (const plate of plan.plates) {
    for (const id of plate.beats) momentsPerBeat.set(id, (momentsPerBeat.get(id) ?? 0) + 1);
  }

  const written = await writeAdScript({
    brief: row.brief,
    style: { label: style.label, bestFor: style.bestFor, avoid: style.avoid, logoRole: style.keyframes ? style.logoRole ?? null : null },
    beats: beats.map((b) => ({ ...b, moments: momentsPerBeat.get(b.id) ?? 1 })),
    voice: brandVoice(resolved.voice) ?? { label: "Plain", how: "Says what the thing is." },
    businessName: brand?.displayName ?? null,
    callToAction: brand?.callToAction ?? null,
    avoidWords: brand?.avoidWords ?? [],
    supportedClaims: [],
  });

  /*
   * The script itself, not the writer's report about it.
   *
   * `writeAdScript` returns `{ script, attempts, repaired, rejected }`, and
   * storing the whole thing put the lines one level deeper than the column
   * documents — so `composeFinal` read `script.lines` off the wrapper, found
   * undefined, and failed the render after every clip had been generated and
   * paid for. The cheapest possible bug to make and the dearest place to make
   * it, since it fails at the last step.
   */
  await set(row.id, { script: written.script as any, startedAt: new Date() });
  if (written.attempts > 1 || written.repaired.length) {
    console.log(`[ad-render] ${row.id} script took ${written.attempts} attempts, ${written.repaired.length} repaired`);
  }

  const plates: PlateRecord[] = plan.plates.map((plate, index) => ({
    index,
    seconds: plate.seconds,
    camera: plate.camera,
    prompt: platePrompt({
      brief: row.brief,
      style,
      plate,
      brandMoment: plate.windows.some((w) => plan.shots[w.shotIndex]?.brandMoment),
      businessName: brand?.displayName ?? null,
      /* What the script asked to see, for the beats this plate covers. */
      scenes: plate.beats
        .map((id) => written.script.lines.find((l) => l.beat === id)?.scene)
        .filter((s): s is string => !!s?.trim()),
    }),
    /*
     * This plate's own moment. A beat cut from three clips wrote three
     * moments; this takes the one that belongs to this clip rather than
     * repeating the whole beat's scene three times, which would have drawn the
     * same room three times over.
     */
    scene: plate.beats
      .map((id) => {
        const wanted = momentsPerBeat.get(id) ?? 1;
        const moments = sceneMoments(written.script.lines.find((l) => l.beat === id)?.scene, wanted);
        /* Which of this beat's plates this is, counted in play order. */
        const nth = plan.plates.filter((q, qi) => qi < index && q.beats.includes(id)).length;
        return moments[Math.min(nth, moments.length - 1)];
      })
      .filter((s) => !!s?.trim())
      .join(" Then: "),
    taskId: null,
    videoUrl: null,
    status: "pending",
    error: null,
  }));

  const format = adFormat(row.format)!;

  /*
   * The keyframes, drawn in order, each from the one before.
   *
   * Chained to the previous *keyframe* rather than to the previous finished
   * clip. Chaining to the clip would be marginally better — the next shot
   * would start exactly where the last one ended — and it would serialise the
   * whole render behind the video model's queue, turning five parallel
   * generations into five sequential ones and a four-minute advert into
   * twenty. Keyframes are seconds each, so this keeps the place consistent at
   * a cost measured in seconds rather than minutes.
   */
  if (style.keyframes) {
    let previous: Buffer | null = null;
    for (const p of plates) {
      const frame = await drawKeyframe({
        scene: p.scene || row.brief,
        brief: row.brief,
        format: row.format as AdFormatId,
        logoPath: brand?.logoPath ?? null,
        logoRole: style.logoRole ?? null,
        previousFrame: previous,
        ownerId: row.requestedBy,
      });
      p.image = frame.base64;
      p.keyframePath = frame.path;
      previous = Buffer.from(frame.base64, "base64");
    }
    /* Stored before a single clip is paid for, so a bad drawing is visible without a render. */
    await set(row.id, { plates: plates as any });
  }

  /*
   * Only as many as may be in flight at once; the rest stay pending and are
   * sent by `pollPlates` as slots free up.
   *
   * Submitting all nine and hoping is what the first two attempts at this
   * advert did. The provider accepted them, then failed two of them with
   * "parallel task over resource pack limit" — *after* five others had
   * generated, so five clips of real spend were thrown away because of a
   * queue depth this server chose. The account's limit is not knowable from
   * here and changes with the plan, so the only safe shape is to keep a small
   * number in flight and feed the rest in behind them.
   */
  const started = await submitUpTo(row, plates, format, style);
  if ("failure" in started) return started.failure;

  return set(row.id, {
    status: "generating",
    /* Without the base64: see PlateRecord.image. The path is what is kept. */
    plates: started.plates.map(({ image, ...rest }) => rest) as any,
    /* Only what has actually been committed to the provider. */
    providerCents: plateCostCents(started.plates.filter((p) => p.taskId).map((p) => p.seconds)),
  });
}

/**
 * How many clips of one advert may be with the provider at the same time.
 *
 * One for a keyframed style, a few otherwise. Deliberately small: the cost of
 * guessing low is a slower advert, and the cost of guessing high is a failed
 * one with the clips that did generate thrown away.
 */
const inFlightLimit = (style: { keyframes?: boolean }): number =>
  style.keyframes ? 1 : MAX_CONCURRENT_PLATES;

/** How many times one plate may be re-sent after the queue turned it away. */
const MAX_PLATE_TRIES = 4;

/**
 * Sends pending plates until the in-flight limit is reached.
 *
 * Returns the plates as they now stand, or the failed render when a plate was
 * refused for a reason that is not the queue being full. Everything accepted
 * before that point is in the returned list either way — a clip that is
 * generating has been paid for whether or not the advert survives.
 */
async function submitUpTo(
  row: RenderRow,
  plates: PlateRecord[],
  format: { ratio: string },
  style: { keyframes?: boolean },
): Promise<{ plates: PlateRecord[] } | { failure: RenderRow }> {
  const limit = inFlightLimit(style);
  const out = plates.slice();

  for (let i = 0; i < out.length; i++) {
    const inFlight = out.filter((p) => p.taskId && p.status !== "succeeded" && p.status !== "failed").length;
    if (inFlight >= limit) break;
    const p = out[i];
    if (p.status !== "pending") continue;

    const submit: KlingSubmit = {
      prompt: p.prompt,
      negativePrompt: plateNegativePrompt(),
      durationSeconds: p.seconds,
      aspectRatio: format.ratio,
      /* With a keyframe this is image-to-video, and the logo is already in the frame. */
      ...(p.image ? { image: p.image } : {}),
    };

    try {
      const task = await submitWaitingOutLimits(submit);
      out[i] = { ...p, taskId: task.taskId, status: task.status, videoUrl: task.videoUrl, stubbed: aiStubbed(), tries: (p.tries ?? 0) + 1 };
    } catch (error) {
      if (isRateLimited(error) || isTransient(error)) {
        /* Still refused after all the waiting. Leave it pending; the sweep tries again. */
        out[i] = { ...p, tries: (p.tries ?? 0) + 1 };
        break;
      }
      await set(row.id, { plates: out.map(({ image, ...rest }) => rest) as any });
      const [fresh] = await db.select().from(adRenders).where(eq(adRenders.id, row.id));
      return { failure: await failRender(fresh, `The video model refused a clip: ${(error as Error)?.message ?? "no reason given"}`) };
    }
  }
  return { plates: out };
}

/**
 * How long to wait out a concurrency limit, and how many times.
 *
 * Generous, because the thing being waited for is another clip of this same
 * advert finishing, which takes a minute or two — and because the alternative
 * is failing something somebody paid for over a queue being briefly full.
 */
const LIMIT_BACKOFF_MS = [20_000, 45_000, 90_000, 150_000];

/**
 * Submit, and wait out the account's own concurrency limit rather than failing on it.
 *
 * Only for rate limits. A refused prompt is thrown straight through: trying a
 * refusal four more times is four more refusals and four more minutes of
 * somebody watching a progress bar.
 */
async function submitWaitingOutLimits(submit: KlingSubmit): Promise<KlingTask> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await klingSubmit(submit);
    } catch (error) {
      const worthWaiting = isRateLimited(error) || isTransient(error);
      if (!worthWaiting || attempt >= LIMIT_BACKOFF_MS.length) throw error;
      console.log(`[ad-render] ${isRateLimited(error) ? "video model at its limit" : "network trouble reaching the video model"}, waiting ${LIMIT_BACKOFF_MS[attempt] / 1000}s`);
      await new Promise((r) => setTimeout(r, LIMIT_BACKOFF_MS[attempt]));
    }
  }
}

/**
 * Ask about every clip in flight, send the next ones, and move on when all are in.
 *
 * The retry on a full queue lives here as well as in the submit, because the
 * provider reports the same condition two different ways: sometimes the
 * request is refused, and sometimes it is accepted and the *task* then fails
 * with "parallel task over resource pack limit". The second one cost an advert
 * five generated clips — they were fine, and the render was failed around
 * them. A clip turned away by a queue never generated and never cost anything,
 * so it goes back to pending and is sent again.
 */
async function pollPlates(row: RenderRow): Promise<RenderRow> {
  const plates = (row.plates as unknown as PlateRecord[]) ?? [];
  const format = adFormat(row.format)!;
  const style = adStyle(row.style)!;

  const polled: PlateRecord[] = await Promise.all(plates.map(async (p) => {
    if (p.status === "succeeded" || p.status === "pending" || !p.taskId) return p;
    try {
      const task = await klingStatus(p.taskId, {
        prompt: p.prompt, durationSeconds: p.seconds, aspectRatio: format.ratio,
        ...(p.keyframePath ? { image: "stored" } : {}),
      });
      if (task.status === "failed" && isRateLimited({ message: task.error ?? "" } as Error)) {
        /* The queue was full, not the clip bad. Nothing generated, nothing charged. */
        return { ...p, taskId: null, status: "pending" as const, videoUrl: null, error: null };
      }
      return { ...p, status: task.status, videoUrl: task.videoUrl, error: task.error };
    } catch {
      /* A failed poll is not a failed clip: the next sweep asks again. */
      return p;
    }
  }));

  const exhausted = polled.find((p) => p.status === "pending" && (p.tries ?? 0) >= MAX_PLATE_TRIES);
  if (exhausted) {
    await set(row.id, { plates: polled.map(({ image, ...rest }) => rest) as any });
    const [fresh] = await db.select().from(adRenders).where(eq(adRenders.id, row.id));
    return failRender(fresh, `The video model stayed busy: a clip was turned away ${MAX_PLATE_TRIES} times running. Nothing was generated for it, and the advert is refunded in full.`);
  }

  const failed = polled.find((p) => p.status === "failed");
  if (failed) {
    await set(row.id, { plates: polled.map(({ image, ...rest }) => rest) as any });
    const [fresh] = await db.select().from(adRenders).where(eq(adRenders.id, row.id));
    return failRender(fresh, `A clip came back unusable: ${failed.error ?? "no reason given"}`);
  }

  /*
   * A keyframe is read back from storage before a plate can be re-sent: the
   * base64 is deliberately not kept on the row, and a retry that lost it would
   * silently fall back to text-to-video and produce the one shot in the advert
   * with none of the brand in it.
   */
  for (const p of polled) {
    if (p.status === "pending" && p.keyframePath && !p.image) {
      const { buffer } = await new ObjectStorageService().readObjectBuffer(p.keyframePath, 25 * 1024 * 1024);
      p.image = buffer.toString("base64");
    }
  }

  const sent = await submitUpTo(row, polled, format, style);
  if ("failure" in sent) return sent.failure;

  await set(row.id, {
    plates: sent.plates.map(({ image, ...rest }) => rest) as any,
    providerCents: plateCostCents(sent.plates.filter((p) => p.taskId).map((p) => p.seconds)),
  });

  if (sent.plates.some((p) => p.status !== "succeeded")) {
    /* Still in somebody else's queue, or waiting for a slot. The row says so. */
    return (await db.select().from(adRenders).where(eq(adRenders.id, row.id)))[0];
  }
  return set(row.id, { status: "composing" });
}

/**
 * Cut the shots out of the plates, typeset the lines, join them, store the file.
 *
 * Everything the model made is a plate. Everything the business owns — the
 * colours, the logo, the words — is composited here, from their own files, at
 * a size and position this code chose.
 */
async function composeFinal(row: RenderRow): Promise<RenderRow> {
  if (!(await ffmpegAvailable())) throw new Error("ffmpeg is not installed on this server");

  const plan = row.plan as { shots: Shot[]; plates: Plate[] };
  const style = adStyle(row.style)!;
  const plates = (row.plates as unknown as PlateRecord[]) ?? [];
  const script = row.script as { lines: { beat: string; onScreen: string }[]; callToAction: string } | null;
  const brand = (row.brand as any)?.kit as BrandKitInput | null;
  const resolved = (row.brand as any)?.resolved ?? resolvedBrand(brand);

  const work = await fs.mkdtemp(path.join(os.tmpdir(), `ad-${row.id.slice(0, 8)}-`));
  try {
    /* Every plate on local disk first, so a download failure is not a half-built ad. */
    const plateFiles: string[] = [];
    for (const p of plates) {
      plateFiles[p.index] = await fetchPlate(p, work);
    }

    const logoFile = brand?.logoPath ? await fetchLogo(brand.logoPath, work) : null;

    /* One shot per window, in the order they play. */
    const pieces: string[] = [];
    for (const [plateIndex, plate] of plan.plates.entries()) {
      for (const window of plate.windows) {
        const shot = plan.shots[window.shotIndex];
        const line = script?.lines.find((l) => l.beat === shot.beat);
        const output = path.join(work, `shot-${String(pieces.length).padStart(2, "0")}.mp4`);
        await renderShot({
          input: plateFiles[plateIndex],
          startSeconds: window.startSeconds,
          seconds: window.seconds,
          format: row.format as AdFormatId,
          brand: resolved,
          lines: line?.onScreen ? [{ ...fitted(line.onScreen, row.format as AdFormatId), atHeight: 0.78, bold: true }] : [],
          /*
           * No corner logo when the logo is already the scene.
           *
           * A keyframed style draws the mark into the world — for SparkTower
           * it is the building the whole advert is about — and stamping a
           * second small copy in the corner is the same logo twice in one
           * frame, one of them a sticker. It reads as a watermark over an
           * advert that did not need one, which is the exact complaint this
           * style was built to answer.
           */
          logoFile: style.keyframes ? null : logoFile,
          brandBar: shot.brandMoment,
          output,
        });
        pieces.push(output);
      }
    }

    /* Concatenated by the demuxer with -c copy: no second encode, no second generation loss. */
    const listFile = path.join(work, "pieces.txt");
    await fs.writeFile(listFile, pieces.map((p) => `file '${p}'`).join("\n"));
    const finished = path.join(work, "advert.mp4");
    await runFfmpeg(composeConcat(listFile, finished));

    const outputPath = await new ObjectStorageService().writeObjectBuffer(
      await fs.readFile(finished),
      "video/mp4",
      { owner: row.requestedBy, visibility: "private" },
    );

    return set(row.id, { status: "ready", outputPath, finishedAt: new Date() });
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * A line and the size to set it at, fitted to this format's safe box.
 *
 * The script writer works to `lineLimit`, which is a reading-speed budget and
 * says nothing about width. The two disagree badly at the longer beats: a
 * three-second proof line may be forty-five characters, and forty-five
 * characters at the headline size is about twice the width of a vertical safe
 * box. The first advert rendered through this pipeline had its proof line
 * clipped at both edges, so the fitting happens here, where the frame is
 * finally known.
 */
function fitted(text: string, formatId: AdFormatId): { text: string; sizeRatio: number } {
  const format = adFormat(formatId)!;
  const box = safeBox(format, SAFE_AREAS[formatId]);
  return fitLine(text, box, Math.min(format.width, format.height));
}

/**
 * The plate as a local file.
 *
 * `stub://` is not downloadable on purpose — see `server/kling-client.ts` —
 * and this is where that purpose is served. Rather than fetching nothing and
 * compositing over it, a test pattern is generated locally at the right length
 * and shape. Unmistakably synthetic, so nobody takes a stubbed render for a
 * real advert, and real video bytes, so everything after this point — the
 * cutting, the lettering, the logo, the concat, the upload — is exercised for
 * nothing.
 */
async function fetchPlate(plate: PlateRecord, work: string): Promise<string> {
  const file = path.join(work, `plate-${plate.index}.mp4`);
  if (!plate.videoUrl) throw new Error(`Plate ${plate.index} has no video`);

  if (plate.videoUrl.startsWith("stub://")) {
    await runFfmpeg(stubPlateArgs(plate, file));
    return file;
  }

  const res = await fetch(plate.videoUrl);
  if (!res.ok) throw new Error(`Couldn't download clip ${plate.index} (${res.status})`);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/**
 * The stand-in plate: calm, dark, and labelled as what it is.
 *
 * It used to be `testsrc2`, ffmpeg's colour-bar pattern, on the reasoning that
 * an obviously synthetic plate could never be mistaken for real footage. That
 * was exactly backwards. Somebody watched a finished advert built on it and
 * described it as "a yellow and blue screen with blocks moving across it —
 * felt like I was being hypnotised", which is a fair description of a test
 * card and tells you nothing about whether the advert is any good. An
 * unmistakably synthetic plate is not the same as a plate that says so.
 *
 * So it is a slow dark gradient with the words on it. Dark and slow because
 * the lettering, the logo and the brand bar are the things being reviewed and
 * they should be the only things moving; labelled because the file leaves this
 * machine and the label is the only thing that travels with it. The camera
 * direction is burned in as well, since it is what the real plate would have
 * been and this is the cheapest place to read it back.
 */
function stubPlateArgs(plate: PlateRecord, file: string): string[] {
  const label = escapeDrawText(`STUB PLATE — no video model`);
  const camera = escapeDrawText(`${plate.seconds}s · ${plate.camera}`);
  const text = (s: string, y: number, size: number, colour: string) =>
    `drawtext=text='${s}':fontcolor=${colour}:fontsize=${size}:x=40:y=${y}:box=1:boxcolor=0x000000@0.45:boxborderw=14`;

  return [
    "-y",
    "-f", "lavfi",
    /* Slow enough that nothing on this plate competes with what is composited over it. */
    "-i", `gradients=s=1280x720:c0=0x1a2028:c1=0x2e3a46:x0=0:y0=0:x1=1280:y1=720:speed=0.012:d=${plate.seconds}:r=24`,
    "-vf", [text(label, 40, 26, "0x8899aa"), text(camera, 92, 20, "0x66788a")].join(","),
    "-t", String(plate.seconds),
    "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast",
    file,
  ];
}

/** The logo, out of object storage and onto disk, where ffmpeg can read it. */
async function fetchLogo(logoPath: string, work: string): Promise<string | null> {
  try {
    const { buffer } = await new ObjectStorageService().readObjectBuffer(logoPath, 12 * 1024 * 1024);
    const file = path.join(work, `logo-${randomUUID().slice(0, 8)}.png`);
    await fs.writeFile(file, buffer);
    return file;
  } catch (error) {
    /*
     * A missing logo does not fail an advert. The rest of the brand — the
     * colours, the name, the words — is still theirs, and an advert delivered
     * without the mark is worth more than a refund.
     */
    console.warn(`[ad-render] couldn't read logo ${logoPath}:`, (error as Error)?.message);
    return null;
  }
}

/** Every render not yet finished, for the sweep. */
export async function unfinishedRenders(limit = 20): Promise<RenderRow[]> {
  return db.select().from(adRenders)
    .where(inArray(adRenders.status, ["queued", "generating", "composing"]))
    .orderBy(adRenders.createdAt)
    .limit(limit);
}

/** A project's adverts, newest first. */
export async function rendersFor(projectId: string, limit = 20): Promise<RenderRow[]> {
  return db.select().from(adRenders)
    .where(eq(adRenders.projectId, projectId))
    .orderBy(desc(adRenders.createdAt))
    .limit(limit);
}

/** Whether the feature can run at all, and why not when it can't. */
export function renderingAvailable(): { ok: boolean; reason?: string } {
  if (aiStubbed()) return { ok: true };
  if (!klingConfigured()) return { ok: false, reason: "Video generation isn't configured on this server." };
  return { ok: true };
}
