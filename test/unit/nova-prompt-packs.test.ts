/**
 * Which questions a project gets asked, and what happens when nobody has
 * written a pack for its kind yet.
 *
 * The packs are the product here: they decide every first plan. So the two
 * things that must hold are that a written pack is used for exactly the goal
 * and subcategory it was written for, and that everything else still gets a
 * usable set of questions rather than an error or an empty screen.
 */
import { describe, it, expect } from "vitest";
import { packFor, LIVE_PACKS, NOVA_PACK_VERSION } from "@shared/nova-prompt-packs";
import { PROJECT_GOALS, PROJECT_SUBCATEGORIES } from "@shared/goals";
import { renderAnswers } from "../../server/nova-first-plan";

describe("Nova prompt packs", () => {
  it("uses the written pack for its own goal and subcategory", () => {
    const pack = packFor("ship_mvp", "website");
    expect(pack).toMatchObject({ key: "ship_mvp:website", status: "live", version: NOVA_PACK_VERSION });
    expect(pack.questions.map((q) => q.id)).toEqual(["visitor", "action", "proof", "live"]);
    // The questions are the pack: each says why it's being asked, so the UI can explain itself.
    for (const q of pack.questions) {
      expect(q.ask.length, q.id).toBeGreaterThan(20);
      expect(q.why.length, q.id).toBeGreaterThan(20);
    }
  });

  it("gives every other goal and subcategory a usable stub, so the path is complete from day one", () => {
    for (const goal of PROJECT_GOALS) {
      for (const sub of PROJECT_SUBCATEGORIES[goal.id]) {
        const pack = packFor(goal.id, sub.id);
        expect(pack.key, `${goal.id}:${sub.id}`).toBe(`${goal.id}:${sub.id}`);
        expect(pack.questions.length, `${goal.id}:${sub.id}`).toBeGreaterThanOrEqual(3);
        expect(pack.guidance.length).toBeGreaterThan(40);
        expect(["live", "stub"]).toContain(pack.status);
      }
    }
    // Exactly the packs claimed as evaluated in docs/nova-evals-v1.md.
    expect(LIVE_PACKS.map((p) => p.key)).toEqual(["ship_mvp:website"]);
  });

  it("answers nothing for an unknown goal rather than throwing", () => {
    expect(packFor(null, null).status).toBe("stub");
    expect(packFor("made_up_goal", "made_up_sub").questions.length).toBeGreaterThan(0);
  });

  it("carries unanswered questions into the prompt as unanswered, not as silence", () => {
    const pack = packFor("ship_mvp", "website");
    const rendered = renderAnswers(pack, { action: "Book a call" });
    expect(rendered).toContain("Book a call");
    // The model is told what wasn't answered, so it plans around not knowing instead of assuming.
    expect(rendered).toMatch(/not answered — plan around not knowing this yet/);
    expect(renderAnswers(pack, undefined).match(/not answered/g)).toHaveLength(pack.questions.length);
  });
});
