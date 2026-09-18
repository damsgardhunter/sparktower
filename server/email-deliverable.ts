/**
 * Can this domain receive mail at all?
 *
 * The shape check (shared/email-address.ts) catches `notanemail`. It cannot
 * catch `casey@gmial.com`, which is shaped perfectly and belongs to nobody —
 * and every one of those costs a bounce. Bounces are what a receiving provider
 * counts when it decides whether the next invite from this domain reaches an
 * inbox or a spam folder, which makes this a deliverability problem before it
 * is a data-quality one.
 *
 * So before a confirmation is sent, the domain is asked whether it has anywhere
 * to deliver: an MX record, or — per RFC 5321 §5.1, which every mail server
 * implements — an A/AAAA record it would fall back to.
 *
 * What this deliberately does not do is check whether the *mailbox* exists.
 * That needs an SMTP conversation with the receiving server, gets this server's
 * address treated as a spammer probing for valid addresses, and is refused or
 * lied to by every large provider. The confirmation email is the mailbox check;
 * this is only about not sending one into a void.
 *
 * Failures of our own resolver are not the address's fault: a lookup that times
 * out or errors lets the address through. The only verdict that refuses is a
 * definite "this domain has nowhere to deliver mail".
 */
import { Resolver } from "node:dns/promises";

export type Deliverability = "ok" | "no-mail-exchanger" | "unknown";

/** Reserved by RFC 2606 and RFC 6761: never resolvable, and never anybody's real address. */
const RESERVED_TLDS = new Set(["test", "example", "invalid", "localhost"]);
/** Reserved the same way, one level down — the addresses documentation is written with. */
const RESERVED_DOMAINS = new Set(["example.com", "example.net", "example.org"]);

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { verdict: Deliverability; at: number }>();

/** Test seam, and a way for an operator to turn it off if a resolver goes bad. */
const enabled = () => process.env.EMAIL_DOMAIN_CHECK !== "0";

export function resetDeliverabilityCache(): void {
  cache.clear();
}

export async function domainCanReceiveMail(domain: string, timeoutMs = 4000): Promise<Deliverability> {
  const host = String(domain ?? "").trim().toLowerCase();
  if (!host || !enabled()) return "unknown";

  /*
   * Reserved names: refused in production, allowed everywhere else, because the
   * test suite is full of @example.test addresses and they are exactly the
   * names that can never receive mail. Refusing them in development would mean
   * the check could only ever be exercised by breaking the tests.
   */
  const tld = host.slice(host.lastIndexOf(".") + 1);
  if (RESERVED_TLDS.has(tld) || RESERVED_DOMAINS.has(host)) {
    return process.env.NODE_ENV === "production" ? "no-mail-exchanger" : "unknown";
  }

  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.verdict;

  const resolver = new Resolver({ timeout: timeoutMs, tries: 2 });
  const remember = (verdict: Deliverability) => {
    // Only settled answers are cached: an "unknown" is our failure, and holding
    // onto it would keep refusing to learn for an hour.
    if (verdict !== "unknown") cache.set(host, { verdict, at: Date.now() });
    return verdict;
  };

  try {
    const mx = await resolver.resolveMx(host);
    if (mx.some((r) => r.exchange && r.exchange !== ".")) return remember("ok");
    // An empty set, or the "null MX" of RFC 7505, both mean: this domain accepts no mail.
    return remember("no-mail-exchanger");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code ?? "";
    if (code !== "ENOTFOUND" && code !== "ENODATA") return "unknown"; // our problem, not theirs
  }

  // No MX. RFC 5321 says senders fall back to the address record, so a domain
  // with one can still receive mail.
  for (const lookup of ["resolve4", "resolve6"] as const) {
    try {
      const addresses = await resolver[lookup](host);
      if (addresses.length) return remember("ok");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code ?? "";
      if (code !== "ENOTFOUND" && code !== "ENODATA") return "unknown";
    }
  }
  return remember("no-mail-exchanger");
}
