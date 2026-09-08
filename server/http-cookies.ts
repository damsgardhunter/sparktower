/**
 * Reading and writing cookies, and telling a page from the things it pulls in.
 *
 * Shared by the analytics stream and signup attribution, which both need a
 * durable id stamped on the visitor's first arrival. Kept here so there is one
 * implementation of "append a Set-Cookie without clobbering the session's" —
 * two would eventually disagree, and the way you'd find out is people being
 * silently signed out.
 */
import type { Request, Response } from "express";

/** Minimal cookie parsing — one header, no dependency, no surprises. */
export function readCookies(req: Request): Record<string, string> {
  const raw = req.headers.cookie;
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* skip */ }
  }
  return out;
}

/** Appends a cookie, leaving any already set on the response alone. */
export function setCookie(res: Response, name: string, value: string, maxAgeSeconds: number) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") bits.push("Secure");
  const existing = res.getHeader("Set-Cookie");
  const list = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
  res.setHeader("Set-Cookie", [...list, bits.join("; ")]);
}

/**
 * Whether this is the HTML page itself, rather than something it pulls in.
 *
 * A path ending in an extension is an asset whatever its Accept header claims,
 * which is what keeps `/assets/index-abc123.js` out.
 */
export function isDocumentRequest(req: Request): boolean {
  if (req.method !== "GET") return false;
  if (!String(req.headers.accept || "").includes("text/html")) return false;
  return !/\.[a-z0-9]{2,5}$/i.test(req.path.split("?")[0]);
}

/** True when a referrer points back at us, so it isn't an external source. */
export function isSelfReferrer(referrer: string | undefined, host: string | undefined): boolean {
  if (!referrer) return true;
  if (!host) return false;
  try {
    return new URL(referrer).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
