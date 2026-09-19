/**
 * The money-first systemize path, as data and pure rules: its shape, tapped
 * answers held to their questions, and a model's plan held to its shape.
 */
import { describe, it, expect } from "vitest";
import {
  resolveTree, mainLineMilestones, workKindFor, validateIntake, renderIntake, sanitizePlan, renderPlanAnswer,
  PATH_TREES,
} from "@shared/phase-trees";
import { MONEY_POSITION_QUESTIONS, MONEY_TARGET_QUESTIONS, ROADMAP_LENGTH_QUESTIONS } from "@shared/phase-trees/systemize";

describe("the systemize path", () => {
  const phases = resolveTree("systemize_business", "restaurant");

  it("opens with money: the numbers, the capital profile and route, the roadmap — then the operating weeks", () => {
    /*
     * The funding path's profile and map sit between Systemize's third money
     * week and its roadmap, so the roadmap is built on the route the person
     * picked. The route's own four phases appear only once one is chosen.
     */
    expect(phases.map((p) => p.id)).toEqual([
      "money-1", "money-2", "money-3", "capital-1", "capital-2", "money-4", "week-1", "week-2", "week-3", "week-4",
    ]);
    const ids = mainLineMilestones(phases).map((m) => m.id);
    expect(ids.slice(0, 24)).toEqual([
      "SYS.F1.1", "SYS.F1.2", "SYS.F1.3", "SYS.F1.4", "SYS.F1.5", "SYS.F1.6",
      "SYS.F2.1", "SYS.F2.2", "SYS.F2.3", "SYS.F2.4",
      "SYS.F3.1", "SYS.F3.2", "SYS.F3.3",
      "FUND.C1.1", "FUND.C1.2", "FUND.C1.3", "FUND.C1.4", "FUND.C1.5", "FUND.C1.6", "FUND.C2.1", "FUND.C2.2",
      "SYS.F4.1", "SYS.F4.2", "SYS.F4.3",
    ]);
  });

  it("asks where you stand first, by tapping, and has Nova build the plans", () => {
    const [first] = mainLineMilestones(phases);
    expect(first).toMatchObject({ id: "SYS.F1.1", title: "Where you stand", work: "intake" });
    expect(first.intake!.find((q) => q.id === "cash")!.options[0].label).toMatch(/^\$0/);
    const byId = new Map(mainLineMilestones(phases).map((m) => [m.id, m]));
    for (const id of ["SYS.F1.3", "SYS.F1.4", "SYS.F1.5", "SYS.F2.1", "SYS.F2.2", "SYS.F2.3", "SYS.F2.4", "SYS.F3.1", "SYS.F3.2", "SYS.F3.3", "SYS.F4.2"]) {
      expect(workKindFor(byId.get(id)!.actor, byId.get(id)!.work), id).toBe("plan");
    }
    expect(workKindFor(byId.get("SYS.F1.6")!.actor, byId.get("SYS.F1.6")!.work)).toBe("options");
    expect(byId.get("SYS.F4.1")!.intake![0].options.map((o) => o.id)).toEqual(["90d", "1y", "3y"]);
  });

  it("carries restaurant detail where it matters", () => {
    const byId = new Map(mainLineMilestones(phases).map((m) => [m.id, m]));
    expect(byId.get("SYS.F1.4")!.description).toMatch(/covers per day/);
    expect(byId.get("SYS.F3.2")!.description).toMatch(/pop-ups/);
    expect(mainLineMilestones(resolveTree("systemize_business", "service")).find((m) => m.id === "SYS.F1.4")!.description).toMatch(/utilisation/);
  });

  it("never promises an outcome", () => {
    // "A personal guarantee" is a loan requirement, and allowed; promising approval or success isn't.
    const promise = /\bguaranteed\b|guarantees? (approval|funding|success|you|the)/i;
    for (const m of PATH_TREES.systemize_business.phases.flatMap((p) => p.milestones)) {
      expect(`${m.description} ${Object.values(m.variants ?? {}).map((v) => v.description).join(" ")}`, m.id).not.toMatch(promise);
    }
  });

  it("keeps the other paths' kinds as they were", () => {
    expect(workKindFor("nova-builds")).toBe("build");
    expect(workKindFor("user-does")).toBe("template");
    expect(workKindFor("nova-drafts")).toBe("options");
  });
});

describe("tapped answers", () => {
  const full = { cash: "zero", monthly: "under_250", credit: "unknown", situation: "starting", experience: "none" };

  it("take one choice per question, and any number where the question allows it", () => {
    const ok = validateIntake(MONEY_POSITION_QUESTIONS, { ...full, assets: ["family", "equipment"] });
    expect(ok).toEqual({ ok: true, answers: { cash: ["zero"], monthly: ["under_250"], credit: ["unknown"], situation: ["starting"], experience: ["none"], assets: ["family", "equipment"] } });
  });

  it("allow an optional question to be skipped, and refuse a required one", () => {
    expect(validateIntake(MONEY_POSITION_QUESTIONS, full).ok).toBe(true);
    const { cash: _c, ...noCash } = full;
    expect(validateIntake(MONEY_POSITION_QUESTIONS, noCash)).toMatchObject({ ok: false, field: "cash" });
  });

  it("refuse a choice that isn't offered, and two choices on a single-choice question", () => {
    expect(validateIntake(MONEY_POSITION_QUESTIONS, { ...full, cash: "a million" })).toMatchObject({ ok: false, field: "cash" });
    expect(validateIntake(MONEY_POSITION_QUESTIONS, { ...full, credit: ["unknown", "740_plus"] })).toMatchObject({ ok: false, field: "credit" });
  });

  it("read back as the sentences Nova builds from", () => {
    const answers = (validateIntake(MONEY_TARGET_QUESTIONS, { raise: "unknown", when: "6_12" }) as any).answers;
    expect(renderIntake(MONEY_TARGET_QUESTIONS, answers)).toBe(
      "How much are you looking to raise? I don't know — work it out for me\nWhen do you need the money? 6–12 months",
    );
    expect(renderIntake(ROADMAP_LENGTH_QUESTIONS, { horizon: [] })).toMatch(/Not sure yet/);
  });
});

describe("a plan from the model", () => {
  it("is held to its shape: text everywhere, tables whose rows fit their columns, bounded lists", () => {
    const plan = sanitizePlan({
      summary: "You need about $180k.",
      figures: [{ label: "Raise", value: 180000 }, { label: "", value: "x" }],
      tables: [{ title: "Sources and uses", columns: ["Use", "Amount"], rows: [["Equipment", "$60k", "extra"], ["Deposits"], "bad row"] }, { title: "Empty", columns: [], rows: [["a"]] }],
      sections: [{ heading: "Why", body: "Because." }],
      assumptions: ["Rent $6k/month"],
      gaps: ["No quotes yet"],
      actions: Array.from({ length: 40 }, (_, i) => ({ title: `Step ${i}`, detail: "Do it", when: "week 1" })),
      verifyWith: "An SBA lender",
      email: "ignored@example.com",
    });
    expect(plan.figures).toEqual([{ label: "Raise", value: "180000" }]);
    expect(plan.tables).toEqual([{ title: "Sources and uses", columns: ["Use", "Amount"], rows: [["Equipment", "$60k"], ["Deposits", ""]] }]);
    expect(plan.actions).toHaveLength(25);
    expect((plan as any).email).toBeUndefined();
    expect(renderPlanAnswer(plan)).toMatch(/^You need about \$180k\.\nFigures: Raise 180000\nGaps: No quotes yet\nActions: \[week 1\] Step 0;/);
  });

  it("is refused when there's nothing a founder could use", () => {
    expect(() => sanitizePlan({ actions: [{ title: "x" }] })).toThrow(/usable plan/);
    expect(() => sanitizePlan(null)).toThrow();
  });
});
