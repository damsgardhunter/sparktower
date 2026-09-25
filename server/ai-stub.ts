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
/**
 * The first balanced JSON value in a string, ignoring braces inside quotes.
 *
 * A shape is not always alone on its line. "Return ONLY valid JSON (no
 * markdown): {"reasons": …}. Each user gets 2-3 short reasons." carries its
 * shape mid-sentence with prose either side, and `JSON.parse` on the rest of
 * the line fails on the full stop. Scanning to the matching brace is what
 * separates the shape from the sentence around it.
 */
function firstJson(text: string): string | null {
  const open = text.search(/[{[]/);
  if (open === -1) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (escaped) { escaped = false; continue; }
    if (c === "\\") { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{" || c === "[") depth += 1;
    else if (c === "}" || c === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

function askedShape(system: string): unknown | null {
  const lines = system.split("\n");
  const asked = lines.findIndex((l) => /respond only with|return only|valid json of exactly this shape/i.test(l));
  if (asked === -1) return null;

  for (let i = asked; i < lines.length; i++) {
    if (!/[{[]/.test(lines[i])) continue;
    /*
     * Shapes are usually one line and sometimes several — the ten-year
     * valuation writes its five scores, its three numbers and its notes across
     * three lines for readability, and a single-line reader found nothing,
     * answered with a generic object, and left the route to report the model
     * as unreadable. So: keep adding lines until it parses, and give up at the
     * point a shape could not plausibly still be open.
     *
     * The balanced scan first, for the shapes that sit inside a sentence
     * rather than on a line of their own — the match reasons on Discover are
     * written that way, and every Nova-assisted browser test logged "Nova
     * returned an unreadable match reasons" because of it.
     */
    let text = "";
    for (let j = i; j < Math.min(lines.length, i + 40); j++) {
      text += (j === i ? "" : "\n") + lines[j];
      const found = firstJson(text);
      if (found) { try { return JSON.parse(found); } catch { /* not closed yet */ } }
      try { return JSON.parse(text); } catch { /* not closed yet */ }
    }
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

/**
 * Shapes the prompt declares but does not describe.
 *
 * The rule above — answer in the shape the prompt asked for — needs the shape
 * to carry its structure, and almost all of them do. The decision simulator's
 * does not: it asks for `{"levers":[]}` and describes what a lever is in prose
 * above, because the real model has read that prose. A stub filling `[]` with
 * strings produces no usable lever, the route correctly answers "that isn't
 * something the numbers can settle", and the entire decision simulator is
 * unreachable on a stubbed server — the one part of the product whose output
 * is arithmetic rather than prose, and so the one most worth driving without
 * paying for a model.
 *
 * So: a small, named exception. Each entry says how to recognise the prompt
 * and what minimum structure to put in. Kept deliberately short — if this
 * grows past a handful, the prompts have a shape problem worth fixing at
 * source rather than papering over here.
 */
const STRUCTURED: { when: RegExp; key: string; value: unknown }[] = [
  {
    /*
     * A scored judgement — the marketing scheme's five dimensions, and
     * anything else that asks for a `scores` object. Every number filled with
     * zero (the honest default for "no model was called") put every scheme
     * below the bar for testing, so the half of that feature which runs the
     * scheme through the simulator could not be reached on a stubbed server at
     * all. A mid-range score makes it drivable; the words beside it still say
     * on every line that nothing was asked.
     */
    when: /score each dimension|"scores"/i,
    key: "scores",
    value: null,  // filled per-key below, from the shape's own dimensions
  },
  {
    // shared/simulation/decision-sim.ts — LEVER_KINDS and the shape at leverPrompt.
    when: /levers/i,
    key: "levers",
    value: [{
      kind: "spend",
      label: `${STUB_SENTENCE} A stand-in lever so the arithmetic has something to run on.`,
      startMonth: 1,
      monthly: 1000,
      months: 6,
      monthlyRevenueAtPeak: 2000,
      rampMonths: 2,
    }],
  },
];

/** What the model would have said, had it been asked. */
export function stubCompletion(system: string, user: string): string {
  const shape = askedShape(system);
  if (shape === null) {
    const subject = /MILESTONE:|STEP:|PROJECT STATE/.test(user) ? " for this step" : "";
    return `${STUB_SENTENCE} There is no real answer${subject} because AI_STUB is on.`;
  }
  const filled = fill(shape) as Record<string, unknown>;
  if (filled && typeof filled === "object" && !Array.isArray(filled)) {
    for (const { when, key, value } of STRUCTURED) {
      if (!(key in filled) || !when.test(system)) continue;
      if (value === null) {
        /*
         * A shape that named its own members — keep them, and give each a
         * middle number rather than the zero every numeric field gets.
         */
        const asked = (shape as any)[key];
        if (asked && typeof asked === "object" && !Array.isArray(asked)) {
          filled[key] = Object.fromEntries(Object.keys(asked).map((k) => [k, 60]));
        }
        continue;
      }
      // Only where the prompt asked for that key and left it empty to describe in prose.
      if (Array.isArray((shape as any)[key]) && !(shape as any)[key].length) filled[key] = value;
    }
    // A "cannot do this" field must be empty, or the route reads the stub as a refusal.
    for (const k of ["cannotSimulate"]) if (k in filled) filled[k] = "";
  }
  return JSON.stringify(filled);
}
