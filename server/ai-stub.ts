/**
 * A fake model, for driving the product without paying for it.
 *
 * Turned on with `AI_STUB=1`, and only outside production. Every AI call in
 * this server goes through `server/openai-client.ts`, so switching it on there
 * means one variable makes the whole app — Nova's path work, the build, the
 * audits, the briefings — answer instantly and for nothing.
 *
 * ## Why it reads the prompt instead of holding canned answers
 *
 * Nearly every prompt in this codebase ends the same way: "Respond ONLY with
 * valid JSON of exactly this shape", followed by a literal JSON object whose
 * values describe what belongs in them. That line is a machine-readable
 * contract the routes already depend on, so the stub parses it and returns an
 * object of that exact shape, with each described value replaced by a short
 * stand-in.
 *
 * The alternative was a table of hand-written replies keyed by feature. That
 * rots: a route changes its shape, the table doesn't, and the stub starts
 * failing in a way that looks like a bug in the route. Deriving the answer
 * from the prompt means a route that changes its shape gets a matching stub
 * answer on the next run, with nobody remembering to update anything.
 *
 * What this is not: a test double for the *content* of model output. The text
 * it returns is obviously fake and says so, because a stub that produced
 * plausible business advice would eventually be mistaken for the real thing in
 * a screenshot. It exists so the flows around the model — money, progress,
 * persistence, notifications — can be exercised end to end.
 */

/** On only when asked for, and never in production, whatever the variable says. */
export function aiStubbed(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.AI_STUB === "1" || process.env.AI_STUB === "true";
}

/** Said once, loudly, at boot — a silent fake model is a debugging afternoon. */
export function warnIfStubbed(): void {
  if (!aiStubbed()) return;
  console.warn("\n[ai-stub] AI_STUB is on: no request will reach OpenAI and every Nova answer is fake. Development only.\n");
}

const STUB_SENTENCE = "Stubbed by AI_STUB — no model was called.";

/**
 * The JSON shape a prompt asked for, if it asked in the house style.
 *
 * Looks for the first line that starts with `{` or `[` after the instruction,
 * which is how every prompt here writes it. Returns null when the prompt wants
 * prose, so the caller can answer with a sentence instead.
 */
function askedShape(system: string): unknown | null {
  const lines = system.split("\n");
  const asked = lines.findIndex((l) => /respond only with|return only|valid json of exactly this shape/i.test(l));
  if (asked === -1) return null;
  for (const line of lines.slice(asked)) {
    const text = line.trim();
    if (!text.startsWith("{") && !text.startsWith("[")) continue;
    try { return JSON.parse(text); } catch { /* the next line, or none */ }
  }
  return null;
}

/**
 * A value of the same shape, with every described string replaced.
 *
 * The prompt's own value is the description of what goes there ("one line on
 * why"), so it is kept as a prefix: a stubbed answer that still says which
 * field it is makes a stubbed screen readable. Enum-ish descriptions written
 * as "a | b | c" take the first, since routes validate those.
 */
function fill(node: unknown, key = ""): unknown {
  if (Array.isArray(node)) {
    // Three of whatever was asked for: the options-style prompts want three,
    // and every route that wants fewer slices the array itself.
    const sample = node.length ? node[0] : "";
    return [0, 1, 2].map((i) => fill(sample, `${key}${i + 1}`));
  }
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, fill(v, k)]));
  }
  if (typeof node === "number") return 0;
  if (typeof node === "boolean") return false;

  const described = String(node ?? "").trim();
  // "terminal | browser | manual" — a choice, not a description of one.
  if (/^[\w-]+( \| [\w-]+)+$/.test(described)) return described.split("|")[0].trim();
  /*
   * `kind` is how the work routes tell an options packet from a build packet,
   * and it is the one field whose literal value in the shape is the answer
   * rather than a description of one.
   */
  if (key === "kind" && described && !described.includes(" ")) return described;
  const label = key ? `[${key}] ` : "";
  return `${label}${STUB_SENTENCE}${described ? ` (asked for: ${described.slice(0, 120)})` : ""}`;
}

/** What the model would have said, had it been asked. */
export function stubCompletion(system: string, user: string): string {
  const shape = askedShape(system);
  if (shape === null) {
    const subject = /MILESTONE:|STEP:|PROJECT STATE/.test(user) ? " for this step" : "";
    return `${STUB_SENTENCE} There is no real answer${subject} because AI_STUB is on.`;
  }
  return JSON.stringify(fill(shape));
}
