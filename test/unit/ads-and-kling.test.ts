/**
 * Generated advertisements, before there is an API key.
 *
 * Everything testable without one, which is most of it: the beat maths, the
 * cost model, the two wire dialects, and the two guarantees that matter before
 * any money is spent — that an unconfigured server says so instead of
 * throwing, and that `AI_STUB` means no request leaves the machine.
 *
 * What is *not* tested here is whether the field names are right. They come
 * from documentation that disagrees with itself, they live in one object for
 * that reason, and only a real key settles it. A test that asserted them would
 * be asserting the guess.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  AD_BEATS, AD_COMPLIANCE_CHECKS, AD_DURATIONS, AD_FORMATS, AD_COST,
  beatPlan, expectedCostCents, adFormat, isAdDuration, isTerminalRenderStatus,
} from "@shared/ads";
import { klingConfig, klingConfigured, klingAuthHeader, klingSubmit, klingStatus, KlingUnconfigured, defaultModel, KLING_CLIP_SECONDS } from "../../server/kling-client";

const KEYS = ["KLINGAI_API_KEY", "KLING_API_KEY", "KLING_ACCESS_KEY", "KLING_SECRET_KEY", "KLING_BASE_URL", "KLING_AUTH", "KLING_ROUTES", "KLING_MODEL", "AI_STUB"] as const;
const saved = new Map(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    const was = saved.get(k);
    if (was === undefined) delete process.env[k];
    else process.env[k] = was;
  }
});
const only = (env: Partial<Record<(typeof KEYS)[number], string>>) => {
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
};

describe("the shapes an ad comes in", () => {
  it("covers the three the networks actually sell", () => {
    expect(AD_FORMATS.map((f) => f.ratio)).toEqual(["9:16", "1:1", "16:9"]);
    /* Every one needs real pixel dimensions: a ratio alone cannot render. */
    for (const f of AD_FORMATS) {
      expect(f.width / f.height, f.id).toBeCloseTo(Number(f.ratio.split(":")[0]) / Number(f.ratio.split(":")[1]), 2);
    }
  });

  it("answers for an unknown format rather than throwing in a render", () => {
    expect(adFormat("widescreen-ish")).toBeNull();
    expect(adFormat("vertical")?.width).toBe(1080);
  });

  it("takes only the three lengths", () => {
    expect(AD_DURATIONS).toEqual([6, 15, 30]);
    for (const good of AD_DURATIONS) expect(isAdDuration(good)).toBe(true);
    for (const bad of [0, 7, 45, -6, "15", null]) expect(isAdDuration(bad), String(bad)).toBe(false);
  });
});

describe("the beats of a cut", () => {
  for (const duration of AD_DURATIONS) {
    it(`fills exactly ${duration} seconds`, () => {
      /*
       * The sum is the whole point: beats that add to one second less than the
       * runtime are a second of black at the end of somebody's advert.
       */
      const plan = beatPlan(duration);
      expect(plan.reduce((sum, b) => sum + b.seconds, 0)).toBe(duration);
      for (const b of plan) expect(b.seconds, `${b.id} in a ${duration}s cut`).toBeGreaterThanOrEqual(1);
    });
  }

  it("drops problem and proof from a six-second cut", () => {
    /*
     * Five beats in six seconds is five things nobody takes in. The short cut
     * keeps the hook, the product and the ask.
     */
    expect(beatPlan(6).map((b) => b.id)).toEqual(["hook", "product", "cta"]);
  });

  it("carries all five at thirty", () => {
    expect(beatPlan(30).map((b) => b.id)).toEqual(AD_BEATS.map((b) => b.id));
  });

  it("gives the hook most of a six-second cut and little of a thirty", () => {
    const share = (d: 6 | 30) => {
      const plan = beatPlan(d);
      return plan.find((b) => b.id === "hook")!.seconds / d;
    };
    expect(share(6)).toBeGreaterThan(0.4);
    expect(share(30)).toBeLessThan(0.2);
  });

  it("always leads with the hook and ends on the ask", () => {
    for (const d of AD_DURATIONS) {
      const ids = beatPlan(d).map((b) => b.id);
      expect(ids[0], `${d}s`).toBe("hook");
      expect(ids[ids.length - 1], `${d}s`).toBe("cta");
    }
  });
});

describe("what a finished ad costs us", () => {
  it("counts the attempts, not just the seconds", () => {
    /*
     * The commercial number is the cost of a usable ad, and a usable ad takes
     * several goes. Costing one clip is how a heavy user becomes unprofitable
     * without anybody noticing.
     */
    const oneClip = 15 * AD_COST.centsPerSecond;
    expect(expectedCostCents(15)).toBeGreaterThan(oneClip * 2);
    expect(AD_COST.attemptsPerFinished).toBeGreaterThanOrEqual(2);
  });

  it("charges the model once however many formats are cut", () => {
    /*
     * Formats are re-cuts of the same footage. If this ever scaled with the
     * format count, generating once and composing per format — the whole
     * reason the pipeline is shaped this way — would have been abandoned.
     */
    const one = expectedCostCents(15, 1);
    const three = expectedCostCents(15, 3);
    expect(three - one).toBe(AD_COST.renderOverheadCents * 2);
  });

  it("grows with length, because the model bills by the second", () => {
    expect(expectedCostCents(6)).toBeLessThan(expectedCostCents(15));
    expect(expectedCostCents(15)).toBeLessThan(expectedCostCents(30));
  });
});

describe("what has to be true before publishing", () => {
  it("names the four that are rules rather than taste", () => {
    const ids = AD_COMPLIANCE_CHECKS.map((c) => c.id);
    expect(ids).toContain("ai_disclosure");
    expect(ids).toContain("licensed_audio");
    expect(ids).toContain("no_real_likeness");
    expect(ids).toContain("claims_supported");
  });

  it("says why each one exists, not just what it is", () => {
    /* A checklist nobody understands is a checklist somebody ticks. */
    for (const c of AD_COMPLIANCE_CHECKS) expect(c.why.length, c.id).toBeGreaterThan(40);
  });
});

describe("the provider, unconfigured", () => {
  it("reports itself off instead of throwing at import", () => {
    only({});
    expect(klingConfig()).toBeNull();
    expect(klingConfigured()).toBe(false);
  });

  it("refuses a render with a sentence naming both ways to configure it", async () => {
    only({});
    await expect(klingSubmit({ prompt: "x", durationSeconds: 6, aspectRatio: "9:16" }))
      .rejects.toThrow(KlingUnconfigured);
    await expect(klingSubmit({ prompt: "x", durationSeconds: 6, aspectRatio: "9:16" }))
      .rejects.toThrow(/KLINGAI_API_KEY.*KLING_ACCESS_KEY.*KLING_SECRET_KEY/s);
  });

  it("treats an access key with no secret as unconfigured", () => {
    /* It looks configured and cannot sign a single request. */
    only({ KLING_ACCESS_KEY: "ak_only" });
    expect(klingConfig()).toBeNull();
    only({ KLING_SECRET_KEY: "sk_only" });
    expect(klingConfig()).toBeNull();
  });
});

describe("auth and routes, which are separate questions", () => {
  it("reads the name the key is actually set under, and the older one too", () => {
    /* `KLINGAI_API_KEY` is what it was set as; ignoring a key somebody has set is worse than accepting two names. */
    only({ KLINGAI_API_KEY: "new_name" });
    expect(klingConfig()).toMatchObject({ auth: "bearer", apiKey: "new_name" });
    only({ KLING_API_KEY: "old_name" });
    expect(klingConfig()).toMatchObject({ auth: "bearer", apiKey: "old_name" });
  });

  it("defaults to what was actually probed: a static key on the v1 routes", () => {
    /*
     * The combination this account turned out to be on, and the one neither
     * documentation source describes. Pinned here because getting it wrong
     * looks like a rejected key rather than a wrong path.
     */
    only({ KLINGAI_API_KEY: "key_123" });
    expect(klingConfig()).toMatchObject({ auth: "bearer", routes: "v1", apiKey: "key_123" });
  });

  it("an access/secret pair implies the signed-JWT auth", () => {
    only({ KLING_ACCESS_KEY: "ak", KLING_SECRET_KEY: "sk" });
    expect(klingConfig()).toMatchObject({ auth: "jwt", accessKey: "ak", secretKey: "sk" });
  });

  it("lets either axis be forced, for an account on the other combination", () => {
    /* The point of splitting them: a different account needs an env var, not a patch. */
    only({ KLINGAI_API_KEY: "k", KLING_ROUTES: "perModel" });
    expect(klingConfig()).toMatchObject({ auth: "bearer", routes: "perModel" });
    only({ KLING_ACCESS_KEY: "ak", KLING_SECRET_KEY: "sk", KLING_AUTH: "bearer" });
    expect(klingConfig()?.auth).toBe("bearer");
  });

  it("prefers the API key when both kinds are present", () => {
    only({ KLINGAI_API_KEY: "key_123", KLING_ACCESS_KEY: "ak", KLING_SECRET_KEY: "sk" });
    expect(klingConfig()?.apiKey).toBe("key_123");
  });

  it("takes a host override, because the right one depends on the account", () => {
    only({ KLINGAI_API_KEY: "k", KLING_BASE_URL: "https://api.klingai.com/" });
    /* Trailing slash removed, or every path has a double one in it. */
    expect(klingConfig()?.baseUrl).toBe("https://api.klingai.com");
  });
});

describe("the Authorization header", () => {
  it("sends a static bearer token on bearer auth", async () => {
    const header = await klingAuthHeader({ auth: "bearer", routes: "v1", baseUrl: "x", apiKey: "key_123" });
    expect(header).toBe("Bearer key_123");
  });

  it("signs a short-lived HS256 token on jwt auth", async () => {
    const header = await klingAuthHeader({ auth: "jwt", routes: "v1", baseUrl: "x", accessKey: "my-ak", secretKey: "my-sk-long-enough" });
    expect(header).toMatch(/^Bearer ey/);
    const [head, payload] = header.slice("Bearer ".length).split(".");
    const decode = (p: string) => JSON.parse(Buffer.from(p, "base64url").toString());
    expect(decode(head)).toMatchObject({ alg: "HS256", typ: "JWT" });
    const claims = decode(payload);
    /* The access key is the issuer — that is how the provider knows whose secret to check it with. */
    expect(claims.iss).toBe("my-ak");
    /* Inside the documented thirty minutes, and not so tight that a slow render outlives it. */
    expect(claims.exp - claims.iat).toBeGreaterThan(10 * 60);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(30 * 60);
    /* Tolerant of a clock a few seconds out, which is ordinary. */
    expect(claims.nbf).toBeLessThanOrEqual(claims.iat);
  });

  it("never puts the secret key in the header", async () => {
    const header = await klingAuthHeader({ auth: "jwt", routes: "v1", baseUrl: "x", accessKey: "ak", secretKey: "super-secret-value" });
    expect(header).not.toContain("super-secret-value");
  });
});

describe("AI_STUB means nothing leaves the machine", () => {
  it("submits and polls without a key and without a request", async () => {
    /*
     * The standing rule on this project is that development never spends real
     * money. Video is the most expensive thing here per call, so the stub is
     * checked rather than assumed — and it has to work with no credentials at
     * all, because that is the state somebody develops in.
     */
    only({ AI_STUB: "1" });
    const input = { prompt: "a jar of sauce on a kitchen table", durationSeconds: 6, aspectRatio: "9:16" };
    const submitted = await klingSubmit(input);
    expect(submitted.status).toBe("succeeded");
    const polled = await klingStatus(submitted.taskId, input);
    expect(polled.taskId).toBe(submitted.taskId);
  });

  it("hands back a URL nothing can accidentally download", async () => {
    /*
     * A plausible-looking http URL would be fetched by the next stage and
     * produce an empty ad rather than an error. `stub://` fails loudly.
     */
    only({ AI_STUB: "1" });
    const task = await klingSubmit({ prompt: "x", durationSeconds: 6, aspectRatio: "1:1" });
    expect(task.videoUrl).toMatch(/^stub:\/\//);
  });

  it("stubs even when a key is present, so a key on a laptop costs nothing", async () => {
    only({ AI_STUB: "1", KLINGAI_API_KEY: "a-real-looking-key" });
    await expect(klingSubmit({ prompt: "x", durationSeconds: 6, aspectRatio: "1:1" })).resolves.toMatchObject({ status: "succeeded" });
  });
});

describe("render statuses", () => {
  it("knows which ones are the end", () => {
    expect(isTerminalRenderStatus("ready")).toBe(true);
    expect(isTerminalRenderStatus("failed")).toBe(true);
    for (const s of ["queued", "generating", "composing"] as const) expect(isTerminalRenderStatus(s)).toBe(false);
  });
});

/**
 * The model name, which is the thing most likely to break this integration.
 *
 * Five of the six names published in the documentation and in community
 * wrappers were already discontinued on a key issued the same week —
 * `kling-v1`, `kling-v1-6`, `kling-v2-master` and `kling-v2-1-master` answer
 * 1203, `kling-v2-1` answers 1201. Only `kling-v2-5-turbo` was accepted, and
 * the failure is a 404 that reads like a broken integration rather than a
 * retired model.
 */
describe("the model name", () => {
  it("defaults to the one that was actually accepted", () => {
    only({});
    expect(defaultModel()).toBe("kling-v2-5-turbo");
  });

  it("can be changed without a deploy, because the list moves", () => {
    only({ KLING_MODEL: "kling-v9-whatever" });
    expect(defaultModel()).toBe("kling-v9-whatever");
  });

  it("ignores an empty override rather than asking for a model called nothing", () => {
    only({ KLING_MODEL: "   " });
    expect(defaultModel()).toBe("kling-v2-5-turbo");
  });
});

describe("clip lengths are not ad lengths", () => {
  it("offers only what the model takes", () => {
    /*
     * The model's own durations, as strings "5" and "10" on the wire. A
     * thirty-second ad is composed from several of these; nothing ever asks
     * the model for thirty seconds.
     */
    expect(KLING_CLIP_SECONDS).toEqual([5, 10]);
  });

  it("and the ad lengths are none of them", () => {
    /* Which is the point: if these ever coincided, somebody would start
     * passing an ad duration straight to the provider. */
    for (const d of AD_DURATIONS) {
      expect(KLING_CLIP_SECONDS as readonly number[], `${d}s is an ad length, not a clip length`).not.toContain(d);
    }
  });
});
