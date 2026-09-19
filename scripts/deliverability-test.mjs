#!/usr/bin/env node
/**
 * The 20-send deliverability batch, driven against the live site.
 *
 * DNS proves a domain is authenticated. It cannot prove that the two emails
 * this product depends on — the address-confirmation link and a project invite
 * — actually reach an inbox rather than a spam folder. Those are different
 * templates with different links, and a filter scores a template, not a domain.
 * So this sends the real ones, through the real app, to real mailboxes.
 *
 *   node scripts/deliverability-test.mjs verify --gmail you@gmail.com --outlook you@outlook.com
 *   … click the link in one of them, finish onboarding …
 *   node scripts/deliverability-test.mjs invite --as <that address> --password <pw> \
 *        --gmail you@gmail.com --outlook you@outlook.com
 *
 * Add --dry-run to see exactly what it would do and send nothing.
 *
 * Two things it deliberately does not do:
 *
 *   - It cannot read your inbox, so it cannot tell you whether a message landed
 *     in Inbox or Junk. That is the whole point of the exercise and it is yours
 *     to look at. It prints the table to fill in.
 *   - It does not verify an account for you. Confirming the address means
 *     opening the emailed link, which is also the only real test that the link
 *     works — so phase two asks you to have done it.
 *
 * Registration counts against the per-address sign-in limit (8 in 15 minutes,
 * shared/moderation.ts), which ten signups would trip at the ninth. They are
 * paced apart rather than sent in a burst; the run takes about twenty minutes
 * and tells you why while it waits.
 */
const BASE = (process.argv.find((a) => a.startsWith("--base="))?.split("=")[1] ?? "https://sparktower.app").replace(/\/$/, "");
const argv = process.argv.slice(2);
const phase = argv.find((a) => !a.startsWith("--"));
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = (n) => argv.includes(`--${n}`);

const gmail = flag("gmail");
const outlook = flag("outlook");
const dry = has("dry-run");

if (!["verify", "invite"].includes(phase) || !gmail || !outlook) {
  console.error(`Usage:
  node scripts/deliverability-test.mjs verify --gmail <addr> --outlook <addr>
  node scripts/deliverability-test.mjs invite --as <addr> --password <pw> --gmail <addr> --outlook <addr>

Options: --base <url> (default ${BASE}), --dry-run`);
  process.exit(2);
}

/**
 * Ten addresses that all reach two mailboxes.
 *
 * Gmail and Outlook both route `user+anything@` to `user@`, and the tag
 * survives into the delivered message — so each send is separately identifiable
 * in the inbox without needing ten real accounts. The stamp keeps a re-run from
 * colliding with accounts this created last time.
 */
const stamp = Date.now().toString(36).slice(-5);
const tagged = (addr, kind, n) => addr.replace(/^([^@]+)@/, `$1+st-${kind}-${stamp}-${n}@`);
const batch = (kind) => Array.from({ length: 10 }, (_, i) =>
  ({ n: i + 1, provider: i % 2 === 0 ? "gmail" : "outlook", to: tagged(i % 2 === 0 ? gmail : outlook, kind, i + 1) }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (path, body, cookie) => {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // The CSRF guard trusts this host; without it a cookie-bearing POST is refused.
      origin: BASE,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, ok: res.ok, json, setCookie: res.headers.get("set-cookie") };
};

const rows = [];
const record = (kind, r, ok, detail) => {
  rows.push(`| ${kind} | ${r.provider} | ${r.to} | ${ok ? "sent" : "FAILED"} | | | | |`);
  console.log(`  ${String(r.n).padStart(2)}/10  ${r.provider.padEnd(7)} ${ok ? "sent   " : "FAILED "} ${r.to}${detail ? `  — ${detail}` : ""}`);
};

/*
 * Ten signups, paced under the sign-in limit. 8 in 15 minutes is one every
 * 112 seconds sustained, so 120 leaves a margin for a slow response.
 */
const PACE_MS = 120_000;
const PASSWORD = "Deliverability!2026";

async function verifyPhase() {
  const list = batch("verify");
  console.log(`Ten registrations against ${BASE}, one every ${PACE_MS / 1000}s to stay under the sign-in limit.`);
  console.log(`Each sends the real address-confirmation email. About ${Math.round((PACE_MS * 9) / 60000)} minutes.\n`);
  if (dry) { for (const r of list) console.log(`  would register ${r.to}`); return; }

  for (const [i, r] of list.entries()) {
    const res = await post("/api/auth/register", { email: r.to, password: PASSWORD, firstName: "Deliver", lastName: `Test${r.n}` });
    record("verification", r, res.status === 201, res.status === 201 ? "" : `HTTP ${res.status} ${res.json?.message ?? ""}`);
    if (res.status === 429) console.log(`     ^ rate limited — the pacing is not working; stop and widen PACE_MS.`);
    if (i < list.length - 1) await sleep(PACE_MS);
  }
}

async function invitePhase() {
  const as = flag("as"); const password = flag("password");
  if (!as || !password) { console.error("invite needs --as <verified address> --password <pw>"); process.exit(2); }
  const list = batch("invite");
  if (dry) { for (const r of list) console.log(`  would invite ${r.to}`); return; }

  const login = await post("/api/auth/login", { email: as, password });
  if (!login.ok) { console.error(`Could not sign in as ${as}: HTTP ${login.status} ${login.json?.message ?? ""}`); process.exit(1); }
  const cookie = (login.setCookie ?? "").split(";")[0];
  if (!cookie) { console.error("Signed in but got no session cookie."); process.exit(1); }

  const project = await post("/api/projects", {
    title: `Deliverability ${stamp}`,
    description: "A project used only to send the invite half of the deliverability batch.",
    category: "saas", goal: "ship_mvp", subcategory: "saas",
  }, cookie);
  if (!project.ok) {
    console.error(`Could not create a project: HTTP ${project.status} ${project.json?.message ?? ""}`);
    if (project.status === 403) console.error("403 usually means the address isn't confirmed yet — open the emailed link first.");
    process.exit(1);
  }
  console.log(`Project ${project.json.id} created. Sending ten invites (limit is 20/hour, 25/project/day).\n`);

  for (const r of list) {
    const res = await post(`/api/projects/${project.json.id}/invites`, { email: r.to, role: "collaborator" }, cookie);
    record("invite", r, res.ok, res.ok ? "" : `HTTP ${res.status} ${res.json?.message ?? ""}`);
    // Well under the limit, but a small gap keeps the provider from seeing a burst.
    await sleep(3_000);
  }
}

await (phase === "verify" ? verifyPhase() : invitePhase());

if (!dry) {
  console.log(`\nNow go and look. For each message, record Inbox or Junk, and from the message source:`);
  console.log(`  dkim=pass  header.d=sparktower.app     ← the domain must be yours, not the provider's`);
  console.log(`  dmarc=pass header.from=sparktower.app`);
  console.log(`\nAnd open one link: it should reach ${BASE} and the form on it should submit.`);
  console.log(`\nFor docs/ops/email-authentication.md:\n`);
  console.log(`| flow | to | address | send | inbox/junk | spf | dkim (header.d) | dmarc |`);
  console.log(`|---|---|---|---|---|---|---|---|`);
  for (const r of rows) console.log(r);
}
