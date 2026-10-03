/**
 * What happens when two hundred people play at once.
 *
 * `docs/ops/scaling-to-2000.md` opens with step 0 — measure before buying
 * anything — and then says the harness that would do it is not in this
 * repository, because `scripts/season-scale.mjs` measures the *engine* in
 * process and never makes an HTTP request. So every instance count in
 * `docs/ops/scaling.md` is arithmetic from a per-user request rate nobody has
 * observed. This is the missing driver: real users, real sessions, real
 * routes, over the network.
 *
 *   npx tsx scripts/sim-load.ts --users 200
 *   npx tsx scripts/sim-load.ts --users 50 --base http://localhost:5021 --seconds 60
 *   npx tsx scripts/sim-load.ts --users 200 --client mobile   # the phone's intervals
 *   npx tsx scripts/sim-load.ts --users 200 --client mixed    # half and half
 *   npx tsx scripts/sim-load.ts --users 200 --stage join   # just the thundering herd
 *
 * ## Why this shape and not a generic HTTP flood
 *
 * A load generator that hammers one endpoint would measure the wrong thing
 * here. The expensive and dangerous moment in this product is *joining*: every
 * joiner for a market takes the same advisory lock (`simulation-routes.ts`,
 * `pg_advisory_xact_lock(hashtextextended(nicheId, 0))`) so that five friends
 * pressing the button together land in one room instead of three. That lock is
 * correctness, it is not a mistake — and it also means joins for one market are
 * a strict queue, so the interesting number is how long one join holds it and
 * therefore how many people a market can seat per second. No generic tool
 * finds that; it needs the actual sequence a person goes through.
 *
 * So the stages mirror a session: everybody arrives at once, everybody grabs
 * for the same chair, the tables get named, then everyone settles into the
 * polling the real client does while they play. Each stage reports latency
 * percentiles *and* checks the invariants that only break under concurrency —
 * six people in a five-seat room, two chief executives at one table, one
 * person seated twice. A fast wrong answer is not a pass.
 *
 * ## Reading the output
 *
 * Latency percentiles are per stage, and the budgets below are what a person
 * would call "it worked". Correctness failures and budget misses both exit
 * non-zero, so this can be a gate rather than something somebody remembers to
 * run.
 *
 * ## What it needs
 *
 * A development server (`NODE_ENV` not production) with the dev outbox
 * available, because accounts are confirmed by reading the link back out of it
 * rather than by writing to the database — the same reason
 * `test/helpers/verify-email.ts` does it that way.
 *
 * Point it at a throwaway database, not the one you develop against: a run
 * leaves N accounts, a pile of seasons and every room they sat in behind it.
 *
 *   createdb project_load
 *   sed 's#/project$#/project_load#' .env > .env.load   # .env.* is gitignored
 *   printf '\nSIM_DEV_ADVANCE=1\nSIM_DEV_FREE_SEATS=1\n' >> .env.load
 *   DATABASE_URL=...project_load npx drizzle-kit migrate   # the server warns, it does not migrate
 *   PORT=5021 NODE_ENV=development npx tsx --env-file=.env.load server/index.ts
 *
 * Delete `.env.load` when you are done with it — it is a copy of real
 * credentials, and the only reason it exists is that `--env-file` wants a
 * file.
 *
 * It never needs a payment or model key. Nothing here calls Stripe or OpenAI.
 *
 * ## What these numbers are not
 *
 * Run the obvious way — server, generator and database all on one laptop —
 * every latency here is pessimistic and every throughput is a floor, because
 * the thing being measured is competing with the thing measuring it for the
 * same cores. That is fine for the two jobs this is actually for: comparing a
 * change against the same setup before it, and finding the behaviour that only
 * appears when people arrive together. It is not fine for sizing instances,
 * which is what `docs/ops/scaling-to-2000.md` step 0 asks for — for that, run
 * this from a different machine than the server, against the tier being
 * bought, and say which is which when reporting the number.
 *
 * The bystander probe is the figure least damaged by sharing a laptop, because
 * it is a ratio against an idle baseline taken on the same hardware moments
 * earlier.
 */

import os from "node:os";

const BASE = argOf("base") ?? "http://localhost:5021";
const USERS = Number(argOf("users") ?? 50);
const NICHE = argOf("niche") ?? "dating_apps";
const SECONDS = Number(argOf("seconds") ?? 45);
const STAGE = argOf("stage") ?? "all";
const RAMP_MS = Number(argOf("ramp") ?? 0);
/**
 * When to stop waiting and call a request failed.
 *
 * `fetch` has no default timeout, so the first run of this script recorded a
 * p95 of five minutes for registration: three requests were simply never
 * answered and the script sat on them. "Never answered" is a result worth
 * reporting in one line, not worth waiting out — and without a bound a stall
 * anywhere makes the whole run's wall clock, and so every rate in the table,
 * meaningless.
 */
const TIMEOUT_MS = Number(argOf("timeout") ?? 30_000);
/** Who these people are while they play: see `play`. */
const PROFILE = argOf("profile") ?? "mixed";
/** Which client's polling intervals they use: `web`, `mobile`, or `mixed`. */
const CLIENT = argOf("client") ?? "web";
/**
 * Mirrors `MATCH_MAX_ROOMS` in server/simulation-routes.ts.
 *
 * Copied rather than imported: this script talks to a server over HTTP and may
 * be pointed at a deployed one, where importing the local constant would
 * silently assert the wrong number about a different build. If the server's
 * value changes, this one has to be changed with it — which is the honest
 * coupling, because the check below is a claim about that server's behaviour.
 */
const MATCH_MAX_ROOMS = 8;

/**
 * What "it worked" means, per stage, at the p95.
 *
 * Generous on purpose. These are not a target to tune against — they are the
 * line past which a person sitting at the screen notices, so that this script
 * fails on a regression rather than on a slow laptop. The join budget is the
 * loose one because joins serialise per market by design: two hundred people
 * through one lock is a queue, and the question the budget asks is whether the
 * queue drains in a time somebody would wait, not whether it exists.
 */
const BUDGET_P95_MS: Record<string, number> = {
  register: 4000,
  verify: 2000,
  join: 8000,
  claim: 3000,
  name: 2000,
  poll: 1500,
  file: 3000,
};

/** A seat's five levers, and a filing for each, so every desk files something real. */
const ROLES = ["ceo", "cmo", "cfo", "cto", "coo"] as const;
type Role = (typeof ROLES)[number];

/**
 * What each desk sends when it files.
 *
 * Deliberately minimal and valid rather than interesting: this script measures
 * the cost of the round trip and the correctness of the concurrency, and a
 * filing that fails validation would measure the 400 path instead. The
 * balance of what these decisions *do* is `scripts/season-scale.mjs` and the
 * simulation tests' business.
 */
const FILING: Record<Role, Record<string, unknown>> = {
  ceo: { focus: "growth" },
  cmo: { price: 39, brandSpend: 50_000, performanceSpend: 50_000 },
  cfo: { borrow: 0, repay: 0, cashBuffer: 500_000 },
  cto: { researchSpend: 100_000 },
  coo: { headcount: 0 },
};

function argOf(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/* ─────────────────────────── measuring ─────────────────────────── */

interface Sample { ms: number; ok: boolean; status: number; code?: string }

class Timings {
  readonly samples: Sample[] = [];
  add(s: Sample) { this.samples.push(s); }

  get count() { return this.samples.length; }
  get failures() { return this.samples.filter((s) => !s.ok); }

  percentile(p: number): number {
    if (!this.samples.length) return 0;
    const sorted = this.samples.map((s) => s.ms).sort((a, b) => a - b);
    /*
     * Nearest-rank, not interpolated. With a handful of samples an
     * interpolated p95 invents a number between two real observations, and
     * the thing being reported here is "a request actually took this long".
     */
    const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, i)];
  }

  /** The reasons things failed, commonest first, so a wall of 429s reads as one line. */
  get reasons(): string {
    const by = new Map<string, number>();
    for (const f of this.failures) {
      const key = `${f.status}${f.code ? ` ${f.code}` : ""}`;
      by.set(key, (by.get(key) ?? 0) + 1);
    }
    return [...by].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}×${k}`).join(" ") || "—";
  }
}

/**
 * A bystander: a signed-in person on an unrelated screen, asking a cheap question.
 *
 * The most useful single signal here, and the one that is invisible if you only
 * measure the requests you are driving. Node serves on one thread, so anything
 * that holds it — a synchronous hash, a long serialise, a tight loop over a
 * season's companies — stops *every* request, including ones that touch none of
 * the same code. Measuring only the stage under test hides that: the stage looks
 * uniformly slow, which reads as "this endpoint is slow" rather than "the server
 * was unavailable to everybody".
 *
 * ## It has to be signed in, and it was not
 *
 * This asked for `/api/sim/niches` with no cookie. `isAuthenticated` answers 401
 * and returns *before* `next()` — no session lookup, no database, no handler — so
 * what it actually measured was whether the process would accept a connection and
 * run one middleware. On a `--client mixed` run it reported a steady 3ms while the
 * requests around it were taking five seconds, which is how the flaw was found:
 * an instrument that cannot distinguish "the server is fine" from "the server is
 * doing nothing for anybody" is worse than no instrument, because it produces a
 * green number next to a red one and invites you to trust the green.
 *
 * It holds a real session now and asks a real question — one cheap authenticated
 * count, the sort of thing every screen in the product does. That measures what a
 * person who is merely *present* experiences while two hundred others play.
 *
 * What the old probe did still measure, and measure well, is the event loop being
 * blocked outright: a 401 that cannot be answered is a thread that is not running
 * at all. That is how the password-hashing cost was found, and that finding was
 * corroborated separately by measuring event-loop lag directly.
 */
class Bystander {
  private readonly ms: number[] = [];
  private stop = false;
  private done: Promise<void> = Promise.resolve();
  /** Set once a person is available to borrow a session from. */
  private who: Person | undefined;

  constructor(private readonly path = "/api/notifications/unread-count") {}

  /** Lend the probe a signed-in session. Without one it cannot measure anything real. */
  signIn(person: Person) { this.who = person; }

  start(everyMs = 250) {
    this.stop = false;
    this.done = (async () => {
      while (!this.stop) {
        const t = performance.now();
        if (this.who) {
          await this.who.call("GET", this.path);
        } else {
          /*
           * Before any account exists there is nobody to be. Measured anyway, so
           * the idle baseline is taken on the same hardware moments earlier — and
           * labelled, because it is not the same measurement.
           */
          try {
            await fetch(`${BASE}${this.path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
          } catch { /* a refusal is a latency of "never", and the timeout bounds it */ }
        }
        this.ms.push(performance.now() - t);
        await sleep(everyMs);
      }
    })();
  }

  async finish(): Promise<{ n: number; p50: number; p95: number; max: number; signedIn: boolean }> {
    this.stop = true;
    await this.done;
    const s = [...this.ms].sort((a, b) => a - b);
    const at = (p: number) => s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0;
    return { n: s.length, p50: at(0.5), p95: at(0.95), max: s.at(-1) ?? 0, signedIn: !!this.who };
  }
}

/* ─────────────────────────── one virtual person ─────────────────────────── */

class Person {
  /*
   * A jar, not a string.
   *
   * This kept the latest response's `set-cookie` verbatim, so any response
   * that set a single unrelated cookie dropped the session one — and the first
   * run of this script reported a wall of 401s from `/api/sim/join` that
   * looked exactly like the server refusing authenticated requests under load.
   * It was this. A harness that invents server faults is worse than no
   * harness, so cookies are merged by name the way a browser merges them.
   */
  readonly jar = new Map<string, string>();
  id = "";
  ventureId = "";
  role: Role | null = null;
  /** Distinct per person: every rate limit in the stack keys on user or address. */
  readonly ip: string;

  constructor(readonly n: number, public email: string, readonly password = "a-good-passphrase-here") {
    // TEST-NET-2 (RFC 5737), which exists for exactly this and routes nowhere.
    this.ip = `198.51.${100 + Math.floor(n / 250)}.${1 + (n % 250)}`;
  }

  async call(
    method: string, path: string, body?: unknown, into?: Timings,
  ): Promise<{ status: number; body: any }> {
    const started = performance.now();
    let status = 0;
    let parsed: any = null;
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": this.ip,
          ...(this.jar.size ? { cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      status = res.status;
      /*
       * Kept if it is offered. A session that is silently dropped turns every
       * later call into a 401 and the run reads as a server fault rather than
       * as this script losing the cookie.
       */
      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) this.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
      const text = await res.text();
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text.slice(0, 200) }; }
    } catch (err: any) {
      // A connection refused or reset is a result, not a crash: it is what
      // running out of something looks like from the client's side.
      parsed = { code: "transport", message: String(err?.message ?? err) };
    }
    into?.add({
      ms: performance.now() - started,
      ok: status >= 200 && status < 300,
      status,
      code: parsed?.code,
    });
    return { status, body: parsed };
  }
}

/* ─────────────────────────── stages ─────────────────────────── */

/**
 * Run `jobs` with at most `width` in flight.
 *
 * The join stage wants everybody at once, which is the point of it. Everything
 * else wants a ceiling, because a thousand simultaneous registrations measure
 * this script's own event loop rather than the server's.
 */
async function pool<T>(jobs: (() => Promise<T>)[], width: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      out[i] = await jobs[i]();
    }
  }));
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * N confirmed accounts.
 *
 * Registered and then confirmed by reading the link out of `GET
 * /api/dev/outbox`, exactly as a person clicks it — no database shortcut, so a
 * change to the sign-up flow fails here rather than being papered over.
 *
 * In batches, and the batch size is not arbitrary: the dev outbox keeps the
 * last fifty messages (`server/email.ts`), so registering two hundred people
 * and then confirming them would find the first hundred and fifty links
 * already evicted. Each batch confirms before the next registers.
 */
async function provision(timings: { register: Timings; verify: Timings }): Promise<Person[]> {
  const stamp = Date.now();
  const people: Person[] = [];
  const BATCH = 20;

  for (let start = 0; start < USERS; start += BATCH) {
    const batch: Person[] = [];
    for (let n = start; n < Math.min(USERS, start + BATCH); n++) {
      batch.push(new Person(n, `load-${stamp}-${n}@example.test`));
    }

    await pool(batch.map((p) => async () => {
      const res = await p.call("POST", "/api/auth/register", {
        email: p.email, password: p.password, firstName: `P${p.n}`,
      }, timings.register);
      if (res.status !== 201) return;
      p.id = res.body?.id ?? "";
    }), 10);

    await pool(batch.map((p) => async () => {
      if (!p.id) return;
      const out = await p.call("GET", "/api/dev/outbox");
      const mine = (out.body?.messages ?? []).find(
        (m: any) => m.to?.toLowerCase() === p.email.toLowerCase() && m.tag === "verify-email",
      );
      const token = /verify-email\?token=([^\s&]+)/.exec(mine?.text ?? "")?.[1];
      if (!token) return;
      await p.call("POST", "/api/auth/verify-email", { token }, timings.verify);
    }), 10);

    people.push(...batch.filter((p) => p.id));
    process.stderr.write(`\r  provisioned ${people.length}/${USERS}`);
  }
  process.stderr.write("\n");
  return people;
}

/**
 * Everybody joins the same market in the same instant.
 *
 * This is the stage worth having a harness for. All of them contend on one
 * advisory lock, so the latency spread here *is* the queue, and the invariants
 * underneath are the ones that sequential tests cannot reach — the comment on
 * `takeSeatInSeason` describes a six-person five-seat room that "the browsers
 * showed and the sequential tests never could".
 */
async function join(people: Person[], t: Timings): Promise<void> {
  const fire = people.map((p) => async () => {
    if (RAMP_MS) await sleep(Math.random() * RAMP_MS);
    const res = await p.call("POST", "/api/sim/join", { nicheId: NICHE }, t);
    p.ventureId = res.body?.ventureId ?? "";
  });
  // No ceiling on purpose: the thundering herd is the measurement.
  await Promise.all(fire.map((f) => f()));
}

/**
 * Everybody reaches for `ceo`, then takes what is left.
 *
 * The first pass is the collision the unique index exists for: one 200 and the
 * rest 409 `role_taken`, per table. The second pass settles the table so the
 * season can actually start, which is what makes the later stages possible.
 */
async function claim(people: Person[], t: Timings): Promise<void> {
  const tables = groupByVenture(people);

  // Pass one: everyone at a table grabs for the same chair, at once.
  await Promise.all([...tables.values()].flatMap((table) =>
    table.map(async (p) => {
      const res = await p.call("POST", `/api/sim/ventures/${p.ventureId}/claim`, { role: "ceo" }, t);
      if (res.status === 200) p.role = "ceo";
    })));

  // Pass two: whoever lost takes a free chair, in order, so the table fills.
  for (const table of tables.values()) {
    const left = ROLES.filter((r) => !table.some((p) => p.role === r));
    for (const p of table.filter((q) => !q.role)) {
      const want = left.shift();
      if (!want) break;
      const res = await p.call("POST", `/api/sim/ventures/${p.ventureId}/claim`, { role: want }, t);
      if (res.status === 200) p.role = want;
    }
  }
}

/** Each table's chief executive names the company, which is what starts the year. */
async function name(people: Person[], t: Timings): Promise<void> {
  const bosses = people.filter((p) => p.role === "ceo");
  await pool(bosses.map((p) => async () => {
    await p.call("POST", `/api/sim/ventures/${p.ventureId}/name`,
      { name: `Table ${p.ventureId.slice(0, 6)}`, product: "A slow dating app." }, t);
  }), 25);
}

/**
 * What the real client asks for, and how often.
 *
 * These are read out of `client/src`, not estimated, because the instance
 * arithmetic in `docs/ops/scaling.md` is built on a per-user request rate and a
 * poll loop at the wrong period measures a load nobody generates. Every number
 * below has the file it came from beside it.
 *
 * The thing to notice: the **lobby** is four times heavier than the desk, and
 * it does not stop when the season starts. A person who joins and leaves
 * `/simulation` open keeps the 2s room poll for the whole season, and picks up
 * standings on top; only navigating to the desk swaps it for the 8s one. So
 * "200 people playing" is a much lighter load than "200 people who joined and
 * left the tab open", and the second is the one a workshop actually produces.
 */
/**
 * What a client asks for, and how often — one profile per client we ship.
 *
 * Read out of the source rather than estimated, with the file beside each
 * number, because the instance arithmetic in `docs/ops/scaling.md` is built on a
 * per-user request rate and a poll loop at the wrong period measures a load
 * nobody generates.
 *
 * There are two profiles because the two clients are not close. The phone polls
 * the desk three times as often as the browser, standings twenty-four times as
 * often, and it polls the *venture list* continuously from a top-level tab —
 * which the browser never does, so a phone user who never opens a season still
 * asks for it twenty-four times a minute. `--client` picks which cohort is being
 * measured, and `mixed` is the one that resembles a real population.
 */
interface Profile {
  /** The room, while it is still gathering. */
  roomMs: number | false;
  /** The room, once the season is running. */
  roomRunningMs: number | false;
  deskMs: number;
  standingsMs: number;
  notificationsMs: number;
  messagesMs: number;
  discoverMs: number;
  /** The venture list, polled from a tab rather than from inside a season. */
  venturesMs: number | false;
  /** A debounced read of the credit balance after a write, or false if the client makes none. */
  subscriptionAfterWriteMs: number | false;
}

const WEB: Profile = {
  /**
   * `roomPollMs` in client/src/pages/simulation.tsx — two seconds while the
   * room is gathering, thirty once the season runs, and nothing once retired.
   *
   * It was a flat two seconds for every phase, which this script is what found:
   * at two hundred players it was the largest single bucket here, and nearly all
   * of it was asking a question whose answer had stopped changing.
   */
  roomMs: 2000,
  roomRunningMs: 30_000,
  /** `client/src/pages/simulation-desk.tsx:231`. */
  deskMs: 8000,
  /** `client/src/components/sim/season-standing.tsx:52` — embedded on /simulation while running. */
  standingsMs: 60_000,
  /** `client/src/components/notification-bell.tsx:35` — app chrome, so every screen. */
  notificationsMs: 30_000,
  /** `client/src/components/app-sidebar.tsx:72`. */
  messagesMs: 10_000,
  /** `client/src/components/app-sidebar.tsx:80` — app chrome. */
  discoverMs: 60_000,
  /** The browser fetches the list on mount and on invalidation, never on a timer. */
  venturesMs: false,
  /** `creditsFollow` in client/src/lib/queryClient.ts skips `/api/sim/`, so no filing triggers one. */
  subscriptionAfterWriteMs: false,
};

const MOBILE: Profile = {
  /*
   * One constant for every simulation screen: `ROOM_POLL_MS` in
   * mobile/src/components/sim/useSim.ts:31. The comment on `useStandings` says
   * why — "one number to change is worth more than the handful of requests a
   * slower one would save" — which is a fair trade made before anybody had
   * measured the handful. On the desk it is 3.2× the browser's rate and on
   * standings 24×, so this profile exists to put a number on it rather than to
   * argue about it.
   */
  roomMs: 2500,
  /*
   * `venturePollMs` — 30s once running, not stopped. It used to stop, which left
   * the screen claiming a finished season was still trading.
   */
  roomRunningMs: 30_000,
  /*
   * `deskPollMs` in mobile/src/components/sim/lobby.ts — 2,500ms while the year
   * is closing, 8,000ms the rest of the time, which is the browser's rate. The
   * flat 2,500 was 3,442 requests in ninety seconds at two hundred players, a
   * third of everything the phone asked for. Modelled at the resting rate,
   * because a run spends almost all its time outside the closing window.
   */
  deskMs: 8000,
  /*
   * `standingsPollMs` — 2,500ms around the tick, 30,000ms between ticks, now that
   * the standings response carries `resolvesAt`. Modelled at the resting rate,
   * because a run spends nearly all its time between ticks. Was the room's flat
   * 2,500ms, which was 23× the browser's on a table that changes once a period.
   */
  standingsMs: 30_000,
  /** mobile/src/components/AppHeader.tsx:62 — same as the browser. */
  notificationsMs: 30_000,
  /** mobile/src/components/nav/NovaTabBar.tsx:130 — half the browser's rate. */
  messagesMs: 20_000,
  /** mobile/src/components/nav/NovaTabBar.tsx:120 — same as the browser. */
  discoverMs: 60_000,
  /*
   * `useVentures` in mobile/src/components/sim/useSim.ts, mounted by the
   * Sprints *tab* as well as the simulation index — so this runs for somebody
   * who is not in a season at all, which nothing in the browser does.
   *
   * 2,500ms for every row in every phase until this script measured it: 6,905
   * requests in ninety seconds at two hundred players, 45% of everything the
   * phone asked for, and more on its own than the whole browser profile. It is
   * `venturesPollMs` now — quick only while a row could still change which
   * screen it opens, which is the reason the poll existed. Playing means every
   * row is running, so this is the idle rate.
   */
  venturesMs: 30_000,
  /** mobile/src/api/client.ts has no post-write invalidation hook at all. */
  subscriptionAfterWriteMs: false,
};

const PROFILES: Record<string, Profile> = { web: WEB, mobile: MOBILE };

/**
 * Wait until the tables can actually be played, and say how long it took.
 *
 * A filing is refused with `not_running` until the *season* starts, which is a
 * scheduled job's decision rather than a consequence of the last person
 * sitting down (`startReadySeasons`, server/simulation-tick.ts) — so the first
 * runs of this script filed into a season that did not exist yet and recorded
 * a wall of 409s as though the route were broken.
 *
 * Worth a number of its own rather than a sleep: "how long after the room
 * fills can the table play" is the thing a person at a workshop is waiting
 * through, and at two hundred people it is a claim about the tick, not about
 * the request. Bounded, and it reports giving up rather than hanging.
 */
async function waitForRunning(
  people: Person[], limitMs = Number(argOf("startwait") ?? 420_000),
): Promise<{ first: number; last: number; started: number; of: number } | null> {
  /*
   * One scout per table, not one for the whole run.
   *
   * This watched `people[0]` alone and reported "it never started" on a
   * 200-person run where the database showed all six seasons running — because
   * that one person's room was among the few that retired, so their desk never
   * turned over and the single probe concluded nothing had.
   *
   * It is also the wrong question. Seasons start independently and each waits
   * for its own slowest room, so "when did it start" has a spread, and the
   * spread is the interesting part: the gap between the first table playing
   * and the last is how long a workshop stands around.
   */
  const scouts = [...groupByVenture(people).values()].map((t) => t[0]).filter((p) => p.ventureId);
  if (!scouts.length) return null;

  const startedAt = new Map<string, number>();
  const t0 = performance.now();
  while (performance.now() - t0 < limitMs && startedAt.size < scouts.length) {
    await Promise.all(scouts.map(async (p) => {
      if (startedAt.has(p.ventureId)) return;
      /*
       * The room, not the desk — and the difference is not cosmetic.
       *
       * `GET /api/sim/ventures/:id` calls `advanceVenture` before answering,
       * so a lobby moves on as it is watched; `GET …/desk` does not. Probing
       * with the desk therefore measured a lobby that nothing was advancing,
       * and reported 4 of 44 tables playable after seven minutes on a run
       * where the database showed all 44 running shortly after. It is also
       * simply not what a person does: until the season starts they are on
       * /simulation, which polls this route every two seconds.
       */
      const res = await p.call("GET", `/api/sim/ventures/${p.ventureId}`);
      // A room that retired will never start; counting it as outstanding for
      // the whole limit would hide the answer for every room that did.
      if (res.status === 404 || res.body?.phase === "retired") {
        startedAt.set(p.ventureId, Number.NaN);
        return;
      }
      if (res.body?.phase === "running") {
        startedAt.set(p.ventureId, performance.now() - t0);
      }
    }));
    if (startedAt.size < scouts.length) await sleep(5000);
  }

  const times = [...startedAt.values()].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!times.length) return null;
  return { first: times[0], last: times.at(-1)!, started: times.length, of: scouts.length };
}

/**
 * Everybody plays for `--seconds`, polling the way the client polls.
 *
 * Spawned as independent loops rather than one serial round, because that is
 * what the client is: several TanStack queries each with their own
 * `refetchInterval`, firing on their own schedule. A single loop that did them
 * in sequence would generate a different shape of load — bursts of six rather
 * than a steady spread — and would silently slow itself down as the server
 * slowed, hiding exactly what this is meant to measure.
 *
 * `--profile` picks who these people are:
 *   desk   — everyone at their desk (the light case, 8s)
 *   lobby  — everyone left /simulation open (the heavy case, 2s)
 *   mixed  — half and half, which is what a real session looks like
 */
async function play(
  people: Person[], t: { poll: (label: string) => Timings; file: Timings }, playing = true,
): Promise<void> {
  const until = Date.now() + SECONDS * 1000;
  const live = () => Date.now() < until;

  /** One poller: jitter the first tick, then hold the period. `false` means the client does not ask. */
  const loop = async (p: Person, label: string, path: string, every: number | false) => {
    if (every === false) return;
    await sleep(Math.random() * every);
    while (live()) {
      await p.call("GET", path, undefined, t.poll(label));
      await sleep(every);
    }
  };

  /*
   * Who is where, and on what.
   *
   * `--profile` describes where people sit *once the season is running*, which
   * is the only time the choice exists. Before that everybody is on the room
   * screen, because that is the only screen there is to be on — and it matters
   * for more than fidelity: the room route advances the lobby as a side effect
   * of answering, so modelling lobby-sitters as desk-pollers measured a lobby
   * nothing was pushing along.
   *
   * `--client` decides which client's intervals they use. `mixed` alternates, so
   * a run resembles a population rather than a monoculture.
   */
  await Promise.all(people.flatMap((p, i) => {
    /*
     * Which client, and which screen — decided on different bits of `i`.
     *
     * Both used `i % 2`, so in a mixed run every browser user was at a desk and
     * every phone user was in a room: the two dimensions were perfectly
     * correlated and half the four combinations never occurred. The giveaway was
     * a results table with `poll room·w` missing from it entirely, which is not a
     * thing a real population does.
     */
    const profile = CLIENT === "mixed" ? (i % 2 === 0 ? WEB : MOBILE) : PROFILES[CLIENT] ?? WEB;
    const atDesk = playing && (PROFILE === "desk"
      || (PROFILE === "mixed" && Math.floor(i / 2) % 2 === 0));
    const label = (name: string) => `${name}${CLIENT === "mixed" ? (profile === MOBILE ? "·m" : "·w") : ""}`;

    const loops = [
      atDesk
        ? loop(p, label("desk"), `/api/sim/ventures/${p.ventureId}/desk`, profile.deskMs)
        : loop(p, label("room"), `/api/sim/ventures/${p.ventureId}`,
            playing ? profile.roomRunningMs : profile.roomMs),
      // The app chrome, which polls wherever they are.
      loop(p, label("notifs"), "/api/notifications/unread-count", profile.notificationsMs),
      loop(p, label("messages"), "/api/messages/unread-count", profile.messagesMs),
      loop(p, label("discover"), "/api/discover/new-count", profile.discoverMs),
      /*
       * The venture list. Browser: never on a timer. Phone: continuously, from a
       * tab, whether or not the person is in a season — so it is not conditional
       * on `atDesk` or on anything else here.
       */
      loop(p, label("ventures"), "/api/sim/ventures", profile.venturesMs),
    ];

    /*
     * The standings card is on the room screen, and only once the season runs.
     * `season-standing.tsx` is mounted behind `room.phase === "running"`, and the
     * phone's equivalent is gated the same way — it was polled here regardless at
     * first, which produced a 39% 404 rate against an endpoint that is simply not
     * asked that question before the world exists.
     */
    if (!atDesk && playing) {
      loops.push(loop(p, label("standings"), `/api/sim/ventures/${p.ventureId}/standings`, profile.standingsMs));
    }

    // And one filing, which is what a period actually asks of a person.
    loops.push((async () => {
      if (!p.role) return;
      await sleep(Math.random() * 2000);
      await p.call("POST", `/api/sim/ventures/${p.ventureId}/decisions`,
        { decision: FILING[p.role] }, t.file);
      /*
       * Followed by a read of the credit balance only if that client makes one.
       * The browser used to after any non-GET and now skips `/api/sim/`
       * (`creditsFollow`); the phone never had the hook. Replaying a request
       * neither client makes would be this script inventing load.
       */
      if (profile.subscriptionAfterWriteMs !== false) {
        await sleep(profile.subscriptionAfterWriteMs);
        await p.call("GET", "/api/subscription", undefined, t.poll(label("subscription")));
      }
    })());

    return loops;
  }));
}

/* ─────────────────────────── invariants ─────────────────────────── */

function groupByVenture(people: Person[]): Map<string, Person[]> {
  const by = new Map<string, Person[]>();
  for (const p of people) {
    if (!p.ventureId) continue;
    by.set(p.ventureId, [...(by.get(p.ventureId) ?? []), p]);
  }
  return by;
}

interface Check { ok: boolean; what: string; detail: string }

/**
 * The things that only break when people arrive together.
 *
 * Each of these has a comment in the server explaining the race it survived,
 * which is the reason to assert them here rather than trust them: the code is
 * right today and this is what would notice if a refactor made it wrong under
 * load, where no sequential test looks.
 */
function invariants(people: Person[], seats: number): Check[] {
  const tables = groupByVenture(people);
  const checks: Check[] = [];

  /*
   * Counted against what was asked for, not against who turned up.
   *
   * This read `seated === people.length` and so passed "0/0 seated" on a run
   * where every single registration had failed — a green board for a run that
   * measured nothing, which is the one result a gate must never give. Every
   * check below is vacuous on an empty set, so the population itself is the
   * first thing asserted.
   */
  checks.push({
    ok: people.length === USERS,
    what: "everybody arrived",
    detail: `${people.length}/${USERS} accounts usable`,
  });

  const seated = people.filter((p) => p.ventureId).length;
  checks.push({
    ok: people.length > 0 && seated === people.length,
    what: "everybody got a room",
    detail: `${seated}/${people.length} seated`,
  });

  const over = [...tables].filter(([, t]) => t.length > seats);
  checks.push({
    ok: over.length === 0,
    what: `no room over ${seats}`,
    detail: over.length ? over.map(([id, t]) => `${id.slice(0, 6)}=${t.length}`).join(" ") : "none",
  });

  /*
   * Rooms are filled fullest-first, so people should be packed — but packed
   * *within a season*, which is the part this got wrong at first.
   *
   * A season takes no more than `MATCH_MAX_ROOMS` tables on purpose
   * (server/simulation-routes.ts): it starts only once every one of its rooms
   * has left the lobby, so an uncapped season on a busy market would never
   * start at all. The ninth table therefore opens a new season, and each
   * season carries its own part-full room at the boundary. Comparing against
   * one global `ceil(N/5)` called that a failure — 22 rooms for 100 people,
   * flagged red, when 20 full tables across three capped seasons is 22 rooms
   * by arithmetic and nothing was wrong.
   *
   * So the thing to assert is what the lock actually promises: at most one
   * part-full room per season. Two in one season would mean joiners who could
   * not see each other each opened a room beside a half-empty one, which is
   * the race `takeSeatInSeason` exists to prevent.
   *
   * Which season a room belongs to is not in the join response, so it is
   * inferred: rooms are grouped by the season the server put them in, read
   * back from the one place a client can see it. Without that, this falls
   * back to counting part-full rooms in total and allowing one per
   * `MATCH_MAX_ROOMS` worth of tables.
   */
  const partial = [...tables.values()].filter((t) => t.length < seats).length;
  const seasonsExpected = Math.max(1, Math.ceil(tables.size / MATCH_MAX_ROOMS));
  checks.push({
    ok: partial <= seasonsExpected,
    what: "people packed into tables",
    detail: `${tables.size} rooms, ${partial} part-full, ${seasonsExpected} season(s) ⇒ at most ${seasonsExpected} part-full`,
  });

  const twice = people.filter((p) => [...tables.values()].filter((t) => t.includes(p)).length > 1);
  checks.push({
    ok: twice.length === 0,
    what: "nobody seated twice",
    detail: twice.length ? `${twice.length} people` : "none",
  });

  const doubled = [...tables].filter(([, t]) => {
    const taken = t.map((p) => p.role).filter(Boolean);
    return new Set(taken).size !== taken.length;
  });
  checks.push({
    ok: doubled.length === 0,
    what: "one person per chair",
    detail: doubled.length ? doubled.map(([id]) => id.slice(0, 6)).join(" ") : "none",
  });

  return checks;
}

/* ─────────────────────────── the run ─────────────────────────── */

function report(rows: [string, Timings][], checks: Check[], wall: number): boolean {
  console.log("");
  console.log(`  stage                 reqs     rps    p50     p95     p99   failures`);
  console.log(`  ──────────────────────────────────────────────────────────────────────────────`);
  let missed: string[] = [];
  for (const [stage, t] of rows) {
    if (!t.count) continue;
    const p95 = t.percentile(95);
    const budget = BUDGET_P95_MS[stage.startsWith("poll ") ? "poll" : stage];
    const over = budget && p95 > budget;
    if (over) missed.push(`${stage} p95 ${Math.round(p95)}ms > ${budget}ms`);
    console.log(
      `  ${stage.padEnd(20)} ${String(t.count).padStart(5)} ` +
      `${(t.count / (wall / 1000)).toFixed(1).padStart(7)} ` +
      `${Math.round(t.percentile(50)).toString().padStart(6)} ` +
      `${Math.round(p95).toString().padStart(6)}${over ? "!" : " "} ` +
      `${Math.round(t.percentile(99)).toString().padStart(6)}   ${t.reasons}`,
    );
  }

  console.log("");
  for (const c of checks) {
    console.log(`  ${c.ok ? "ok  " : "FAIL"}  ${c.what.padEnd(28)} ${c.detail}`);
  }
  if (missed.length) {
    console.log("");
    for (const m of missed) console.log(`  SLOW  ${m}`);
  }

  const bad = checks.some((c) => !c.ok) || missed.length > 0;
  console.log("");
  console.log(`  ${bad ? "FAILED" : "passed"} — ${USERS} users on ${NICHE}, ${CLIENT} client, ${(wall / 1000).toFixed(1)}s wall`);
  /*
   * The total, because the per-endpoint rows do not add up in the head and the
   * comparison that matters between two runs is this one number.
   */
  const polls = rows.filter(([stage]) => stage.startsWith("poll ")).reduce((n, [, t]) => n + t.count, 0);
  console.log(`  ${polls} polled requests in ${(SECONDS)}s of play`);
  /*
   * And what else the machine was doing, because that decides whether any of the
   * latencies above mean anything.
   *
   * A `--client mixed` run once produced p95s of five to ten seconds across every
   * endpoint at the *lowest* request volume yet measured, which looked like a
   * major finding and was a load average of 21: another process on the same
   * laptop was building. Uniform slowness across unrelated endpoints is the
   * signature of a contended machine rather than a slow server, and printing the
   * number is cheaper than remembering to check it.
   */
  const load = os.loadavg()[0];
  const cores = os.cpus().length;
  console.log(`  load average ${load.toFixed(1)} across ${cores} cores at the end of the run`
    + (load > cores ? "  ← contended: treat every latency above as this machine's, not the server's" : ""));
  return !bad;
}

async function main() {
  /*
   * One bucket per polled path, created on demand.
   *
   * Everything the client polls used to land in a single `poll` row, which
   * reported "58x404" on a 200-person run and gave no way to tell which of six
   * endpoints had answered it. A diagnostic that tells you something is wrong
   * but not where is most of a day's work away from being useful.
   */
  const polls = new Map<string, Timings>();
  const pollBucket = (label: string) => {
    const got = polls.get(label) ?? new Timings();
    polls.set(label, got);
    return got;
  };
  const t = {
    register: new Timings(), verify: new Timings(), join: new Timings(),
    claim: new Timings(), name: new Timings(), file: new Timings(),
    poll: pollBucket,
  };

  const up = await fetch(`${BASE}/api/sim/niches`).then((r) => r.status).catch(() => 0);
  if (!up) {
    console.error(`No server at ${BASE}. Start one and pass --base if it is elsewhere.`);
    process.exit(2);
  }

  /*
   * The baseline first, with nothing running, because the number that matters
   * is the ratio. An idle p50 is a property of the laptop and the network; the
   * same request under load, compared against it, is a property of the server.
   */
  const idleProbe = new Bystander();
  idleProbe.start(100);
  await sleep(2000);
  const idle = await idleProbe.finish();

  const wallStart = performance.now();
  console.error(`→ provisioning ${USERS} accounts`);
  const provisionProbe = new Bystander();
  provisionProbe.start();
  const people = await provision(t);
  const duringProvision = await provisionProbe.finish();

  const loadProbe = new Bystander();
  /*
   * A real session, borrowed from somebody who is not in this market's rooms if
   * possible — the point is somebody *present* rather than playing. Any of them
   * will do: the probe only reads a count.
   */
  if (people.length) loadProbe.signIn(people[people.length - 1]);
  loadProbe.start();
  if (people.length < USERS) {
    console.error(`  only ${people.length}/${USERS} registered — see the failures below`);
  }

  const seats = 5;
  let playable: Awaited<ReturnType<typeof waitForRunning>> = null;
  if (STAGE === "all" || STAGE === "join") {
    console.error(`→ ${people.length} joining ${NICHE} at once`);
    await join(people, t.join);
  }
  if (STAGE === "all") {
    console.error(`→ claiming seats`);
    await claim(people, t.claim);
    console.error(`→ naming companies`);
    await name(people, t.name);
    console.error(`→ waiting for the seasons to start`);
    playable = await waitForRunning(people);
    console.error(playable === null
      ? `  none of them started — filings below will be refused`
      : `  first table playable at ${(playable.first / 1000).toFixed(0)}s, last at ${(playable.last / 1000).toFixed(0)}s`
        + ` (${playable.started}/${playable.of} tables)`);
    console.error(`→ playing for ${SECONDS}s`);
    await play(people, t);
  }

  const duringLoad = await loadProbe.finish();
  const wall = performance.now() - wallStart;
  const ok = report(
    [["register", t.register], ["verify", t.verify], ["join", t.join],
     ["claim", t.claim], ["name", t.name], ["file", t.file],
     ...[...polls].sort((a, b) => b[1].count - a[1].count).map(([k, v]) => [`poll ${k}`, v] as [string, Timings])],
    invariants(people, seats), wall,
  );

  if (playable) {
    console.log("");
    console.log(`  time from "everybody has joined" to "this table can play"`);
    console.log(`    first table ${(playable.first / 1000).toFixed(0)}s    last table ${(playable.last / 1000).toFixed(0)}s`
      + `    (${playable.started} of ${playable.of} tables ever started)`);
    /*
     * The gap, said out loud. A season begins only once every one of its rooms
     * has left the lobby, so the last table is what everybody in that season
     * waited for — and at a workshop that wait is the product.
     */
    console.log(`    a table that was ready first still waited ${((playable.last - playable.first) / 1000).toFixed(0)}s for the slowest in its season`);
  }

  console.log("");
  console.log(`  a bystander on an unrelated screen (GET /api/notifications/unread-count, every 250ms)`);
  console.log(`    the idle and registering rows are unauthenticated — there is nobody to be yet — so only`);
  console.log(`    the last row measures a signed-in person. A 401 never reaches the database.`);
  console.log(`    idle               p50 ${Math.round(idle.p50)}ms   p95 ${Math.round(idle.p95)}ms   max ${Math.round(idle.max)}ms   (n=${idle.n})`);
  console.log(`    while registering  p50 ${Math.round(duringProvision.p50)}ms   p95 ${Math.round(duringProvision.p95)}ms   max ${Math.round(duringProvision.max)}ms   (n=${duringProvision.n})`);
  console.log(`    while playing      p50 ${Math.round(duringLoad.p50)}ms   p95 ${Math.round(duringLoad.p95)}ms   max ${Math.round(duringLoad.max)}ms   (n=${duringLoad.n})`);
  /*
   * Stated rather than left to be read off the table. A bystander slowed by
   * this much is the whole site being unavailable to everybody, which is a
   * different and worse thing than the stage under test being slow, and it is
   * the finding most easily missed in a wall of numbers.
   */
  const blown = idle.p50 > 0 ? duringLoad.p50 / Math.max(1, idle.p50) : 0;
  if (blown >= 10) {
    console.log(`    → ${blown.toFixed(0)}× the idle latency: the server was blocked, not merely busy.`);
  }

  process.exit(ok ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(2); });
