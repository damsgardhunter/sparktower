/**
 * The address this site is reachable at, and the address it sends mail as.
 *
 * Every link in every email is built from `publicBaseUrl`. It used to be built
 * three times: `email-verification.ts` and `password-reset.ts` carried the same
 * function copied word for word, and `invite-routes.ts` had a third with a
 * different order of preference — `SERVER_BASE_URL` before `PUBLIC_URL`, where
 * the other two never looked at `SERVER_BASE_URL` at all. Two consequences,
 * both silent:
 *
 *   - With both variables set to different hosts, an invite pointed somewhere
 *     the confirmation link didn't. The e2e configuration sets exactly that
 *     pair, so it was not hypothetical.
 *   - The invite version never added a scheme. `SERVER_BASE_URL=sparktower.app`
 *     produced `sparktower.app/invite/…`, which is a relative path: the mail
 *     client shows a link and it opens nothing.
 *
 * One function now, one order of preference, one place to fix.
 *
 * The host it returns also has to be one the CSRF guard trusts (server/csrf.ts
 * reads `PUBLIC_URL` into its trusted set), or the page the link opens can't
 * submit the form it exists to show. `emailLinkHostIsTrusted` below is what
 * says so out loud rather than leaving it to be discovered by a person whose
 * password reset silently refuses.
 */

/** A bare host, a full URL, or something with a trailing slash — all the same thing, normalised. */
function normalise(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Where a link in an email should point.
 *
 * `PUBLIC_URL` first because it is the one the CSRF guard trusts and the one a
 * person typed on purpose. `SERVER_BASE_URL` next, then Replit's domain, then —
 * only when nothing is configured — the host this request happens to have
 * arrived on, which is right in development and a guess anywhere else.
 */
export function publicBaseUrl(req?: { headers?: Record<string, any>; protocol?: string }): string {
  const configured =
    process.env.PUBLIC_URL ||
    process.env.SERVER_BASE_URL ||
    process.env.REPLIT_DOMAINS?.split(",")[0];
  if (configured?.trim()) return normalise(configured);

  const host = String(req?.headers?.["x-forwarded-host"] ?? req?.headers?.host ?? "localhost:5001").split(",")[0].trim();
  const protocol = String(
    req?.headers?.["x-forwarded-proto"] ?? req?.protocol ?? (/^localhost|^127\.0\.0\.1/.test(host) ? "http" : "https"),
  ).split(",")[0].trim();
  return `${protocol}://${host}`;
}

/** The host part of an address or a `Name <addr@host>` string, lowercased. */
export function domainOf(address: string | undefined | null): string | null {
  const at = String(address ?? "").replace(/^.*<|>.*$/g, "").trim().toLowerCase();
  const domain = at.split("@")[1];
  return domain && domain.includes(".") ? domain : null;
}

/** The host of a URL or bare host, lowercased and without a port. */
export function hostOf(value: string | undefined | null): string | null {
  if (!value?.trim()) return null;
  try { return new URL(normalise(value)).hostname.toLowerCase(); } catch { return null; }
}

/**
 * Does `EMAIL_FROM` send as a domain the receiving end will accept?
 *
 * DMARC passes only when the domain in the visible From address lines up with
 * the domain that SPF or DKIM authenticated. Sending as `hello@gmail.com`
 * through Resend fails every time, however perfect the DNS — the records are
 * published for a domain the From header doesn't name.
 *
 * This can't reach DNS (that's scripts/check-email-auth.mjs), so it checks the
 * one thing visible from inside the process: that the From domain is the site's
 * own, or a subdomain of it. A separate sending subdomain such as
 * `mail.sparktower.app` is the normal arrangement and passes.
 */
export function senderAlignment(): {
  ok: boolean;
  from: string | null;
  fromDomain: string | null;
  siteDomain: string | null;
  reason: string | null;
} {
  const from = process.env.EMAIL_FROM?.trim() || null;
  const fromDomain = domainOf(from);
  const siteDomain = hostOf(process.env.PUBLIC_URL || process.env.SERVER_BASE_URL || process.env.REPLIT_DOMAINS?.split(",")[0]);

  if (!from) return { ok: false, from, fromDomain, siteDomain, reason: "EMAIL_FROM is not set" };
  if (!fromDomain) return { ok: false, from, fromDomain, siteDomain, reason: `EMAIL_FROM has no domain in it: ${from}` };
  // Nothing to compare against isn't a misalignment — it's an unconfigured site.
  if (!siteDomain) return { ok: true, from, fromDomain, siteDomain, reason: null };

  const registrable = (d: string) => d.split(".").slice(-2).join(".");
  const aligned = fromDomain === siteDomain || registrable(fromDomain) === registrable(siteDomain);
  return {
    ok: aligned,
    from, fromDomain, siteDomain,
    reason: aligned ? null : `EMAIL_FROM sends as ${fromDomain} but the site is ${siteDomain}`,
  };
}

/**
 * Said at boot, because the failure is invisible from here.
 *
 * Mail that fails alignment isn't bounced in a way this process ever sees:
 * Resend accepts it, reports it as sent, and the receiver files it as spam or
 * drops it. The only symptom is people not arriving, which reads as "nobody
 * signed up today" rather than as a configuration mistake.
 */
export function warnIfSenderMisaligned(): void {
  if (process.env.NODE_ENV === "test") return;
  const { ok, reason, from, fromDomain, siteDomain } = senderAlignment();
  if (ok || !reason) return;
  /*
   * Nothing to say about the alignment of an address that doesn't exist.
   * `warnIfEmailUnconfigured` already reports an unset EMAIL_FROM, and better —
   * it names the consequence. Without this guard the two fire together and the
   * second one reads "mail sent as null", which is noise on top of a real
   * message.
   */
  if (!from) return;
  const message =
    `[email] ${reason}. Mail sent as ${fromDomain} passes DMARC only if SPF and DKIM are published for ${fromDomain} ` +
    `— publishing them for ${siteDomain} does nothing for it. Receivers will accept the message and file it as spam. ` +
    `See docs/ops/email-authentication.md.`;
  if (process.env.NODE_ENV === "production") console.error(message);
  else console.warn(message);
}

/**
 * Would a link built for this email open a page that can then submit a form?
 *
 * The CSRF guard trusts the request's own host, `PUBLIC_URL`, `REPLIT_DOMAINS`
 * and `CSRF_TRUSTED_ORIGINS` — not `SERVER_BASE_URL`. So a deployment that set
 * only `SERVER_BASE_URL` would send links to a host the guard has never heard
 * of, and every form on the far end of one (confirm, accept invite, set a new
 * password) would be refused as cross-site. Exported so a test can hold the two
 * lists together; they are edited in different files and drift silently.
 */
export function emailLinkHostIsTrusted(): { ok: boolean; linkHost: string | null; reason: string | null } {
  const linkHost = hostOf(publicBaseUrl());
  if (!linkHost) return { ok: true, linkHost, reason: null };
  // Mirrors trustedHosts() in server/csrf.ts, minus the per-request headers.
  const trusted = new Set(
    [process.env.PUBLIC_URL, ...String(process.env.REPLIT_DOMAINS ?? "").split(","), ...String(process.env.CSRF_TRUSTED_ORIGINS ?? "").split(",")]
      .map((v) => hostOf(v))
      .filter((h): h is string => !!h),
  );
  // Nothing configured: every host is the request's own, which the guard trusts.
  if (!trusted.size) return { ok: true, linkHost, reason: null };
  return trusted.has(linkHost)
    ? { ok: true, linkHost, reason: null }
    : {
        ok: false,
        linkHost,
        reason: `email links point at ${linkHost}, which server/csrf.ts does not trust — add it to PUBLIC_URL or CSRF_TRUSTED_ORIGINS, or forms opened from an email will be refused as cross-site`,
      };
}
