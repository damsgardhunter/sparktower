/**
 * What the audit's runtime probe is allowed to know, and to say.
 *
 * Two things went wrong here, and both were invisible because the output
 * looked plausible either way.
 *
 * The probe answered "which of the environment variables your code references
 * are set?" by looking them up in `process.env` — the audit server's own
 * environment, not the audited project's. So the answer was wrong for the
 * person reading it, and it was a disclosure for us: the *names* come from the
 * caller's uploaded code, so anyone could upload a file mentioning
 * `SESSION_SECRET` or `STRIPE_SECRET_KEY` and read back which of them exist in
 * production. Names only, never values — the caller writing the question is
 * what makes it an oracle rather than a report.
 *
 * And one of its three outward requests used a bare `fetch`, five lines under
 * the comment explaining the redirect-follow hole that the other two had been
 * fixed for.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { probeRuntime } from "../../server/runtime-probe";

const SOURCE = readFileSync(resolve("server/runtime-probe.ts"), "utf8");

describe("the environment question", () => {
  it("is not answered out of this process, however it is asked", async () => {
    const name = "RUNTIME_PROBE_CANARY_VALUE";
    process.env[name] = "set-right-here";
    try {
      const facts = await probeRuntime({ liveUrl: null, envVarNames: [name, "SESSION_SECRET", "DATABASE_URL"] });
      expect(facts.env.referenced, "it still counts what the code refers to").toBe(3);
      // Null, not an empty list: "not checked" and "nothing is set" are different claims.
      expect(facts.env.setThere).toBeNull();
      expect(facts.env.missingThere).toBeNull();
      expect(JSON.stringify(facts), "no name from this process reaches the caller").not.toContain(name);
      expect(facts.env.note).toMatch(/not checked/i);
    } finally {
      delete process.env[name];
    }
  });

  it("answers only when something that can see the project's own environment says so", async () => {
    const facts = await probeRuntime({
      liveUrl: null,
      envVarNames: ["STRIPE_SECRET_KEY", "SENTRY_DSN"],
      envSetOnHost: ["STRIPE_SECRET_KEY", "SOMETHING_ELSE_ENTIRELY"],
    });
    expect(facts.env.setThere).toEqual(["STRIPE_SECRET_KEY"]);
    expect(facts.env.missingThere).toEqual(["SENTRY_DSN"]);
    // A bridge can't be turned into a way to enumerate a machine: only names
    // the code already refers to are ever echoed back.
    expect(JSON.stringify(facts)).not.toContain("SOMETHING_ELSE_ENTIRELY");
  });

  it("never reads process.env for a name the caller supplied", () => {
    const lookups = SOURCE.match(/process\.env\[[^\]]+\]/g) ?? [];
    expect(lookups, `indexed process.env lookups: ${lookups.join(", ")}`).toEqual([]);
  });
});

describe("every request it makes", () => {
  it("goes through the guard that re-checks redirects", () => {
    /*
     * A source-level check rather than a behavioural one, because the failure
     * is a single call site drifting back to the global: the danger is a
     * `fetch(` that nobody notices next to two that are correct.
     */
    const bare = SOURCE.split("\n")
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /(^|[^.\w])fetch\s*\(/.test(line) && !/safeFetch/.test(line) && !/^\s*\*/.test(line));
    expect(bare.map(([n, l]) => `${n}: ${l.trim()}`)).toEqual([]);
  });
});
