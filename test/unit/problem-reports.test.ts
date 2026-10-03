/**
 * What a problem report has to have, and what is deliberately thrown away.
 *
 * The rules are few on purpose — a sentence and the page — because every field
 * somebody has to fill in before they can say a screen is broken is a field
 * that loses you the report.
 */
import { describe, it, expect } from "vitest";
import {
  readProblemMessage, readProblemPath, isProblemStatus,
  PROBLEM_MESSAGE_MAX, PROBLEM_STATUSES, PROBLEM_STATUS_COPY,
} from "../../shared/problem-reports";

describe("readProblemMessage", () => {
  it("takes a few words", () => {
    expect(readProblemMessage("the button does nothing")).toEqual({ ok: true, message: "the button does nothing" });
  });

  it("trims, and counts what is left", () => {
    expect(readProblemMessage("   broken   ")).toEqual({ ok: true, message: "broken" });
    expect(readProblemMessage("   \n  ").ok).toBe(false);
  });

  it("refuses an empty one in words the person will read", () => {
    const out = readProblemMessage("");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/what went wrong/i);
  });

  it("refuses one longer than the box allows", () => {
    expect(readProblemMessage("x".repeat(PROBLEM_MESSAGE_MAX + 1)).ok).toBe(false);
    expect(readProblemMessage("x".repeat(PROBLEM_MESSAGE_MAX)).ok).toBe(true);
  });

  it("is safe on anything that isn't a string", () => {
    for (const v of [null, undefined, 42, {}, []]) expect(readProblemMessage(v).ok).toBe(false);
  });
});

describe("readProblemPath", () => {
  it("keeps the path", () => {
    expect(readProblemPath("/projects/abc/manage")).toBe("/projects/abc/manage");
  });

  /*
   * The query string carries search terms and whatever else was in the box,
   * and none of it is needed to find the screen.
   */
  it("drops the query and the fragment", () => {
    expect(readProblemPath("/discover?q=my+private+search")).toBe("/discover");
    expect(readProblemPath("/projects/1#secret")).toBe("/projects/1");
  });

  it("refuses anything that isn't a path on this site", () => {
    expect(readProblemPath("https://example.test/x")).toBe("");
    expect(readProblemPath("javascript:alert(1)")).toBe("");
    expect(readProblemPath("")).toBe("");
    expect(readProblemPath(null)).toBe("");
  });

  it("does not keep an unbounded one", () => {
    expect(readProblemPath("/" + "a".repeat(1000)).length).toBeLessThanOrEqual(300);
  });
});

describe("statuses", () => {
  it("recognises only the four", () => {
    for (const s of PROBLEM_STATUSES) expect(isProblemStatus(s)).toBe(true);
    for (const s of ["", "open", "closed", "urgent", null, 1]) expect(isProblemStatus(s)).toBe(false);
  });

  it("has words for every one of them", () => {
    for (const s of PROBLEM_STATUSES) {
      expect(PROBLEM_STATUS_COPY[s].label, s).toBeTruthy();
      expect(PROBLEM_STATUS_COPY[s].blurb, s).toBeTruthy();
    }
  });
});

/**
 * The stored path, and the link a reviewer clicks.
 *
 * `/admin/problems` renders a report's path as `<Link href={r.path}>`, and
 * `POST /api/problem-reports` deliberately takes no session — the person best
 * placed to tell you the sign-in screen is broken is the one who cannot get past
 * it. Those two facts together mean a stranger chooses a string that a reviewer
 * is later invited to click.
 *
 * `startsWith("/")` was the whole test, and it is not enough: a browser reads
 * `//evil.test` and `/\evil.test` as a host, and both start with a slash. So a
 * report could put a link to another origin in the reviewer's queue, reading like
 * one of ours. `safeReturnPath` in shared/credits.ts already had the right rule
 * for the same reason; this one did not apply it.
 */
describe("the path a report is filed against", () => {
  it("keeps an ordinary path and drops the query and fragment", () => {
    expect(readProblemPath("/project/123")).toBe("/project/123");
    expect(readProblemPath("/project/123?tab=brief")).toBe("/project/123");
    expect(readProblemPath("/project/123#notes")).toBe("/project/123");
    expect(readProblemPath("  /spaced  ")).toBe("/spaced");
  });

  it("refuses the forms a browser would read as another host", () => {
    expect(readProblemPath("//evil.test"), "protocol-relative").toBe("");
    expect(readProblemPath("//evil.test/looks/like/ours")).toBe("");
    expect(readProblemPath("/\\evil.test"), "backslash is a slash to a browser").toBe("");
    expect(readProblemPath("\\\\evil.test")).toBe("");
    expect(readProblemPath("https://evil.test/x")).toBe("");
    expect(readProblemPath("javascript:alert(1)")).toBe("");
  });

  it("refuses a control character, which can hide the rest of the string", () => {
    expect(readProblemPath("/ok\u0000/no")).toBe("");
    expect(readProblemPath("/ok\nhttps://evil.test")).toBe("");
  });

  it("still refuses anything that is not a string at all", () => {
    for (const junk of [undefined, null, 7, {}, [], true]) {
      expect(readProblemPath(junk), String(junk)).toBe("");
    }
  });
});
