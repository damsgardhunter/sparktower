/**
 * The stub has to answer in the shape the prompt asked for.
 *
 * `AI_STUB=1` exists so a flow can be driven end to end without a model, and
 * it only works if the route on the other side can read the answer. When it
 * cannot, the route reports the model as unreadable and falls back to
 * defaults — quietly, so the test that depended on the real path still runs
 * and fails somewhere else entirely.
 *
 * That is what happened to Discover's match reasons. Their prompt writes the
 * shape inside a sentence — "Return ONLY valid JSON (no markdown): {…}. Each
 * user gets 2-3 short reasons." — and the reader only accepted a shape that
 * began a line, so every Nova-assisted browser test logged "Nova returned an
 * unreadable match reasons".
 */
import { describe, expect, it } from "vitest";
import { stubCompletion } from "../../server/ai-stub";

const parse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };

describe("the AI stub's answers", () => {
  it("reads a shape written inside a sentence", () => {
    const system = 'Generate concise match reasons. Return ONLY valid JSON (no markdown): {"reasons": {"userId": ["reason1", "reason2"]}}. Each user gets 2-3 short reasons.';
    const out = parse(stubCompletion(system, "some users"));
    expect(out, "the stub answered with prose where JSON was asked for").not.toBeNull();
    expect(out).toHaveProperty("reasons");
    expect(typeof out.reasons).toBe("object");
  });

  it("still reads a shape that sits on its own line", () => {
    const system = 'Respond only with JSON.\n{"verdict": "", "score": 0}';
    const out = parse(stubCompletion(system, "x"));
    expect(out).not.toBeNull();
    expect(out).toHaveProperty("verdict");
    expect(out).toHaveProperty("score");
  });

  it("still reads a shape spread over several lines", () => {
    const system = 'Return only valid JSON of exactly this shape:\n{\n  "a": 0,\n  "b": ""\n}';
    const out = parse(stubCompletion(system, "x"));
    expect(out).not.toBeNull();
    expect(out).toHaveProperty("a");
    expect(out).toHaveProperty("b");
  });

  /* A prompt that asks for prose must still get prose, not an empty object. */
  it("answers in words when no shape was asked for", () => {
    const out = stubCompletion("Write a short encouraging note.", "MILESTONE: ship it");
    expect(parse(out), "prose was answered with JSON").toBeNull();
    expect(out).toMatch(/AI_STUB/);
  });

  /* Braces inside strings must not close the shape early. */
  it("is not fooled by a brace inside a quoted example", () => {
    const system = 'Return only valid JSON: {"note": "use {braces} freely", "n": 0}. Nothing else.';
    const out = parse(stubCompletion(system, "x"));
    expect(out).not.toBeNull();
    expect(out).toHaveProperty("note");
    expect(out).toHaveProperty("n");
  });
});
