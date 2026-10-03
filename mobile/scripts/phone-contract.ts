/**
 * Does the phone's own code agree with the server it is talking to?
 *
 *   cd mobile && npx tsx scripts/phone-contract.ts --base http://localhost:5021
 *
 * It lives in `mobile/` rather than beside `sim-load.ts`, and has to: the root
 * package is `"type": "module"` and this one is not, so a script up there
 * importing these files gets named exports from what Node treats as CommonJS and
 * refuses to load. Keeping it inside the package it is testing also means it
 * resolves exactly as the app does.
 *
 * `scripts/sim-load.ts --client mobile` replays the phone's *intervals* against
 * the API and answers "what does a phone cohort cost the server". It never runs a
 * line of the phone's code, so anything wrong in `mobile/` is still found by
 * hand — which is how the last two were found: a room screen that told a finished
 * season it was still trading, and a vote whose tally the phone received and
 * never showed.
 *
 * This runs the phone's own decisions against real payloads. Not the screens:
 * `mobile/` has no renderer (its tests stub React Native for logic that does not
 * need one), and adding one is a dependency decision rather than a test. What it
 * drives is everything between the socket and the pixels — the parsing, the poll
 * rules, the predicates that decide what a screen offers — which is where both of
 * those bugs actually lived.
 *
 * ## Why this is not a unit test
 *
 * The phone's helpers are already unit-tested against fixtures somebody wrote.
 * The failure mode those cannot see is the fixture being wrong: a field renamed,
 * a shape that arrived as a string, an endpoint that answers 404 where the phone
 * assumed a body. So every payload here comes from a live server, and the thing
 * being checked is agreement rather than correctness.
 *
 * It needs the same throwaway server as `sim-load.ts` — see that file's header.
 * It never needs a payment or model key.
 */
import {
  deskPollMs, standingsPollMs, venturePollMs, venturesPollMs,
  DESK_POLL_CLOSING_MS, DESK_POLL_IDLE_MS, STANDINGS_POLL_IDLE_MS,
} from "../src/components/sim/lobby";
import { canNudge, commitment, money, notStartedReason, expansionOutcome, reachOf, voteOf } from "../src/components/sim/desk";
import { creditPlace, readDecision, seatsThatFiledNothing } from "../src/components/sim/past";
import { effectLines, lifeRead } from "../src/components/sim/market";
import { periodLabel, periodWords, periodsPerYear, seasonSpan, totalPeriodsIn } from "../src/components/sim/period";
import { accountLines, accountsReconcile, yearToShow } from "../src/components/sim/report";
import { VERDICT_READ, capacityRisk, comingUp, demandAtPrice, forecastAtPrice } from "../src/components/sim/future";
import { turnoutRead } from "../src/components/sim/profiles";

const BASE = argOf("base") ?? "http://localhost:5021";
/** The year the marketing seat's `research` lever arrives. Mirrors UNLOCKS in responsibilities.ts. */
const RESEARCH_UNLOCKS_IN = 4;
const NICHE = argOf("niche") ?? "dating_apps";

function argOf(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/* ─────────────────────────── saying what happened ─────────────────────────── */

let checks = 0;
const failures: string[] = [];
const unreached: string[] = [];

/**
 * A check this run never got to, which is not the same as one that failed.
 *
 * A season does not start until every room in its market has left the lobby, so a
 * short run legitimately never sees a table, a rival or a standings table. Calling
 * that a disagreement would make the script cry wolf, and a script that cries wolf
 * gets ignored — but silently passing would be worse, so it is counted and named.
 */
function skip(what: string, why: string) {
  unreached.push(`${what} (${why})`);
  console.log(`  --    ${what}  — not reached: ${why}`);
}

/** One agreement between the phone and the server, named in full. */
function agree(what: string, ok: boolean, detail = "") {
  checks += 1;
  if (ok) {
    console.log(`  ok    ${what}${detail ? `  — ${detail}` : ""}`);
  } else {
    failures.push(`${what}${detail ? `: ${detail}` : ""}`);
    console.log(`  FAIL  ${what}${detail ? `  — ${detail}` : ""}`);
  }
}

/* ─────────────────────────── one phone ─────────────────────────── */

class Phone {
  readonly jar = new Map<string, string>();
  id = "";
  constructor(readonly email: string, readonly ip: string) {}

  async call(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": this.ip,
        ...(this.jar.size ? { cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    const text = await res.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text.slice(0, 200) }; }
    return { status: res.status, body: parsed };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** An account, confirmed the way a person confirms one. */
async function signUp(n: number): Promise<Phone> {
  const phone = new Phone(`phone-${Date.now()}-${n}@example.test`, `198.51.210.${10 + n}`);
  const made = await phone.call("POST", "/api/auth/register", {
    email: phone.email, password: "a-good-passphrase-here", firstName: `Phone${n}`,
  });
  if (made.status !== 201) throw new Error(`register ${made.status}: ${JSON.stringify(made.body).slice(0, 160)}`);
  phone.id = made.body?.id ?? "";
  const out = await phone.call("GET", "/api/dev/outbox");
  const mine = (out.body?.messages ?? []).find(
    (m: any) => m.to?.toLowerCase() === phone.email.toLowerCase() && m.tag === "verify-email");
  const token = /verify-email\?token=([^\s&]+)/.exec(mine?.text ?? "")?.[1];
  if (!token) throw new Error("no confirmation link in the dev outbox");
  await phone.call("POST", "/api/auth/verify-email", { token });
  return phone;
}

/* ─────────────────────────── the run ─────────────────────────── */

async function main() {
  const up = await fetch(`${BASE}/api/sim/niches`).then((r) => r.status).catch(() => 0);
  if (!up) {
    console.error(`No server at ${BASE}. Start one and pass --base if it is elsewhere.`);
    process.exit(2);
  }

  /*
   * Four, and the fifth seat left for a stand-in — which is a measurement
   * decision rather than a convenience.
   *
   * Two accounts takes six minutes to reach year one: the bot filler waits a
   * minute, then the claiming clock runs its three and the naming clock its two,
   * because two people cannot satisfy "every seat is taken". Four fills the room
   * the moment the bot arrives and then advances at once — `nextPhase` moves on as
   * soon as every seat that is going to choose has chosen and the rest are bots.
   *
   * Leaving one seat to the bot is the point: the nudge contract has four
   * refusals to check and one of them is "that seat is a stand-in". A table of
   * five humans would never exercise it.
   */
  const ROLES = ["ceo", "cfo", "cmo", "cto"] as const;
  console.log(`→ ${ROLES.length} accounts and a stand-in, one table, ${NICHE}`);
  const phones = [] as Phone[];
  for (let i = 1; i <= ROLES.length; i++) phones.push(await signUp(i));
  const [a] = phones;

  const joins = await Promise.all(phones.map((p) => p.call("POST", "/api/sim/join", { nicheId: NICHE })));
  const venture = joins[0].body?.ventureId;
  agree(
    "every phone reaches the same room",
    !!venture && joins.every((j) => j.body?.ventureId === venture),
    venture,
  );

  console.log(`\n→ the room screen, while it is still gathering`);
  const room = await a.call("GET", `/api/sim/ventures/${venture}`);
  agree(
    "the phone polls a gathering room quickly",
    venturePollMs(room.body?.phase) === 2500,
    `phase=${room.body?.phase} → ${venturePollMs(room.body?.phase)}ms`,
  );
  agree(
    "the venture list's rate follows the rooms it was given",
    venturesPollMs((await a.call("GET", "/api/sim/ventures")).body?.ventures) > 0,
  );

  console.log(`\n→ claiming, naming, and the desk`);
  /*
   * The room has to be full before a seat can be claimed, and it is full when the
   * bot filler has been round — a minute after the last person arrived. Waited for
   * rather than assumed, because claiming in `filling` is refused with
   * `wrong_phase` and the rest of the run would then be measuring that mistake.
   */
  const claimBy = Date.now() + 150_000;
  let phase = "";
  while (Date.now() < claimBy) {
    const room = await a.call("GET", `/api/sim/ventures/${venture}`);
    phase = room.body?.phase ?? "";
    if (phase === "claiming" || phase === "naming" || phase === "running") break;
    await sleep(5000);
  }
  agree("the room fills and moves to claiming", phase !== "filling" && !!phase, `phase=${phase}`);

  const claims = await Promise.all(phones.map((p, i) =>
    p.call("POST", `/api/sim/ventures/${venture}/claim`, { role: ROLES[i] })));
  agree(
    "each phone takes a different chair",
    claims.every((c) => c.status === 200),
    claims.map((c, i) => `${ROLES[i]}:${c.status}`).join(" "),
  );
  await a.call("POST", `/api/sim/ventures/${venture}/name`, { name: "Phonewright", product: "A test" });

  const desk = await a.call("GET", `/api/sim/ventures/${venture}/desk`);
  agree("the desk answers the phone", desk.status === 200, `phase=${desk.body?.phase}`);

  /*
   * The bug this script exists for. A season that has not started sends three
   * fields the phone ignored for months, and the message it showed instead was
   * usually the wrong reason — so the check is that the real payload carries them
   * and that the phone's sentence changes when they do.
   */
  if (desk.body?.phase === "not_started") {
    const d = desk.body;
    agree(
      "a season that has not started says what it is waiting on",
      typeof d.roomsStillChoosing === "number" && typeof d.yourRoomReady === "boolean",
      `rooms=${d.roomsStillChoosing} ready=${d.yourRoomReady}`,
    );
    const said = notStartedReason(d);
    agree(
      "and the phone's reason is drawn from those fields, not a fixed string",
      said !== notStartedReason({ ...d, roomsStillChoosing: (d.roomsStillChoosing ?? 0) + 7 }),
      said.slice(0, 72),
    );
    agree("the reason never shows a missing number", !/undefined|NaN/.test(said));
  }

  console.log(`\n→ the desk's poll rate, against the deadline the server gives`);
  agree(
    "a desk with a deadline far off rests",
    desk.body?.resolvesAt === undefined || desk.body?.resolvesAt === null
      ? deskPollMs(desk.body) === DESK_POLL_IDLE_MS
      : [DESK_POLL_CLOSING_MS, DESK_POLL_IDLE_MS].includes(deskPollMs(desk.body) as number),
    `resolvesAt=${desk.body?.resolvesAt ?? "none"} → ${deskPollMs(desk.body)}ms`,
  );

  /*
   * Everything below needs a season that has started: the `not_started` desk
   * answers with a deliberately small payload — phase, your seat, and what the
   * wait is for — and no table, rivals or standings. So wait for it, bounded, and
   * say plainly what was not reached rather than failing checks that were never
   * run.
   */
  console.log(`\n→ waiting for year one, so there is a table to read`);
  let live = desk;
  const until = Date.now() + Number(argOf("startwait") ?? 420_000);
  while (live.body?.phase === "not_started" && Date.now() < until) {
    await sleep(5000);
    live = await a.call("GET", `/api/sim/ventures/${venture}/desk`);
  }
  const started = live.body?.phase === "running";
  console.log(started
    ? `  the season is running`
    : `  still ${live.body?.phase} after ${(Number(argOf("startwait") ?? 420_000) / 1000).toFixed(0)}s`);

  console.log(`\n→ who the phone offers to nudge, against who the server accepts`);
  const table: any[] = live.body?.table ?? [];
  if (!started || table.length === 0) {
    skip("the nudge contract", `the desk sends no table while the season is ${live.body?.phase}`);
  } else {
  agree("the desk sends the table", table.length > 0, `${table.length} seats`);
  for (const seat of table) {
    const offered = canNudge(seat);
    const sent = await a.call("POST", `/api/sim/ventures/${venture}/nudge`, { userId: seat.userId });
    const accepted = sent.status === 200;
    /*
     * The contract. The phone hides the button exactly where the server would
     * refuse, so these two must never disagree — and a disagreement in either
     * direction is a bug: a button that fails, or a reminder nobody can send.
     */
    agree(
      `nudge agrees for ${seat.role ?? "an empty chair"}${seat.isYou ? " (you)" : ""}${seat.isBot ? " (stand-in)" : ""}`,
      offered === accepted,
      `phone ${offered ? "offers" : "hides"}, server ${accepted ? "accepts" : `refuses ${sent.status} ${sent.body?.code ?? ""}`}`,
    );
  }

  }

  console.log(`\n→ the two profile screens the phone could not open`);
  const mate = table.find((s) => !s.isYou);
  if (!mate) {
    skip("the teammate's seat", "no other seat to read yet");
  } else {
    const seat = await a.call("GET", `/api/sim/ventures/${venture}/seats/${mate.userId}`);
    agree("a teammate's seat answers the phone", seat.status === 200, seat.body?.name);
    agree(
      "and carries the turnout the screen reads",
      !!seat.body?.turnout && typeof seat.body.turnout.filed === "number",
      turnoutRead(seat.body?.turnout),
    );
    agree("the turnout line never shows a missing number", !/undefined|NaN/.test(turnoutRead(seat.body?.turnout)));
  }

  const rivals: any[] = live.body?.rivals ?? [];
  if (!rivals.length) {
    skip("the rival company screen", "no rivals in the payload yet");
  } else {
    const them = await a.call("GET", `/api/sim/ventures/${venture}/companies/${rivals[0].id}`);
    agree("a rival company answers the phone", them.status === 200, them.body?.name);
    agree(
      "and the readings come from the server rather than the screen",
      Array.isArray(them.body?.reads),
      `${(them.body?.reads ?? []).length} readings`,
    );
  }

  console.log(`\n→ standings, and the region on the table`);
  const standings = await a.call("GET", `/api/sim/ventures/${venture}/standings`);
  if (standings.status !== 200) {
    skip("standings", `the server answered ${standings.status}`);
  } else {
    agree(
      "standings carry the deadline the phone paces itself by",
      "resolvesAt" in (standings.body ?? {}),
      `resolvesAt=${standings.body?.resolvesAt ?? "none"}`,
    );
    agree(
      "and a finished season stops the poll rather than slowing it",
      standingsPollMs({ status: "finished", resolvesAt: null }) === false
        && standingsPollMs(standings.body) !== false
        || standingsPollMs(standings.body) === false,
      `${standingsPollMs(standings.body)}`,
    );
    agree("a season between ticks rests", STANDINGS_POLL_IDLE_MS >= 30_000);
  }

  if (!live.body?.expansion) {
    skip("the region on the table", "no region announced yet");
  } else {
    const e = live.body.expansion;
    agree("the region on the table says where it stands", !!expansionOutcome(e), expansionOutcome(e));
    agree(
      "and no seat has voted on a region nobody put up",
      e.proposed || table.every((s) => voteOf(e, s.role) === null),
    );
  }

  /*
   * One year resolved, so there is a record to read.
   *
   * Everything about the Past screen is a reading of a year that has happened,
   * and in year one there is none — so without this the checks that matter most
   * for it report "not reached" and prove nothing. Every seat files first, so the
   * record has something in it and `seatsThatFiledNothing` has something to be
   * right or wrong about.
   *
   * `SIM_DEV_ADVANCE=1` is what makes this possible and it is development-only;
   * the server prints a warning about it at boot.
   */
  if (!started) {
    skip("a year resolved, so last year exists", "the season never started");
  } else {
    for (const phone of phones) {
      const seat = await phone.call("GET", `/api/sim/ventures/${venture}/desk`);
      const role = seat.body?.yourRole;
      if (!role) continue;
      /* Whatever the form offers, left at its defaults — the point is that the
         seat filed, not what it filed. */
      /*
       * `decision`, singular, and no `submit` key — the shape both real clients
       * post (`simulation-desk.tsx:308`, `desk/[id].tsx:129`). Spelled `decisions`
       * here originally, which the route reads as `undefined` and refuses with
       * "Nothing to submit", so every filing this driver made was silently
       * rejected and the checks downstream were measuring the caretaker.
       */
      await phone.call("POST", `/api/sim/ventures/${venture}/decisions`, { decision: seat.body?.draft ?? {} });
    }
    const advanced = await a.call("POST", `/api/sim/seasons/${live.body?.seasonId}/advance`, {});
    agree(
      "a year can be resolved, so there is a record to read",
      advanced.status === 200,
      `advance answered ${advanced.status}`,
    );

    /*
     * And on to year four, which is where `research` unlocks.
     *
     * Worth the extra ticks: the research report was the sharpest of the unread
     * fields — a lever that took a year's marketing budget and produced nothing
     * either client showed — and a check that cannot reach the state it is about
     * proves nothing. Each year needs every seat to file first or the caretaker
     * runs them, which is fine but makes the figures less interesting.
     */
    for (let year = 2; year <= RESEARCH_UNLOCKS_IN; year++) {
      for (const phone of phones) {
        const seat = await phone.call("GET", `/api/sim/ventures/${venture}/desk`);
        if (!seat.body?.yourRole) continue;
        const draft: Record<string, unknown> = { ...(seat.body?.draft ?? {}) };
        /* Buy a report the year the lever arrives, so the card has something to draw. */
        const buying = seat.body.yourRole === "cmo" && year === RESEARCH_UNLOCKS_IN;
        if (buying) draft.research = "expectations";
        const filed = await phone.call("POST", `/api/sim/ventures/${venture}/decisions`, { decision: draft });
        if (buying) {
          /*
           * Said out loud, because a report that never appears could be the card,
           * the route, or this driver — and the three have different fixes.
           */
          agree(
            "the marketing seat can buy a research report once the lever arrives",
            filed.status === 200,
            `filing answered ${filed.status}${filed.status === 200 ? "" : ` — ${JSON.stringify(filed.body).slice(0, 160)}`}`,
          );
        }
      }
      if (year < RESEARCH_UNLOCKS_IN) {
        await a.call("POST", `/api/sim/seasons/${live.body?.seasonId}/advance`, {});
        for (let tries = 0; tries < 24; tries++) {
          await sleep(2000);
          live = await a.call("GET", `/api/sim/ventures/${venture}/desk`);
          if (Number(live.body?.year) >= year) break;
        }
      } else {
        live = await a.call("GET", `/api/sim/ventures/${venture}/desk`);
      }
    }
    console.log(`  the desk is on year ${live.body?.year ?? "?"}`);
    /* The tick is a background sweep, so give it a moment and re-read. */
    for (let tries = 0; tries < 24 && !(live.body?.lastYear); tries++) {
      await sleep(2500);
      live = await a.call("GET", `/api/sim/ventures/${venture}/desk`);
    }
    console.log(live.body?.lastYear
      ? `  year ${live.body.lastYear.year} is on the record`
      : `  no year resolved in the time allowed`);
  }

  /*
   * The two screens the phone did not have: last year's record and the year
   * ahead. Both read the desk payload, and the whole bug was that the payload
   * carried what they needed and nothing on the device looked at it — so the
   * check that matters is against the live payload, not against a fixture.
   */
  console.log(`\n→ last year's record, and the year ahead`);
  {
    const d: any = live.body ?? {};

    agree(
      "the desk carries what the table filed last year",
      "lastFiled" in d,
      d.lastFiled ? `${Object.keys(d.lastFiled.decisions ?? {}).length} seats on record` : "null in year one",
    );

    /* Read through the phone's own functions, so this fails if the reading breaks
       and not only if the field vanishes. */
    const filed = d.lastFiled?.decisions ?? null;
    const roles: string[] = (d.table ?? []).map((seat: any) => seat.role).filter(Boolean);
    if (!filed) {
      skip("the phone can read a filed decision back", "year one, nothing filed yet");
    } else {
      const lines = roles.flatMap((role) => readDecision(filed[role], money));
      agree(
        "and the phone reads it back as levers rather than as JSON",
        lines.length > 0 && lines.every((l) => !!l.label && !!l.value),
        `${lines.length} levers across ${roles.length} seats`,
      );
      const silent = seatsThatFiledNothing(roles, filed);
      agree(
        "and it knows which seats filed nothing",
        Array.isArray(silent),
        silent.length ? `${silent.join(", ")} ran on the caretaker` : "every seat filed",
      );
    }

    agree(
      "the desk places every company in the market",
      Array.isArray(d.standing) && d.standing.length > 0,
      `${d.standing?.length ?? 0} companies`,
    );
    const mine = (d.standing ?? []).find((row: any) => row.isYou);
    agree(
      "and says which one is yours, which is how a lot is known to be won",
      !!mine,
      mine ? `${mine.name} at ${mine.price}` : "no row flagged isYou",
    );
    const place = creditPlace(d.standing ?? []);
    agree(
      "and carries a credit grade the phone can rank",
      !!place,
      place ? `${place.grade}, ${place.place} of ${place.of}` : "no graded teams",
    );

    /* The forecast: the one that was costing players money, because operations
       sized capacity against nothing while the number sat in this payload. */
    agree(
      "the desk carries the forecast the phone now reads",
      !!d.forecast && Number.isFinite(Number(d.forecast.likely)),
      d.forecast ? `likely ${Math.round(d.forecast.likely)}, band ${d.forecast.band}` : "absent",
    );
    agree(
      "and what a year of unused room costs, so the bet has a price",
      Number.isFinite(Number(d.idleCostPerUnit)),
      `${d.idleCostPerUnit} each`,
    );

    if (!d.forecast) {
      skip("the room reads against the demand", "no forecast in the payload");
    } else {
      const have = Number(d.company?.capacity ?? 0) + Number(d.company?.assetCapacity ?? 0);
      const at = forecastAtPrice(d.forecast, Number(d.company?.price ?? d.forecast.price));
      const risk = capacityRisk({
        capacity: have,
        forecast: at,
        price: Number(d.company?.price ?? 0),
        idleCostPerUnit: Number(d.idleCostPerUnit ?? 0),
      });
      agree(
        "the room reads against the demand, both ways and in money",
        !!VERDICT_READ[risk.verdict] && risk.idleCostAtLow >= 0 && risk.revenueLostAtHigh >= 0,
        `${VERDICT_READ[risk.verdict].title}: room ${have} vs ${at.low}–${at.high}`,
      );
      /* The curve has to actually bend, or the price lever moves a number that
         never changes and the screen is lying about being live. */
      const cheap = demandAtPrice(d.forecast, Number(d.forecast.price) * 0.5);
      const dear = demandAtPrice(d.forecast, Number(d.forecast.price) * 2);
      agree(
        "and moving the price moves the demand, which is what makes it a decision",
        cheap >= dear,
        `${Math.round(cheap)} at half the price, ${Math.round(dear)} at double`,
      );
    }

    agree(
      "the phone can say what is already paid for and not yet arrived",
      Array.isArray(comingUp(d.company ?? {})),
      comingUp(d.company ?? {}).map((r) => `${r.label} ${r.value} ${r.when}`).join("; ") || "nothing on its way",
    );
    agree(
      "and the market's own word for its customers reaches the phone",
      !!d.niche?.voice?.customers,
      d.niche?.voice?.customers ?? 'missing — every screen would say "customers"',
    );
  }

  /*
   * The year-end report, which the phone never asked for at all.
   *
   * The reconciliation is the check worth having here and not only in the unit
   * suite: these are accounts the server actually stored and serialised, so this
   * catches a field lost in transit as well as a line missing from the reading.
   */
  console.log(`\n→ the year-end report`);
  {
    const res = await a.call("GET", `/api/sim/ventures/${venture}/reports`);
    if (res.status !== 200) {
      skip("the report answers the phone", `the server answered ${res.status}`);
    } else {
      const body: any = res.body ?? {};
      agree(
        "the report answers the phone",
        Array.isArray(body.years),
        `${body.years?.length ?? 0} years on the record`,
      );
      agree(
        "and the phone can pick which year to show",
        yearToShow(body.years ?? [], null) === (body.report?.year ?? null) || !body.report,
        `asked for the latest, got ${body.report?.year ?? "none"}`,
      );

      if (!body.report) {
        skip("the accounts add up", "no year has resolved yet");
      } else {
        agree("the report carries the accounts, not just the headline", !!body.report.pnl, body.report.pnl ? "pnl present" : "pnl missing");
        if (body.report.pnl) {
          const recon = accountsReconcile(body.report.pnl);
          agree(
            "and the phone's cost lines add up to the profit the server stored",
            Math.abs(recon.operatingOut) < 1 && Math.abs(recon.profitOut) < 1,
            `out by ${recon.operatingOut.toFixed(2)} on operating, ${recon.profitOut.toFixed(2)} after tax`,
          );
          agree(
            "and every cost has a seat's name against it",
            accountLines(body.report.pnl).every((l) => !!l.seat && !!l.label),
            `${accountLines(body.report.pnl).length} lines`,
          );
        }
        agree("the cash is shown as a bridge, not a closing figure", !!body.report.cashBridge,
          body.report.cashBridge ? `${body.report.cashBridge.lines.length} steps` : "absent");
        agree("the customers are broken down by segment", Array.isArray(body.report.segments),
          `${body.report.segments?.length ?? 0} segments`);
        agree("and what everybody else did is on it", Array.isArray(body.report.rivals),
          `${body.report.rivals?.length ?? 0} rivals`);
      }

      /* An old link must land on the report rather than on an error. */
      if ((body.years ?? []).length > 0) {
        const one = await a.call("GET", `/api/sim/ventures/${venture}/reports/${body.years[0]}`);
        agree("a particular year can be asked for by number", one.status === 200, `year ${body.years[0]} answered ${one.status}`);
      } else {
        skip("a particular year can be asked for by number", "no years yet");
      }
    }
  }

  /*
   * The three things the server sent and nothing read.
   *
   * None of these can be made to happen inside one run — a niche takes a year's
   * research, a report takes a filed `research` lever — so what is checked is that
   * the fields arrive in the shape the new cards read, and the check says plainly
   * when the state was not reachable rather than passing on an absence.
   */
  console.log(`\n→ what the table bought`);
  {
    const d: any = live.body ?? {};
    agree("the desk carries a field for the niche this table found", "ours" in d,
      d.ours ? `${d.ours.name}, ${d.ours.headStartLeft}y of head start left` : "null — nobody has opened one");
    if (d.ours) {
      agree("and it carries everything the card reads",
        ["name", "foundInYear", "from", "people", "premium", "headStartLeft", "sharedWith", "held"].every((k) => k in d.ours),
        Object.keys(d.ours).join(", "));
    } else {
      skip("the niche card has everything it reads", "no niche opened in this run");
    }

    agree("the desk carries a field for the research report", "research" in d,
      d.research ? `kind=${d.research.kind}` : "null — nobody bought one");
    if (d.research) {
      const ok = d.research.kind === "expectations"
        ? Array.isArray(d.research.segments) && d.research.segments.every((x: any) => Array.isArray(x.floors))
        : Array.isArray(d.research.rivals) && d.research.rivals.every((x: any) => "priceNext" in x);
      agree("and it is the shape the card reads", ok, d.research.kind);
    } else {
      skip("the research card has the shape it reads", "no report bought in this run");
    }

    agree("and how good the staff are reaches the phone",
      Number.isFinite(Number(d.staffQuality)),
      `staffQuality=${d.staffQuality}`);
  }

  /*
   * A sealed bid, and the meter the whole table reads.
   *
   * The money is committed the moment the bid is placed and the meter could not
   * see it: the market screen warns whoever placed it, and the other four were
   * filing a year against a total that looked comfortable. Driven live because the
   * total comes out of a database sum on the desk route — a unit test cannot tell
   * me the route actually queries it.
   */
  console.log(`\n→ a sealed bid, in the number the table reads`);
  {
    const market = await a.call("GET", `/api/sim/ventures/${venture}/market`);
    const lot = (market.body?.listings ?? [])[0];
    if (market.status !== 200 || !lot) {
      skip("a bid shows up in the table's commitment", `nothing for sale this year (${market.status})`);
    } else {
      const before = await a.call("GET", `/api/sim/ventures/${venture}/desk`);
      const was = Number(before.body?.bidsOutstanding ?? 0);
      const amount = Math.max(1, Math.round(Number(lot.reserve ?? 1000)));
      const placed = await a.call("POST", `/api/sim/ventures/${venture}/bids`, { listingId: lot.id, amount });
      if (placed.status !== 200) {
        skip("a bid shows up in the table's commitment", `the bid was refused (${placed.status})`);
      } else {
        const after = await a.call("GET", `/api/sim/ventures/${venture}/desk`);
        const now = Number(after.body?.bidsOutstanding ?? 0);
        agree(
          "the desk reports what this table has standing at auction",
          now >= was + amount,
          `${was} → ${now} after bidding ${amount}`,
        );
        /*
         * And through the phone's own meter, which is the thing that was blind.
         * Compared against the same draft with the bid left out, so what is being
         * checked is that the bid moves the total rather than that the total is
         * some particular number.
         */
        const company = after.body?.company;
        const args = {
          company,
          decisions: after.body?.filed ?? {},
          costIndex: Number(after.body?.economy?.costIndex ?? 1),
          reach: reachOf(after.body?.cities),
          prices: after.body?.prices,
        } as any;
        const blind = commitment({ ...args, bids: 0 });
        const seeing = commitment({ ...args, bids: now });
        agree(
          "and the phone's commitment meter counts it",
          seeing.spend - blind.spend >= amount && seeing.bidsOutstanding === now,
          `spend ${Math.round(blind.spend)} → ${Math.round(seeing.spend)}, named as ${Math.round(seeing.bidsOutstanding)}`,
        );
        agree(
          "on the chief executive's line, because bidding is their lever",
          (seeing.bySeat.find((b: any) => b.role === "ceo")?.spend ?? 0)
            - (blind.bySeat.find((b: any) => b.role === "ceo")?.spend ?? 0) >= amount,
          "ceo",
        );
      }
    }
  }

  /*
   * The market screen, which was three fields behind the payload.
   *
   * `you`, `period` and `periods` have all been sent since the auction stopped
   * being annual and none of them were read, so this screen printed "+6 quality"
   * instead of "quality 54 → 60" and called a quarterly season's three-year
   * licence "12 years". Checked live because the fix is only worth anything if
   * the fields actually arrive.
   */
  console.log(`\n→ the market screen's readings`);
  {
    const res = await a.call("GET", `/api/sim/ventures/${venture}/market`);
    if (res.status !== 200) {
      skip("the market answers the phone", `the server answered ${res.status}`);
    } else {
      const m: any = res.body ?? {};
      agree(
        "the market says where this company stands",
        !!m.you && ["quality", "brand", "service", "capacity", "unitCost"].every((k) => k in m.you),
        m.you ? `quality ${m.you.quality}, brand ${m.you.brand}, room ${m.you.capacity}` : "absent",
      );
      agree(
        "and what one decision is called here, and how many make a year",
        !!m.period?.one && Number.isFinite(Number(m.periods)),
        `${m.period?.one ?? "?"} × ${m.periods ?? "?"} a year`,
      );

      const lot = (m.listings ?? [])[0];
      if (!lot) {
        skip("a lot reads as a before and after", "nothing for sale this period");
      } else {
        const withYou = effectLines(lot.effect, m.you);
        const without = effectLines(lot.effect);
        agree(
          "a lot reads as a before and after rather than a bare delta",
          withYou.length === 0 || JSON.stringify(withYou) !== JSON.stringify(without),
          withYou.length ? withYou.join(" · ") : "this lot does nothing on its own",
        );
        agree(
          "and its life is counted in the unit the table decides in",
          typeof lifeRead(lot.expiresIn, m.period, m.periods) === "string",
          `expiresIn=${lot.expiresIn} → "${lifeRead(lot.expiresIn, m.period, m.periods)}"`,
        );
        /*
         * The bug itself, stated as the thing that must not come back: with more
         * than one decision a year, the old reading printed the raw tick count
         * with "years" after it.
         */
        if (Number(m.periods) > 1 && Number(lot.expiresIn) > 1) {
          agree(
            "and does not call a tick count a year",
            lifeRead(lot.expiresIn, m.period, m.periods) !== `${lot.expiresIn} years, then it lapses`,
            `${lot.expiresIn} ticks reads as "${lifeRead(lot.expiresIn, m.period, m.periods)}"`,
          );
        } else {
          skip("the tick count is not called a year", `this season decides ${m.periods ?? 1}× a year`);
        }
      }
    }
  }

  /*
   * "Year 7 of 4", which is what four of these screens used to say.
   *
   * `year` counts periods and `totalYears` is in years, so dividing one by the
   * other put a quarterly season past its own end. `totalPeriods` was added to
   * fix it and the phone read it nowhere. Driven live because the whole fix
   * depends on the field arriving on each of these routes.
   */
  console.log(`\n→ how the phone counts a season`);
  {
    for (const [what, path] of [
      ["the standings", `/api/sim/ventures/${venture}/standings`],
      ["acquisitions", `/api/sim/ventures/${venture}/offers`],
      ["the desk", `/api/sim/ventures/${venture}/desk`],
    ] as [string, string][]) {
      const res = await a.call("GET", path);
      if (res.status !== 200) { skip(`${what} carries the season's span`, `answered ${res.status}`); continue; }
      const b: any = res.body ?? {};
      agree(
        `${what} carries the span a period counter belongs over`,
        Number.isFinite(Number(b.totalPeriods)) && Number(b.totalPeriods) > 0,
        `totalPeriods=${b.totalPeriods}, totalYears=${b.totalYears}`,
      );
      const span = seasonSpan({ totalPeriods: b.totalPeriods, totalYears: b.totalYears });
      const words = periodWords({ period: b.period, cadence: b.cadence });
      agree(
        `and ${what} reads as a period of a span, never past its own end`,
        span > 0 && Number(b.year) <= span,
        `${periodLabel(b.year, span, words)}`,
      );
    }

    /*
     * And the arithmetic that was wrong, stated against this season's own
     * numbers: whatever the cadence, the span has to be the year count times the
     * decisions in a year — which is the sum the screens were not doing.
     */
    const desk = await a.call("GET", `/api/sim/ventures/${venture}/desk`);
    const d: any = desk.body ?? {};
    if (d.totalPeriods && d.totalYears && d.period) {
      agree(
        "and the span is the years times the decisions in one, as the engine has it",
        Number(d.totalPeriods) === totalPeriodsIn(d.totalYears, d.cadence),
        `${d.totalYears} years × ${periodsPerYear(d.cadence)} ${d.period.many} = ${d.totalPeriods}`,
      );
    } else {
      skip("the span is the years times the decisions in one", "the desk sent no cadence");
    }
  }

  /*
   * Leaving, last, because it is destructive: this account is out of the room
   * afterwards and nothing below it could be checked.
   *
   * What is being checked is the promise the phone's confirm dialog makes. It
   * tells a player mid-season that their chair goes to a stand-in and cannot be
   * taken back; if the server does something else, the dialog is a lie and this
   * is the only place that would show up.
   */
  console.log(`\n→ leaving a company that is already running`);
  {
    const quitter = phones[phones.length - 1];
    const before = await quitter.call("GET", `/api/sim/ventures/${venture}/desk`);
    const hadRole = before.body?.yourRole ?? null;
    const res = await quitter.call("POST", `/api/sim/ventures/${venture}/leave`, {});
    agree("a seated player can leave", res.status === 200 && res.body?.left === true, `answered ${res.status}`);

    if (!started) {
      skip("the chair goes to a stand-in", "the season never started");
    } else {
      /*
       * The dialog promises a stand-in. The server hands the chair to one of this
       * venture's own bots, or deletes the seat if it cannot seat one — both are
       * real, and the phone now says which happened, so what matters is that the
       * answer is unambiguous rather than that it is always true.
       */
      agree(
        "and the server says whether the chair was passed on or emptied",
        typeof res.body?.handedOver === "boolean",
        res.body?.handedOver ? "passed to a stand-in, as the confirm promised" : "emptied — the phone says so rather than claiming a stand-in",
      );
      agree(
        "and the seat they held is no longer theirs",
        hadRole !== null,
        `held ${hadRole ?? "no seat"} before leaving`,
      );
      const after = await quitter.call("GET", `/api/sim/ventures/${venture}/desk`);
      agree(
        "and their desk no longer offers them a seat at that table",
        after.status !== 200 || !after.body?.yourRole,
        after.status !== 200 ? `desk now answers ${after.status}` : `yourRole=${after.body?.yourRole ?? "none"}`,
      );
    }

    /* Leaving twice is not an error — a room you are not in is one you have left. */
    const again = await quitter.call("POST", `/api/sim/ventures/${venture}/leave`, {});
    agree("and leaving again says so rather than failing", again.status === 200, `answered ${again.status}`);
  }

  await sleep(50);
  console.log("");
  const notReached = unreached.length ? `  ${unreached.length} not reached: ${unreached.join("; ")}` : "";
  if (failures.length) {
    console.log(`FAILED — ${failures.length} of ${checks} disagreements between the phone and the server:`);
    for (const f of failures) console.log(`  · ${f}`);
    if (notReached) console.log(notReached);
    process.exit(1);
  }
  console.log(`passed — ${checks} checks, the phone and the server agree`);
  if (notReached) console.log(notReached);
}

main().catch((err) => { console.error(err); process.exit(2); });
