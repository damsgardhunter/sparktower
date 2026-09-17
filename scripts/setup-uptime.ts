/**
 * Creates (or corrects) the UptimeRobot monitor that watches production.
 *
 *   npm run monitor:setup                 — asks for the key, nothing echoed
 *   npm run monitor:setup -- --dry-run    — says what it would do, changes nothing
 *   npm run monitor:setup -- --url https://sparktower.app/_ready
 *
 * The key is a credential for an account that can delete every monitor you
 * have, so it is read from a prompt, from UPTIMEROBOT_API_KEY, or from .env —
 * never from an argument. An argument is remembered by your shell, shown in
 * `ps` to everyone on the machine, and copied into whatever you paste next.
 *
 * Nothing here is stored: the server never needs this key, only this script
 * does, and a secret that lives nowhere can't leak from anywhere.
 *
 * Safe to run twice. It matches on the URL and edits the monitor it finds
 * rather than adding a second one, so re-running after the domain moves fixes
 * the existing monitor instead of leaving two that disagree.
 *
 * What it sets up, and why, is in docs/ops/deploy.md:
 *   - watches /_ready, not /_health — /_health answers 200 while the database
 *     is unreachable, which is the outage you actually want to hear about
 *   - a keyword check for "ready":true, so a 200 with a broken body still pages
 *   - five minutes, thirty-second timeout
 */
import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";

const API = "https://api.uptimerobot.com/v2";
const DEFAULT_URL = "https://sparktower.onrender.com/_ready";
const FRIENDLY_NAME = "SparkTower production";
const INTERVAL_SECONDS = 300;
const TIMEOUT_SECONDS = 30;
/** The body a healthy deployment returns. Absent → something is wrong even if the status is 200. */
const KEYWORD = '"ready":true';

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const urlArg = args.indexOf("--url");
const target = urlArg !== -1 ? args[urlArg + 1] : DEFAULT_URL;

if (args.some((a) => a.startsWith("--key") || a.startsWith("--api-key"))) {
  console.error("\nDon't pass the key as an argument — your shell remembers it and `ps` shows it to\nanyone on this machine. Run without it and you'll be asked, or export\nUPTIMEROBOT_API_KEY for this one command.\n");
  process.exit(2);
}

function fromDotEnv(name: string): string | undefined {
  if (!existsSync(".env")) return undefined;
  for (const raw of readFileSync(".env", "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1 || line.slice(0, eq).trim() !== name) continue;
    return line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

/** Reads the key without printing it back. A key on screen is a key in a screenshot. */
function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Swallow the echo of what's typed, but keep the question itself visible.
    const out = process.stdout as any;
    const write = out.write.bind(out);
    let hiding = false;
    out.write = (chunk: any, ...rest: any[]) => (hiding ? true : write(chunk, ...rest));
    write(question);
    hiding = true;
    rl.question("", (answer) => {
      hiding = false;
      out.write = write;
      write("\n");
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Never let a key reach a log, a terminal, or an error message. */
const redact = (text: string, key: string) => (key ? text.split(key).join("«api key»") : text);

async function call(method: string, key: string, params: Record<string, string | number> = {}): Promise<any> {
  const body = new URLSearchParams({ api_key: key, format: "json", ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-cache" },
    body,
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error(`${method}: ${res.status} — ${redact(text.slice(0, 200), key)}`); }
  if (json.stat !== "ok") {
    const message = json.error?.message ?? JSON.stringify(json.error ?? json);
    throw new Error(`${method}: ${redact(String(message), key)}`);
  }
  return json;
}

async function main() {
  const key = process.env.UPTIMEROBOT_API_KEY?.trim()
    || fromDotEnv("UPTIMEROBOT_API_KEY")
    || (await prompt("UptimeRobot API key (not shown as you type, not stored): "));

  if (!key) {
    console.error("\nNo key given. Get one at uptimerobot.com → My Settings → API → Main API Key.\nThe main key, not a monitor-specific one: only the main key can create monitors.\n");
    process.exit(2);
  }

  console.log(`\nMonitor target: ${target}`);
  if (dryRun) console.log("(dry run — nothing will be created or changed)\n");

  // Who gets told. A monitor with no alert contacts watches in silence.
  const contacts = (await call("getAlertContacts", key)).alert_contacts ?? [];
  const usable = contacts.filter((c: any) => Number(c.status) === 2); // 2 = active
  if (usable.length === 0) {
    console.log("\n⚠ This account has no active alert contacts, so a monitor would notice an outage");
    console.log("  and tell nobody. Add one at uptimerobot.com → My Settings → Alert Contacts");
    console.log("  (confirm the email — an unconfirmed contact doesn't count), then run this again.\n");
  } else {
    console.log(`Alert contacts: ${usable.map((c: any) => c.friendly_name || c.value).join(", ")}`);
  }
  // "id_threshold_recurrence": notify immediately, once.
  const alertContacts = usable.map((c: any) => `${c.id}_0_0`).join("-");

  const existing = ((await call("getMonitors", key, { search: target })).monitors ?? [])
    .find((m: any) => String(m.url).replace(/\/$/, "") === target.replace(/\/$/, ""));

  const settings = {
    friendly_name: FRIENDLY_NAME,
    url: target,
    type: 2,               // keyword
    keyword_type: 2,       // alert when the keyword is NOT found
    keyword_value: KEYWORD,
    interval: INTERVAL_SECONDS,
    timeout: TIMEOUT_SECONDS,
    ...(alertContacts ? { alert_contacts: alertContacts } : {}),
  };

  if (dryRun) {
    console.log(existing ? `\nWould update monitor ${existing.id} ("${existing.friendly_name}")` : "\nWould create a new monitor");
    console.log(`  type      keyword — alerts when the response does NOT contain ${KEYWORD}`);
    console.log(`  interval  every ${INTERVAL_SECONDS / 60} minutes, ${TIMEOUT_SECONDS}s timeout`);
    console.log(`  contacts  ${usable.length || "none"}\n`);
    return;
  }

  const result = existing
    ? await call("editMonitor", key, { id: existing.id, ...settings })
    : await call("newMonitor", key, settings);
  const id = result.monitor?.id ?? existing?.id;
  console.log(existing ? `\nUpdated monitor ${id}.` : `\nCreated monitor ${id}.`);

  // Read it back rather than trusting the write: the API accepts a keyword
  // monitor on plans that don't run one, and the difference only shows here.
  const [saved] = (await call("getMonitors", key, { monitors: id })).monitors ?? [];
  if (!saved) {
    console.log("Created, but reading it back returned nothing. Check the dashboard.");
    return;
  }
  const STATUS: Record<number, string> = { 0: "paused", 1: "not checked yet", 2: "up", 8: "seems down", 9: "down" };
  console.log(`  name      ${saved.friendly_name}`);
  console.log(`  url       ${saved.url}`);
  console.log(`  type      ${Number(saved.type) === 2 ? `keyword (alerts when ${KEYWORD} is missing)` : `HTTP status only — this plan did not accept a keyword check, so a 200 with a broken body would NOT alert`}`);
  console.log(`  interval  every ${Number(saved.interval) / 60} minutes`);
  console.log(`  state     ${STATUS[Number(saved.status)] ?? saved.status}`);
  console.log(`  contacts  ${usable.length || "NONE — nobody will be told"}`);

  console.log("\nOne thing this script can't do for you: prove the alert arrives.");
  console.log("Pause the monitor and resume it, or point it at a URL that 404s for a minute,");
  console.log("and confirm the mail actually lands. An alert nobody receives is worse than none,");
  console.log("because you'll believe you're covered. Then tick the boxes in docs/ops/deploy.md.\n");
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  console.error("If that says the key is wrong: it must be the Main API Key (My Settings → API),");
  console.error("not a monitor-specific or read-only one — those can't create monitors.\n");
  process.exit(1);
});
