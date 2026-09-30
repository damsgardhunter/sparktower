/**
 * Telling "cut off" apart from "gibberish".
 *
 * Both used to reach the builder as "Nova returned an unreadable audit", which
 * is true of each and useful about neither. An audit that overran its token
 * ceiling — the actual bug — said nothing about why, so nobody could tell it
 * from a model that had answered in prose.
 */
import { describe, it, expect } from "vitest";
import { looksTruncated, ModelResponseError, parseModelJson } from "../../server/ai-json";

describe("looksTruncated", () => {
  it("recognises an object that never closes", () => {
    expect(looksTruncated('{"stage":"mvp","capabilities":[{"area":"auth","status":"bui')).toBe(true);
  });

  it("recognises a truncated array, and one inside a fence", () => {
    expect(looksTruncated('[{"item":"a"},{"item":"b"')).toBe(true);
    expect(looksTruncated('```json\n{"a":{"b":1}')).toBe(true);
  });

  it("does not call complete JSON truncated", () => {
    expect(looksTruncated('{"stage":"mvp"}')).toBe(false);
    expect(looksTruncated('[{"a":1},{"b":2}]')).toBe(false);
  });

  /*
   * Malformed is not truncated. "{not json" also opens and never closes, and
   * it did not run out of room — nothing that stopped part-way gets there
   * without writing at least one field first.
   */
  it("does not call malformed JSON truncated", () => {
    expect(looksTruncated("{not json")).toBe(false);
    expect(looksTruncated("{")).toBe(false);
    expect(looksTruncated("[")).toBe(false);
  });

  /* Prose is a different failure with a different fix, and must not be confused for this one. */
  it("does not call prose truncated", () => {
    expect(looksTruncated("I had a look at your codebase and here is what I found.")).toBe(false);
    expect(looksTruncated("")).toBe(false);
    expect(looksTruncated(null)).toBe(false);
  });
});

describe("ModelResponseError", () => {
  it("says it was cut off when it was", () => {
    const err = new ModelResponseError("audit", '{"stage":"mvp","risks":[{"area":"Sec');
    expect(err.message).toMatch(/cut off/i);
    expect(err.message, "nobody should think they paid for it").toMatch(/nothing was charged/i);
  });

  it("keeps the plain wording for something that was never JSON", () => {
    const err = new ModelResponseError("audit", "Sure! Here is a summary of your project.");
    expect(err.message).toMatch(/unreadable/i);
    expect(err.message).not.toMatch(/cut off/i);
  });
});

describe("parseModelJson", () => {
  it("still reads what it always did", () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('Here you go:\n{"a":1}')).toEqual({ a: 1 });
  });

  it("throws the cut-off message on a truncated answer", () => {
    expect(() => parseModelJson('{"stage":"mvp","loops":[{"key":"L1","stages":[{"step":"open the', "audit"))
      .toThrow(/cut off/i);
  });
});
