/**
 * A browser saying one of its screens threw.
 *
 * The web app had no error boundary at all: React unmounts the whole tree when
 * a render throws, so one bad value anywhere replaced the entire product with a
 * blank white page — and nothing reported it, so the first anybody heard was a
 * customer saying "the site broke", with no idea which screen.
 *
 * The boundary is the half the person sees. This is the half that means
 * somebody finds out, and what it is careful about is what it refuses to
 * carry: this is a public endpoint whose whole job is receiving text from a
 * browser and putting it where an operator will read it.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";

afterAll(async () => { await closeTestApp(); });

describe("reporting a render crash", () => {
  it("is accepted from a browser nobody has signed in", async () => {
    const app = await getTestApp();
    /*
     * The case that justifies it being public: the sign-in screen itself
     * throwing. An authenticated endpoint could never hear about that one.
     */
    const res = await request(app).post("/api/client-errors")
      .set("x-forwarded-for", "198.51.190.10")
      .send({ message: "Cannot read properties of undefined (reading 'map')", where: "page", path: "/discover" });
    expect(res.status).toBe(204);
  });

  it("refuses a report with nothing in it", async () => {
    const app = await getTestApp();
    const res = await request(app).post("/api/client-errors")
      .set("x-forwarded-for", "198.51.190.11").send({});
    expect(res.status).toBe(400);
  });

  it("scrubs what a stack trace should never have carried off the machine", async () => {
    const app = await getTestApp();
    /*
     * Error messages pick things up. A token in a URL, an address in a
     * validation message — both end up in a stack, and this is the one payload
     * on its way to a webhook somebody else operates. The server's own
     * `redact` runs over it, so the check is that it runs at all.
     */
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await request(app).post("/api/client-errors")
        .set("x-forwarded-for", "198.51.190.12")
        .send({
          message: "failed for sk_live_abcdefghij1234567890 and dana@example.test",
          where: "page",
        });
      expect(res.status).toBe(204);

      const written = stderr.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(written, "a live key must never reach the drain").not.toContain("sk_live_abcdefghij1234567890");
      expect(written, "nor an address").not.toContain("dana@example.test");
    } finally {
      stderr.mockRestore();
    }
  });

  it("stops listening long before a render loop can flood it", async () => {
    const app = await getTestApp();
    const ip = "198.51.190.13";
    /*
     * A screen throwing inside a render loop reports as fast as the machine
     * will send. The first few are all anybody needs to find the bug; the rest
     * would be a denial of service with our own error handler as the weapon.
     */
    let refused = 0;
    for (let i = 0; i < 16; i += 1) {
      const res = await request(app).post("/api/client-errors")
        .set("x-forwarded-for", ip).send({ message: `throw ${i}` });
      if (res.status === 429) refused += 1;
    }
    expect(refused, "the limit has to bite").toBeGreaterThan(0);
  });
});
