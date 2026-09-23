/**
 * The fake model — the thing that makes a local walkthrough cost nothing.
 *
 * Worth testing for one reason: its whole value is that a developer can drive
 * the real product without a key and without a bill, and the way it fails is
 * silent. A stub that returns something the routes can't parse doesn't look
 * like a broken stub; it looks like Nova being broken, and the next person
 * debugs the feature instead of the switch. So: it must answer in the shape
 * the prompt asked for, and it must refuse to exist in production.
 */
import { describe, it, expect, afterEach } from "vitest";
import { aiStubbed, stubCompletion } from "../../server/ai-stub";
import { parseModelJson } from "../../server/ai-json";

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });

/** A system prompt in the house style, ending in the shape it wants back. */
const promptFor = (shape: string) => `You are Nova, doing a milestone on a builder's path.
Respond ONLY with valid JSON of exactly this shape (no markdown fences):
${shape}`;

describe("the AI stub", () => {
  it("is off unless asked for, and refuses production however loudly it is asked", () => {
    process.env.NODE_ENV = "development";
    delete process.env.AI_STUB;
    expect(aiStubbed()).toBe(false);

    process.env.AI_STUB = "1";
    expect(aiStubbed()).toBe(true);

    process.env.NODE_ENV = "production";
    expect(aiStubbed(), "a stubbed production server answers everyone with nonsense").toBe(false);
  });

  it("answers in the shape the prompt asked for, so the route can read it", () => {
    const shape = '{"kind":"options","intro":"one sentence","options":[{"title":"","body":"the full text","why":"one line"}]}';
    const parsed = parseModelJson(stubCompletion(promptFor(shape), "MILESTONE: Product statement"));

    expect(parsed.kind, "the discriminator is the one field whose literal value is the answer").toBe("options");
    expect(Array.isArray(parsed.options)).toBe(true);
    // Three, because the prompts that ask for options ask for three of them.
    expect(parsed.options).toHaveLength(3);
    for (const option of parsed.options) {
      expect(typeof option.title).toBe("string");
      expect(option.body).toContain("AI_STUB");
    }
  });

  it("keeps the types the shape used, so a number stays a number", () => {
    const shape = '{"kind":"build","files":[{"path":"relative/path","language":"ts","content":"complete file"}],"runGroups":[{"where":"terminal | browser | manual","commands":["one line each"],"longRunning":false}]}';
    const parsed = parseModelJson(stubCompletion(promptFor(shape), "MILESTONE: Scaffold"));

    expect(parsed.kind).toBe("build");
    expect(parsed.files[0].path).toEqual(expect.any(String));
    expect(parsed.runGroups[0].longRunning, "a boolean field came back as prose").toBe(false);
    // A "a | b | c" value is a choice the route validates, not a description of one.
    expect(parsed.runGroups[0].where).toBe("terminal");
  });

  it("says something readable when the prompt wanted prose rather than JSON", () => {
    const text = stubCompletion("You are Nova. Reply to the builder in two sentences.", "How is my project going?");
    expect(() => parseModelJson(text)).toThrow();
    expect(text).toContain("AI_STUB");
  });
});
