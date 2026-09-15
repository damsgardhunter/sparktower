/**
 * Security headers on every response (helmet), with a Content Security Policy
 * written against what the app actually loads.
 *
 *  - Clickjacking: `frame-ancestors 'none'` and X-Frame-Options: DENY — no page
 *    of ours can be framed by another site.
 *  - Injection: scripts only from our origin and YouTube's player API; no
 *    inline or eval'd script; `object-src 'none'`; `base-uri 'self'`; forms
 *    post only to us. Styles allow 'unsafe-inline' — the UI library sets style
 *    attributes and the chart writes a <style> — a much smaller risk than script.
 *  - HSTS, production only (it's meaningless over http and would pin a local
 *    host to https). No `preload`: that's a one-way door to decide on purpose.
 *  - Referrer-Policy: strict-origin-when-cross-origin, not no-referrer —
 *    YouTube refuses to play an embed that sends no referrer at all.
 *
 * In development the same policy is sent report-only, loosened for Vite (its
 * inline refresh preamble and the HMR websocket): a violation shows up in the
 * console without breaking the dev server, so a new third party is noticed
 * before it's shipped. Adding one means adding it here.
 */
import helmet from "helmet";
import type { RequestHandler } from "express";

/** Every host outside our origin the pages use, and why. */
export const CSP_SOURCES = {
  /** YouTube's IFrame Player API (components/promo-video-player.tsx) loads its widget script from here. */
  scripts: ["https://www.youtube.com"],
  styles: ["https://fonts.googleapis.com"],
  fonts: ["https://fonts.gstatic.com"],
  /** Promotion videos: YouTube (privacy-enhanced host) and Vimeo. */
  frames: ["https://www.youtube-nocookie.com", "https://www.youtube.com", "https://player.vimeo.com"],
  /** Direct uploads go to a presigned object-storage URL. */
  connect: ["https://storage.googleapis.com"],
} as const;

export function contentSecurityPolicy(opts: { production: boolean }): Record<string, string[]> {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", ...CSP_SOURCES.scripts],
    "style-src": ["'self'", "'unsafe-inline'", ...CSP_SOURCES.styles],
    "font-src": ["'self'", "data:", ...CSP_SOURCES.fonts],
    // Avatars, project logos, video thumbnails and admin-set promotion logos come from many https hosts.
    "img-src": ["'self'", "data:", "blob:", "https:"],
    // Uploaded promotion videos can be any https .mp4/.webm.
    "media-src": ["'self'", "blob:", "https:"],
    "connect-src": ["'self'", ...CSP_SOURCES.connect],
    "frame-src": [...CSP_SOURCES.frames],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };
  if (opts.production) {
    directives["upgrade-insecure-requests"] = [];
  } else {
    // Vite: the React refresh preamble is inline, and HMR talks over a websocket.
    directives["script-src"].push("'unsafe-inline'", "'unsafe-eval'");
    directives["connect-src"].push("ws:", "wss:");
  }
  return directives;
}

/** `enforce`: the policy blocks rather than reports. Always in production; CSP_ENFORCE=1 elsewhere (the browser tests run with it). */
export function securityHeaders(opts: { production: boolean; enforce?: boolean }): RequestHandler {
  return helmet({
    contentSecurityPolicy: { useDefaults: false, directives: contentSecurityPolicy(opts), reportOnly: !(opts.production || opts.enforce) },
    strictTransportSecurity: opts.production ? { maxAge: 31_536_000, includeSubDomains: true, preload: false } : false,
    xFrameOptions: { action: "deny" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // Same-origin opener isolation; the OAuth and checkout flows are redirects, not popups.
    crossOriginOpenerPolicy: { policy: "same-origin" },
    // Our images and logos may be shown by the mobile app and link unfurlers: same-site, not same-origin.
    crossOriginResourcePolicy: { policy: "same-site" },
    // Would require every embedded resource (YouTube, fonts) to opt in; not worth breaking them for.
    crossOriginEmbedderPolicy: false,
  });
}
