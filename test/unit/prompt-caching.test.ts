/**
 * Nova's prompts have to start with the part that never changes.
 *
 * OpenAI caches a prompt by exact prefix, and only from about 1,024 tokens in.
 * A prompt that opens with the project's own context therefore caches nothing
 * at all: every turn re-buys the entire instruction block at full price, and
 * for the chat prompt that was about 2,600 tokens of boilerplate on every
 * single message.
 *
 * So the rule these tests hold is simple and mechanical: the static text comes
 * first, everything that varies by user, plan or project comes last. It is the
 * kind of thing that gets quietly undone by somebody adding a helpful
 * `${project.title}` near the top, which is exactly why it is a test.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/** Rough and deliberately conservative: four characters to a token. */
const CHARS_PER_TOKEN = 4;
/** Below this, OpenAI caches nothing. */
const CACHE_MINIMUM_TOKENS = 1024;

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

/** The template literal a prompt is built from, by a line that identifies it. */
function promptBlock(file: string, opening: string): string {
  const lines = read(file).split("\n");
  const start = lines.findIndex((l) => l.includes(opening));
  expect(start, `could not find the prompt opening "${opening}" in ${file}`).toBeGreaterThan(-1);
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trimEnd().endsWith("`;")) return lines.slice(start, i + 1).join("\n");
  }
  throw new Error(`no closing backtick for the prompt in ${file}`);
}

/** How much of it is identical on every call: everything before the first interpolation. */
const staticPrefixTokens = (block: string): number => {
  const first = block.search(/\$\{/);
  return Math.round((first === -1 ? block.length : first) / CHARS_PER_TOKEN);
};

describe("the Nova chat prompt", () => {
  const block = promptBlock("server/routes.ts", "warm, direct, knowledgeable");

  it("opens with enough unchanging text to be cached at all", () => {
    expect(staticPrefixTokens(block)).toBeGreaterThan(CACHE_MINIMUM_TOKENS);
  });

  it("holds nothing that changes, so the history behind it caches too", () => {
    /*
     * The regression this exists for. `${projectContext}` used to sit about
     * 390 characters in — roughly 98 tokens, under the threshold — so nothing
     * cached at all. Worse, the board it describes changes inside a single
     * conversation, because Nova edits it: every reply re-bought the whole
     * instruction block *and* every turn of the history.
     *
     * The only interpolation allowed here is a module constant, which is the
     * same string on every call.
     */
    const interps = [...block.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1].trim());
    for (const i of interps) {
      expect(i, `"${i}" varies per request and belongs on the live turn, not in the system prompt`)
        .toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it("carries the project's state on the live turn instead", () => {
    const src = read("server/routes.ts");
    const from = src.indexOf("warm, direct, knowledgeable");
    const build = src.slice(from, src.indexOf("const rawReply", from));
    // The volatile things travel together, after the history, with the question.
    expect(build).toContain("const liveContext");
    for (const volatileBit of ["${projectContext}", "YOUR PLAN:", "COACHING DEPTH:"]) {
      expect(build.slice(build.indexOf("const liveContext"))).toContain(volatileBit);
    }
  });

  it("bounds the reply, so one runaway answer is not paid for by the token", () => {
    const src = read("server/routes.ts");
    // The chat call specifically: the one built from the prompt above.
    const from = src.indexOf("warm, direct, knowledgeable");
    const call = src.slice(from, src.indexOf("const rawReply", from));
    expect(call).toMatch(/max_completion_tokens:\s*\d+/);
  });
});
