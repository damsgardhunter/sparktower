/**
 * Making a company in a test, now that a company has to prove a domain first.
 *
 * Creating one used to be a single call with a name. It is not any more — a
 * company cannot exist without a verified domain, and the verification is
 * started, proved and spent as three separate steps against a real HTTP fetch.
 * That is the right shape for the product (a builder can now tell that the
 * company offering a fortnight's work is the company it claims to be) and it
 * left every test that had ever made a company failing on a 400.
 *
 * Rather than paste the same twenty lines into six files, the dance lives
 * here. Anything that just needs *a company* calls `makeVerifiedCompany` and
 * carries on being about whatever it was about; the rules of verification
 * itself are tested where they belong, in company-verification.test.ts.
 */
import request from "supertest";
import { setVerificationDeps } from "../../server/company-verification-routes";

/** Domains this fake world will serve a token for, keyed by domain → token. */
const serving = new Map<string, string>();
let installed = false;

/**
 * Point the verifier at a world we control.
 *
 * Idempotent, so a file can call it from `beforeAll` without caring whether
 * something else already has. DNS always fails: the hosted file is the route
 * these tests take, and one route proved is enough for a helper — the other is
 * covered where verification itself is.
 *
 * Deliberately not named `useFakeDomainWorld`: a function starting with `use`
 * is a React hook as far as eslint is concerned, and calling it from a plain
 * async helper is an error.
 */
export function serveDomainTokens(): void {
  if (installed) return;
  installed = true;
  setVerificationDeps({
    fetch: (async (url: string) => {
      const host = new URL(url).hostname;
      const token = serving.get(host);
      if (!token) return { ok: false, status: 404, url, contentType: "text/plain", body: Buffer.from("") };
      return { ok: true, status: 200, url, contentType: "text/plain", body: Buffer.from(token) };
    }) as any,
    resolveTxt: async () => { throw Object.assign(new Error("no record"), { code: "ENOTFOUND" }); },
  });
}

let domains = 0;
/** A domain nobody else in this run has claimed. One domain, one company, for ever. */
export const freshDomain = (hint = "co"): string =>
  `${hint.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20)}-${Date.now().toString(36)}-${(domains += 1)}.test`;

/** Start a verification, serve its token, pass the check. Returns the verification id. */
export async function proveDomain(agent: request.SuperAgentTest, domain: string): Promise<string> {
  serveDomainTokens();
  const started = await agent.post("/api/company-verifications").send({ website: domain });
  if (started.status !== 201) throw new Error(`could not start verification for ${domain}: ${started.status} ${started.text}`);
  const v = started.body.verification;
  serving.set(domain, v.token);
  const checked = await agent.post(`/api/company-verifications/${v.id}/check`).send({});
  if (checked.status !== 200) throw new Error(`could not prove ${domain}: ${checked.status} ${checked.text}`);
  return v.id as string;
}

/**
 * A company, proved and created, for a test that needs one and does not care how.
 *
 * Returns the raw response so callers can keep asserting on it exactly as they
 * did when this was one line, with the domain that was proved hung off it —
 * the company's `website` is now that domain rather than anything the caller
 * sent, so a test asserting on the shape needs to know which one it got.
 */
export async function makeVerifiedCompany(
  agent: request.SuperAgentTest,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<request.Response & { domain: string }> {
  const domain = freshDomain(name);
  const verificationId = await proveDomain(agent, domain);
  const res = await agent.post("/api/companies").send({ name, verificationId, ...extra });
  return Object.assign(res, { domain });
}
