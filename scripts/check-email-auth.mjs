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
  /*
   * Where the aggregate reports actually go.
   *
   * A registrar that publishes a DMARC record for you points `rua` at itself,
   * which satisfies "a record exists" and "reports are on" while you never see
   * one. The addresses are compared with the sending domain so the difference
   * between "reports arrive" and "reports arrive somewhere else" is visible.
   */
  /*
   * Each rua destination, and whether it is one at all.
   *
   * A DMARC value is a string: nothing validates it, and `malito:` — one
   * transposed letter — parses as a perfectly well-formed record with a
   * destination no receiver can deliver to. This checker used to test only
   * that `rua=` appeared and reported "reports on", which is how a typo
   * survived a run of it. The scheme and the address are checked now.
   */
  const ruaRaw = (dmarcRecords[0]?.match(/\brua\s*=\s*([^;]+)/i)?.[1] ?? "")
    .split(",").map((a) => a.trim()).filter(Boolean);
  const ruaBad = ruaRaw.filter((u) => !/^(mailto:[^@\s]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|https:\/\/\S+)$/i.test(u));
  const rua = ruaRaw.map((a) => a.replace(/^mailto:/i, ""));
  const ruaOffDomain = rua.filter((a) => {
    const host = a.split("@")[1]?.toLowerCase() ?? "";
    return host && host !== domain && !host.endsWith(`.${domain}`);
  });
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
    rua,
    ruaRaw,
    ruaBad,
    ruaOffDomain,
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

/*
 * Declared out here because the exit code at the bottom reads it. It was a
 * `const` inside the branch below, which threw a ReferenceError at the last
 * line of the script — after printing a full, correct report, so the run looked
 * like it had worked and simply exited 1.
 */
let ruaUsable = false;

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
  /*
   * Whether a message has any way to align, and whether DMARC is enforcing.
   * Both are needed before the DMARC line is printed, because "a record
   * exists" and "this record is doing you good" are different questions and
   * only the second one is worth a PASS.
   */
  const canAlign = agreed.spf.length === 1 || agreed.dkim.length > 0;
  const enforcing = agreed.dmarcPolicy === "quarantine" || agreed.dmarcPolicy === "reject";
  ruaUsable = agreed.ruaRaw.length > 0 && agreed.ruaBad.length < agreed.ruaRaw.length;
  const dmarcDetail = agreed.dmarc.length
    ? `p=${agreed.dmarcPolicy ?? "(none stated)"}${
        !agreed.ruaRaw.length ? ", no rua= so no reports arrive"
        : ruaUsable ? ", reports on"
        : ", rua is unusable so no reports arrive"}`
    : "no record at _dmarc";
  if (enforcing && !canAlign) {
    // Not MISSING — it is published, and that is the problem.
    console.log(`BROKEN  ${"DMARC".padEnd(6)} ${dmarcDetail} — enforcing with nothing to align (see below)`);
  } else {
    console.log(verdict("DMARC", agreed.dmarc.length > 0, dmarcDetail));
  }
  if (agreed.dmarcPolicy === "none") console.log(`      ^ p=none observes and enforces nothing. Move to quarantine once the rua reports are clean.`);
  /*
   * Reports that go to somebody else are not reports you have. A registrar
   * that publishes DMARC on your behalf points rua at its own address, so the
   * record looks complete and you have never seen an aggregate report.
   */
  if (agreed.ruaBad.length) {
    console.log(`      ^ rua destination is not a usable URI: ${agreed.ruaBad.join(", ")}`);
    console.log(`        A DMARC value is just a string — nothing rejects a misspelt scheme, so this looks`);
    console.log(`        like a working record and silently collects nothing. It must read mailto:someone@domain.`);
  }
  if (agreed.ruaOffDomain.length) {
    console.log(`      ^ rua points at ${agreed.ruaOffDomain.join(", ")} — not an address on ${domain}.`);
    console.log(`        The aggregate reports are going there, not to you. If you didn't publish this record, your registrar did.`);
  }
  console.log(`\nMX: ${agreed.mx.join(", ") || "none (the domain sends but receives nowhere — check that's deliberate)"}`);

  /*
   * The combination that is worse than having nothing.
   *
   * DMARC tells receivers what to do when a message fails to align, and a
   * message can only align through SPF or DKIM. Enforcing without either means
   * every message fails — including the ones you send on purpose. This printed
   * as "PASS DMARC" before, which reads as two problems and one thing done
   * right, when it is really one problem big enough to stop all the mail.
   */
  if (enforcing && !canAlign) {
    const verb = agreed.dmarcPolicy === "reject" ? "rejected outright" : "delivered to spam";
    console.log(`\n!! DMARC says p=${agreed.dmarcPolicy} and neither SPF nor DKIM is published.`);
    console.log(`   Nothing can align, so every message you send as ${domain} fails DMARC and is ${verb}.`);
    console.log(`   This is worse than publishing no DMARC at all, and it is happening now, silently:`);
    console.log(`   the provider reports the message as sent and the receiver files it away.`);
    console.log(`\n   Either publish SPF and DKIM (docs/ops/email-authentication.md), or drop the policy`);
    console.log(`   to p=none until you have, which enforces nothing and still collects the reports.`);
  } else if (enforcing && !agreed.dkim.length) {
    console.log(`\n!  p=${agreed.dmarcPolicy} with SPF but no DKIM. SPF does not survive forwarding, so a`);
    console.log(`   forwarded message — a mailing list, a "send to my other address" rule — fails and is quarantined.`);
  }
}

if (disagreement) console.log(`\nThe two resolvers disagree; DNS is mid-propagation or one is serving a stale answer. Check again in an hour.`);

const row = !agreed.exists
  ? `| ${new Date().toISOString().slice(0, 10)} | ${domain} | MISSING | MISSING | MISSING | scripts/check-email-auth.mjs — domain does not resolve (${agreed.reason}) |`
  : `| ${new Date().toISOString().slice(0, 10)} | ${domain} | ${agreed.spf.length === 1 ? "published" : "MISSING"} | ${agreed.dkim.length ? agreed.dkim.map((d) => d.selector).join("+") : "MISSING"} | ${agreed.dmarcPolicy ? `p=${agreed.dmarcPolicy}${(agreed.dmarcPolicy === "quarantine" || agreed.dmarcPolicy === "reject") && !(agreed.spf.length === 1 || agreed.dkim.length) ? " (BROKEN — nothing aligns)" : ""}` : "MISSING"} | scripts/check-email-auth.mjs |`;
console.log(`\nFor the evidence table in docs/ops/email-authentication.md:\n${row}`);

/*
 * Exits non-zero when the domain sends mail and isn't authenticated, so this can
 * become a pre-deploy gate later. It is not in CI today: CI has no business
 * failing because somebody else's DNS is slow.
 */
process.exit(agreed.exists && agreed.spf.length === 1 && agreed.dkim.length && agreed.dmarc.length && ruaUsable ? 0 : 1);
