/**
 * Kling, the video model behind generated advertisements.
 *
 * Built the first time something asks for it, for the reason
 * `server/openai-client.ts` gives at length: a feature without a key must not
 * stop the site from starting. Nothing here is constructed at import time and
 * nothing here throws until a request actually needs a video.
 *
 ## Auth and routes are two separate questions
 *
 * Both sets of documentation describe them as one — "the old API uses a signed
 * JWT and the `/v1/` paths, the new one uses a static key and a path per
 * model" — and this account is neither. Probed on 2026-10-05 with the real
 * key, costing no generation units:
 *
 *   GET /v1/videos/text2video   → 200 {"code":0,"message":"SUCCEED","data":[]}
 *   GET /v1/videos/image2video  → 200, same envelope
 *   GET /v1/images/generations  → 200, same envelope
 *   GET /v1/account/costs       → 404, no such endpoint
 *
 * So: the `/v1/` routes, authenticated with a **static bearer key**. That
 * combination is why the two axes are modelled separately here rather than as
 * one "dialect" — conflating them is what made the first version of this file
 * wrong, and it would have been wrong in a way that looked like a bad key.
 *
 * `KLING_AUTH` and `KLING_ROUTES` can each be overridden, so an account on the
 * other combination needs an environment variable rather than a patch.
 *
 ## Verified end to end on 2026-10-05
 *
 * One generation, on the trial key, and everything below is the observed shape
 * rather than a documented one.
 *
 *   POST /v1/videos/text2video
 *     { model_name, prompt, duration: "5", aspect_ratio: "9:16", mode: "std" }
 *   → { code: 0, data: { task_id, task_status: "submitted", created_at } }
 *
 *   GET /v1/videos/text2video/{task_id}
 *   → data.task_status: submitted → processing → succeed   (~35s for 5s of video)
 *   → data.task_result.videos[0] = { id, url, duration: "5.041" }
 *
 * The model name matters more than anything else here. Five of the six names
 * in the documentation and in community wrappers are **discontinued** on this
 * account — `kling-v1`, `kling-v1-6`, `kling-v2-master`, `kling-v2-1-master`
 * all answer 1203, and `kling-v2-1` answers 1201 "model is not supported".
 * Only `kling-v2-5-turbo` was accepted, which is why it is the default and why
 * `KLING_MODEL` exists: this list changes under you, the failure is a 404 that
 * reads like a broken integration, and the message Kling returns actually says
 * which it is. A rejected model costs nothing, so probing is free.
 *
 * `duration` is a *string* of "5" or "10" — the model's clip lengths, not the
 * ad lengths in shared/ads.ts. A thirty-second ad is composed from several
 * clips; nothing asks the model for thirty seconds.
 */
import { SignJWT } from "jose";
import { aiStubbed } from "./ai-stub";

/** How a request proves who it is. */
export type KlingAuth = "bearer" | "jwt";
/** Which generation of paths and field names the account answers on. */
export type KlingRoutes = "v1" | "perModel";

export interface KlingConfig {
  auth: KlingAuth;
  routes: KlingRoutes;
  baseUrl: string;
  apiKey?: string;
  accessKey?: string;
  secretKey?: string;
}

/**
 * The default host.
 *
 * Kling serves from regional hosts and the documentation names more than one.
 * Overridable precisely because the right answer depends on the account, and
 * being wrong about it looks like an outage rather than a setting.
 */
const DEFAULT_BASE_URL = "https://api-singapore.klingai.com";

/** What is configured, or null. Never throws — callers decide what to do about absence. */
export function klingConfig(): KlingConfig | null {
  const baseUrl = (process.env.KLING_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  /*
   * `KLINGAI_API_KEY` first, because that is the name the key was actually set
   * under. `KLING_API_KEY` is kept as an alternative rather than renamed away:
   * both appear in the wild, and a provider that silently ignores a key
   * somebody has definitely set is a bad afternoon.
   */
  const apiKey = (process.env.KLINGAI_API_KEY || process.env.KLING_API_KEY)?.trim();
  const accessKey = process.env.KLING_ACCESS_KEY?.trim();
  const secretKey = process.env.KLING_SECRET_KEY?.trim();

  /*
   * Defaults follow what was probed: a static key talking to the `/v1` routes.
   * An access/secret pair implies the signed-JWT auth, since that is the only
   * thing those credentials are for. Either can be forced, for an account that
   * turns out to be on the other combination.
   */
  const auth = (process.env.KLING_AUTH as KlingAuth | undefined)
    ?? (apiKey ? "bearer" : "jwt");
  const routes = (process.env.KLING_ROUTES as KlingRoutes | undefined) ?? "v1";

  if (apiKey) return { auth, routes, baseUrl, apiKey };
  /*
   * Both halves, or neither. One without the other cannot sign anything, and
   * a half-configured provider that fails at the first render is worse than
   * one that reports itself off at boot.
   */
  if (accessKey && secretKey) return { auth, routes, baseUrl, accessKey, secretKey };
  return null;
}

export const klingConfigured = (): boolean => klingConfig() !== null;

/**
 * The Authorization header for one request.
 *
 * The JWT is signed per call rather than cached. It is valid for thirty
 * minutes and signing is microseconds, so caching it would save nothing and
 * add a clock to get wrong — and a token that expires mid-poll on a
 * ten-minute render is a failure that only happens in production.
 */
export async function klingAuthHeader(config: KlingConfig): Promise<string> {
  if (config.auth === "bearer") return `Bearer ${config.apiKey}`;
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(config.accessKey!)
    .setIssuedAt(now)
    /* Well inside the documented thirty minutes: a clock a few minutes out is common and costs nothing to tolerate. */
    .setExpirationTime(now + 25 * 60)
    .setNotBefore(now - 5)
    .sign(new TextEncoder().encode(config.secretKey!));
  return `Bearer ${token}`;
}

/** The clip lengths the model offers. Not ad lengths — see shared/ads.ts. */
export const KLING_CLIP_SECONDS = [5, 10] as const;
export type KlingClipSeconds = (typeof KLING_CLIP_SECONDS)[number];

/**
 * The model to ask for.
 *
 * Overridable because the list is not stable: five of the six names published
 * at the time of writing were already discontinued on a key issued the same
 * week. A wrong one is a free 404 whose message names the problem.
 */
export const defaultModel = (): string => process.env.KLING_MODEL?.trim() || "kling-v2-5-turbo";

export interface KlingSubmit {
  prompt: string;
  negativePrompt?: string;
  durationSeconds: number;
  aspectRatio: string;
  /**
   * A still to animate, as raw base64 — no data: prefix, no URL.
   *
   * Base64 rather than a URL on purpose. Kling accepts either, and a URL means
   * this server publishing a keyframe somewhere Kling's machines can reach
   * before it can ask for a clip — which does not exist in development at all,
   * and in production is an advert's unfinished artwork on a public address
   * for as long as the render takes. The bytes go in the request.
   *
   * This is the field that turns a plate into a place. With it the clip starts
   * from a frame we drew — one that already has the business's own logo built
   * into the scene — so the building in shot three is the building from shot
   * one, which text-to-video cannot do at any price.
   */
  image?: string;
  model?: string;
  /** "std" or "pro". Standard unless something needs the dearer one. */
  mode?: "std" | "pro";
}

/** Normalised, so nothing above this file reads a provider's own status words. */
export interface KlingTask {
  taskId: string;
  status: "submitted" | "processing" | "succeeded" | "failed";
  videoUrl: string | null;
  /** The provider's own message when it failed, which is usually the useful part. */
  error: string | null;
}

/**
 * The wire format, per dialect, in one place.
 *
 * Everything uncertain about this integration is in this object. If the first
 * real call returns a shape these readers do not understand, this is the only
 * thing that changes.
 */
const ROUTES: Record<KlingRoutes, {
  submitPath: (s: KlingSubmit) => string;
  submitBody: (s: KlingSubmit) => Record<string, unknown>;
  statusPath: (taskId: string, s: KlingSubmit) => string;
  readTask: (json: any) => KlingTask;
}> = {
  v1: {
    submitPath: (s) => (s.image ? "/v1/videos/image2video" : "/v1/videos/text2video"),
    submitBody: (s) => ({
      model_name: s.model ?? defaultModel(),
      prompt: s.prompt,
      ...(s.negativePrompt ? { negative_prompt: s.negativePrompt } : {}),
      /* A string, and only "5" or "10" — the model's clip lengths. */
      duration: String(s.durationSeconds),
      aspect_ratio: s.aspectRatio,
      /* "std" rather than "pro": a background plate does not need the dearer mode. */
      mode: s.mode ?? "std",
      ...(s.image ? { image: s.image } : {}),
    }),
    statusPath: (taskId, s) => `${s.image ? "/v1/videos/image2video" : "/v1/videos/text2video"}/${taskId}`,
    readTask: (json) => {
      const d = json?.data ?? json;
      return {
        taskId: String(d?.task_id ?? ""),
        /* `succeed` is this dialect's spelling; normalised so no caller has to know. */
        status: d?.task_status === "succeed" ? "succeeded" : (d?.task_status ?? "submitted"),
        videoUrl: d?.task_result?.videos?.[0]?.url ?? null,
        error: d?.task_status_msg ?? null,
      };
    },
  },
  perModel: {
    submitPath: (s) => `${s.image ? "/image-to-video" : "/text-to-video"}/${s.model ?? "kling-v2-master"}`,
    submitBody: (s) => ({
      prompt: s.prompt,
      negativePrompt: s.negativePrompt,
      duration: s.durationSeconds,
      aspectRatio: s.aspectRatio,
      ...(s.image ? { image: s.image } : {}),
    }),
    statusPath: (taskId) => `/tasks/${taskId}`,
    readTask: (json) => {
      const d = json?.data ?? json;
      const video = (d?.outputs ?? []).find((o: any) => o?.type === "video");
      return {
        taskId: String(d?.taskId ?? d?.task_id ?? ""),
        status: d?.status === "succeed" ? "succeeded" : (d?.status ?? "submitted"),
        videoUrl: video?.url ?? null,
        error: d?.error ?? d?.message ?? null,
      };
    },
  },
};

export class KlingUnconfigured extends Error {
  constructor() {
    super(
      "Video generation is not set up on this server. Set KLINGAI_API_KEY, or " +
      "KLING_ACCESS_KEY and KLING_SECRET_KEY together.",
    );
    this.name = "KlingUnconfigured";
  }
}

/** A stub task, so the whole flow above can be exercised with no key and no spend. */
const stubTask = (taskId: string): KlingTask => ({
  taskId,
  status: "succeeded",
  /* Deliberately not a real URL: anything that tries to download this should fail loudly rather than quietly produce an empty ad. */
  videoUrl: `stub://kling/${taskId}`,
  error: null,
});

async function call(config: KlingConfig, method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: await klingAuthHeader(config),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* reported below with the status */ }
  if (!res.ok) {
    /*
     * The provider's own message, kept. A rejected render is nearly always a
     * prompt the safety filter refused or a parameter it did not like, and
     * both are things the caller can act on — "video generation failed" is not.
     */
    const detail = json?.message ?? json?.error ?? text.slice(0, 300);
    const error = new Error(`Kling ${res.status} on ${path}: ${detail || "no message"}`) as KlingHttpError;
    error.status = res.status;
    throw error;
  }
  return json;
}

export interface KlingHttpError extends Error { status?: number }

/**
 * Whether this failure is "not now" rather than "not ever".
 *
 * The distinction matters because the two need opposite handling and one of
 * them costs somebody their advert. A refused prompt is final: trying again
 * produces the same refusal. A concurrency limit is a queue being full, and
 * the only correct response is to wait — the account's own limit is not a
 * property of the advert and should never be the reason one fails.
 *
 * This exists because a thirty-second advert died on
 * "429: parallel task over resource pack limit" after nine keyframes had been
 * drawn and paid for. Nothing was wrong with it. The server had simply asked
 * for five clips at once on a trial pack that would not take five.
 */
/**
 * Whether this failure is the network rather than the request.
 *
 * `fetch failed` is what undici raises for a connection that did not complete,
 * and it arrives with no status and no message worth showing anyone. Treated
 * as a refusal it fails an advert that nothing is wrong with — which is how
 * one died with three of its nine clips already generated and paid for. It is
 * retried on exactly the same footing as a full queue, because from here the
 * two are the same thing: ask again shortly.
 */
export const isTransient = (error: unknown): boolean => {
  const e = error as KlingHttpError;
  if (e?.status && e.status >= 500) return true;
  return /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network|aborted/i.test(String(e?.message ?? ""));
};

export const isRateLimited = (error: unknown): boolean => {
  const e = error as KlingHttpError;
  if (e?.status === 429) return true;
  /* Some gateways answer 400 with the limit in the message rather than 429. */
  return /rate limit|too many|concurren|parallel task|resource pack limit/i.test(String(e?.message ?? ""));
};

/** Start a render. Returns the task to poll, having charged nothing yet. */
export async function klingSubmit(input: KlingSubmit): Promise<KlingTask> {
  if (aiStubbed()) return stubTask(`stub-${Date.now()}`);
  const config = klingConfig();
  if (!config) throw new KlingUnconfigured();
  const d = ROUTES[config.routes];
  const json = await call(config, "POST", d.submitPath(input), d.submitBody(input));
  const task = d.readTask(json);
  if (!task.taskId) throw new Error(`Kling accepted the request and returned no task id: ${JSON.stringify(json).slice(0, 300)}`);
  return task;
}

export async function klingStatus(taskId: string, input: KlingSubmit): Promise<KlingTask> {
  if (aiStubbed()) return stubTask(taskId);
  const config = klingConfig();
  if (!config) throw new KlingUnconfigured();
  const d = ROUTES[config.routes];
  return d.readTask(await call(config, "GET", d.statusPath(taskId, input)));
}

/** The documented defaults: ask every five seconds, give up after ten minutes. */
export const POLL_EVERY_MS = 5_000;
export const POLL_TIMEOUT_MS = 10 * 60_000;
