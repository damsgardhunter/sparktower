/**
 * That the renderer actually calls the things built for it.
 *
 * This file exists because of a specific failure, and the failure is the kind
 * that unit tests are blind to by construction. `server/ad-placement.ts` was
 * written, tested and committed; `shared/ad-type.ts` grew a caption treatment
 * with no brand colour in it, tested and committed. Neither was ever called.
 * Ten passing tests covered the arithmetic inside the module and nothing
 * covered the one line that invokes it, so the suite was green, the commit
 * message said the work was done, and every rendered advert still put its
 * caption at a fixed height in the company's colours.
 *
 * Reading the source is a blunt way to check a call site and it is the right
 * blunt way here: the alternative is rendering a video in a unit test. What
 * these assert is only that the wiring exists — whether it is correct is the
 * other suites' job.
 */
import { describe, it, expect } from "vitest";
import { readSource, withoutComments } from "../helpers/source-parity";

const render = withoutComments(readSource("server/ad-render.ts"));

describe("the renderer uses what was built for it", () => {
  it("measures where the line goes instead of assuming", () => {
    expect(render, "ad-placement.ts is imported but never called").toContain("placeLine(");
    /*
     * The fixed height was the old behaviour and is still the fallback, so its
     * presence proves nothing — what proves it is that the height passed to
     * the shot is the computed one.
     */
    expect(render, "the line is pinned to a constant height again").not.toMatch(/atHeight:\s*0\.\d+\s*,\s*bold/);
    /*
     * The measured height reaches the shot. Written as "atHeight is used as a
     * value" rather than matching one exact spelling, because the shape around
     * it changes — it was `{ ...typeset, atHeight }` when captions were one
     * line and `atHeight + i * …` once they could wrap onto two, and the
     * second rewrite broke this test rather than the wiring.
     */
    expect(render, "the measured height is computed and then not used").toMatch(/atHeight(,|\s*\+)/);
  });

  it("passes the format's caption treatment to the compositor", () => {
    /*
     * Without this every story format gets the branded bubble, which is the
     * single detail that gives away a film pretending not to be an advert.
     */
    expect(render, "typeStyle is never passed, so every caption is the default").toMatch(/typeStyle:/);
    expect(render).toMatch(/story\?\.captions/);
  });

  it("resolves a story format wherever it branches on one", () => {
    /*
     * `adStyle` returns null for a story format. Every function that needs to
     * know how a render is shot has to ask both lists, and the one that forgot
     * failed an advert at the last step with every clip already paid for.
     */
    const asks = (render.match(/storyFormat\(row\.style\)/g) ?? []).length;
    expect(asks, "a function branches on the style without asking the story list").toBeGreaterThanOrEqual(2);
  });

  it("sends the character and the world into every drawn frame", () => {
    /* Each generation is alone: anything not restated is re-invented. */
    /*
     * The set belongs on this list for the same reason as the other two, and
     * it is the one a viewer notices first: a bench redrawn every shot is what
     * somebody described as "the desk station keeps changing throughout".
     */
    for (const field of ["world:", "character:", "set:"]) {
      expect(render, `${field} never reaches drawKeyframe`).toContain(field);
    }
    expect(render).toContain("drawKeyframe({");
  });
});
