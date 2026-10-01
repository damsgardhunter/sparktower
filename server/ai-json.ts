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
    super(
      looksTruncated(raw)
        ? `Nova's ${what} was cut off part-way and couldn't be read. Nothing was charged — please try again.`
        : `Nova returned an unreadable ${what}. Please try again.`,
    );
    this.name = "ModelResponseError";
  }
}

/**
 * Whether the answer began as JSON and stopped part-way.
 *
 * Worth telling apart from prose, because the two have different causes and
 * different fixes: an answer that ran out of room needs a bigger ceiling,
 * while one that came back as a paragraph needs a clearer prompt. Both used to
 * read as "unreadable", which is true of each and useful about neither — an
 * audit that overran its token limit told its builder nothing about why.
 *
 * Deliberately shallow: it asks whether the text opens like JSON, got as far
 * as writing a field, and never closed — not whether the JSON is valid.
 * Anything cleverer would be a parser, and there is already one below.
 *
 * The field is what separates this from ordinary malformed JSON. "{not json"
 * also opens and never closes, and it did not run out of room — it was never
 * JSON. Something that stopped part-way has at least one `"key":` behind it.
 */
export function looksTruncated(raw: string | null | undefined): boolean {
  const text = String(raw ?? "").trim().replace(/^```(?:json)?\s*/i, "");
  if (!text.startsWith("{") && !text.startsWith("[")) return false;
  if (!/"\s*:/.test(text)) return false;
  const opens = (text.match(/[{[]/g) ?? []).length;
  const closes = (text.match(/[}\]]/g) ?? []).length;
  return opens > closes;
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

/**
 * The catch-all at the end of an AI route. An unreadable model answer — thrown
 * by the route or by a helper it called — is a 502 model_unreadable, so the
 * person is told to try again and the client can tell it apart; anything else
 * is the route's own 500 message. Charging is untouched: every AI route charges
 * only after its answer is read, so neither path is billed.
 */
export function respondToAiError(res: any, err: unknown, fallbackMessage: string) {
  if (err instanceof ModelResponseError) return answerUnreadable(res, err);
  if (res.headersSent) return;
  return res.status(500).json({ message: fallbackMessage });
}
