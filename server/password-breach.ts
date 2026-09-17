/**
 * Has this password already been stolen from someone else?
 *
 * The common-password list in @shared/passwords catches what people guess
 * first. It cannot catch the thing that actually gets accounts taken: a
 * password that is strong-looking, unique-looking, and already sitting in a
 * credential dump because its owner used it on a forum that got breached.
 * Credential stuffing is the most common way an account here will be lost, and
 * the per-account login limit only slows it down — refusing the password at
 * the moment it is set is what prevents it.
 *
 * The password never leaves this process. Have I Been Pwned's range API is
 * k-anonymous: we SHA-1 the password, send the FIRST FIVE hex characters of
 * that hash, and get back every suffix sharing that prefix — some hundreds of
 * hashes — then look for ours locally. The service learns a prefix shared by
 * thousands of unrelated passwords and never sees the password, the hash, or
 * who was asking. `Add-Padding` makes every response a similar size, so the
 * length of the reply doesn't leak how common the prefix is either.
 *
 * FAILS OPEN, deliberately. If the API is slow, down, or unreachable — an
 * offline laptop, a blocked egress — this returns "not breached" and the
 * signup proceeds. The alternative is that an outage at a third party stops
 * anyone from creating an account or changing a password, which is a worse
 * failure than accepting one reused password. Every failure is logged, so a
 * check that has quietly stopped working is visible rather than assumed.
 */
import { createHash } from "crypto";

/** How many breach appearances make a password unusable. One is enough: it's in a list someone is already trying. */
const BREACH_THRESHOLD = 1;

/** Past this, the signup is more important than the answer. */
const TIMEOUT_MS = 2500;

/**
 * Prefixes we've already asked about, with the answer.
 *
 * Two people signing up with the same weak password, or one person trying
 * three variations, shouldn't each cost a network round trip. Small and
 * short-lived: this is a latency cache, not a mirror of the corpus.
 */
const cache = new Map<string, { suffixes: Map<string, number>; at: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 256;

/** Logged once per process, not once per signup: a down API shouldn't write a line per attempt. */
let warned = false;

/**
 * On unless switched off, and off in tests unless switched on.
 *
 * The test suite creates hundreds of accounts; each one reaching for the
 * network would add a timeout's worth of waiting to a suite that has no
 * business depending on an external service. The tests that DO cover this
 * behaviour set PASSWORD_BREACH_CHECK=on and stub the fetch.
 */
function enabled(): boolean {
  const flag = process.env.PASSWORD_BREACH_CHECK?.toLowerCase();
  if (flag === "off" || flag === "false" || flag === "0") return false;
  if (flag === "on" || flag === "true" || flag === "1") return true;
  return process.env.NODE_ENV !== "test";
}

function fromCache(prefix: string): Map<string, number> | null {
  const hit = cache.get(prefix);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(prefix); return null; }
  return hit.suffixes;
}

function remember(prefix: string, suffixes: Map<string, number>) {
  // Oldest out first. A Map iterates in insertion order, so this is the eldest key.
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(prefix, { suffixes, at: Date.now() });
}

/**
 * How many known breaches this password appears in. 0 when unknown, including
 * when the check couldn't run — callers can't distinguish, and shouldn't:
 * "we don't know" and "not found" both mean "don't block this person".
 */
export async function breachCount(password: string): Promise<number> {
  if (!password || !enabled()) return 0;

  // SHA-1 because that is the corpus's format, not because it's a good hash.
  // Nothing is stored under it; it is a lookup key for someone else's index.
  const hash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const [prefix, suffix] = [hash.slice(0, 5), hash.slice(5)];

  const cached = fromCache(prefix);
  if (cached) return cached.get(suffix) ?? 0;

  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: {
        "Add-Padding": "true",
        // Asked for by the service so operators can identify traffic.
        "User-Agent": "SparkTower-password-check",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`pwnedpasswords answered ${res.status}`);

    const suffixes = new Map<string, number>();
    for (const line of (await res.text()).split("\n")) {
      const [suf, count] = line.trim().split(":");
      // Padding entries come back with a count of 0; they're noise by design.
      if (suf && count) suffixes.set(suf.toUpperCase(), Number(count) || 0);
    }
    remember(prefix, suffixes);
    return suffixes.get(suffix) ?? 0;
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn("[passwords] breach check unavailable, passwords are being accepted unchecked:", (err as Error).message);
    }
    return 0;
  }
}

/** True when this password is in a public dump and must not be set here. */
export async function isBreached(password: string): Promise<boolean> {
  return (await breachCount(password)) >= BREACH_THRESHOLD;
}

/**
 * What to tell someone whose password was refused for this.
 *
 * Not "your password is weak" — theirs may be long and inventive. The honest
 * version is that it is *known*, which is both true and the reason a different
 * password fixes it. It says nothing about where it leaked from: we don't know,
 * and guessing would be alarming and probably wrong.
 */
export const BREACHED_MESSAGE =
  "This password has appeared in a public data breach, so it's already on the lists attackers try first — even if you've never used it here before. Please choose a different one.";

/** For tests that need the cache empty between cases. */
export function resetBreachCache() {
  cache.clear();
  warned = false;
}
