/**
 * Checking that somebody controls the domain they say is their company's.
 *
 * Two proofs, and the whole module is about being strict with both — because
 * the value of a verified badge is exactly the difficulty of getting one
 * dishonestly, and a checker that can be talked into a yes is worse than no
 * checker at all. A builder who sees "verified" and spends a fortnight on an
 * entry is relying on this file.
 *
 * ## The file
 *
 * `https://<domain>/.well-known/sparktower-verification.txt`, fetched through
 * `safeFetch` — which resolves the name, refuses private and loopback
 * addresses, re-checks every redirect and caps the body. A verification
 * endpoint that fetched a URL a stranger chose would otherwise be a
 * server-side request forgery with a tick at the end of it.
 *
 * https only, and no redirect off the domain. Both matter: plain http can be
 * answered by anybody on the path, and following a redirect to
 * `attacker.example` and reading the token there would verify the attacker's
 * site rather than the claimed one.
 *
 * ## The DNS record
 *
 * A TXT record at `_sparktower.<domain>`, read with the resolver's own
 * lookup. Nothing is fetched, so there is nothing to forge with a redirect —
 * the answer either has the token or it does not.
 *
 * ## What it refuses to do
 *
 * Decide whether a company is *good*. It cannot, and pretending otherwise
 * would be the dishonest part. What it establishes is that whoever is asking
 * can change that domain, which employees can do and strangers cannot.
 */
import { promises as dns } from "node:dns";
import { randomBytes } from "node:crypto";
import { safeFetch, type SafeFetchOptions } from "./safe-fetch";
import {
  TOKEN_PREFIX, VERIFICATION_DNS_PREFIX, VERIFICATION_PATH,
  type VerificationMethod,
} from "@shared/company-verification";

/** A token nobody can guess, and which announces what it is if found. */
export const newVerificationToken = (): string =>
  `${TOKEN_PREFIX}${randomBytes(24).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40)}`;

export interface CheckOutcome {
  ok: boolean;
  method?: VerificationMethod;
  /** What was actually seen, for somebody debugging their own DNS at eleven at night. */
  detail: string;
}

/** Seams, so the checks can be tested without a network or a nameserver. */
export interface CheckDeps {
  fetch?: typeof safeFetch;
  resolveTxt?: (hostname: string) => Promise<string[][]>;
}

/**
 * The token in a file on the site.
 *
 * The body is compared after trimming and nothing else: a file served with a
 * trailing newline is the normal case, and refusing it would send people
 * hunting for a difference they cannot see. Anything longer than a token is
 * refused outright rather than searched — `includes` would accept a page that
 * merely *mentions* the token, which is every page of a forum where somebody
 * pasted it asking for help.
 */
export async function checkFile(domain: string, token: string, deps: CheckDeps = {}): Promise<CheckOutcome> {
  const get = deps.fetch ?? safeFetch;
  const url = `https://${domain}${VERIFICATION_PATH}`;
  const opts: SafeFetchOptions = {
    // A token is 60 bytes. Anything that answers with a megabyte is not the file.
    maxBytes: 4096,
    timeoutMs: 8000,
    method: "GET",
    // https only: plain http can be answered by anybody between here and there.
    allowHttp: false,
    /*
     * No hops. A redirect to another host and a token read there would verify
     * that host instead — which is exactly the trick this is guarding against,
     * and one an open redirect on the claimed domain would hand to anybody.
     */
    maxRedirects: 0,
  };

  try {
    const res = await get(url, opts);
    if (!res.ok) return { ok: false, detail: `${url} answered ${res.status}.` };
    const body = res.body.toString("utf8").trim();
    if (!body) return { ok: false, detail: `${url} is empty.` };
    if (body.length > token.length + 8) {
      return { ok: false, detail: `${url} has more in it than the token — it should contain only the token.` };
    }
    if (body !== token) {
      return { ok: false, detail: `${url} answered with something else. It has to contain exactly the token.` };
    }
    return { ok: true, method: "file", detail: `Found the token at ${url}.` };
  } catch (err: any) {
    return { ok: false, detail: `Couldn't read ${url}: ${String(err?.message ?? err).slice(0, 180)}` };
  }
}

/** The token in a TXT record. */
export async function checkDns(domain: string, token: string, deps: CheckDeps = {}): Promise<CheckOutcome> {
  const resolve = deps.resolveTxt ?? dns.resolveTxt;
  const name = `${VERIFICATION_DNS_PREFIX}.${domain}`;
  try {
    const records = await resolve(name);
    // A TXT record arrives as chunks that have to be joined before comparing:
    // anything over 255 characters is split, and ours is close enough to care.
    const values = records.map((chunks) => chunks.join("").trim());
    if (!values.length) return { ok: false, detail: `No TXT record at ${name} yet.` };
    if (!values.includes(token)) {
      return { ok: false, detail: `${name} has ${values.length} TXT record(s), none of them the token. DNS can take a few minutes.` };
    }
    return { ok: true, method: "dns", detail: `Found the token in TXT at ${name}.` };
  } catch (err: any) {
    const code = String(err?.code ?? "");
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return { ok: false, detail: `No TXT record at ${name} yet. DNS can take a few minutes to publish.` };
    }
    return { ok: false, detail: `Couldn't look up ${name}: ${String(err?.message ?? err).slice(0, 180)}` };
  }
}

/**
 * Either proof, whichever the person actually did.
 *
 * Both are tried because asking somebody to declare which method they used
 * before they have finished doing it is a step that exists only for the
 * server's benefit. The file is tried first — it is the faster of the two to
 * be sure about, and DNS is the one that keeps saying "not yet" while it
 * publishes.
 */
export async function checkDomain(domain: string, token: string, deps: CheckDeps = {}): Promise<CheckOutcome> {
  const file = await checkFile(domain, token, deps);
  if (file.ok) return file;
  const record = await checkDns(domain, token, deps);
  if (record.ok) return record;
  // Both failed: the file's reason first, since most people take that route.
  return { ok: false, detail: `${file.detail} ${record.detail}` };
}
