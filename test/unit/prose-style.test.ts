/**
 * The filter that takes Markdown decoration out of Nova's prose.
 *
 * The cases that matter are the two directions of getting it wrong: leaving
 * the hashes and asterisks that a plain-text surface renders as punctuation,
 * and eating characters that were never decoration — a shell glob, a
 * `__init__`, a multiplication.
 */
import { describe, expect, it } from "vitest";
import { tidyProse, PROSE_STYLE_RULE } from "../../server/prose-style";

describe("tidyProse", () => {
  it("keeps a heading's words and drops its hashes", () => {
    expect(tidyProse("## Decision (2026-09-16): Go to users now")).toBe("Decision (2026-09-16): Go to users now");
    expect(tidyProse("#### 1) Deploy web + API (1–2 days)")).toBe("1) Deploy web + API (1–2 days)");
    expect(tidyProse("## Closed heading ##")).toBe("Closed heading");
  });

  it("drops bold and italic markers", () => {
    expect(tidyProse("**Evidence:** the health check returns 200.")).toBe("Evidence: the health check returns 200.");
    expect(tidyProse("**Risk + handling:** deployment drift")).toBe("Risk + handling: deployment drift");
    expect(tidyProse("a *quiet* emphasis")).toBe("a quiet emphasis");
    expect(tidyProse("__also bold__")).toBe("also bold");
  });

  it("normalises list markers and drops horizontal rules", () => {
    expect(tidyProse("* one\n+ two\n- three")).toBe("- one\n- two\n- three");
    expect(tidyProse("  * nested")).toBe("  - nested");
    expect(tidyProse("before\n\n---\n\nafter")).toBe("before\n\nafter");
  });

  it("collapses blank runs and trims", () => {
    expect(tidyProse("one\n\n\n\ntwo\n\n")).toBe("one\n\ntwo");
    expect(tidyProse("trailing   \nspaces  ")).toBe("trailing\nspaces");
  });

  /*
   * The half that would make this filter a liability. Everything here is a
   * character that looks like Markdown and isn't.
   */
  it("never touches code", () => {
    const fenced = "Run this:\n\n```bash\nrm -rf **/*.map\n# not a heading\n```\n\nThen reload.";
    expect(tidyProse(fenced)).toBe(fenced);

    expect(tidyProse("Call `__init__` first")).toBe("Call `__init__` first");
    expect(tidyProse("Pass `**kwargs` through")).toBe("Pass `**kwargs` through");
    expect(tidyProse("Delete `*.log` files")).toBe("Delete `*.log` files");
  });

  it("leaves arithmetic and identifiers alone", () => {
    expect(tidyProse("2 * 3 * 4 = 24")).toBe("2 * 3 * 4 = 24");
    expect(tidyProse("the path_work table")).toBe("the path_work table");
    expect(tidyProse("public_to_signup_click then signup_complete")).toBe("public_to_signup_click then signup_complete");
  });

  it("is safe on empty and non-string input", () => {
    expect(tidyProse(null)).toBe("");
    expect(tidyProse(undefined)).toBe("");
    expect(tidyProse("")).toBe("");
  });

  /* The real thing, as a builder was shown it. */
  it("reads as prose on a real answer", () => {
    const raw = [
      "## Decision (2026-09-16): Go to users now",
      "",
      "### Why this decision exists",
      "SparkTower is already integrated enough to learn from real users.",
      "",
      "#### 1) Deploy web + API (1–2 days)",
      "- Pick hosting (viable paths):",
      "  - **Render/Fly.io** for API + **Vercel** for web (fast iteration).",
      "",
      "**Evidence:**",
      "- Health check returns 200.",
      "",
      "**Risk + handling:** deployment drift → run a smoke script.",
    ].join("\n");

    expect(tidyProse(raw)).toBe([
      "Decision (2026-09-16): Go to users now",
      "",
      "Why this decision exists",
      "SparkTower is already integrated enough to learn from real users.",
      "",
      "1) Deploy web + API (1–2 days)",
      "- Pick hosting (viable paths):",
      "  - Render/Fly.io for API + Vercel for web (fast iteration).",
      "",
      "Evidence:",
      "- Health check returns 200.",
      "",
      "Risk + handling: deployment drift → run a smoke script.",
    ].join("\n"));
  });

  it("states in the prompt what the filter enforces", () => {
    expect(PROSE_STYLE_RULE).toMatch(/No Markdown headings/i);
    expect(PROSE_STYLE_RULE).toMatch(/plain text/i);
  });
});
