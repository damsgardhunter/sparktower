#!/usr/bin/env node
/**
 * Are SPF, DKIM and DMARC actually published for the sending domain?
 *
 * The repository can hold the intention and not the fact: the records live in
 * DNS, so `docs/ops/email-authentication.md` could describe three perfect
 * records that nobody ever published and no check in the codebase would know.
 * This is the part that can be known — asked of the real DNS, with the answer
 * printed in a form that pastes straight into that file's evidence table.
 *
 * A screenshot of a validator would prove the same thing once. This proves it
 * again every time somebody runs it, which is what matters after a registrar
 * change, a provider switch, or a domain that quietly expires.
 *
 * Uses node's own resolver: no dependency, and nothing to install in CI.
 *
 * Usage:
 *   node scripts/check-email-auth.mjs                      # domain from EMAIL_FROM, or sparktower.app
 *   node scripts/check-email-auth.mjs example.com
 *   node scripts/check-email-auth.mjs example.com --selector resend --selector google
 */
import { Resolver } from "node:dns/promises";

const argv = process.argv.slice(2);
const domain = (argv.find((a) => !a.startsWith("--")) ?? process.env.EMAIL_FROM?.split("@").pop() ?? "sparktower.app")
  .replace(/^.*@/, "").replace(/[<>]/g, "").trim().toLowerCase();
/** DKIM lives at <selector>._domainkey, and only the provider knows the selector — so they're named here. */
const selectors = argv.reduce((out, a, i) => (a === "--selector" && argv[i + 1] ? [...out, argv[i + 1]] : out), [])
  .concat(argv.some((a) => a === "--selector") ? [] : ["resend", "resend2", "google", "s1", "s2", "k1", "default", "mail"]);

/*
 * Public resolvers rather than whatever this machine is pointed at: a laptop on
 * a VPN, or a network with a caching resolver holding a stale negative answer,
 * can say NXDOMAIN about a domain the rest of the world resolves. Two, so one
 * of them being wrong is visible rather than authoritative.
 */
const resolvers = [
  { name: "Cloudflare 1.1.1.1", servers: ["1.1.1.1", "1.0.0.1"] },
  { name: "Google 8.8.8.8", servers: ["8.8.8.8", "8.8.4.4"] },
];

const ask = async (resolver, method, name) => {
  try { return { ok: true, records: await resolver[method](name) }; }
  catch (err) { return { ok: false, code: err.code ?? String(err?.message ?? err) }; }
};

async function lookOnce({ name, servers }) {
  const r = new Resolver({ timeout: 5000, tries: 2 });
  r.setServers(servers);
  const flat = (res) => (res.ok ? res.records.map((x) => (Array.isArray(x) ? x.join("") : String(x))) : []);

  const soa = await ask(r, "resolveSoa", domain);
  const txt = await ask(r, "resolveTxt", domain);
  const dmarc = await ask(r, "resolveTxt", `_dmarc.${domain}`);
  const mx = await ask(r, "resolveMx", domain);

  const dkim = [];
  for (const selector of selectors) {
    const host = `${selector}._domainkey.${domain}`;
    const cname = await ask(r, "resolveCname", host);
    const asTxt = await ask(r, "resolveTxt", host);
    if (cname.ok) dkim.push({ selector, kind: "CNAME", value: cname.records.join(" ") });
    else if (asTxt.ok) dkim.push({ selector, kind: "TXT", value: flat(asTxt).join("").slice(0, 80) + "…" });
  }

  const spf = flat(txt).filter((t) => /^v=spf1\b/i.test(t));
  const dmarcRecords = flat(dmarc).filter((t) => /^v=DMARC1\b/i.test(t));
  return {
    resolver: name,
    exists: soa.ok,
    reason: soa.ok ? null : soa.code,
    spf,
    // Two SPF records is a permanent failure at every receiver, not a merge — so it's called out, not counted.
    spfDuplicated: spf.length > 1,
    dmarc: dmarcRecords,
    dmarcPolicy: dmarcRecords[0]?.match(/\bp\s*=\s*(none|quarantine|reject)\b/i)?.[1]?.toLowerCase() ?? null,
    dmarcReports: /\brua\s*=/i.test(dmarcRecords[0] ?? ""),
    dkim,
    mx: mx.ok ? mx.records.map((m) => `${m.priority} ${m.exchange}`) : [],
  };
}

const looks = await Promise.all(resolvers.map(lookOnce));
const agreed = looks[0];
const disagreement = looks.some((l) => l.exists !== agreed.exists || l.spf.join() !== agreed.spf.join() || l.dmarc.join() !== agreed.dmarc.join());

const verdict = (label, ok, detail) => `${ok ? "PASS" : "MISSING"}  ${label.padEnd(6)} ${detail}`;
console.log(`Sending domain: ${domain}`);
console.log(`Checked: ${new Date().toISOString()} via ${resolvers.map((r) => r.name).join(" and ")}\n`);

if (!agreed.exists) {
  console.log(`The domain does not resolve at all (${agreed.reason}). There is no zone, so there are no records to find:`);
  console.log(`SPF, DKIM and DMARC are all MISSING, and nothing can send authenticated mail as ${domain} — including you.`);
  console.log(`\nIf that is a surprise, the domain is unregistered, expired, or the name is wrong.`);
} else {
  console.log(verdict("SPF", agreed.spf.length === 1, agreed.spf.length ? agreed.spf.join(" | ") : "no v=spf1 record at the domain root"));
  if (agreed.spfDuplicated) console.log(`      ^ ${agreed.spf.length} SPF records. Receivers treat that as a permanent error — merge them into one.`);
  console.log(verdict("DKIM", agreed.dkim.length > 0, agreed.dkim.length
    ? agreed.dkim.map((d) => `${d.selector} (${d.kind})`).join(", ")
    : `no key at any of the selectors tried (${selectors.join(", ")}) — pass --selector <name> if the provider uses another`));
  console.log(verdict("DMARC", agreed.dmarc.length > 0, agreed.dmarc.length
    ? `p=${agreed.dmarcPolicy ?? "(none stated)"}${agreed.dmarcReports ? ", reports on" : ", no rua= so no reports arrive"}`
    : "no record at _dmarc"));
  if (agreed.dmarcPolicy === "none") console.log(`      ^ p=none observes and enforces nothing. Move to quarantine once the rua reports are clean.`);
  console.log(`\nMX: ${agreed.mx.join(", ") || "none (the domain sends but receives nowhere — check that's deliberate)"}`);
}

if (disagreement) console.log(`\nThe two resolvers disagree; DNS is mid-propagation or one is serving a stale answer. Check again in an hour.`);

const row = !agreed.exists
  ? `| ${new Date().toISOString().slice(0, 10)} | ${domain} | MISSING | MISSING | MISSING | scripts/check-email-auth.mjs — domain does not resolve (${agreed.reason}) |`
  : `| ${new Date().toISOString().slice(0, 10)} | ${domain} | ${agreed.spf.length === 1 ? "published" : "MISSING"} | ${agreed.dkim.length ? agreed.dkim.map((d) => d.selector).join("+") : "MISSING"} | ${agreed.dmarcPolicy ? `p=${agreed.dmarcPolicy}` : "MISSING"} | scripts/check-email-auth.mjs |`;
console.log(`\nFor the evidence table in docs/ops/email-authentication.md:\n${row}`);

/*
 * Exits non-zero when the domain sends mail and isn't authenticated, so this can
 * become a pre-deploy gate later. It is not in CI today: CI has no business
 * failing because somebody else's DNS is slow.
 */
process.exit(agreed.exists && agreed.spf.length === 1 && agreed.dkim.length && agreed.dmarc.length ? 0 : 1);
