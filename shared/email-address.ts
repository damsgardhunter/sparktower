/**
 * What counts as an email address here, before anything is sent to it.
 *
 * Registration used to accept anything non-empty. `notanemail`, `a@b`,
 * `x@@y.com` and `spaces here@x.com` all made accounts, and each one started a
 * confirmation email to an address that cannot receive one. That costs three
 * things: a bounce against the sending domain's reputation, which is the thing
 * that decides whether real invites land in inboxes; a row in `users` that can
 * never be verified or recovered; and a person who mistyped their address and
 * is now waiting for a message that will never arrive.
 *
 * This is the shape check. Whether a domain can actually receive mail is a DNS
 * question, and lives in server/email-deliverable.ts.
 *
 * The rules are deliberately a little looser than the RFC, which permits
 * quoted local parts and comments that no mail provider on earth will issue.
 * Anything refused here is something a person cannot have been given by their
 * provider, and the message says which part is wrong rather than "invalid
 * email".
 */

export const EMAIL_MAX = 254;
export const EMAIL_LOCAL_MAX = 64;

export interface EmailProblem { message: string; field: "email" }

/** Trimmed and lowercased: an address is one thing however it was typed. */
export const normalizeEmail = (email: string | null | undefined): string =>
  String(email ?? "").trim().toLowerCase();

/**
 * The domains people mean when they type something one letter away.
 *
 * Only exact, unambiguous misspellings of the largest providers — a suggestion
 * that is wrong is worse than none, because it is offered with confidence.
 */
const TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com",
  "gnail.com": "gmail.com", "gmaill.com": "gmail.com", "gmail.cm": "gmail.com",
  "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmail.co": "hotmail.com",
  "outlok.com": "outlook.com", "outloo.com": "outlook.com", "outlook.co": "outlook.com",
  "yahooo.com": "yahoo.com", "yaho.com": "yahoo.com", "yahoo.co": "yahoo.com",
  "iclod.com": "icloud.com", "icloud.co": "icloud.com", "icoud.com": "icloud.com",
  "protonmial.com": "protonmail.com",
};

/** The address somebody probably meant, or null when there's no confident answer. */
export function suggestAddress(email: string): string | null {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf("@");
  if (at < 0) return null;
  const fixed = TYPOS[normalized.slice(at + 1)];
  return fixed ? `${normalized.slice(0, at)}@${fixed}` : null;
}

/**
 * Whether this is shaped like an address a provider could have issued.
 * Returns null when it is fine.
 */
export function checkEmailShape(raw: unknown): EmailProblem | null {
  const email = normalizeEmail(typeof raw === "string" ? raw : "");
  if (!email) return { message: "Enter your email address.", field: "email" };
  if (email.length > EMAIL_MAX) return { message: "That address is too long.", field: "email" };
  if (/\s/.test(email)) return { message: "An email address can't contain spaces.", field: "email" };

  const at = email.indexOf("@");
  if (at < 0) return { message: "That's missing the @ — an address looks like you@example.com.", field: "email" };
  if (email.indexOf("@", at + 1) !== -1) return { message: "That has more than one @ in it.", field: "email" };

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  if (!local) return { message: "There's nothing before the @.", field: "email" };
  if (local.length > EMAIL_LOCAL_MAX) return { message: "The part before the @ is too long.", field: "email" };
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return { message: "The part before the @ can't start, end, or run two dots together.", field: "email" };
  }
  // Everything a provider will actually issue, and nothing that needs quoting.
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)) {
    return { message: "The part before the @ has a character an address can't contain.", field: "email" };
  }

  if (!domain) return { message: "There's nothing after the @.", field: "email" };
  if (!domain.includes(".")) {
    return { message: "The part after the @ needs a dot in it, like example.com.", field: "email" };
  }
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    return { message: "The part after the @ isn't a domain name.", field: "email" };
  }
  if (!/^[a-z0-9.-]+$/.test(domain) || domain.startsWith("-") || domain.endsWith("-")) {
    return { message: "The part after the @ isn't a domain name.", field: "email" };
  }
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (!/^[a-z]{2,}$/.test(tld)) {
    return { message: "That domain ending doesn't look right — did you mean .com?", field: "email" };
  }

  const meant = suggestAddress(email);
  if (meant) return { message: `Did you mean ${meant}?`, field: "email" };

  return null;
}
