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

/** Replit's AI gateway wants a /v1 suffix; a direct OpenAI key wants no baseURL at all. */
function baseUrl(): string | undefined {
  const raw = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!raw) return undefined;
  return raw.endsWith("/v1") ? raw : `${raw.replace(/\/$/, "")}/v1`;
}

let client: OpenAI | null = null;

/** Builds it on first use, then hands back the same one. Throws here — in a request — rather than at import. */
export function getOpenAI(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: baseUrl() });
  return client;
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

/** For tests, and for anything that wants to know before it promises a person an answer. */
export const openAiConfigured = (): boolean => !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim();
