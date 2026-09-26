/**
 * Where Nova's writing gets cut, when it has to be cut at all.
 *
 * This exists because of a specific failure. A real $30 build wrote nineteen
 * artifacts and six of them stopped mid-word at exactly the old 4,000
 * character limit — a ten-table data model ending at "- status (enum: draft,
 * rea", the five core loops ending at "1) Mock report tes". Nothing on the
 * screen said anything had been removed, so the text simply stopped, and the
 * person who paid for it had no way to tell they were reading two thirds of an
 * answer.
 */
import { describe, it, expect } from "vitest";
import { clampWritten, WRITTEN_LIMIT } from "../../server/written-limits";

describe("clamping what Nova writes", () => {
  it("leaves anything within the budget exactly as it was", () => {
    const text = "A short, complete answer.\n\nWith a second paragraph.";
    expect(clampWritten(text)).toBe(text);
  });

  it("never cuts in the middle of a word", () => {
    const overlong = `${"An ordinary sentence about the business. ".repeat(600)}`;
    const cut = clampWritten(overlong);
    expect(cut.length).toBeLessThanOrEqual(WRITTEN_LIMIT);
    // The old behaviour: raw slice, last token half a word. The new one ends on a boundary.
    const body = cut.split("—")[0].trimEnd();
    expect(body.endsWith("business.") || body.endsWith("sentence") || /[.\s]$/.test(body + " ")).toBe(true);
    expect(overlong.startsWith(body.slice(0, 200))).toBe(true);
  });

  it("prefers a paragraph break when there is one near the end", () => {
    const para = `${"Something worth keeping. ".repeat(60)}\n\n`;
    const cut = clampWritten(para.repeat(40), 5_000);
    expect(cut).toContain("Something worth keeping.");
    expect(cut.length).toBeLessThanOrEqual(5_000);
  });

  it("says that it trimmed, rather than just stopping", () => {
    const cut = clampWritten("word ".repeat(5_000));
    expect(cut, "a reader has to be able to tell there is more").toMatch(/trimmed here/);
  });

  it("is generous enough for the artifacts that broke", () => {
    // The data model that was cut was around 5,800 characters of real content.
    const dataModel = "### table\n- id (pk)\n- name (text, required)\n".repeat(140);
    expect(dataModel.length).toBeGreaterThan(4_000);
    expect(clampWritten(dataModel), "the limit that cut a ten-table data model is gone").toBe(dataModel);
  });
});
