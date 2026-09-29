/**
 * Nova's read on whether two niches are the same idea.
 *
 * The engine already merges the ones that are the same *people* — same
 * segment, same wants, same price — because that is measurable. This is for
 * the pairs that are numerically a little apart and obviously the same thing
 * to anybody reading them.
 *
 * The rule it is built to: being wrongly told your idea is somebody else's is
 * worse than being wrongly left with your own, because the first takes
 * something away. So everything unreadable, out of range or uncertain leaves
 * both niches alone.
 */
import { describe, it, expect } from "vitest";
import { pairsToReview, buildNicheReviewPrompt, parseNicheVerdicts, applyVerdicts, REVIEW_FROM } from "../../server/nova-niche-review";
import { nicheFor, similarity, SAME_NICHE_AT } from "@shared/simulation/niche-openings";
import { startingCompany } from "@shared/simulation/season";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type Company } from "@shared/simulation/types";

const niche = nicheById("dating_apps")!;
const parent = niche.segments[0];
const base = () => startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] });
const who = (id: string, over: Partial<Company>): Company => ({ ...base(), id, name: id, ...over });
const open = (id: string, over: Partial<Company>, year = 5) =>
  nicheFor({ company: who(id, over), parent, year });

/* Far apart on every axis: not a close call by any reading. */
const sharp = open("sharp", { quality: 90, brand: 8, service: 20 });
const opposite = open("opposite", { quality: 15, brand: 90, service: 85 });

describe("which pairs are worth asking about", () => {
  it("skips the ones the engine has already called the same", () => {
    const twinA = open("a", { quality: 82, brand: 10, service: 28 });
    const twinB = open("b", { quality: 82, brand: 10, service: 28 });
    expect(similarity(twinA, twinB)).toBeGreaterThanOrEqual(SAME_NICHE_AT);
    expect(pairsToReview([twinA, twinB]), "arithmetic already settled it").toHaveLength(0);
  });

  it("skips the ones that are not close calls", () => {
    expect(similarity(sharp, opposite)).toBeLessThan(REVIEW_FROM);
    expect(pairsToReview([sharp, opposite])).toHaveLength(0);
  });

  it("never asks about one company's own two niches", () => {
    const mine = open("same", { quality: 70, brand: 30, service: 40 });
    const alsoMine = open("same", { quality: 66, brand: 34, service: 44 });
    expect(pairsToReview([mine, alsoMine])).toHaveLength(0);
  });

  it("never asks about niches in different segments", () => {
    const elsewhere = nicheFor({ company: who("x", { quality: 82, brand: 10 }), parent: niche.segments[1], year: 5 });
    expect(pairsToReview([sharp, elsewhere])).toHaveLength(0);
  });
});

describe("what comes back", () => {
  const pairs = [{ a: sharp, b: opposite, closeness: 0.7 }];

  it("describes both in words rather than numbers", () => {
    const prompt = buildNicheReviewPrompt(pairs);
    expect(prompt.user).toContain(sharp.name);
    expect(prompt.user).toContain(opposite.name);
    expect(prompt.user).toMatch(/quality|brand|service|price/);
    expect(prompt.system).toMatch(/Lean towards leaving them alone/);
  });

  it("leaves both alone when the answer cannot be read", () => {
    for (const raw of ["", "not json", "{}", '{"verdicts":"no"}']) {
      expect(parseNicheVerdicts(raw, pairs), raw).toEqual([]);
    }
  });

  it("leaves both alone when the answer says they are different", () => {
    expect(parseNicheVerdicts('{"verdicts":[{"pair":0,"same":false}]}', pairs)).toEqual([]);
  });

  it("ignores a verdict about a pair that does not exist", () => {
    expect(parseNicheVerdicts('{"verdicts":[{"pair":9,"same":true}]}', pairs)).toEqual([]);
    expect(parseNicheVerdicts('{"verdicts":[{"pair":-1,"same":true}]}', pairs)).toEqual([]);
  });

  it("folds a pair it judged to be one idea, keeping whoever was first", () => {
    const early = open("early", { quality: 80, brand: 12 }, 5);
    const late = open("late", { quality: 76, brand: 16 }, 7);
    const these = [{ a: early, b: late, closeness: 0.7 }];
    const out = applyVerdicts([early, late], these, [{ pair: 0, same: true, name: "Serious players" }]);
    expect(out).toHaveLength(1);
    expect(out[0].openedBy).toBe("early");
    expect(out[0].name, "a better name for the shared one is taken").toBe("Serious players");
    expect(out[0].alsoFoundBy?.map((a) => a.companyId)).toEqual(["late"]);
  });

  it("changes nothing when there is nothing to change", () => {
    const these = [{ a: sharp, b: opposite, closeness: 0.7 }];
    expect(applyVerdicts([sharp, opposite], these, [])).toHaveLength(2);
  });
});
