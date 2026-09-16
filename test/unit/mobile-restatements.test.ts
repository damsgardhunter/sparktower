/**
 * The mobile app restates a few shared constants by hand — it builds from its
 * own tsconfig and doesn't import `@shared` — and a restatement drifts. That
 * isn't cosmetic here: a reason code the server doesn't know is a 400 the
 * reviewer sees as "couldn't undo that", on the screen where they're trying to
 * take back a mistake. This reads both sides and fails when they disagree.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { MODERATION_REASON_CODES, UNDO_REASON_CODES, UNDOABLE_ACTIONS } from "@shared/moderation";

const source = readFileSync(join(__dirname, "..", "..", "mobile", "app", "admin", "reports.tsx"), "utf8");

/** The `id: "…"` values inside one `const NAME = [ … ] as const;` block. */
function idsIn(name: string): string[] {
  const block = new RegExp(String.raw`const ${name} = \[([\s\S]*?)\n\] as const;`).exec(source);
  expect(block, `${name} should be declared in the mobile screen`).toBeTruthy();
  return [...block![1].matchAll(/id:\s*"([\w_]+)"/g)].map((m) => m[1]).sort();
}

/** The keys of one `const NAME: Record<string, string> = { … };` block. */
function keysIn(name: string): string[] {
  const block = new RegExp(String.raw`const ${name}: Record<string, string> = \{([\s\S]*?)\n\};`).exec(source);
  expect(block, `${name} should be declared in the mobile screen`).toBeTruthy();
  return [...block![1].matchAll(/(\w+):\s*"/g)].map((m) => m[1]).sort();
}

describe("what the mobile review screen restates", () => {
  it("uses the reason codes the server accepts, for decisions and for undoing them", () => {
    expect(idsIn("REASON_CODES")).toEqual(MODERATION_REASON_CODES.map((r) => r.id).sort());
    expect(idsIn("UNDO_REASON_CODES")).toEqual(UNDO_REASON_CODES.map((r) => r.id).sort());
  });

  it("offers undo on exactly the decisions the server can undo", () => {
    expect(keysIn("UNDOABLE_ACTIONS")).toEqual(Object.keys(UNDOABLE_ACTIONS).sort());
  });

  it("has a word for every action it can show, including the new ones", () => {
    const words = keysIn("ACTION_WORDS");
    const missing = [...Object.keys(UNDOABLE_ACTIONS), ...Object.values(UNDOABLE_ACTIONS)].filter((a) => !words.includes(a));
    expect(missing, "actions the history would print as a raw identifier").toEqual([]);
  });
});
