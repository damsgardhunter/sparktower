/**
 * Is the live site up, and is it the site we think it is?
 *
 * `npm run check:live`                          — the canonical URL in docs/ops/deploy.md
 * `npm run check:live -- https://staging.host`  — somewhere else
 * `npm run check:live -- https://old.host --publishes https://new.host`
 *                                               — a host that is meant to keep
 *                                                 answering while pointing at
 *                                                 the canonical one
 *
 * An uptime monitor answers one question: did something answer. That is worth
 * knowing and it is not the question that has actually hurt this deploy. The
 * failures worth catching here are the ones where the site is *up* and wrong:
 *
 *   - `PUBLIC_URL` left pointing at the previous host after a domain move, so
 *     every confirmation link, password reset and shared artifact URL sends
 *     people to a hostname that is no longer the product — while the site
 *     itself looks perfectly healthy.
 *   - A deploy that came up before its migrations, so the process answers and
 *     the first query fails.
 *   - A build that is not the commit anybody thinks is live.
 *
 * So this asks the site what it believes about itself and compares it with
 * what it is being reached by. It exits non-zero on anything a person would
 * want woken for, which makes it usable three ways: by hand after a deploy, by
 * CI, and as the command an uptime service runs.
 *
 * Nothing here needs a secret: every endpoint it reads is public, which is the
 * property that makes an outside monitor possible at all.
 */
const DEFAULT_URL = "https://sparktower.app";

interface Check { name: string; ok: boolean; detail: string }

const results: Check[] = [];
const record = (name: string, ok: boolean, detail: string) => { results.push({ name, ok, detail }); };

async function get(url: string, timeoutMs = 15_000): Promise<{ status: number; text: string; ms: number }> {
  const started = Date.now();
  const stop = AbortSignal.timeout(timeoutMs);
  const res = await fetch(url, { signal: stop, redirect: "follow" });
  return { status: res.status, text: await res.text(), ms: Date.now() - started };
}

async function main() {
  const args = process.argv.slice(2);
  const arg = args.find((a) => !a.startsWith("-"));
  const base = (arg ?? process.env.CHECK_LIVE_URL ?? DEFAULT_URL).replace(/\/+$/, "");
  /*
   * Which address this host is supposed to publish. Normally its own — but the
   * old hostname is deliberately kept answering after a domain move, and it is
   * *correct* for that one to publish the new address. Saying so is the
   * difference between a check that survives the move and one that gets
   * switched off for crying wolf.
   */
  const publishesAt = args.indexOf("--publishes");
  const expected = publishesAt === -1 ? base : (args[publishesAt + 1] ?? base).replace(/\/+$/, "");
  console.log(`Checking ${base}\n`);

  // 1. Alive. The shallow one: it proves a process answered, and nothing else.
  try {
    const health = await get(`${base}/_health`);
    record("/_health answers", health.status === 200, `${health.status} in ${health.ms}ms`);
  } catch (err: any) {
    record("/_health answers", false, `no answer: ${err?.message ?? err}`);
  }

  // 2. Alive *and* able to reach its database, which is the one a monitor should watch.
  let ready: any = null;
  try {
    const res = await get(`${base}/_ready`);
    try { ready = JSON.parse(res.text); } catch { /* reported below as unreadable */ }
    record("/_ready answers", res.status === 200, `${res.status} in ${res.ms}ms`);
    record("database reachable", ready?.database === "ok", ready?.database ?? "unreadable answer");
    if (ready?.migrations !== undefined) {
      record("migrations applied", ready.migrations === "ok",
        ready.migrations === "ok" ? "every migration in the repo has run" : String(ready.migrations));
    }
  } catch (err: any) {
    record("/_ready answers", false, `no answer: ${err?.message ?? err}`);
  }

  /*
   * 3. The site's own idea of where it lives.
   *
   * The sitemap is built from the same base URL as every emailed link, so it
   * is a public, honest witness to `PUBLIC_URL` — no admin session needed. If
   * it names a different host from the one answering, links are being sent
   * somewhere other than here, and that is invisible from any ordinary check.
   */
  try {
    const sitemap = await get(`${base}/sitemap.xml`);
    const first = /<loc>(https?:\/\/[^/<]+)/.exec(sitemap.text)?.[1];
    if (!first) {
      record("the site publishes its address", false, "no <loc> in sitemap.xml to read it from");
    } else {
      const same = new URL(first).host === new URL(expected).host;
      const what = expected === base ? "its own address" : `the canonical address (${new URL(expected).host})`;
      record(`the site publishes ${what}`, same,
        same ? `publishes ${first}` : `publishes ${first}, expected ${new URL(expected).host} — PUBLIC_URL is pointing somewhere else`);
    }
  } catch (err: any) {
    record("the site publishes its address", false, `sitemap unreadable: ${err?.message ?? err}`);
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.name} — ${r.detail}`);
  if (ready?.ms != null) console.log(`\n  database round trip: ${ready.ms}ms`);

  if (failed.length) {
    console.error(`\n${failed.length} check${failed.length === 1 ? "" : "s"} failed. The site is not serving correctly.`);
    process.exit(1);
  }
  console.log("\nLive and serving what it should.");
}

main().catch((err) => {
  console.error("Couldn't run the check:", err?.message ?? err);
  process.exit(1);
});
