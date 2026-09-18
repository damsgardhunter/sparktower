/**
 * One way to fetch a URL somebody else chose.
 *
 * Three places in this codebase reached out to an address a user supplied — the
 * promotion sync, the audit's runtime probe, and merch logo rendering — and
 * each had written its own guard. The promotion sync's was right: it resolves
 * the hostname and checks the *addresses* it resolves to, refuses anything on
 * the network the server sits in, follows redirects by hand so every hop is
 * checked again, and stops reading at a size cap.
 *
 * The other two matched a blocklist of hostnames and literal IPs and then
 * called `fetch(url, { redirect: "follow" })`. That is the shape with the hole
 * in it: `https://example.com/logo.png` passes the check and answers `302
 * Location: http://169.254.169.254/latest/meta-data/`, and the redirect is
 * followed without anybody looking at it. A blocklist of hostnames also does
 * nothing about a name that simply resolves to 127.0.0.1, which costs an
 * attacker one DNS record.
 *
 * So the good one lives here now, and all three use it. The part worth keeping
 * in mind: DNS is resolved, then fetched by URL, so a name that answers
 * differently between the two lookups is still a hole (DNS rebinding). Closing
 * that means pinning the connection to the address we checked, which needs a
 * custom agent; this is the honest limit of what is here.
 */
import { lookup } from "node:dns/promises";
import { isPrivateAddress } from "@shared/promotion-sources";

export interface Fetched { ok: boolean; status: number; url: string; contentType: string; body: Buffer }

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  method?: "GET" | "HEAD";
  userAgent?: string;
  /** http as well as https. Only for things people typed long before we asked for https. */
  allowHttp?: boolean;
  /** Hops to follow, each re-checked. */
  maxRedirects?: number;
}

const DEFAULT_AGENT = "Mozilla/5.0 (compatible; SparkTowerBot/1.0; +https://sparktower.app)";

/**
 * Fetch a URL that a stranger chose, or throw saying why not.
 *
 * Every hop is checked again before it is followed: the protocol, the
 * hostname's resolved addresses, and any credentials smuggled into the URL.
 */
export async function safeFetch(start: string, opts: SafeFetchOptions = {}): Promise<Fetched> {
  const {
    maxBytes = 3 * 1024 * 1024,
    timeoutMs = 12_000,
    method = "GET",
    userAgent = DEFAULT_AGENT,
    allowHttp = false,
    maxRedirects = 4,
  } = opts;

  let url = start;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && !(allowHttp && parsed.protocol === "http:")) {
      throw new Error(`not https: ${url}`);
    }
    // A URL carrying credentials is aimed at something that wants them, and it isn't us.
    if (parsed.username || parsed.password) throw new Error(`refused credentials in ${parsed.hostname}`);

    const addresses = await lookup(parsed.hostname, { all: true });
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
      throw new Error(`refused address for ${parsed.hostname}`);
    }

    const res = await fetch(url, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": userAgent, "accept-language": "en" },
    });

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      // Round the loop rather than letting fetch follow it: the next address gets checked too.
      url = new URL(res.headers.get("location")!, url).toString();
      continue;
    }

    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (method === "HEAD") return { ok: res.ok, status: res.status, url, contentType, body: Buffer.alloc(0) };

    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new Error(`too large: ${url}`);

    // Read in chunks and stop at the cap, because a content-length header is a claim.
    const reader = res.body?.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new Error(`too large: ${url}`); }
      chunks.push(Buffer.from(value));
    }
    return { ok: res.ok, status: res.status, url, contentType, body: Buffer.concat(chunks) };
  }
  throw new Error(`too many redirects: ${start}`);
}
