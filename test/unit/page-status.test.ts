/**
 * The status the single-page shell goes out with.
 *
 * `/a/:id` is the one page in this product rendered for people with no
 * account, and both HTML responders hard-coded 200 — so a link to an artifact
 * that was never published, or has been taken down, answered "200 OK" with an
 * empty shell. A crawler indexes that as a real page and a link checker calls
 * the dead link healthy. A route can now ask for a different status on its way
 * past, and the shell is still served either way.
 */
import { describe, it, expect } from "vitest";
import { pageStatus } from "../../server/page-status";

const res = (locals: Record<string, unknown>) => ({ locals }) as any;

describe("the shell's status code", () => {
  it("is 200 when no route asked for anything", () => {
    expect(pageStatus(res({}))).toBe(200);
    expect(pageStatus(res({ pageMeta: { title: "A page" } }))).toBe(200);
  });

  it("is what the route asked for", () => {
    expect(pageStatus(res({ pageStatus: 404 }))).toBe(404);
    expect(pageStatus(res({ pageStatus: 410 }))).toBe(410);
  });

  it("ignores anything that isn't a status code, rather than sending it", () => {
    for (const nonsense of [99, 600, 0, null, undefined, NaN, {}, -1, "teapot"]) {
      expect(pageStatus(res({ pageStatus: nonsense })), String(nonsense)).toBe(200);
    }
  });

  it("takes a number that arrived as a string, since that is still a status", () => {
    expect(pageStatus(res({ pageStatus: "404" }))).toBe(404);
  });
});
