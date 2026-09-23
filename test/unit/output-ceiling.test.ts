/**
 * Every answer has a ceiling, whether the call site remembered one or not.
 *
 * Almost every completion in this codebase set no `max_completion_tokens`, so
 * an answer was as long as the model felt like — and a model that loops, or
 * reads a pasted file back, is paid for by the token with nobody reading the
 * result. The default is applied in the client rather than at thirty-odd call
 * sites, because the site that gets forgotten is the one that runs away.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("the default ceiling on an answer", () => {
  beforeEach(() => { vi.resetModules(); process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "sk-test-not-a-real-key"; });

  it("is applied to a request that asked for none, and never overrides one that did", async () => {
    const { withDefaultCeiling, DEFAULT_MAX_OUTPUT_TOKENS } = await import("../../server/openai-client");

    expect(withDefaultCeiling({ model: "m", messages: [] }).max_completion_tokens,
      "a request that asked for nothing gets the default").toBe(DEFAULT_MAX_OUTPUT_TOKENS);

    expect(withDefaultCeiling({ model: "m", messages: [], max_completion_tokens: 200 }).max_completion_tokens,
      "a request that asked for less keeps it").toBe(200);

    expect(withDefaultCeiling({ model: "m", messages: [], max_completion_tokens: 32_000 }).max_completion_tokens,
      "and one that asked for more keeps that too").toBe(32_000);

    expect((withDefaultCeiling({ model: "m", messages: [], max_tokens: 123 }) as any).max_completion_tokens,
      "the older spelling counts as having thought about it").toBeUndefined();

    // It never mutates what it was handed.
    const original = { model: "m", messages: [] };
    withDefaultCeiling(original);
    expect(original).toEqual({ model: "m", messages: [] });
  });

  it("is at least as large as the biggest ceiling any call asks for on purpose", async () => {
    const { DEFAULT_MAX_OUTPUT_TOKENS } = await import("../../server/openai-client");
    /*
     * If a call deliberately asks for more than the default, the default would
     * be the smaller of the two only where the site forgot — but a default
     * below a known-needed size means somebody's answer gets cut off the day
     * they remove an explicit ceiling. So it tracks the largest.
     */
    const asked = fs.readdirSync("server").filter((f) => f.endsWith(".ts"))
      .flatMap((f) => [...read(`server/${f}`).matchAll(/max_completion_tokens:\s*(\d+)/g)].map((m) => Number(m[1])));
    expect(asked.length, "some call sites still set their own").toBeGreaterThan(0);
    expect(DEFAULT_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(Math.max(...asked));
  });

  it("is not bypassed by a second client built somewhere else", () => {
    /*
     * `code-audit-routes.ts` used to construct its own OpenAI client, which
     * duplicated the base-URL rule and opted the dearest feature in the
     * product out of the ceiling. One client, one place that builds it.
     */
    const offenders = fs.readdirSync("server")
      .filter((f) => f.endsWith(".ts") && f !== "openai-client.ts")
      .filter((f) => /new OpenAI\s*\(/.test(read(`server/${f}`)));
    expect(offenders, "these build their own client and skip the ceiling").toEqual([]);
  });
});
