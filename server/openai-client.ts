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

let client: OpenAI | null = null;

/** Builds it on first use, then hands back the same one. Throws here — in a request — rather than at import. */
export function getOpenAI(): OpenAI {
  /*
   * The fake one, when AI_STUB is on. Built here rather than at each call site
   * for the reason this whole module exists: there are sixty-three of them,
   * and one that forgot to check would send a real request — which, for a
   * switch whose entire purpose is "spend nothing", is the only failure that
   * matters. `aiStubbed` refuses in production on its own.
   */
  if (aiStubbed()) return stubClient();
  if (!client) client = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: baseUrl() });
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
