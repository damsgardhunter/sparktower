/**
 * The OpenAI client, built the first time something actually asks for it.
 *
 * Five modules used to construct one at import time. The openai library
 * validates its credentials in the constructor, so on a deployment without
 * `AI_INTEGRATIONS_OPENAI_API_KEY` the process died while loading its own
 * modules — before the boot preflight could say anything, before the health
 * endpoint existed, with a stack trace ending in `node_modules/openai`.
 *
 * Two things were wrong with that. The message named neither the variable this
 * product uses nor the deployment it belonged to, so the operator's first
 * assumption is a broken build. And the outage was total: the entire site,
 * every page and every account, refused to start because a *feature* had no
 * key. AI is a feature here. Nova not working is bad; nobody being able to
 * sign in because Nova isn't working is worse.
 *
 * A property access on the export below builds the real client, so every call
 * site keeps the shape it had (`openai.chat.completions.create(...)`), and a
 * module that imports this and never calls it costs nothing. The failure moves
 * to the request that needed AI, which is where it can be caught, charged
 * nothing, and reported to the person waiting.
 */
import OpenAI from "openai";
import { aiStubbed, stubCompletion } from "./ai-stub";

/** Replit's AI gateway wants a /v1 suffix; a direct OpenAI key wants no baseURL at all. */
function baseUrl(): string | undefined {
  const raw = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!raw) return undefined;
  return raw.endsWith("/v1") ? raw : `${raw.replace(/\/$/, "")}/v1`;
}

/**
 * The ceiling on any answer that did not ask for one.
 *
 * Almost every call in this codebase set no `max_completion_tokens`, which
 * means an answer is only as long as the model decides — and a model that
 * loops, or reads a pasted file back, is paid for by the token with nobody
 * reading the result. Set far above any honest answer here: the longest
 * things Nova writes are a document plan and a roadmap, and neither comes
 * near this. A call that genuinely needs more says so.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 8000;

let client: OpenAI | null = null;

/**
 * Builds it on first use, then hands back the same one. Throws here — in a
 * request — rather than at import.
 *
 * The client is wrapped so every completion gets a ceiling on its answer
 * whether or not the call site remembered one. Done here rather than at
 * thirty-odd call sites because the one that gets forgotten is the one that
 * runs away, and a default that has to be opted into is not a default.
 */
export function getOpenAI(): OpenAI {
  /*
   * The fake one, when AI_STUB is on. Built here rather than at each call site
   * for the reason this whole module exists: there are sixty-three of them,
   * and one that forgot to check would send a real request — which, for a
   * switch whose entire purpose is "spend nothing", is the only failure that
   * matters. `aiStubbed` refuses in production on its own.
   */
  if (aiStubbed()) return stubClient();
  // And the real one, capped: no call site can ask for an unbounded response.
  if (!client) client = capped(new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: baseUrl() }));
  return client;
}

let stub: OpenAI | null = null;

/**
 * An object shaped like the two surfaces this server calls — `chat.completions`
 * and `responses` — and nothing else. Anything reaching for a third throws by
 * name rather than returning undefined, so a feature the stub doesn't cover
 * says so instead of failing three frames later.
 */
function stubClient(): OpenAI {
  if (stub) return stub;
  const fake = {
    chat: {
      completions: {
        create: async (body: any) => {
          const system = String(body?.messages?.find((m: any) => m.role === "system")?.content ?? "");
          const user = String(body?.messages?.find((m: any) => m.role === "user")?.content ?? "");
          return {
            model: body?.model ?? "ai-stub",
            choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: stubCompletion(system, user) } }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          };
        },
      },
    },
    responses: {
      create: async (body: any) => ({
        model: body?.model ?? "ai-stub",
        status: "completed",
        output_text: stubCompletion(String(body?.instructions ?? ""), String(body?.input ?? "")),
      }),
    },
  };
  stub = new Proxy(fake as unknown as OpenAI, {
    get(target, property, receiver) {
      if (property in (target as object)) return Reflect.get(target as object, property, receiver);
      throw new Error(`[ai-stub] nothing stubs openai.${String(property)} yet — add it to server/ai-stub.ts or run without AI_STUB.`);
    },
  });
  return stub;
}

/**
 * The request as it will be sent: with a ceiling on the answer, if it did not
 * bring one. An explicit ceiling always wins, including one set higher, and
 * `max_tokens` counts as one — a request that names either is a request that
 * has thought about it.
 */
export function withDefaultCeiling<T>(body: T): T {
  if (!body || typeof body !== "object") return body;
  const asked = body as { max_completion_tokens?: unknown; max_tokens?: unknown };
  if (asked.max_completion_tokens !== undefined || asked.max_tokens !== undefined) return body;
  return { ...body, max_completion_tokens: DEFAULT_MAX_OUTPUT_TOKENS };
}

/**
 * Told what each answer actually cost, when anyone is listening.
 *
 * Registered rather than imported so this module keeps its one job — building
 * a client — and does not drag the database in behind it. `server/ai-spend.ts`
 * registers the real one; in a test, or before it loads, nothing happens.
 */
type UsageRecorder = (usage: {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
  model?: string | null;
}) => void;

let recorder: UsageRecorder | null = null;
export const setUsageRecorder = (fn: UsageRecorder | null): void => { recorder = fn; };

/**
 * The same client, with a default ceiling on the answer and a note of what it
 * cost. Exported so a test can apply it to a stand-in and exercise the real
 * wrapper rather than a description of it.
 */
export function capped(raw: OpenAI): OpenAI {
  const create = raw.chat.completions.create.bind(raw.chat.completions);
  (raw.chat.completions as any).create = async (body: any, options?: any) => {
    const result: any = await create(withDefaultCeiling(body), options);
    /*
     * Never in the way of the answer. A ledger that cannot be written is not a
     * reason for somebody's request to fail, so this swallows its own
     * failures and the caller never learns there was one.
     */
    try {
      if (recorder && result?.usage) recorder({ ...result.usage, model: result.model ?? body?.model });
    } catch { /* recorded on a best-effort basis, by design */ }
    return result;
  };
  return raw;
}

/**
 * A stand-in that behaves exactly like the client and isn't one until touched.
 *
 * Deliberately a Proxy rather than asking every call site to write
 * `getOpenAI().chat…`: the point is that importing this module can never be
 * what fails, and that property is easy to lose the next time somebody adds a
 * sixth module in a hurry.
 */
export const openai: OpenAI = new Proxy({} as OpenAI, {
  get(_target, property, receiver) {
    return Reflect.get(getOpenAI() as object, property, receiver);
  },
  has(_target, property) {
    return Reflect.has(getOpenAI() as object, property);
  },
});

/**
 * For tests, and for anything that wants to know before it promises a person
 * an answer. True under AI_STUB with no key at all: the routes that ask this
 * use it to decide whether to offer the feature, and a stubbed server should
 * offer all of them — that is the point of running one.
 */
export const openAiConfigured = (): boolean => aiStubbed() || !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim();
