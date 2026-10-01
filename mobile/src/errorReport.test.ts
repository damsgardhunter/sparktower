/**
 * The crash report, which is the one payload that leaves the device at the exact
 * moment nobody is watching what goes into it.
 *
 * Two things are being held. That it can always be built — this runs inside a
 * failure, and `throw` can carry anything, so a report that cannot be built is a
 * crash inside the crash handler. And that the query string never goes with it: an
 * invite code, a password-reset token and whatever somebody typed into a search
 * all live there.
 */
import { describe, it, expect } from "vitest";
import {
  ERROR_MESSAGE_MAX, ERROR_PATH_MAX, ERROR_STACK_MAX,
  errorReportBody, errorReportPath,
} from "./errorReport";

describe("the route a crash is reported against", () => {
  it("keeps the path and drops the query and the fragment", () => {
    expect(errorReportPath("/project/123")).toBe("/project/123");
    expect(errorReportPath("/invite?code=secret-invite-code")).toBe("/invite");
    expect(errorReportPath("/reset?token=abc123#x")).toBe("/reset");
    expect(errorReportPath("/search?q=what+i+typed")).toBe("/search");
  });

  /*
   * The protocol-relative and backslash forms are the ones worth naming. Both
   * start with a slash, so a `startsWith("/")` check passes them, and a browser
   * reads both as a host. The same hole was open in `shared/problem-reports.ts`,
   * where the stored path is rendered as a link in the reviewer's queue.
   */
  it("refuses anything that is not one of our own paths", () => {
    for (const notOurs of [
      "https://evil.test/x", "//evil.test", "/\\evil.test", "\\\\evil.test",
      "relative", "", "   ", "/ok\u0000/no", undefined, null, 7, {},
    ]) {
      expect(errorReportPath(notOurs), JSON.stringify(notOurs)).toBeNull();
    }
  });

  it("truncates a long one rather than sending it", () => {
    expect(errorReportPath("/" + "x".repeat(900))!.length).toBe(ERROR_PATH_MAX);
  });
});

describe("the body of a crash report", () => {
  it("carries the message, the stack, the component stack and where", () => {
    const err = Object.assign(new Error("things.map is not a function"), { stack: "at Thing\\nat Screen" });
    const body = errorReportBody(err, "\\n  in Thing\\n  in Screen", "tabs", "/project/9?tab=brief");
    expect(body.message).toBe("things.map is not a function");
    expect(body.stack).toContain("at Thing");
    expect(body.componentStack).toContain("in Screen");
    expect(body.where).toBe("tabs");
    expect(body.path, "the query is gone").toBe("/project/9");
  });

  /* `throw` can carry anything, and all of these have been thrown by real code. */
  it("is built from whatever was thrown, without throwing itself", () => {
    const cases: unknown[] = [
      new Error("ordinary"), "a bare string", undefined, null, 0, false, {}, [],
      { message: 42 }, Object.create(null),
      new Proxy({}, { get() { throw new Error("hostile getter"); } }),
    ];
    for (const [i, thrown] of cases.entries()) {
      /*
       * Labelled by position. Neither `String(thrown)` nor
       * `Object.prototype.toString.call(thrown)` is safe here: the first throws
       * on a null-prototype object, the second trips the hostile proxy's getter
       * via Symbol.toStringTag. Both made the label the thrower rather than the
       * code under test.
       */
      const label = `thrown #${i}`;
      expect(() => errorReportBody(thrown, undefined, undefined, undefined), label).not.toThrow();
      const body = errorReportBody(thrown, undefined, undefined, undefined);
      expect(typeof body.message, label).toBe("string");
      expect(typeof body.stack).toBe("string");
      expect(body.where).toBeNull();
      expect(body.path).toBeNull();
    }
  });

  it("caps each field, so a runaway stack is not a runaway request", () => {
    const err = Object.assign(new Error("m".repeat(5_000)), { stack: "s".repeat(50_000) });
    const body = errorReportBody(err, "c".repeat(50_000), "x", "/x");
    expect(body.message.length).toBe(ERROR_MESSAGE_MAX);
    expect(body.stack.length).toBe(ERROR_STACK_MAX);
    expect(body.componentStack.length).toBe(2_000);
  });

  it("treats an empty `where` as none, rather than reporting an empty string", () => {
    expect(errorReportBody(new Error("x"), "", "", "/x").where).toBeNull();
  });
});
