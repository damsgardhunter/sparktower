/**
 * Where a signup gets credited.
 *
 * Worth pinning because every answer this gives is plausible. If the precedence
 * between `utm_source` and `ref` flips, or a referrer stops being recognised,
 * nothing errors — the numbers just quietly describe a different world, and
 * you find out by making a decision on them.
 */
import { describe, it, expect } from "vitest";
import { parseAttribution, referrerHost, TRACKED_PARAMS } from "@shared/attribution";

describe("referrerHost", () => {
  it("reduces a URL to its host and drops www", () => {
    expect(referrerHost("https://news.ycombinator.com/item?id=1")).toBe("news.ycombinator.com");
    expect(referrerHost("https://www.google.com/search?q=x")).toBe("google.com");
  });

  it("returns null rather than throwing on rubbish", () => {
    expect(referrerHost(null)).toBeNull();
    expect(referrerHost("")).toBeNull();
    expect(referrerHost("not a url at all")).toBeNull();
  });
});

describe("parseAttribution — which source wins", () => {
  it("prefers utm_source over the short forms", () => {
    const a = parseAttribution("/?utm_source=newsletter&ref=twitter&via=slack", null);
    expect(a.source).toBe("newsletter");
  });

  it("falls back through ref, then via, then source", () => {
    expect(parseAttribution("/?ref=producthunt&via=slack", null).source).toBe("producthunt");
    expect(parseAttribution("/?via=slack", null).source).toBe("slack");
    expect(parseAttribution("/?source=podcast", null).source).toBe("podcast");
  });

  it("uses the referring site when the link carries no tag", () => {
    const a = parseAttribution("/", "https://news.ycombinator.com/item?id=1");
    expect(a.source).toBe("news.ycombinator.com");
    expect(a.medium).toBe("referral");
  });

  it("says 'direct' rather than nothing when there is neither", () => {
    const a = parseAttribution("/", null);
    // "direct" is a real answer that groups and counts. A null here is a hole
    // every future query has to special-case.
    expect(a.source).toBe("direct");
    expect(a.medium).toBe("direct");
    expect(a.campaign).toBeNull();
  });

  it("prefers an explicit tag over the referrer that carried it", () => {
    // Arriving from Google on a link you tagged yourself is your campaign,
    // not Google's referral.
    const a = parseAttribution("/?utm_source=newsletter", "https://www.google.com/");
    expect(a.source).toBe("newsletter");
  });
});

describe("parseAttribution — medium and campaign", () => {
  it("takes utm_medium literally when given", () => {
    expect(parseAttribution("/?utm_source=x&utm_medium=email", null).medium).toBe("email");
  });

  it("infers 'campaign' for a tagged link with no medium", () => {
    expect(parseAttribution("/?ref=producthunt", null).medium).toBe("campaign");
  });

  it("reads campaign from either utm_campaign or campaign", () => {
    expect(parseAttribution("/?utm_campaign=launch", null).campaign).toBe("launch");
    expect(parseAttribution("/?campaign=launch", null).campaign).toBe("launch");
  });
});

describe("parseAttribution — what it refuses to keep", () => {
  it("keeps only allowlisted parameters", () => {
    const a = parseAttribution(
      "/?utm_source=ok&session_token=SECRET&email=someone@private.com&password=hunter2",
      null,
    );
    expect(a.params).toEqual({ utm_source: "ok" });
    // Named explicitly: the point is that a URL picks up things nobody meant
    // to store, and the allowlist is what stops them landing in a table.
    expect(JSON.stringify(a.params)).not.toContain("SECRET");
    expect(JSON.stringify(a.params)).not.toContain("private.com");
  });

  it("caps a single value so a tag can't be used as storage", () => {
    const long = "x".repeat(500);
    const a = parseAttribution(`/?utm_source=${long}`, null);
    expect(a.params.utm_source!.length).toBe(120);
  });

  it("survives a URL it cannot parse, and a custom app scheme it can", () => {
    expect(() => parseAttribution("%%%not-a-url%%%", null)).not.toThrow();
    // Mobile deep links arrive like this.
    const a = parseAttribution("sparktower://open?utm_source=tiktok", null);
    expect(a.source).toBe("tiktok");
  });

  it("records the landing path so the entry point is recoverable", () => {
    const a = parseAttribution("/c/abc123?utm_source=twitter", null);
    expect(a.landingPath).toBe("/c/abc123?utm_source=twitter");
  });

  it("has no parameter in the allowlist that isn't a marketing tag", () => {
    // A guard on the list itself: adding something like "token" here would
    // silently start persisting it on every signup.
    for (const p of TRACKED_PARAMS) {
      expect(p).not.toMatch(/token|secret|password|auth|key|session/i);
    }
  });
});
