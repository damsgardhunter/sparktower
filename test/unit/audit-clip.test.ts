/**
 * A file too long to send whole, cut around the question being asked.
 *
 * The audit reported moderation as built with a gap: it could not confirm the
 * undo handler, "because the implementation is truncated in provided FILES".
 * That was true and it was the read's own fault — `server/moderation.ts` is
 * 85kB, the close read sends the first 60kB, and the undo route starts at
 * character 72,603. The read was handed the first 70% of the file and asked
 * about something in the last 15%.
 *
 * Taking the head is right for a file whose shape is at the top. It is wrong
 * for a long routes file, where the answer is wherever the route happens to
 * sit — so the head is kept and the rest of the budget goes to the parts that
 * mention what the area was asked about.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

vi.mock("openai", () => ({ default: class { chat = { completions: { create: async () => ({}) } }; } }));
vi.mock("../../server/db", () => ({ db: {}, pool: {} }));

import { clipToQuestion, AREA_QUESTIONS } from "../../server/audit-deep-reads";

const moderation = readFileSync(join(import.meta.dirname, "../../server/moderation.ts"), "utf8");

describe("clipping a long file to the question", () => {
  it("keeps a file that fits exactly as it is", () => {
    const short = "line one\nline two\n";
    expect(clipToQuestion(short, 60_000, AREA_QUESTIONS.moderation)).toBe(short);
  });

  it("keeps the handler the area is asked about, which the head alone lost", () => {
    const budget = 60_000;
    expect(moderation.length, "the file this exists for is still long enough to need it").toBeGreaterThan(budget);
    expect(moderation.slice(0, budget), "and the head alone still misses the undo route")
      .not.toContain("/api/admin/moderation-log/:id/undo");

    const clipped = clipToQuestion(moderation, budget, AREA_QUESTIONS.moderation);
    expect(clipped).toContain("/api/admin/moderation-log/:id/undo");
    // And enough of it to answer what the question asks: does the undo put the report back?
    expect(clipped, "the part that reopens the report").toContain("reviewedById: null");
  });

  it("keeps the top of the file, where a module says what it is", () => {
    const clipped = clipToQuestion(moderation, 60_000, AREA_QUESTIONS.moderation);
    expect(clipped.slice(0, 400)).toBe(moderation.slice(0, 400));
  });

  it("stays inside the budget and says where it cut", () => {
    const budget = 30_000;
    const clipped = clipToQuestion(moderation, budget, AREA_QUESTIONS.moderation);
    expect(clipped.length).toBeLessThanOrEqual(budget + 400);
    expect(clipped, "a gap is marked, so nothing reads as code that runs on from what precedes it").toMatch(/… \(\d+ lines not shown\)/);
  });

  it("does not chase words that mean nothing about where code lives", () => {
    /*
     * "Name each step's file" — a cut that went looking for "each" and "name"
     * would return the file's English rather than its routes.
     */
    const clipped = clipToQuestion(moderation, 30_000, AREA_QUESTIONS.moderation);
    expect(clipped).toMatch(/app\.(post|get|patch)\(/);
  });
});
