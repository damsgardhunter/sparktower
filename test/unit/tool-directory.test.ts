/**
 * What Nova is allowed to recommend, and to whom.
 *
 * Two failures this guards against, both of which look like working software.
 *
 * The first is a link nobody vetted. Nova names a need and the app answers
 * with links; if the resolver ever answers with something outside the curated
 * list, the safety property the whole design rests on is gone.
 *
 * The second is quieter and more likely: handing American company-formation
 * advice to a founder in another country with the same confidence. Where the
 * directory hasn't been extended yet, it has to say so rather than show
 * nothing and let someone conclude the step doesn't apply to them.
 */
import { describe, it, expect } from "vitest";
import { NEEDS, NEED_IDS, needById, isNeedId, STAGE_ORDER, ADVICE_NOTE } from "@shared/needs";
import { TOOLS, recommendationsFor, coveredElsewhereOnly, type Tool } from "@shared/tool-directory";

describe("the need vocabulary", () => {
  it("has unique ids and says what each thing is in plain words", () => {
    const ids = NEEDS.map((n) => n.id);
    expect(new Set(ids).size, "duplicate need id").toBe(ids.length);

    for (const need of NEEDS) {
      expect(need.id, `${need.id}: ids are referenced by saved data, keep them url-shaped`).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(need.plain.length, `${need.id}: needs a plain-words sentence`).toBeGreaterThan(20);
      expect(need.cues.length, `${need.id}: needs cues for Nova to recognise it`).toBeGreaterThan(0);
      expect(STAGE_ORDER).toContain(need.typicalStage);
    }
  });

  it("marks the ones where being wrong costs money, and never leaves them bare", () => {
    // Entity type, tax, contracts: a product with no lawyers must name options
    // and costs, not tell someone what to do.
    const sensitive = NEEDS.filter((n) => n.sensitivity === "advice").map((n) => n.id);
    for (const id of ["business-entity", "tax-id", "accounting", "contracts", "trademark"]) {
      expect(sensitive, `${id} should be marked as advice-sensitive`).toContain(id);
    }
    expect(ADVICE_NOTE).toMatch(/not advice/i);
  });

  it("knows which needs depend on the country, because those are the expensive ones to get wrong", () => {
    for (const id of ["business-entity", "tax-id", "business-banking", "sales-tax"]) {
      expect(needById(id)?.jurisdictional, `${id} depends on where you are`).toBe(true);
    }
    // And the ones that plainly don't, so everyone gets them.
    for (const id of ["build-first-version", "domain", "design-assets"]) {
      expect(needById(id)?.jurisdictional, `${id} is the same everywhere`).toBe(false);
    }
  });

  it("tells people what they can do without paying anyone, where that exists", () => {
    // The sentence a directory earning commission would rather not print, and
    // the reason this one can be trusted.
    for (const id of ["tax-id", "business-entity", "domain"]) {
      expect(needById(id)?.freeRoute, `${id} has a real free route and should say so`).toBeTruthy();
    }
    expect(needById("tax-id")!.freeRoute).toMatch(/free/i);
  });

  it("orders the vocabulary as a journey, not an alphabet", () => {
    // Nova offers things in this order; an LLC before a first version is how a
    // product sells someone something before they have anything to protect.
    const stageOf = (id: string) => STAGE_ORDER.indexOf(needById(id)!.typicalStage);
    expect(stageOf("build-first-version")).toBeLessThan(stageOf("payments"));
    expect(stageOf("payments")).toBeLessThan(stageOf("business-entity"));
    expect(NEED_IDS[0]).toBe(NEEDS.find((n) => n.typicalStage === "deciding")!.id);
  });

  it("recognises its own ids and rejects anything else", () => {
    expect(isNeedId("domain")).toBe(true);
    // What a model might emit if it were improvising rather than choosing.
    for (const made_up of ["buy-a-domain", "DOMAIN", "https://godaddy.com", "", null, 42]) {
      expect(isNeedId(made_up as unknown), String(made_up)).toBe(false);
    }
  });
});

describe("the directory", () => {
  it("only ever answers with entries from the curated list", () => {
    for (const need of NEEDS) {
      for (const tool of recommendationsFor(need.id, { region: "US" })) {
        expect(TOOLS, `${tool.id} came from outside the directory`).toContain(tool);
      }
    }
  });

  it("holds every entry to what a person needs to know before clicking", () => {
    for (const tool of TOOLS) {
      expect(tool.url, `${tool.id}: https only`).toMatch(/^https:\/\//);
      expect(tool.url, `${tool.id}: no referral codes in the catalog — those are admin settings`).not.toMatch(/[?&](ref|aff|via|partner)=/i);
      expect(tool.costs.length, `${tool.id}: say what it actually costs`).toBeGreaterThan(5);
      expect(tool.needs.length, `${tool.id}: an entry that answers no need is unreachable`).toBeGreaterThan(0);
      for (const need of tool.needs) expect(isNeedId(need), `${tool.id}: unknown need "${need}"`).toBe(true);
      expect(tool.regions.length, `${tool.id}: say where it applies`).toBeGreaterThan(0);
    }
  });

  it("does not hand one country's answers to another country's founder", () => {
    // A synthetic directory, so this tests the rule rather than today's data.
    const usOnly: Tool = { id: "x", name: "X", url: "https://x.test", what: "Forms a US company.", needs: ["business-entity"], regions: ["US"], costs: "$99" };
    const everywhere: Tool = { id: "y", name: "Y", url: "https://y.test", what: "An editor.", needs: ["build-first-version"], regions: ["GLOBAL"], costs: "Free" };
    const saved = [...TOOLS];
    TOOLS.length = 0;
    TOOLS.push(usOnly, everywhere);
    try {
      expect(recommendationsFor("business-entity", { region: "US" })).toEqual([usOnly]);
      expect(recommendationsFor("business-entity", { region: "GB" }), "a UK founder must not be shown a US filing service").toEqual([]);
      // Unknown region is not a synonym for the US.
      expect(recommendationsFor("business-entity", {})).toEqual([]);
      // Things that genuinely don't vary still reach everyone.
      expect(recommendationsFor("build-first-version", { region: "NG" })).toEqual([everywhere]);

      // And the caller can tell "nothing exists" from "nothing for you yet",
      // which is the difference between a gap and silence.
      expect(coveredElsewhereOnly("business-entity", "GB")).toBe(true);
      expect(coveredElsewhereOnly("business-entity", "US")).toBe(false);
      expect(coveredElsewhereOnly("insurance", "GB"), "no entries at all is not 'covered elsewhere'").toBe(false);
    } finally {
      TOOLS.length = 0;
      TOOLS.push(...saved);
    }
  });
});
