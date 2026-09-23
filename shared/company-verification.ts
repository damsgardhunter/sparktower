/**
 * Proving a company is that company.
 *
 * ## The hole this closes
 *
 * Anyone could create a company called anything and post a challenge under it,
 * with a prize that was a sentence. A builder could spend a fortnight on an
 * entry for a company that did not exist, judged by nobody, for a prize that
 * was never going to arrive — and the product had no way to tell them, because
 * it did not know either.
 *
 * ## What is actually checked
 *
 * Control of the website, and nothing more ambitious than that.
 *
 * There is no way to verify that a company is *good*, or solvent, or that the
 * person typing is allowed to speak for it. What can be proved is that whoever
 * is asking can put a file on `example.com` or change its DNS — which is a
 * thing employees of a company can do and strangers cannot, and it is the same
 * proof Google, Stripe and every certificate authority rely on.
 *
 * Two routes, because organisations are shaped differently. A file under
 * `/.well-known/` is easy where somebody can deploy; a DNS TXT record is the
 * one to reach for when the site is a locked-down marketing page nobody can
 * touch.
 *
 * ## The rule that does the most work
 *
 * **One domain, one company.** Impersonation is not mainly stopped by making
 * verification hard — it is stopped by making the real company's domain
 * unavailable to anybody else. Once `acme.com` is claimed, a second "ACME
 * Inc." cannot claim it, and a challenge posted by a company that has not
 * claimed any domain cannot exist at all.
 *
 * Pure: no network, no database. The server does the fetching and the storing.
 */

/** Where the file goes. Fixed, because it is printed in instructions people follow by hand. */
export const VERIFICATION_PATH = "/.well-known/sparktower-verification.txt";

/** The DNS record's name, prefixed to the domain: `_sparktower.example.com`. */
export const VERIFICATION_DNS_PREFIX = "_sparktower";

/** Every token starts with this, so a record found in the wild is obviously ours. */
export const TOKEN_PREFIX = "sparktower-verify-";

/** How long a started verification has before its token stops being accepted. */
export const VERIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** How many times one account may fail a check before it has to start again. Stops a token being brute-forced against a third party's site. */
export const MAX_CHECK_ATTEMPTS = 20;

export type VerificationMethod = "file" | "dns";

/**
 * A domain, as this product will store and compare it.
 *
 * Everything is lowercased, the scheme and path are dropped, `www.` is dropped,
 * and a trailing dot goes. Without this, `https://WWW.Acme.com/` and `acme.com`
 * are two different companies to a uniqueness check, which is the entire
 * defence.
 *
 * Returns null for anything that is not a plausible registrable domain, rather
 * than guessing — an empty label, an IP address, a port, a single label with no
 * dot. A verification against `localhost` is not a verification.
 */
export function normaliseDomain(input: unknown): string | null {
  let raw = String(input ?? "").trim().toLowerCase();
  if (!raw) return null;

  // Tolerate a pasted URL, which is what people actually have to hand.
  if (raw.includes("://")) {
    try { raw = new URL(raw).hostname; } catch { return null; }
  } else {
    raw = raw.split("/")[0];
  }
  raw = raw.replace(/\.$/, "");
  // A port is not part of a domain, and `acme.com:8080` must not become a second acme.com.
  if (raw.includes(":")) return null;
  if (raw.startsWith("www.")) raw = raw.slice(4);

  // An address is not a domain: nobody's company is at 203.0.113.4.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) return null;

  const labels = raw.split(".");
  if (labels.length < 2) return null;
  for (const label of labels) {
    if (!label || label.length > 63) return null;
    if (!/^[a-z0-9-]+$/.test(label)) return null;
    if (label.startsWith("-") || label.endsWith("-")) return null;
  }
  // A last label of digits is not a TLD.
  if (/^\d+$/.test(labels[labels.length - 1])) return null;
  if (raw.length > 253) return null;
  return raw;
}

/**
 * Domains nobody may claim as their company's.
 *
 * Free mail and free hosting: anybody can get an address at gmail.com and a
 * page at github.io, so proving control of one proves nothing about a company.
 * Claiming them would also be worse than useless — it would let the first
 * comer lock out everybody else who genuinely uses that host, because of the
 * one-domain-one-company rule.
 *
 * Deliberately short and obvious. It is not a spam filter; it is a list of
 * hosts where "I control this" does not mean "this is my company".
 */
export const UNCLAIMABLE_DOMAINS: readonly string[] = [
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "ymail.com", "aol.com", "icloud.com", "me.com", "mac.com",
  "proton.me", "protonmail.com", "pm.me", "tutanota.com", "zoho.com", "gmx.com", "mail.com",
  "qq.com", "163.com", "126.com", "yandex.ru",
];

/**
 * Hosts that hand out subdomains to anybody. A page at `someone.github.io` is
 * that person's page, not a company at github.io — and the parent must stay
 * unclaimable so the first person to try cannot take it from everyone.
 */
export const SHARED_SUBDOMAIN_HOSTS: readonly string[] = [
  "github.io", "gitlab.io", "vercel.app", "netlify.app", "pages.dev", "web.app", "firebaseapp.com",
  "herokuapp.com", "onrender.com", "replit.app", "replit.dev", "glitch.me", "surge.sh",
  "wordpress.com", "blogspot.com", "wixsite.com", "squarespace.com", "weebly.com", "webflow.io",
  "notion.site", "carrd.co", "substack.com", "medium.com", "linktr.ee",
  "myshopify.com", "bigcartel.com", "gumroad.com",
  "s3.amazonaws.com", "cloudfront.net", "azurewebsites.net", "appspot.com",
];

/** Why this domain can't be claimed, or null if it can. */
export function unclaimableReason(domain: string): string | null {
  if (UNCLAIMABLE_DOMAINS.includes(domain)) {
    return "That's a personal email provider, not a company website. Use the domain your company's own site is on.";
  }
  for (const host of SHARED_SUBDOMAIN_HOSTS) {
    if (domain === host) {
      return `${host} hands out addresses to anybody, so controlling it doesn't identify a company. Use your own domain.`;
    }
    if (domain.endsWith(`.${host}`)) {
      return `A page on ${host} belongs to whoever made it rather than to a company anyone can check. Use a domain your company owns.`;
    }
  }
  return null;
}

/** A token is opaque; this is only the shape, so a malformed one is refused before any network call. */
export const isVerificationToken = (v: unknown): v is string =>
  typeof v === "string" && v.startsWith(TOKEN_PREFIX) && /^[a-z0-9-]{24,96}$/.test(v);

/**
 * What to tell somebody to do, in the order they will do it.
 *
 * Written here rather than in the client so the phone, the web and the email
 * that will eventually carry it cannot describe the same task three ways —
 * and so the path and the record name in the instructions are the literal ones
 * the checker looks for.
 */
export function verificationSteps(domain: string, token: string): Record<VerificationMethod, { title: string; steps: string[] }> {
  return {
    file: {
      title: "Put a file on your site",
      steps: [
        `Create a file containing exactly: ${token}`,
        `Publish it at https://${domain}${VERIFICATION_PATH}`,
        "It has to be reachable without signing in, and answer over https.",
      ],
    },
    dns: {
      title: "Add a DNS record",
      steps: [
        `Add a TXT record for ${VERIFICATION_DNS_PREFIX}.${domain}`,
        `Set its value to exactly: ${token}`,
        "DNS can take a few minutes to publish. Check again after that.",
      ],
    },
  };
}
