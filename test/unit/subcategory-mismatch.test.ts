/**
 * The sentence somebody reads when a (goal, subcategory) pair is refused.
 *
 * It used to be `"channel" is not a kind of "systemize_business" project.` —
 * true, and no help to somebody who had just picked Creator or channel off a
 * list. It happened the first time a new subcategory was added: the picker
 * comes from the client bundle, which Vite hot-reloads, while the validation
 * runs in the server process, which `npm run dev` does not restart on a file
 * change. The two were running different code and the message said nothing
 * about it.
 *
 * So the refusal now names what the build accepts. A list missing the thing
 * you just chose means a stale process; a list containing something close
 * means a typo.
 */
import { describe, it, expect } from "vitest";
import { subcategoryMismatch, subcategoriesFor, isValidSubcategory } from "@shared/goals";

describe("the refusal", () => {
  it("names the ids this build accepts", () => {
    const message = subcategoryMismatch("systemize_business", "nonsense");
    for (const { id } of subcategoriesFor("systemize_business")) {
      expect(message, `the message should list ${id}`).toContain(id);
    }
  });

  it("still says what was refused", () => {
    expect(subcategoryMismatch("ship_mvp", "restaurant")).toContain('"restaurant"');
    expect(subcategoryMismatch("ship_mvp", "restaurant")).toContain("ship_mvp");
  });

  it("would have made the stale-server case obvious", () => {
    /*
     * The actual bug, reconstructed. A server that predates `channel` answers
     * with a list that does not contain it, next to the word the caller sent —
     * which is the whole diagnosis in one line.
     */
    const asStaleBuildWouldSay = `"channel" isn't a kind of "systemize_business" project. This build accepts: restaurant, service, retail, other.`;
    expect(asStaleBuildWouldSay).toContain("channel");
    expect(asStaleBuildWouldSay).not.toMatch(/accepts:[^.]*channel/);
    /* And today's build does list it, which is how you tell the two apart. */
    expect(subcategoryMismatch("systemize_business", "nonsense")).toMatch(/accepts:[^.]*channel/);
  });

  it("answers for an unknown goal rather than listing nothing", () => {
    /* `[goal]` is undefined here, and `.map` on undefined would throw inside an
     * error path — the worst place for a second error. */
    expect(subcategoryMismatch("made_up_goal", "whatever")).toBe(`"made_up_goal" isn't one of the paths.`);
  });

  it("is only ever reached for a pair that really is invalid", () => {
    /* Every valid pair must stay valid — the message is not a behaviour change. */
    for (const goal of ["ship_mvp", "systemize_business", "run_company"] as const) {
      for (const { id } of subcategoriesFor(goal)) {
        expect(isValidSubcategory(goal, id), `${goal}:${id}`).toBe(true);
      }
    }
  });
});
