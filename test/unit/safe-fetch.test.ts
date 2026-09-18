/**
 * Fetching a URL a stranger chose, including the second one.
 *
 * Three places reached out to user-supplied addresses and each had its own
 * guard. Two of them checked the address they were handed and then called
 * `fetch(url, { redirect: "follow" })` — so `https://example.com/logo.png`
 * passed the check, answered `302 Location: http://169.254.169.254/…`, and the
 * redirect was followed with nobody looking at it. The third did it properly.
 * This pins the properties of the one they all use now.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup }));

const { safeFetch } = await import("../../server/safe-fetch");

/** Every hostname resolves somewhere public unless a test says otherwise. */
const resolvesTo = (address: string) => lookup.mockResolvedValue([{ address, family: address.includes(":") ? 6 : 4 }]);

const reply = (status: number, headers: Record<string, string> = {}, body = "") =>
  new Response(body, { status, headers });

afterEach(() => { vi.unstubAllGlobals(); lookup.mockReset(); });

describe("fetching what somebody else chose", () => {
  it("refuses a hostname that resolves onto our own network", async () => {
    resolvesTo("127.0.0.1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // No blocklist would catch this: the name is ordinary, the address is not.
    await expect(safeFetch("https://totally-normal.example/logo.png")).rejects.toThrow(/refused address/);
    expect(fetchMock, "nothing should have been requested").not.toHaveBeenCalled();
  });

  it("refuses the cloud metadata address, however it is reached", async () => {
    resolvesTo("169.254.169.254");
    vi.stubGlobal("fetch", vi.fn());
    await expect(safeFetch("https://metadata.example/")).rejects.toThrow(/refused address/);
  });

  it("checks the redirect, not just the first address — the hole this closes", async () => {
    lookup
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])   // the URL somebody gave us
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]); // where it sends us
    vi.stubGlobal("fetch", vi.fn(async () =>
      reply(302, { location: "http://169.254.169.254/latest/meta-data/" })));

    await expect(safeFetch("https://example.com/logo.png", { allowHttp: true })).rejects.toThrow(/refused address/);
  });

  it("follows a redirect that stays public", async () => {
    resolvesTo("93.184.216.34");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(301, { location: "https://cdn.example.com/logo.png" }))
      .mockResolvedValueOnce(reply(200, { "content-type": "image/png; charset=binary" }, "PNGDATA"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await safeFetch("https://example.com/logo.png");
    expect(res.status).toBe(200);
    expect(res.contentType).toBe("image/png");
    expect(res.body.toString()).toBe("PNGDATA");
    expect(res.url, "reports where it ended up").toBe("https://cdn.example.com/logo.png");
  });

  it("gives up rather than going round forever", async () => {
    resolvesTo("93.184.216.34");
    vi.stubGlobal("fetch", vi.fn(async () => reply(302, { location: "https://example.com/again" })));
    await expect(safeFetch("https://example.com/")).rejects.toThrow(/too many redirects/);
  });

  it("refuses credentials smuggled into the URL", async () => {
    resolvesTo("93.184.216.34");
    vi.stubGlobal("fetch", vi.fn());
    await expect(safeFetch("https://user:secret@example.com/")).rejects.toThrow(/credentials/);
  });

  it("refuses anything that isn't http(s), and http only when asked", async () => {
    resolvesTo("93.184.216.34");
    vi.stubGlobal("fetch", vi.fn());
    await expect(safeFetch("file:///etc/passwd")).rejects.toThrow();
    await expect(safeFetch("http://example.com/")).rejects.toThrow(/not https/);
    // And with allowHttp it goes through.
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { "content-type": "image/png" }, "ok")));
    expect((await safeFetch("http://example.com/", { allowHttp: true })).ok).toBe(true);
  });

  it("stops reading at the size cap, whatever the headers claimed", async () => {
    resolvesTo("93.184.216.34");
    // Honest header, too big.
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { "content-length": "999999" }, "x")));
    await expect(safeFetch("https://example.com/big", { maxBytes: 10 })).rejects.toThrow(/too large/);

    // Lying header, still too big — the body is what counts.
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { "content-length": "1" }, "x".repeat(50))));
    await expect(safeFetch("https://example.com/liar", { maxBytes: 10 })).rejects.toThrow(/too large/);
  });
});
