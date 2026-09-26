/**
 * Pressing redraw has to give a different picture.
 *
 * Everything the prompt is built from — the logo, the brief, the slot's
 * subject — is fixed by the project, so a second press sent an identical
 * prompt and got an almost identical image back. Nothing was broken in the
 * sense of throwing; the feature simply didn't do what its button said, which
 * is the kind of bug that never shows up in a test suite unless somebody
 * writes this one.
 */
import { describe, it, expect } from "vitest";
import { VISUAL_TAKES, takeFor, PROJECT_VISUAL_SLOTS } from "@shared/project-visuals";
import { visualPrompt } from "../../server/project-visuals";

const project = {
  id: "p1", title: "Corner Café", category: "restaurant", ownerId: "u1",
  oneLiner: "Breakfast worth the walk", valueProposition: "The best coffee on the street",
} as any;
const slot = PROJECT_VISUAL_SLOTS[0];

describe("redrawing a project image", () => {
  it("asks for a different picture each time, for several presses running", () => {
    const prompts = Array.from({ length: VISUAL_TAKES.length }, (_, i) => visualPrompt(project, slot, false, i));
    expect(new Set(prompts).size, "two presses in a row produced the same prompt").toBe(prompts.length);
  });

  it("keeps the subject and the brand fixed — only the take moves", () => {
    const first = visualPrompt(project, slot, false, 0);
    const second = visualPrompt(project, slot, false, 1);
    for (const fixed of [slot.subject, "Corner Café", "the project's logo", "No text, lettering"]) {
      expect(first).toContain(fixed);
      expect(second, `"${fixed}" should not change between takes`).toContain(fixed);
    }
    // …and the second says outright that it is a second attempt.
    expect(first).not.toMatch(/attempt \d/);
    expect(second).toMatch(/attempt 2/);
  });

  it("cycles rather than running out, and never repeats back to back", () => {
    for (let i = 0; i < VISUAL_TAKES.length * 3; i++) {
      expect(takeFor(i)).not.toBe(takeFor(i + 1));
    }
    expect(takeFor(VISUAL_TAKES.length)).toBe(takeFor(0));
    // Negative or nonsense counts still land on a real take rather than undefined.
    expect(VISUAL_TAKES).toContain(takeFor(-1));
  });

  it("offers takes that are actually different photographs, not reworded ones", () => {
    expect(VISUAL_TAKES.length).toBeGreaterThanOrEqual(4);
    expect(new Set(VISUAL_TAKES).size).toBe(VISUAL_TAKES.length);
  });
});
