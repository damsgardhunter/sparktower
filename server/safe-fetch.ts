/**
 * One way to fetch a URL somebody else chose.
 *
 * Three places in this codebase reach out to an address a user supplied — the
 * promotion sync, the audit's runtime probe, and merch logo rendering — and
 * each had written its own guard. Two of them matched a blocklist of hostnames
 * and literal IPs and then called `fetch(url, { redirect: "follow" })`, which
 * is the shape with the hole in it: `https://example.com/logo.png` passes the
 * check and answers `302 Location: http://169.254.169.254/latest/meta-data/`,
 * and the redirect is followed with nobody looking at it.
 *
 * What this does instead, in order:
 *
 *  1. Resolves the hostname and refuses if *any* address it resolves to is on
 *     the network this server sits in. A blocklist of hostnames is no defence
 *     against an ordinary name pointed at 127.0.0.1, which costs an attacker
 *     one DNS record.
 *  2. Connects to that address, pinned — `host` is the IP we just checked,
 *     while TLS validates the certificate against the *name* (`servername`)
 *     and the request carries the original `Host`. This is what closes DNS
 *     rebinding: a name that answers publicly for the check and privately a
 *     moment later cannot move the connection, because the connection was
 *     already aimed at the address that passed.
 *  3. Follows redirects by hand, running every hop through 1 and 2 again.
 *  4. Stops reading at a size cap, whatever `content-length` claimed.
 *
 * It is written on `node:http`/`node:https` rather than `fetch` because that is
 * the only way to say "connect *here* but verify *that name*" without adding a
 * dependency: `fetch` gives no way to pin the address, and rewriting the URL to
 * the IP would break certificate validation instead.
 */
import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { isPrivateAddress } from "@shared/promotion-sources";

export interface Fetched { ok: boolean; status: number; url: string; contentType: string; body: Buffer }

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  method?: "GET" | "HEAD";
  userAgent?: string;
  /** http as well as https. Only for addresses people typed long before we asked for https. */
  allowHttp?: boolean;
  /** Hops to follow, each re-checked. */
  maxRedirects?: number;
  /** Test seam: how a single request is made, once its address has been checked. */
  transport?: Transport;
}

/** One request to one already-checked address. Returns the status line, headers and body stream. */
export type Transport = (args: {
  url: URL;
  address: string;
  family: number;
  method: "GET" | "HEAD";
  headers: Record<string, string>;
  timeoutMs: number;
}) => Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: AsyncIterable<Buffer> }>;

const DEFAULT_AGENT = "Mozilla/5.0 (compatible; SparkTowerBot/1.0; +https://sparktower.app)";

const nodeTransport: Transport = ({ url, address, family, method, headers, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const secure = url.protocol === "https:";
    const request = (secure ? https : http).request(
      {
        // The address that passed the check, not the name — resolved once, connected once.
        host: address,
        family,
        port: url.port ? Number(url.port) : secure ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        method,
        // The certificate is still checked against the hostname, not the IP.
        ...(secure ? { servername: url.hostname } : {}),
        headers: { ...headers, Host: url.host },
        timeout: timeoutMs,
      },
      (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res as AsyncIterable<Buffer> }),
    );
    request.on("timeout", () => request.destroy(new Error("timed out")));
    request.on("error", reject);
    request.end();
  });

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
    transport = nodeTransport,
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

    const res = await transport({
      url: parsed,
      address: addresses[0].address,
      family: addresses[0].family,
      method,
      headers: { "user-agent": userAgent, "accept-language": "en" },
      timeoutMs,
    });

    const header = (name: string): string => {
      const v = res.headers[name];
      return Array.isArray(v) ? (v[0] ?? "") : String(v ?? "");
    };

    if (res.status >= 300 && res.status < 400 && header("location")) {
      // Round the loop rather than letting the transport follow it: the next address gets checked too.
      url = new URL(header("location"), url).toString();
      continue;
    }

    const contentType = header("content-type").split(";")[0].trim().toLowerCase();
    const ok = res.status >= 200 && res.status < 300;
    if (method === "HEAD") return { ok, status: res.status, url, contentType, body: Buffer.alloc(0) };

    const declared = Number(header("content-length") || 0);
    if (declared > maxBytes) throw new Error(`too large: ${url}`);

    // Read in pieces and stop at the cap, because a content-length header is a claim.
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body) {
      const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += piece.length;
      if (size > maxBytes) throw new Error(`too large: ${url}`);
      chunks.push(piece);
    }
    return { ok, status: res.status, url, contentType, body: Buffer.concat(chunks) };
  }
  throw new Error(`too many redirects: ${start}`);
}
