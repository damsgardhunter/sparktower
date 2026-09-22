/**
 * One answer to "what should I do next", said the same way everywhere.
 *
 * The phone builds from its own tsconfig and can't import `@shared`, so it
 * restates the next-step contract by hand — and the restatement had already
 * drifted: it had lost `projectedAt`, and its sentence for a finished path was
 * a different sentence from the web's ("The main line is done — pick what's
 * next on the project." against "Main line done — pick what's next."). Two
 * screens disagreeing about the product's central question is not a typo.
 *
 * This reads the phone's source and the shared module and fails when they part
 * company.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { ACTOR_SHORT, NEXT_STEP_COPY } from "@shared/next-step";
import { ACTOR_LABEL } from "@shared/phase-trees/types";

const root = join(__dirname, "..", "..");
const mobileCard = readFileSync(join(root, "mobile", "src", "components", "feed", "ContinuePathCard.tsx"), "utf8");
const webCard = readFileSync(join(root, "client", "src", "components", "continue-path-card.tsx"), "utf8");

/** The keys of one `const NAME: Record<string, string> = { … };` block. */
function keysIn(source: string, name: string): string[] {
  const block = new RegExp(String.raw`const ${name}: Record<string, string> = \{([\s\S]*?)\n\};`).exec(source);
  expect(block, `${name} should be declared there`).toBeTruthy();
  return [...block![1].matchAll(/"([\w-]+)":/g)].map((m) => m[1]).sort();
}

describe("what the phone restates about the next step", () => {
  it("has a short label for every actor the path trees use", () => {
    expect(Object.keys(ACTOR_SHORT).sort()).toEqual(Object.keys(ACTOR_LABEL).sort());
    expect(keysIn(mobileCard, "ACTOR_SHORT")).toEqual(Object.keys(ACTOR_SHORT).sort());
  });

  it("says the same thing as the web when a path has run out", () => {
    expect(mobileCard).toContain(NEXT_STEP_COPY.mainLineDone);
    expect(webCard, "the web reads it from @shared rather than restating it").toContain("NEXT_STEP_COPY.mainLineDone");
  });

  it("offers the same way onto a path as the web does", () => {
    for (const line of [NEXT_STEP_COPY.startTitle, NEXT_STEP_COPY.startBody, NEXT_STEP_COPY.startAction, NEXT_STEP_COPY.adoptTitle, NEXT_STEP_COPY.adoptAction]) {
      expect(mobileCard, `the phone should offer: ${line}`).toContain(line);
    }
  });

  it("carries every field the server sends, so nothing is quietly dropped", () => {
    const shape = readFileSync(join(root, "shared", "next-step.ts"), "utf8");
    const fields = [...shape.matchAll(/^\s{2}(?:\/\*\*[\s\S]*?\*\/\s*)?(\w+)[?]?:/gm)].map((m) => m[1]);
    const required = ["project", "track", "phase", "progress", "next", "daysSinceActivity", "projectedAt", "lastDone", "weekly", "needsPath"];
    for (const field of required) {
      expect(fields, `@shared/next-step should declare ${field}`).toContain(field);
      expect(mobileCard, `the phone's NextStepItem should carry ${field}`).toMatch(new RegExp(`\\b${field}[?]?:`));
    }
  });

  it("knows both reasons a project can have no path", () => {
    for (const kind of ["start", "adopt"]) {
      expect(mobileCard, `the phone should handle needsPath ${kind}`).toContain(`"${kind}"`);
      expect(webCard, `the web should handle needsPath ${kind}`).toContain(`"${kind}"`);
    }
  });
});
