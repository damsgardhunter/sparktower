import { describe, it, expect } from "vitest";
import { parseModelJson, ModelResponseError } from "../../server/ai-json";

describe("parseModelJson", () => {
  it("reads fenced, prefixed and bare JSON, objects and arrays", () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('Here you go:\n{"a":{"b":[1,2]}}\nHope that helps.')).toEqual({ a: { b: [1, 2] } });
    expect(parseModelJson('[{"x":1},{"x":2}]')).toEqual([{ x: 1 }, { x: 2 }]);
    expect(parseModelJson(' {"ok":true} ')).toEqual({ ok: true });
  });
  it("throws a typed 502 on prose, empty, or broken JSON", () => {
    for (const bad of ["I'm sorry, I can't do that.", "", null, undefined, "{not json", "```\n\n```"]) {
      let err: any;
      try { parseModelJson(bad as any, "plan"); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(ModelResponseError);
      expect(err).toMatchObject({ status: 502, code: "model_unreadable" });
      expect(err.message).toMatch(/unreadable plan/);
    }
  });
});
