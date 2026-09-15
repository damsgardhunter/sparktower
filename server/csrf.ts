/**
 * Cross-site request forgery: refusing writes that another site started.
 *
 * The session cookie is SameSite=Lax, which stops most of it — but not a
 * sibling subdomain ("same-site" to the browser), not a top-level form POST in
 * every browser, and not any write mounted on GET-like assumptions later. So
 * every state-changing request that carries cookies must also prove it came
 * from this site's own pages, in this order:
 *
 *   1. `Sec-Fetch-Site`, which every current browser sets and pages can't
 *      forge: "same-origin" and "none" (typed, bookmarked) pass; "same-site"
 *      and "cross-site" are refused.
 *   2. Without it (older browsers), `Origin` must name this host.
 *   3. Without that, `Referer` must.
 *
 * Requests with no cookies aren't in scope: a forged request's whole power is
 * the victim's ambient cookie. That's what keeps the mobile app and the editor
 * bridge (bearer tokens) and server-to-server callers working. A request with
 * an Authorization header likewise can't be forged cross-site without a CORS
 * preflight, which this server never grants. The Stripe webhook is mounted
 * before this and verified by signature instead.
 */
import type { Request, Response, NextFunction } from "express";

export const CROSS_SITE_REFUSED = { message: "This request didn't come from SparkTower, so it was refused. Reload the page and try again.", code: "cross_site" } as const;

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).host.toLowerCase(); } catch { return null; }
}

/** Hosts this server answers as: the request's own, the proxy's forwarded one, the public URL, and any listed extras. */
function trustedHosts(req: Request): Set<string> {
  const hosts = new Set<string>();
  const add = (h: string | null | undefined) => { if (h) hosts.add(h.trim().toLowerCase()); };
  add(req.headers.host);
  add(String(req.headers["x-forwarded-host"] ?? "").split(",")[0]);
  for (const o of [process.env.PUBLIC_URL, ...String(process.env.REPLIT_DOMAINS ?? "").split(","), ...String(process.env.CSRF_TRUSTED_ORIGINS ?? "").split(",")]) {
    const v = o?.trim();
    if (v) add(hostOf(/^https?:\/\//.test(v) ? v : `https://${v}`));
  }
  return hosts;
}

/** Why a request is cross-site, or null when it may proceed. */
export function crossSiteReason(req: Request): string | null {
  if (!UNSAFE.has(req.method)) return null;
  if (!req.headers.cookie) return null;
  if (req.headers.authorization) return null;

  const site = String(req.headers["sec-fetch-site"] ?? "").toLowerCase();
  if (site) return site === "same-origin" || site === "none" ? null : `sec-fetch-site: ${site}`;

  const hosts = trustedHosts(req);
  const origin = req.headers.origin;
  if (origin !== undefined) {
    const h = hostOf(origin); // "null" (sandboxed frames, redirected forms) parses to nothing and is refused
    return h && hosts.has(h) ? null : `origin: ${origin}`;
  }
  const referer = req.headers.referer;
  if (referer !== undefined) {
    const h = hostOf(referer);
    return h && hosts.has(h) ? null : `referer: ${referer}`;
  }
  // No provenance at all: not a browser page (browsers send Origin on every cross-site POST).
  return null;
}

export function sameOriginWrites() {
  return (req: Request, res: Response, next: NextFunction) => {
    const reason = crossSiteReason(req);
    if (!reason) return next();
    console.warn(`Refused cross-site ${req.method} ${req.path} (${reason})`);
    res.status(403).json(CROSS_SITE_REFUSED);
  };
}
