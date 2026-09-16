/**
 * A limit that counts by author, on a request with no author.
 *
 * `rateLimit("comment")` asks "how many comments has this person written
 * lately", counted by author id. With nobody signed in there is no id to count
 * by: the count comes back zero and the limit allows everything — an unlimited
 * write that still reads as limited, in the coverage table and to whoever
 * wrote the route.
 *
 * Every route using one of these authenticates first, so this is unreachable
 * today. It is here so that the day one doesn't, it fails loudly.
 */
import { describe, it, expect, vi } from "vitest";
import { rateLimit } from "../../server/moderation";

/** Just enough of an Express exchange to see which way the middleware went. */
function exchange() {
  const res: any = {
    statusCode: 0,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return { req: { method: "POST", path: "/api/somewhere", headers: {}, body: {} } as any, res, next: vi.fn() };
}

describe("a content-counted limit with nobody signed in", () => {
  it("refuses, rather than passing the write through unlimited", async () => {
    for (const action of ["comment", "feedPost", "message", "project"] as const) {
      const { req, res, next } = exchange();
      const warn = vi.spyOn(console, "error").mockImplementation(() => {});
      await rateLimit(action)(req, res, next);
      warn.mockRestore();

      expect(next, `${action} let an unauthenticated write through`).not.toHaveBeenCalled();
      expect(res.statusCode, action).toBe(401);
      expect(res.body, action).toMatchObject({ code: "unauthenticated" });
    }
  });

  it("says why in the log, naming the route — the next person needs to know which one", async () => {
    const { req, res, next } = exchange();
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    await rateLimit("comment")(req, res, next);
    const said = warn.mock.calls.map((c) => String(c[0])).join(" ");
    warn.mockRestore();
    expect(said).toMatch(/counted from content by author/);
    expect(said).toContain("POST /api/somewhere");
  });
});
