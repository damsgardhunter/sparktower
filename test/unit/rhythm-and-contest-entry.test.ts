/**
 * The rhythm's other half on the phone, and filing a contest entry from one.
 *
 * Two features that were each half-built, and the halves were not the obvious
 * ones.
 *
 * **The rhythm.** The phone had the weekly check-in — the act — and nothing the
 * act was *for*: no quarter goals, no monthly report, no way to move the day the
 * reminder arrives. Three of the eleven rhythm routes were called; now it is all
 * but the two long setup forms.
 *
 * **The contest entry.** Entering worked and then dead-ended: the button turned
 * into "Entered" and there was nowhere to put the work. `POST
 * /api/contests/:id/submit` existed and *nothing on either client called it* —
 * not the phone and not the web — and the list route returned only
 * `isParticipant`, so no client could have told somebody who had filed from
 * somebody who had merely joined.
 *
 * The checks here are mostly source-reading, because the phone cannot import
 * `@shared` and every interface on it is a copy that drifts. Where a copy is
 * compared with the server, it is compared field for field.
 */
import { describe, it, expect } from "vitest";
import { readSource, withoutComments, withoutInterfaces } from "../helpers/source-parity";

const week = readSource("mobile/app/rhythm/[id].tsx");
const goals = readSource("mobile/app/rhythm/goals/[id].tsx");
const report = readSource("mobile/app/rhythm/report/[id].tsx");
const settings = readSource("mobile/app/rhythm/settings/[id].tsx");
const contests = readSource("mobile/app/contests.tsx");
const rhythmServer = readSource("server/company-rhythm-routes.ts");
const sharedRhythm = readSource("shared/company-rhythm.ts");

/** Every rhythm route the server declares, as written. */
const serverRhythmRoutes = [...withoutComments(rhythmServer)
  .matchAll(/app\.(get|post|put|patch|delete)\("(\/api\/projects\/:id\/rhythm[^"]*)"/g)]
  .map((m) => ({ method: m[1].toUpperCase(), path: m[2] }));

/** The phone's four rhythm screens, read together. */
const phoneRhythm = withoutComments(week + goals + report + settings);

describe("the rhythm, on the phone", () => {
  it("now calls all of it but the two setup forms", () => {
    expect(serverRhythmRoutes.length).toBeGreaterThan(8);
    /*
     * The recurring jobs' own CRUD stays on the web: adding and editing them is
     * a long form about the project's shape, not about this week. Marking one
     * done is on the phone, because that is the recurring act.
     */
    const deliberatelyAbsent = [
      "/api/projects/:id/rhythm/jobs",
      "/api/projects/:id/rhythm/jobs/:jobId",
    ];
    const uncalled = serverRhythmRoutes
      .filter((r) => !deliberatelyAbsent.includes(r.path))
      .filter((r) => {
        const pattern = r.path.split("/").map((seg) =>
          seg.startsWith(":") ? "(?:\\$\\{[^}]*\\}|[\\w.-]+)" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("/");
        return !new RegExp(pattern).test(phoneRhythm);
      })
      .map((r) => `${r.method} ${r.path}`);
    expect(uncalled, "these rhythm routes have no caller on the phone").toEqual([]);
  });

  it("reaches the three new screens from the week", () => {
    /* A screen nobody can navigate to is not a feature. */
    const code = withoutComments(week);
    for (const route of ["/rhythm/goals/", "/rhythm/report/", "/rhythm/settings/"]) {
      expect(code, `the week's screen does not link to ${route}`).toContain(route);
    }
  });

  it("renders the goal states the server actually produces, and no others", () => {
    /*
     * `goalProgress` returns one of five states. A phone with a sixth would have
     * dead code; a phone missing one would render a goal with no colour at all.
     */
    const union = sharedRhythm.match(/state:\s*("reached"[^;]*);/);
    expect(union, "GoalProgress.state has moved").not.toBeNull();
    const states = [...union![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    const phoneStates = (() => {
      const tone = goals.match(/const TONE[\s\S]*?\{([\s\S]*?)\n\};/);
      expect(tone, "the phone's state-to-colour table has moved").not.toBeNull();
      return [...tone![1].matchAll(/"?([a-z ]+)"?:\s*"/g)].map((m) => m[1].trim()).sort();
    })();
    expect(phoneStates).toEqual(states);
  });

  it("never claims a goal with no numbers is failing", () => {
    /*
     * "No numbers yet" is the absence of evidence, and the kit's `unknown` tone
     * is dashed and blue for exactly this. Painting it red would tell a company
     * it is behind on a goal nobody has measured.
     */
    const tone = goals.match(/const TONE[\s\S]*?\n\};/)![0];
    expect(tone).toMatch(/"no numbers yet":\s*"unknown"/);
    expect(tone).not.toMatch(/"no numbers yet":\s*"bad"/);
  });

  it("reads progress rather than working it out again", () => {
    /*
     * The server measures from the quarter's first recorded value to the target,
     * with slack before calling a goal behind. A phone doing its own arithmetic
     * would be a second opinion that drifts.
     */
    const code = withoutInterfaces(withoutComments(goals));
    expect(code).toContain("progress.fraction");
    expect(code).toContain("progress.elapsed");
    expect(code, "the phone should not be deciding what counts as behind").not.toMatch(/0\.15|ON_TRACK_SLACK/);
  });

  it("opens the report on the month that ended, not the one in progress", () => {
    /*
     * A report on a month three days old is a report on three days.
     *
     * Asserted on the `useState` call, not on `lastMonth` appearing somewhere:
     * the helper stays defined when the initial month is hardcoded, so a check
     * for the name alone passes while the screen opens on the wrong month.
     */
    const code = withoutComments(report);
    expect(code).toMatch(/useState\(lastMonth\)/);
    expect(code).toMatch(/getUTCMonth\(\)\s*-\s*1/);
  });

  it("describes the same monthly report the server builds", () => {
    const serverFields = (() => {
      const block = sharedRhythm.match(/export interface MonthlyReport \{([\s\S]*?)\n\}/);
      expect(block, "MonthlyReport has moved").not.toBeNull();
      let flat = block![1];
      let prev: string;
      do { prev = flat; flat = flat.replace(/\{[^{}]*\}/g, "OBJ"); } while (flat !== prev);
      return [...flat.matchAll(/(?:^|\n)\s*(\w+)\??\s*:/g)].map((m) => m[1]).sort();
    })();
    const phoneFields = (() => {
      const block = report.match(/interface Report \{([\s\S]*?)\n\}/);
      let flat = block![1];
      let prev: string;
      do { prev = flat; flat = flat.replace(/\{[^{}]*\}/g, "OBJ"); } while (flat !== prev);
      return [...flat.matchAll(/(?:^|\n)\s*(\w+)\??\s*:/g)].map((m) => m[1]);
    })();
    /* The route adds the two it uses for navigation on top of the shared shape. */
    expect(phoneFields.sort()).toEqual([...serverFields, "previousMonth", "nextMonth"].sort());
  });

  it("claims the milestone that reading a report is, rather than glancing", () => {
    /*
     * The route closes RUN.S3.4 when a month with filings is opened, unless
     * `glance=1`. Opening this screen *is* that act, so it must not pass it.
     */
    expect(rhythmServer).toContain('req.query.glance !== "1"');
    expect(withoutComments(report), "the report screen should not read as a glance").not.toContain("glance=1");
  });

  it("treats an empty reminder list as everyone, which is what the server means", () => {
    /*
     * `remindUserIds` empty means every member. A checkbox list reading that as
     * "nobody" would show an unticked team and quietly turn reminders off for a
     * company that had never changed the setting.
     */
    expect(readSource("shared/schema.ts")).toContain("empty means every project member");
    const code = withoutComments(settings);
    expect(code).toMatch(/everyone\s*=\s*remind\.length === 0/);
    expect(code, "and there has to be a way back to everyone").toContain("setRemind([])");
  });

  it("numbers the days the server's way, not JavaScript's", () => {
    /* 0 = Monday here; `new Date().getDay()` says 0 = Sunday. */
    expect(readSource("shared/schema.ts")).toContain("0 = Monday");
    const days = settings.match(/const DAYS = \[([^\]]*)\]/);
    expect(days, "the day names have moved").not.toBeNull();
    expect(days![1].trim().startsWith('"Monday"')).toBe(true);
    expect(days![1]).toContain('"Sunday"');
  });

  it("offers Nova's reading only on a week that has been filed", () => {
    /*
     * It is a reply *to* the numbers and it costs credits, so asking before a
     * week exists would charge somebody for a reading of nothing. The route
     * answers 404 for an unfiled week.
     */
    expect(rhythmServer).toContain("No check-in for that week yet.");
    expect(withoutComments(week)).toMatch(/filed && d\.current\?\.reply/);
  });

  it("does not claim who wrote the reading, because nothing records it", () => {
    /*
     * A reply is recomputed from the numbers on every save and Nova's replaces
     * it; no column says which is on screen. A label guessing would be wrong
     * half the time.
     */
    expect(rhythmServer).toContain("The reply is recomputed");
    const code = withoutComments(week);
    expect(code).toContain("Ask Nova to look closer");
    expect(code, "it must not label the stored reply as Nova's").not.toMatch(/Nova (wrote|said) (this|that)/i);
  });
});

describe("filing a contest entry, from a phone", () => {
  it("calls the route that nothing called before", () => {
    const code = withoutComments(contests);
    expect(code).toMatch(/contests\/\$\{[^}]*\}\/submit/);
    expect(code).toContain("submissionUrl");
  });

  it("knows the difference between entered and filed, which the server now says", () => {
    /*
     * `isParticipant` alone is why this dead-ended. The list and detail routes
     * now carry the viewer's own entry, and only their own: a contest's
     * submissions are not public before judging.
     */
    /*
     * Both routes, counted. The list and the detail carry the same line, so
     * asserting it appears "somewhere" passes with one of them stripped — and
     * the list is the one the phone's cards are built from.
     */
    const routes = withoutComments(readSource("server/routes.ts"));
    const carried = [...routes.matchAll(/submission: mine\?\.submissionUrl \? \{ url: mine\.submissionUrl, note: mine\.submissionNote \} : null/g)];
    expect(carried, "GET /api/contests and GET /api/contests/:id should both carry the viewer's entry").toHaveLength(2);
    /* And the signed-out shape says so explicitly rather than omitting the key. */
    expect(routes).toMatch(/isParticipant: false, submission: null/);
    expect(withoutInterfaces(withoutComments(contests))).toContain("submission");
  });

  it("offers to file only while the contest is taking submissions", () => {
    /*
     * Joining takes `upcoming` and `active`; submitting takes `active` alone. A
     * button on an upcoming contest would be a 400 the person reads as broken,
     * so the card says it is waiting instead.
     */
    expect(withoutComments(readSource("server/routes.ts"))).toMatch(/contest\.status !== "active"/);
    /*
     * Scoped to the branch that chooses the button. `c.status === "active"` also
     * appears in the card's heading ("Open now"), so a file-wide match passes
     * with the guard around the button removed — which is how this very mutation
     * got through the first time.
     */
    const code = withoutComments(contests);
    const branch = code.match(/c\.isParticipant \? \([\s\S]*?button-file-/);
    expect(branch, "the filing branch has moved").not.toBeNull();
    expect(branch![0], "the file button must sit behind an active-status check").toMatch(/c\.status === "active"/);
  });

  it("leaves judging what a link is to the server", () => {
    /*
     * One place decides. The phone stops an empty box; the server decides whether
     * something is a URL and says so in a sentence the sheet shows.
     */
    const routes = withoutComments(readSource("server/routes.ts"));
    expect(routes).toContain("It needs to start with https://");
    const code = withoutComments(contests);
    expect(code).toContain("errText(e,");
    expect(code, "the phone should not be parsing URLs too").not.toMatch(/new URL\(/);
  });

  it("seeds the sheet from what is already filed, so a change is an edit", () => {
    const code = withoutComments(contests);
    expect(code).toMatch(/setUrl\(c\.submission\?\.url \?\? ""\)/);
  });
});
