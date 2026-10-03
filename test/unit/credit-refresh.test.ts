/**
 * Two polling decisions that are load decisions, held where they can rot.
 *
 * Both came out of a 200-player load run (`scripts/sim-load.ts`), and both are
 * the same shape of saving: a request that was being made for a reason that had
 * stopped applying. Neither is the sort of thing a reviewer would notice
 * regressing, because putting either back makes nothing fail and nothing look
 * wrong — it just costs a hundred requests a second at the one moment the
 * product is busiest.
 *
 * The important test in here is the last one. The prefix list in
 * `queryClient.ts` is a promise that nothing under `/api/sim/` charges for
 * anything, and the way that promise breaks is not somebody editing the list —
 * it is somebody adding a charge to a simulation route a year from now and
 * having no reason to think about a client-side cache. So the list is checked
 * against the routes themselves.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { SPENDS_NOTHING, creditsFollow } from "../../client/src/lib/queryClient";
import { roomPollMs } from "../../client/src/pages/simulation";

const root = join(__dirname, "..", "..");

describe("when a write re-reads the credit balance", () => {
  it("follows a write that could have spent something", () => {
    // The ones that really do charge, or might.
    expect(creditsFollow("/api/projects/abc/simulation"), "building a market with Nova costs $10").toBe(true);
    expect(creditsFollow("/api/projects/abc/nova-build")).toBe(true);
    expect(creditsFollow("/api/companies/abc/simulation-seats/buy"), "a seat is a purchase").toBe(true);
    expect(creditsFollow("/api/projects/abc/code-audits")).toBe(true);
  });

  it("does not follow a write that cannot have", () => {
    for (const url of [
      "/api/sim/join",
      "/api/sim/join-code",
      "/api/sim/ventures/abc/claim",
      "/api/sim/ventures/abc/name",
      "/api/sim/ventures/abc/decisions",
      "/api/sim/ventures/abc/bids",
      "/api/sim/ventures/abc/offers",
      "/api/sim/seasons/abc/advance",
    ]) {
      expect(creditsFollow(url), `${url} does not spend credits`).toBe(false);
    }
  });

  it("never follows a write to the balance itself, which would be a loop", () => {
    expect(creditsFollow("/api/subscription")).toBe(false);
  });

  /*
   * The guard that matters.
   *
   * `/api/sim/` is skipped because nothing under it charges. If that stops
   * being true and this test does not notice, somebody plays a season and
   * watches a credit balance that is quietly wrong — the least debuggable kind
   * of bug, because the number is right on the server and stale in one tab.
   *
   * Matched on the route definition rather than the file: these files are large
   * and a charge *inside a helper they import* would be missed either way, so
   * this is a floor and not a proof. It catches the realistic case, which is a
   * `requireCredits` or `deductCredits` added beside the other route handlers.
   */
  it("still holds: no route under a skipped prefix charges for anything", () => {
    const charging = /\b(requireCredits|deductCredits)\s*\(/;
    const offenders: string[] = [];

    for (const name of readdirSync(join(root, "server"))) {
      if (!name.endsWith(".ts")) continue;
      const src = readFileSync(join(root, "server", name), "utf8");
      if (!charging.test(src)) continue;

      /*
       * This file charges somewhere. Which paths does it register? If any of
       * them sits under a skipped prefix, the promise is broken.
       */
      for (const m of src.matchAll(/app\.(?:post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g)) {
        const path = m[1];
        if (SPENDS_NOTHING.some((prefix) => path.startsWith(prefix))) {
          offenders.push(`${name}: ${path}`);
        }
      }
    }

    expect(offenders, `these charge but the client skips refreshing credits after them:\n  ${offenders.join("\n  ")}`)
      .toEqual([]);
  });
});

describe("how often the room screen asks about itself", () => {
  it("stays quick while the room is still gathering", () => {
    // People arriving, seats going, a clock running down: all of it is news.
    for (const phase of ["filling", "claiming", "naming"]) {
      expect(roomPollMs(phase), phase).toBe(2000);
    }
    // And before the first response has arrived, when the phase is unknown.
    expect(roomPollMs(undefined)).toBe(2000);
  });

  it("slows right down once the season is running", () => {
    /*
     * The countdown is over, the standings card fetches its own numbers, and
     * the only field on this screen that can still turn over is `seasonOver`.
     * Two seconds here was the largest single bucket of requests in a
     * 200-player run — about a hundred a second, each one advancing the lobby
     * and joining three tables to answer a question whose answer had stopped
     * changing.
     */
    expect(roomPollMs("running")).toBe(30_000);
  });

  it("stops asking about a room that is over", () => {
    // Nothing about a retired room will ever change again.
    expect(roomPollMs("retired")).toBe(false);
  });

  it("is quicker while gathering than once running, whatever the numbers become", () => {
    // The relationship, so that tuning the figures cannot invert them.
    const gathering = roomPollMs("filling");
    const running = roomPollMs("running");
    expect(typeof gathering).toBe("number");
    expect(typeof running).toBe("number");
    expect(gathering as number).toBeLessThan(running as number);
  });
});
