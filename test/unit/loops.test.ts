import { describe, it, expect, vi } from "vitest";
// The verifiers module reaches the database on import; these checks are pure.
vi.mock("../../server/db", () => ({ db: {}, pool: {} }));
import {
  loopCoverage, loopTypeRefusal, loopTypeOf, sanitizeLoopAudit, sanitizeLoopClosures, loopAuditStale, authoredTextFor, resolveTree,
  LOOP_CAP, MAX_PRODUCT_LOOPS, type LoopType,
} from "@shared/phase-trees";
import { VERIFIERS } from "../../server/phase-tree-verifiers";

const five = (written = true) => (["product", "growth", "retention", "revenue", "referral"] as LoopType[]).map((type) => ({ type, written }));

describe("the five loops a business runs on", () => {
  it("is complete only with every kind present and written", () => {
    expect(loopCoverage(five()).complete).toBe(true);
    expect(loopCoverage(five().filter((l) => l.type !== "referral"))).toMatchObject({ complete: false, missing: ["referral"] });
    expect(loopCoverage(five().map((l) => (l.type === "growth" ? { ...l, written: false } : l)))).toMatchObject({ complete: false, missing: [], unwritten: ["growth"] });
    // More product loops don't stand in for a missing kind.
    expect(loopCoverage([{ type: "product", written: true }, { type: "product", written: true }]).missing).toEqual(["growth", "retention", "revenue", "referral"]);
  });

  it("repeats product loops only, up to the cap", () => {
    expect(loopTypeRefusal(five(), "product")).toBeNull();
    expect(loopTypeRefusal(five(), "growth")?.code).toBe("loop_type_taken");
    const products = Array.from({ length: MAX_PRODUCT_LOOPS }, () => ({ type: "product" as LoopType }));
    expect(loopTypeRefusal(products, "product")?.code).toBe("loop_cap");
    expect(loopTypeRefusal(products, "growth")).toBeNull();
    expect(LOOP_CAP).toBe(4 + MAX_PRODUCT_LOOPS);
  });

  it("reads a loop from before types as a product loop", () => {
    expect(loopTypeOf(["kind:loop", "parent:SHIP.M1.2"])).toBe("product");
    expect(loopTypeOf(["kind:loop", "loop-type:revenue"])).toBe("revenue");
    expect(loopTypeOf(["kind:loop", "loop-type:nonsense"])).toBe("product");
  });

  it("still reads the old core-loop placeholder as unanswered after the rewrite", () => {
    const m = resolveTree("ship_mvp", "saas").flatMap((p) => p.milestones).find((x) => x.id === "SHIP.M1.2")!;
    const old = "The highest-variance milestone in the path; everything downstream orders off it. The 3–5 step sequence that delivers value.";
    expect(authoredTextFor(m, old)).toBe(old);
    expect(authoredTextFor(m, `${old}\n\nMarked done by you: yes`)).toBe(old);
    expect(authoredTextFor(m, "1. Scan fridge 2. Get recipe")).toBe(m.description);
  });
});

const loops = [
  { key: "L1", taskId: "t-product", title: "Ship an MVP", type: "product" as LoopType },
  { key: "L2", taskId: "t-growth", title: "Public check-ins", type: "growth" as LoopType },
];

describe("Nova's competitive read, held to what it may say", () => {
  it("matches loops by key, derives the verdict from the score, and never invents a loop", () => {
    const audit = sanitizeLoopAudit({
      competitors: [{ name: "Linear", why: "teams already plan there" }, { name: "" }],
      summary: "Solid product loop, thin growth.",
      loops: [
        { key: "L2", score: 31, verdict: "strong", competitors: [{ name: "Indie Hackers", howTheirLoopWorks: "Milestone posts rank in search." }], gap: "No SEO." },
        { key: "L1", score: 140, advantage: "Dated plan" },
        { key: "L1", score: 5 },
        { key: "L9", score: 99 },
      ],
    }, loops);
    expect(audit.loops.map((l) => [l.loopTaskId, l.score, l.verdict])).toEqual([["t-product", 100, "strong"], ["t-growth", 31, "weak"]]);
    expect(audit.overallScore).toBe(66);
    expect(audit.weakestLoopTaskId).toBe("t-growth");
    expect(audit.competitors).toEqual([{ name: "Linear", why: "teams already plan there" }]);
    expect(audit.caveat).toMatch(/not a live scan/);
    // Stale is about the loops it was given, not the ones it happened to score.
    const now = loops.map((l) => ({ ...l, description: "" }));
    expect(loopAuditStale(audit, now)).toBe(false);
    expect(loopAuditStale(audit, [now[0]])).toBe(true);
    expect(loopAuditStale(audit, [now[0], { ...now[1], description: "rewritten" }])).toBe(true);
  });
});

describe("the code audit's closure check, held to the files", () => {
  const files = new Set(["server/check-ins.ts", "server/notify.ts", "client/src/pages/feed.tsx"]);

  it("keeps a closed loop that cites real files for every stage and the way back", () => {
    const [read] = sanitizeLoopClosures([{
      key: "L1", closure: "closed",
      stages: [{ step: "Post a check-in", status: "built", evidence: ["server/check-ins.ts"] }, { step: "See it in the feed", status: "built", evidence: ["client/src/pages/feed.tsx"] }],
      returnPath: { mechanism: "comment notification email", evidence: ["server/notify.ts"] },
      breaksAt: "ignored when closed",
    }], loops.slice(0, 1), files);
    expect(read).toMatchObject({ loopTaskId: "t-product", closure: "closed", breaksAt: "" });
    expect(read.note).toBeUndefined();
  });

  it("downgrades 'closed' without a real return path or with a stage it can't see", () => {
    const [noReturn, fakeStage] = sanitizeLoopClosures([
      { key: "L1", closure: "closed", stages: [{ step: "Post", status: "built", evidence: ["server/check-ins.ts"] }], returnPath: { mechanism: "email", evidence: ["server/made-up.ts"] } },
      { key: "L2", closure: "closed", stages: [{ step: "Share", status: "built", evidence: ["nope.ts"] }], returnPath: { mechanism: "link", evidence: ["server/notify.ts"] }, breaksAt: "sharing", fix: "Add a share link" },
    ], loops, files);
    expect(noReturn.closure).toBe("open");
    expect(noReturn.note).toMatch(/brings the user back/);
    expect(fakeStage.closure).toBe("open");
    expect(fakeStage.stages[0]).toMatchObject({ status: "partial", evidence: [] });
    expect(fakeStage.fix).toBe("Add a share link");
  });

  it("reports a loop the model skipped as open, never closed", () => {
    const reads = sanitizeLoopClosures([], loops, files);
    expect(reads.map((r) => r.closure)).toEqual(["open", "open"]);
  });

  it("verifies 'Loop closes' only when all five kinds close", () => {
    const closed = (type: LoopType) => ({ loopTaskId: type, title: type, type, closure: "closed", stages: [], returnPath: { mechanism: "email", evidence: ["x"] }, breaksAt: "", fix: "" });
    const all = (["product", "growth", "retention", "revenue", "referral"] as LoopType[]).map(closed);
    expect(VERIFIERS["SHIP.M2.3"]({ id: "a", signals: {}, findings: { loops: all } })).toMatch(/all 5 loops close/);
    expect(VERIFIERS["SHIP.M2.3"]({ id: "a", signals: {}, findings: { loops: all.slice(0, 4) } })).toBeNull();
    expect(VERIFIERS["SHIP.M2.3"]({ id: "a", signals: {}, findings: { loops: all.map((l, i) => (i ? l : { ...l, closure: "open" })) } })).toBeNull();
  });
});
