/**
 * The verdict nothing ever checked.
 *
 * The audit's second reads existed to put numbers behind a verdict, and they
 * ran only for areas the first pass had already called built or partial. So
 * "missing" — the one verdict that tells a builder to write something from
 * scratch, and the one that costs a week when it is wrong — was the only
 * verdict with nothing behind it. The first pass reads a digest: a file tree
 * and excerpts of a couple of dozen files out of thousands. From inside that
 * read, "this isn't built" and "I wasn't shown it" are the same sentence.
 *
 * Now an area called missing is read again against its own files, and if the
 * close read finds it there, the area moves to partial carrying a note that
 * says which read to believe. The model call is only spent when the repository
 * holds files the area would be built out of — otherwise the first pass is
 * probably right, and confirming it is not worth a call.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("openai", () => ({ default: class { chat = { completions: { create: async () => ({}) } }; } }));
vi.mock("../../server/db", () => ({ db: {}, pool: {} }));

import { hasCandidateFiles, deepReadAll } from "../../server/audit-deep-reads";
import { sanitizeDeepRead, type CapabilityEntry } from "@shared/capabilities";

const file = (path: string, content = "export const x = 1;\n") => ({ path, content, bytes: content.length } as any);

describe("whether a missing area is worth reading again", () => {
  it("says yes when the files it would be built out of are sitting there", () => {
    const files = [file("server/moderation.ts"), file("server/routes.ts")];
    expect(hasCandidateFiles("moderation", files), "moderation.ts, while the audit says moderation is missing").toBe(true);
    expect(hasCandidateFiles("rateLimiting", files), "the limiter lives in the same file").toBe(true);
  });

  it("says no when nothing in the repository belongs to the area", () => {
    const files = [file("client/src/pages/home.tsx"), file("README.md", "# hi")];
    expect(hasCandidateFiles("payments", files)).toBe(false);
    expect(hasCandidateFiles("mobile", files)).toBe(false);
  });

  it("does not count a file with no text, which cannot answer anything", () => {
    // Over the ingest budget, or binary: it is in the tree and unreadable.
    expect(hasCandidateFiles("payments", [{ path: "server/webhookHandlers.ts", bytes: 900_000 } as any])).toBe(false);
  });

  it("does not count a test as the thing being tested", () => {
    expect(hasCandidateFiles("payments", [file("test/integration/stripe-webhook.test.ts")])).toBe(false);
  });
});

describe("what the close read's answer does to the verdict", () => {
  const entry = (over: Partial<CapabilityEntry>): CapabilityEntry =>
    ({ area: "payments", status: "missing", summary: "No payment provider found.", evidence: [], ...over } as CapabilityEntry);

  it("moves a wrong 'missing' to partial and says which read to believe", async () => {
    const detail = { coverage: "Stripe checkout, webhook verification and a subscription ledger.", gaps: [], strengths: [], present: true };
    const read = vi.fn(async () => detail);
    const out = await deepReadAll(
      {} as any, [entry({})], [file("server/webhookHandlers.ts")], null, null,
      { readArea: read as any },
    );
    expect(read, "the area was read again rather than left as it was").toHaveBeenCalledTimes(1);
    expect(out[0].status).toBe("partial");
    expect(out[0].note, "the builder is told the first pass was reading excerpts").toMatch(/digest|excerpt/i);
    expect(out[0].detail).toBe(detail);
  });

  it("leaves it missing when the close read looked and agrees", async () => {
    const read = vi.fn(async () => ({ coverage: "Nothing here handles money.", gaps: [], strengths: [], present: false }));
    const out = await deepReadAll(
      {} as any, [entry({})], [file("server/webhookHandlers.ts")], null, null,
      { readArea: read as any },
    );
    expect(out[0].status).toBe("missing");
    expect(out[0].detail?.coverage, "and the reason it gave is kept").toMatch(/Nothing here/);
  });

  it("leaves it missing when there was nothing to read", async () => {
    const read = vi.fn(async () => ({ coverage: "x", gaps: [], strengths: [], present: true }));
    const out = await deepReadAll({} as any, [entry({})], [file("client/src/pages/home.tsx")], null, null, { readArea: read as any });
    expect(read, "no files, no call, no credit spent").not.toHaveBeenCalled();
    expect(out[0].status).toBe("missing");
  });

  it("leaves it missing when the read fails, rather than guessing", async () => {
    const read = vi.fn(async () => null);
    const out = await deepReadAll({} as any, [entry({})], [file("server/webhookHandlers.ts")], null, null, { readArea: read as any });
    expect(out[0].status).toBe("missing");
  });

  it("never turns a built area into something else", async () => {
    const read = vi.fn(async () => ({ coverage: "c", gaps: [], strengths: [], present: false }));
    const out = await deepReadAll(
      {} as any, [entry({ status: "built", evidence: [{ file: "server/webhookHandlers.ts" }] })],
      [file("server/webhookHandlers.ts")], null, null, { readArea: read as any },
    );
    expect(out[0].status, "`present` is only asked of a missing area, and only it can move").toBe("built");
  });
});

describe("the close read's own answer, held to the shape", () => {
  it("keeps present only when it is a boolean", () => {
    const allowed = new Set(["server/webhookHandlers.ts"]);
    expect(sanitizeDeepRead({ coverage: "c", present: true }, allowed)?.present).toBe(true);
    expect(sanitizeDeepRead({ coverage: "c", present: false }, allowed)?.present).toBe(false);
    expect(sanitizeDeepRead({ coverage: "c", present: "yes" }, allowed)).not.toHaveProperty("present");
    expect(sanitizeDeepRead({ coverage: "c" }, allowed)).not.toHaveProperty("present");
  });
});

describe("a gap that cites a file the read never saw", () => {
  it("keeps the gap and says what it cited, rather than quietly dropping the path", () => {
    const detail = sanitizeDeepRead(
      { coverage: "c", gaps: [{ item: "No signature check on the webhook", file: "server/never-given.ts", severity: "high" }] },
      new Set(["server/webhookHandlers.ts"]),
    );
    expect(detail?.gaps[0].file, "a path a reader can't open is not evidence").toBeUndefined();
    expect(detail?.gaps[0].item).toContain("server/never-given.ts");
    expect(detail?.gaps[0].item).toMatch(/not among the files this read was given/);
  });

  it("leaves a gap that cited a file it was given exactly as written", () => {
    const detail = sanitizeDeepRead(
      { coverage: "c", gaps: [{ item: "No signature check", file: "server/webhookHandlers.ts" }] },
      new Set(["server/webhookHandlers.ts"]),
    );
    expect(detail?.gaps[0]).toEqual({ item: "No signature check", file: "server/webhookHandlers.ts", severity: "medium" });
  });
});

/**
 * The finding that prompted all of this: "signed-in web / is still feed-first
 * (client/src/pages/home.tsx)", led the report, named the file, and was wrong
 * — about a file the read had never been given. The page had opened with the
 * path card for two weeks.
 */
describe("a claim about a file nobody opened", () => {
  const opts = {
    read: new Set(["server/routes.ts"]),
    inRepo: new Set(["server/routes.ts", "client/src/pages/home.tsx"]),
  };

  it("says which file the judgement was made without reading", async () => {
    const { flagUnreadFiles } = await import("../../server/audit-claims");
    const findings: any = {
      nextThreeThings: ["Make signed-in web / path-first — client/src/pages/home.tsx is still feed-first"],
    };
    expect(flagUnreadFiles(findings, opts)).toBe(1);
    expect(findings.nextThreeThings[0]).toMatch(/client\/src\/pages\/home\.tsx was not read by this audit/);
  });

  it("leaves a claim about a file it did read exactly as written", async () => {
    const { flagUnreadFiles } = await import("../../server/audit-claims");
    const findings: any = { risks: [{ finding: "server/routes.ts mounts everything in one file." }] };
    expect(flagUnreadFiles(findings, opts)).toBe(0);
    expect(findings.risks[0].finding).toBe("server/routes.ts mounts everything in one file.");
  });

  it("does not second-guess the close reads, which are handed whole files", async () => {
    const { flagUnreadFiles } = await import("../../server/audit-claims");
    const findings: any = {
      capabilities: [{ detail: { gaps: [{ item: "client/src/pages/home.tsx has no test" }] } }],
      loops: [{ breaksAt: "client/src/pages/home.tsx never links back" }],
    };
    expect(flagUnreadFiles(findings, opts)).toBe(0);
  });

  it("stays quiet about a path that isn't in the repository at all", async () => {
    // That is the absence checker's business, and it has a different answer.
    const { flagUnreadFiles } = await import("../../server/audit-claims");
    const findings: any = { missing: [{ item: "server/invented.ts does nothing" }] };
    expect(flagUnreadFiles(findings, opts)).toBe(0);
  });
});
