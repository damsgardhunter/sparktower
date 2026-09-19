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

/**
 * A stand-in for one request to one already-checked address. The real one
 * connects to that address with the certificate checked against the hostname
 * (server/safe-fetch.ts); what a test needs is the answer, plus a record of
 * where the connection was actually aimed.
 */
function transportReturning(...replies: { status: number; headers?: Record<string, string>; body?: string }[]) {
  const calls: { address: string; host: string }[] = [];
  let i = 0;
  const transport = async ({ url, address }: any) => {
    calls.push({ address, host: url.hostname });
    const r = replies[Math.min(i++, replies.length - 1)];
    return {
      status: r.status,
      headers: r.headers ?? {},
      body: (async function* () { if (r.body) yield Buffer.from(r.body); })(),
    };
  };
  return { transport, calls };
}

afterEach(() => { lookup.mockReset(); });

describe("fetching what somebody else chose", () => {
  it("refuses a hostname that resolves onto our own network", async () => {
    resolvesTo("127.0.0.1");
    const { transport, calls } = transportReturning({ status: 200 });
    // No blocklist would catch this: the name is ordinary, the address is not.
    await expect(safeFetch("https://totally-normal.example/logo.png", { transport })).rejects.toThrow(/refused address/);
    expect(calls, "nothing should have been requested").toEqual([]);
  });

  it("refuses the cloud metadata address, however it is reached", async () => {
    resolvesTo("169.254.169.254");
    const { transport } = transportReturning({ status: 200 });
    await expect(safeFetch("https://metadata.example/", { transport })).rejects.toThrow(/refused address/);
  });

  it("checks the redirect, not just the first address — the hole this closes", async () => {
    lookup
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])   // the URL somebody gave us
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]); // where it sends us
    const { transport } = transportReturning({ status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
    await expect(safeFetch("https://example.com/logo.png", { allowHttp: true, transport })).rejects.toThrow(/refused address/);
  });

  it("follows a redirect that stays public", async () => {
    resolvesTo("93.184.216.34");
    const { transport, calls } = transportReturning(
      { status: 301, headers: { location: "https://cdn.example.com/logo.png" } },
      { status: 200, headers: { "content-type": "image/png; charset=binary" }, body: "PNGDATA" },
    );

    const res = await safeFetch("https://example.com/logo.png", { transport });
    // Both hops were aimed at the address that passed the check, not at a name resolved again later.
    expect(calls.map((c) => c.address)).toEqual(["93.184.216.34", "93.184.216.34"]);
    expect(res.status).toBe(200);
    expect(res.contentType).toBe("image/png");
    expect(res.body.toString()).toBe("PNGDATA");
    expect(res.url, "reports where it ended up").toBe("https://cdn.example.com/logo.png");
  });

  it("gives up rather than going round forever", async () => {
    resolvesTo("93.184.216.34");
    const { transport } = transportReturning({ status: 302, headers: { location: "https://example.com/again" } });
    await expect(safeFetch("https://example.com/", { transport })).rejects.toThrow(/too many redirects/);
  });

  it("refuses credentials smuggled into the URL", async () => {
    resolvesTo("93.184.216.34");
    const { transport } = transportReturning({ status: 200 });
    await expect(safeFetch("https://user:secret@example.com/", { transport })).rejects.toThrow(/credentials/);
  });

  it("refuses anything that isn't http(s), and http only when asked", async () => {
    resolvesTo("93.184.216.34");
    const { transport } = transportReturning({ status: 200, headers: { "content-type": "image/png" }, body: "ok" });
    await expect(safeFetch("file:///etc/passwd", { transport })).rejects.toThrow();
    await expect(safeFetch("http://example.com/", { transport })).rejects.toThrow(/not https/);
    // And with allowHttp it goes through.
    expect((await safeFetch("http://example.com/", { allowHttp: true, transport })).ok).toBe(true);
  });

  it("stops reading at the size cap, whatever the headers claimed", async () => {
    resolvesTo("93.184.216.34");
    // Honest header, too big.
    const honest = transportReturning({ status: 200, headers: { "content-length": "999999" }, body: "x" });
    await expect(safeFetch("https://example.com/big", { maxBytes: 10, transport: honest.transport })).rejects.toThrow(/too large/);

    // Lying header, still too big — the body is what counts.
    const liar = transportReturning({ status: 200, headers: { "content-length": "1" }, body: "x".repeat(50) });
    await expect(safeFetch("https://example.com/liar", { maxBytes: 10, transport: liar.transport })).rejects.toThrow(/too large/);
  });
});
