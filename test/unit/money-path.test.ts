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

/*
 * A plan's fields are cut to length, and that cut is read as prose.
 *
 * Reported from a generated plan: sentences ending mid-word — "pending proof and
 * el". Nothing was wrong with the plan. Every field is bounded, the bound was a
 * plain `.slice(0, max)`, and it cut wherever the character count landed. A
 * reader cannot tell that from a model that lost its thread, which is the damage:
 * the plan looks broken rather than shortened.
 */
describe("a plan's fields, cut to length", () => {
  const sentence = "The route is viable pending proof and election of an S-corp, which changes the tax position materially.";
  const planWith = (over: Record<string, unknown>) => sanitizePlan({ summary: "A summary.", ...over });

  it("never ends a field mid-word", () => {
    const plan = planWith({
      actions: [{ title: "Do the thing", detail: sentence, when: sentence, moves: sentence }],
      figures: [{ label: "Free cash", value: sentence, note: sentence }],
    });
    for (const [what, text] of [
      ["when", plan.actions[0].when],
      ["value", plan.figures[0].value],
    ] as [string, string][]) {
      expect(text, `${what} was not cut at all`).toMatch(/…$/);
      /* The character before the ellipsis ends a word: a letter followed by the
         cut is only acceptable if the whole word fitted. */
      const body = text.replace(/…$/, "");
      expect(sentence.startsWith(body), `${what} is not a prefix of the original`).toBe(true);
      expect(
        sentence[body.length] === " " || sentence.length === body.length,
        `${what} stopped mid-word: "${body.slice(-24)}"`,
      ).toBe(true);
    }
  });

  it("says it was cut, so a short field does not read as all there was", () => {
    const plan = planWith({ figures: [{ label: "Free cash", value: sentence }] });
    expect(plan.figures[0].value.endsWith("…")).toBe(true);
  });

  it("leaves a field that fits completely alone", () => {
    /* No stray ellipsis on "$4k", which is most of what these fields hold. */
    const plan = planWith({ figures: [{ label: "Free cash", value: "$4k", note: "typical range" }] });
    expect(plan.figures[0].value).toBe("$4k");
    expect(plan.figures[0].note).toBe("typical range");
  });

  it("does not leave a dangling comma or dash before the ellipsis", () => {
    const plan = planWith({ figures: [{ label: "l", value: "Proof of the route, election of an S-corp, and the tax position" }] });
    expect(plan.figures[0].value).not.toMatch(/[,;:.\-]…$/);
  });

  it("still cuts a single token longer than the limit", () => {
    /* A URL or an identifier with no space in it. Dropping the field entirely
       would be worse than cutting it where it must be cut. */
    const plan = planWith({ figures: [{ label: "l", value: "x".repeat(200) }] });
    expect(plan.figures[0].value.length).toBeLessThanOrEqual(60);
    expect(plan.figures[0].value.endsWith("…")).toBe(true);
  });

  it("keeps every field inside its own limit", () => {
    /* The point of the bound in the first place — the fix must not widen it. */
    const plan = planWith({
      actions: [{ title: sentence.repeat(4), detail: sentence.repeat(20), when: sentence, moves: sentence }],
      figures: [{ label: sentence, value: sentence, note: sentence.repeat(4) }],
      assumptions: [sentence.repeat(6)],
      gaps: [sentence.repeat(6)],
      sections: [{ heading: sentence, body: sentence.repeat(60) }],
    });
    expect(plan.actions[0].title.length).toBeLessThanOrEqual(140);
    expect(plan.actions[0].detail.length).toBeLessThanOrEqual(600);
    expect(plan.actions[0].when!.length).toBeLessThanOrEqual(60);
    expect(plan.figures[0].label.length).toBeLessThanOrEqual(80);
    expect(plan.figures[0].note!.length).toBeLessThanOrEqual(200);
    expect(plan.assumptions[0].length).toBeLessThanOrEqual(300);
    expect(plan.sections[0].body.length).toBeLessThanOrEqual(3000);
  });

  it("cuts the written answer later steps read at a word too", () => {
    const plan = planWith({
      summary: sentence,
      sections: Array.from({ length: 8 }, () => ({ heading: "H", body: sentence.repeat(20) })),
      actions: Array.from({ length: 25 }, (_, i) => ({ title: `Action ${i} ${sentence}`, detail: sentence })),
    });
    const answer = renderPlanAnswer(plan);
    expect(answer.length).toBeLessThanOrEqual(4000);
    if (answer.endsWith("…")) {
      expect(answer).not.toMatch(/[a-z]…$/i);
    }
  });
});
