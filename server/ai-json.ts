/**
 * Reading structured output from a model, one way everywhere.
 *
 * Models wrap JSON in fences, add a sentence before it, or return prose
 * when they lose the thread. Every route used to handle that on its own,
 * and most handled only some of it. This is the one parser: strip fences,
 * find the outermost object or array, parse. When there is nothing to
 * parse it throws a typed error that answers 502 with a machine code —
 * and, because the throw happens before any credit is deducted in every
 * route that uses it, an unreadable response is never a charged one.
 */
export class ModelResponseError extends Error {
  status = 502;
  code = "model_unreadable";
  constructor(what: string, public raw?: string) {
    super(`Nova returned an unreadable ${what}. Please try again.`);
    this.name = "ModelResponseError";
  }
}

export function parseModelJson<T = any>(raw: string | null | undefined, what = "response"): T {
  const text = String(raw ?? "").trim();
  if (!text) throw new ModelResponseError(what, text);
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const candidates = [unfenced];
  const obj = unfenced.match(/\{[\s\S]*\}/); if (obj) candidates.push(obj[0]);
  const arr = unfenced.match(/\[[\s\S]*\]/); if (arr) candidates.push(arr[0]);
  for (const c of candidates) {
    try { return JSON.parse(c) as T; } catch { /* next */ }
  }
  throw new ModelResponseError(what, text.slice(0, 400));
}

/** The 502 for a route that caught the error itself. Same shape as the global handler's. */
export function answerUnreadable(res: any, err: unknown, what = "response") {
  const e = err instanceof ModelResponseError ? err : new ModelResponseError(what);
  console.error(`[ai] unreadable ${what}:`, e.raw?.slice(0, 200) ?? "(empty)");
  return res.status(502).json({ message: e.message, code: e.code });
}
