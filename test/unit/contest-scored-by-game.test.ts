/**
 * A contest the product scores itself, as far as the screens are concerned.
 *
 * The standings arithmetic is held to its promises in
 * test/integration/contest-standings.test.ts. This is the other half: that both
 * clients know such a contest is a different thing from a judged one, and stop
 * offering the half that no longer applies.
 *
 * The failure to avoid is subtle and silent. A scored contest with a judged
 * contest's buttons invites somebody to paste a link that nothing will ever
 * read, while their actual standing is worked out from games they may not know
 * count — so the prize goes to whoever happened to understand it.
 */
import { describe, it, expect } from "vitest";
import { readSource, withoutComments, withoutInterfaces } from "../helpers/source-parity";
import { CONTEST_SCORERS, isContestScorer } from "@shared/contests";

const web = readSource("client/src/pages/contests.tsx");
const phone = readSource("mobile/app/contests.tsx");
const admin = readSource("client/src/pages/admin-contests.tsx");
const routes = withoutComments(readSource("server/routes.ts"));

describe("the scorer list", () => {
  it("is the same ids the column accepts", () => {
    /* The database's enum and the list the form offers have to be one set. */
    const column = readSource("shared/schema.ts").match(/scoredBy: text\("scored_by", \{ enum: \[([^\]]*)\] \}\)/);
    expect(column, "the scored_by column has moved").not.toBeNull();
    const enumIds = [...column![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(CONTEST_SCORERS.map((s) => s.id).sort()).toEqual(enumIds);
  });

  it("refuses an id that is not one of them", () => {
    expect(isContestScorer("ten_years_from_now")).toBe(true);
    expect(isContestScorer("sim")).toBe(false);
    expect(isContestScorer("")).toBe(false);
    expect(isContestScorer(null)).toBe(false);
  });

  it("carries a sentence for each, because the form and both cards show one", () => {
    for (const scorer of CONTEST_SCORERS) {
      expect(scorer.label.length, `${scorer.id} needs a label`).toBeGreaterThan(0);
      expect(scorer.blurb.length, `${scorer.id} needs a sentence an entrant can read`).toBeGreaterThan(20);
    }
  });

  it("is a choice an admin can make, and is validated before it is stored", () => {
    expect(withoutComments(admin)).toContain("CONTEST_SCORERS");
    expect(withoutComments(admin)).toContain("contest-admin-scored-by");
    /*
     * The validator is also the field allowlist for both admin routes, so being
     * in it is what lets the value through at all.
     */
    const shared = withoutComments(readSource("shared/contests.ts"));
    expect(shared).toMatch(/scoredBy,/);
    expect(shared, "an unknown scorer must be refused rather than stored as null").toContain("That isn't a game this can score from.");
  });
});

describe("both clients, on a scored contest", () => {
  for (const [name, source] of [["the web", web], ["the phone", phone]] as const) {
    it(`${name} reads the standings route`, () => {
      expect(withoutComments(source)).toMatch(/contests\/\$\{[^}]*\}\/standings/);
    });

    it(`${name} branches on scoredBy before offering anything`, () => {
      /*
       * Scoped to the action area. `scoredBy` appears in the interface and in the
       * blurb lookup too, so a file-wide check would pass with the branch gone.
       */
      const code = withoutComments(source);
      const action = code.match(/c\.scoredBy \?[\s\S]{0,1200}?button-enter-/);
      expect(action, `${name} does not choose its buttons on scoredBy`).not.toBeNull();
      expect(action![0], "a scored contest should offer the standings").toContain("button-standings-");
      expect(action![0], "and a way to play").toContain("button-play-");
    });

    it(`${name} does not offer to file an entry on one`, () => {
      /* There is nothing to file, and the route refuses it. */
      const code = withoutComments(source);
      const scored = code.match(/c\.scoredBy \?[\s\S]{0,1200}?button-enter-/);
      expect(scored![0], "a scored contest must not show the filing button").not.toContain("button-file-");
    });

    it(`${name} says how it is decided, in the scorer's own words`, () => {
      const code = withoutComments(source);
      expect(code).toContain("text-scored-");
      /*
       * The phone cannot import @shared, so it keeps a copy; the web uses the
       * list directly. Either way an entrant reads the same sentence.
       */
      const blurb = CONTEST_SCORERS[0].blurb;
      if (name === "the phone") {
        expect(code, "the phone's copy of the sentence has drifted from shared/contests.ts").toContain(blurb);
      } else {
        expect(code).toContain("CONTEST_SCORERS");
      }
    });

    it(`${name} fetches the table only when it is opened`, () => {
      expect(withoutComments(source)).toMatch(/enabled:\s*!!viewing/);
    });

    it(`${name} marks your own row rather than moving it`, () => {
      const code = withoutComments(source);
      expect(code).toMatch(/user\?\.id/);
      expect(code).toContain("(you)");
    });

    it(`${name} says partners share a result`, () => {
      /*
       * The game is played in pairs and there is one verdict, so two entrants who
       * played each other share a number and a rank. Unsaid, that reads as a bug.
       */
      expect(withoutComments(source)).toMatch(/partners share a result/i);
    });
  }

  it("the phone's copy of the valuation format matches the web's", () => {
    /*
     * A phone showing "$2.4B" where the web shows "$2,400,000,000" on the same
     * leaderboard is the kind of difference people screenshot. Both read a
     * `money` that writes billions the same way.
     */
    expect(withoutComments(phone)).toContain("game/model");
    expect(withoutComments(web)).toContain("@shared/sprints/budget");
  });
});

describe("the server", () => {
  it("refuses a filed link on a scored contest", () => {
    expect(routes).toContain("scored_not_judged");
    /* Before the status check, so an active scored contest is refused too. */
    const submit = routes.match(/contests\/:id\/submit[\s\S]*?scored_not_judged/);
    expect(submit, "the guard is not in the submit route").not.toBeNull();
  });

  it("answers 404 rather than an empty table for a judged contest", () => {
    expect(routes).toContain("not_scored");
  });

  it("never puts a valuation through the integer score column", () => {
    /*
     * `contest_participants.score` is an integer and a ten-year valuation
     * overflows it at about 2.1 billion, which is an ordinary result. The
     * standings are computed and returned, never stored there.
     */
    const standings = withoutInterfaces(withoutComments(readSource("server/contest-standings.ts")));
    expect(standings, "the standings must not write to contest_participants").not.toMatch(/update\(contestParticipants\)|insert\(contestParticipants\)/);
    expect(standings, "nor read a stored score").not.toMatch(/contestParticipants\.score/);
  });
});
