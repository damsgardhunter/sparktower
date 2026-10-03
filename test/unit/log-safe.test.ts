/**
 * Ids in log lines cannot forge a second line.
 *
 * A log is read by a person scanning for what happened, so a value carrying a
 * newline can write a line that looks exactly like something this code wrote — a
 * "payout released" that never happened. Every id in these logs arrives from a
 * request, so every one of them is sanitised first.
 *
 * The redundant `[\r\n]` strip is the part worth a test of its own: it exists for
 * CodeQL rather than for correctness, and somebody tidying it away would restore
 * an alert on a sanitiser that is strictly stronger than the one the analyser
 * recognises.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { logId } from "../../server/log-safe";

describe("an id on its way into a log", () => {
  it("cannot end the line it is in", () => {
    for (const forged of [
      "abc\ndef",
      "abc\r\n[nova-build] payout released",
      "abc\rdef",
      "ok\u2028next",
    ]) {
      const safe = logId(forged);
      expect(safe, `${JSON.stringify(forged)} survived`).not.toMatch(/[\r\n\u2028\u2029]/);
    }
  });

  it("keeps the characters an id is actually made of", () => {
    /* A uuid, and the prefixed ids this codebase uses, have to come out readable. */
    expect(logId("3f2b9c14-7e8a-4d55-9a1b-2c6f0e4d8a77")).toBe("3f2b9c14-7e8a-4d55-9a1b-2c6f0e4d8a77");
    expect(logId("RUN.S3.4")).toBe("RUNS34");
  });

  it("is bounded, so one value cannot be the whole log", () => {
    expect(logId("x".repeat(500))).toHaveLength(64);
  });

  it("says something for nothing rather than throwing", () => {
    expect(logId(null)).toBe("");
    expect(logId(undefined)).toBe("");
    expect(logId(12345)).toBe("12345");
  });
});

describe("the places that log an id", () => {
  const files = ["server/nova-build.ts", "server/startup-game-verdict.ts"];

  it("pass it as an argument rather than building the format string from it", () => {
    /*
     * `console.error(\`... ${id} ...\`)` is what CodeQL calls a tainted format
     * string, and it is also how a forged line gets written. The form it
     * recognises — and the one that is actually safe — puts the value in an
     * argument.
     */
    for (const file of files) {
      const source = readFileSync(resolve(import.meta.dirname, "../..", file), "utf8");
      const interpolated = [...source.matchAll(/console\.(error|warn|log)\(`[^`]*\$\{[^`]*`/g)].map((m) => m[0]);
      expect(interpolated, `${file} interpolates a value into a log's format string`).toEqual([]);
    }
  });

  it("sanitises every id it logs", () => {
    for (const file of files) {
      const source = readFileSync(resolve(import.meta.dirname, "../..", file), "utf8");
      /* Every `%s` in a log must have a `logId(` somewhere in the same call. */
      for (const call of source.match(/console\.(error|warn|log)\([^;]*?\);/gs) ?? []) {
        if (!call.includes("%s")) continue;
        expect(call.includes("logId("), `an unsanitised %s in ${file}:\n${call.slice(0, 160)}`).toBe(true);
      }
    }
  });
});
