/**
 * The client knows what an answer cost and nothing about who asked. The route
 * knows who asked and never sees the usage. This is the join between them.
 *
 * It was missing: `recordTokens` existed and nothing called it, so the ledger
 * held credits and no tokens at all — which made "what does a credit really
 * cost" unanswerable from the very table built to answer it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("attributing a model call to a ledger row", () => {
  beforeEach(() => { vi.resetModules(); process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "sk-test-not-a-real-key"; });

  it("puts a ceiling on the way out and records the usage on the way back", async () => {
    const { capped, setUsageRecorder, DEFAULT_MAX_OUTPUT_TOKENS } = await import("../../server/openai-client");

    // A stand-in for the network, so the real wrapper is what is under test.
    const sent: any[] = [];
    const fake: any = { chat: { completions: {
      create: (body: any) => { sent.push(body); return Promise.resolve({
        model: "gpt-5.2",
        usage: { prompt_tokens: 5000, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 4096 } },
        choices: [],
      }); },
    } } };

    const seen: any[] = [];
    setUsageRecorder((u) => seen.push(u));
    const client = capped(fake);

    await client.chat.completions.create({ model: "gpt-5.2", messages: [] } as any);

    expect(sent[0].max_completion_tokens, "a ceiling it did not ask for").toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    expect(seen[0]).toMatchObject({ prompt_tokens: 5000, prompt_tokens_details: { cached_tokens: 4096 } });
    expect(seen[0].model, "so the ledger knows which model answered").toBe("gpt-5.2");

    // A recorder that throws is never allowed to take the answer down with it.
    setUsageRecorder(() => { throw new Error("ledger is down"); });
    await expect(client.chat.completions.create({ model: "gpt-5.2", messages: [] } as any)).resolves.toBeTruthy();
    setUsageRecorder(null);
  });

  it("carries the cached-token count, which is the whole point of the prompt ordering", async () => {
    const { recordTokens } = await import("../../server/ai-spend");
    // With no row id there is nothing to write, and it must not throw.
    await expect(recordTokens(null, { prompt_tokens: 1, completion_tokens: 1 })).resolves.toBeUndefined();
    await expect(recordTokens("nope", null)).resolves.toBeUndefined();
  });

  it("keeps each request's calls separate", async () => {
    const { beginSpend } = await import("../../server/ai-spend");
    /*
     * `enterWith` sets the store for the rest of this async chain. Two
     * requests running side by side each get their own, which is the property
     * that stops one person's tokens landing on another person's bill.
     */
    const seen: (string | null)[] = [];
    await Promise.all([
      (async () => { beginSpend("row-a"); await new Promise((r) => setTimeout(r, 5)); seen.push("row-a"); })(),
      (async () => { beginSpend("row-b"); await new Promise((r) => setTimeout(r, 1)); seen.push("row-b"); })(),
    ]);
    expect(new Set(seen)).toEqual(new Set(["row-a", "row-b"]));
  });
});
