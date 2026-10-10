/**
 * Can a small company actually grow, and does Nova find the way?
 *
 * Nine markets Nova writes itself — three channels, three SaaS startups, three
 * restaurants (see `nova-growth-briefs.ts`) — each opened at nothing, at
 * £5,000 and at £25,000, played a month at a time for a year with Nova filling
 * every decision. It reports share every month, because share is the thing the
 * owner reads and the thing a company holding its customers while the market
 * grows is quietly losing.
 *
 * ## Repeatable, and it only pays once
 *
 * The markets are generated through the real API and then **cached to disk**
 * under `script/.cache/nova-markets/`. Re-running costs nothing and compares
 * like with like, which matters more here than freshness: a balance change
 * measured against a different set of generated markets is not measured at
 * all. `--fresh` regenerates and pays again; `--only=saas` narrows to one
 * category; `--months=24` runs longer.
 *
 * ## The two controls, and why they are the point
 *
 * Every opening is played three ways:
 *
 *   - **Nova**, filling everything, which is what a player gets from the
 *     button.
 *   - **hours only** — the founders' week, and not a penny spent. This is the
 *     claim being tested: somebody with nothing who puts the hours in should
 *     still grow. If this line is flat the game is telling people with no
 *     money that there is nothing they can do, which is false about the thing
 *     being simulated.
 *   - **money only** — the same plan with the week left empty. Hard work
 *     should come close to this and never beat it, or there is no reason to
 *     raise or spend anything.
 *
 * Usage:
 *   npx tsx --env-file=.env script/nova-growth-report.ts
 *   npx tsx --env-file=.env script/nova-growth-report.ts --fresh --only=channel
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildMarketPrompt, parseMarket } from "../server/nova-market";
import { openai } from "../server/openai-client";
import { TEXT_MODEL } from "../server/aiModels";
import { buildWorld, economyFor } from "@shared/simulation/season";
import { optimise } from "@shared/simulation/optimiser";
import { resolveYear } from "@shared/simulation/resolve";
import { HOURS_A_WEEK, foundersActions } from "@shared/simulation/actions";
import { chooseBid, incumbentBids, marketListings, resolveBids, biddableFunds, type Bid } from "@shared/simulation/assets";
import { ROLES, type Niche, type World } from "@shared/simulation/types";
import { BRIEFS, type Brief } from "./nova-growth-briefs";

const CACHE = join(import.meta.dirname ?? "script", ".cache", "nova-markets");
const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const FRESH = args.includes("--fresh");
const ONLY = flag("only");
const MONTHS = Number(flag("months") ?? 12);
const OPENINGS = (flag("openings") ?? "0,5000,25000").split(",").map(Number);

const held = (c: any) => Object.values(c?.customers ?? {}).reduce((a: number, b: any) => a + Number(b), 0);

/** The market for a brief: from disk if we have it, from the API if not. */
async function marketFor(brief: Brief): Promise<Niche | null> {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, `${brief.id}.json`);
  if (!FRESH && existsSync(path)) {
    const stored = JSON.parse(readFileSync(path, "utf-8"));
    return parseMarket(JSON.stringify(stored), brief.id, { check: false });
  }
  const prompt = buildMarketPrompt({ project: brief.project, startup: true } as never);
  process.stdout.write(`  asking the model for ${brief.id}… `);
  const completion = await openai.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
  });
  const raw = completion.choices[0]?.message?.content ?? "";
  const niche = parseMarket(raw, brief.id, { check: true });
  if (!niche) { console.log("unreadable or unplayable — skipped"); return null; }
  writeFileSync(path, JSON.stringify(niche, null, 2));
  console.log("written and cached");
  return niche;
}

type Mode = "nova" | "hours" | "money" | "credit";

interface Month {
  subs: number; share: number; cash: number; quality: number; brand: number;
  spent: number; bust: boolean;
  /** For the credit run: debt carried, and what was bought this month. */
  debt: number; bought: string | null;
}

/** One company, one opening, a year of months, with Nova filling the decisions. */
function play(niche: Niche, seasonId: string, opening: number, mode: Mode): Month[] {
  let world: World = buildWorld({
    seasonId, niche, cadence: "monthly",
    teams: [{ id: "us", name: "Us", seats: [...ROLES], foundersPaid: false }],
  });
  world = { ...world, companies: world.companies.map((c) => (c.id === "us" ? { ...c, cash: opening } : c)) };

  /* The whole week on whatever the market offers first, for the hours-only run. */
  const everyHour = () => {
    const offered = foundersActions(niche);
    const each = Math.floor(HOURS_A_WEEK / Math.min(3, offered.length || 1));
    return Object.fromEntries(offered.slice(0, 3).map((a) => [a.id, each]));
  };

  const out: Month[] = [];
  for (let p = 1; p <= MONTHS; p++) {
    const us = world.companies.find((c) => c.id === "us");
    if (!us) break;
    const plan = optimise({ world, companyId: "us", year: p, economy: economyFor(seasonId, p, 12), periods: 12, totalYears: Math.ceil(MONTHS / 12) });
    if (!plan) break;
    const d: any = JSON.parse(JSON.stringify(plan.decisions));
    d.companyId = "us";

    if (mode === "hours") {
      /*
       * Built from nothing rather than filtered out of Nova's plan.
       *
       * The first version stripped money levers from the plan by matching
       * their names — `/Spend|Amount|borrow|raise|.../` — which is a control
       * that silently stops being a control the moment somebody adds a lever
       * called something else. The whole claim being tested is "not a penny",
       * so the decision is written out in full: the price it already charges,
       * the room it already has, nobody hired, and the week.
       */
      d.cmo = { price: us.price, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: us.cities };
      d.cto = { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0 };
      d.coo = { capacityTarget: us.capacity, supportSpend: 0, efficiencySpend: 0, headcount: us.staff ?? 0 };
      d.cfo = { borrow: 0, repay: 0, cashBuffer: 0 };
      d.ceo = { focus: d.ceo?.focus ?? "growth", founderHours: everyHour() };
    }
    if (mode === "money") d.ceo = { ...d.ceo, founderHours: {} };

    const spent = mode === "hours" ? 0 : plan.spends;

    /*
     * The marketplace, settled exactly as `simulation-tick.ts` settles it:
     * the shelf is dealt from the season and the period, Nova picks with the
     * shared `chooseBid`, the incumbents bid against it, `resolveBids` decides
     * who won, and a winner who bid past their bank has the difference booked
     * as debt. That last part is the whole mechanic for a company with no cash,
     * and the harness could not see it at all before — the asset market lives
     * in the tick, so every number I had measured was for a company that could
     * never buy anything.
     */
    let bought: string | null = null;
    if (mode === "credit") {
      const me = world.companies.find((c) => c.id === "us")!;
      const shelf = marketListings({
        seasonId, year: p, niche, periods: 12,
        owned: (me.assets ?? []).map((a) => a.name),
      });
      const pick = chooseBid(me, shelf);
      if (pick) {
        const bids: Bid[] = [
          { ventureId: "us", listingId: pick.listingId, amount: pick.amount },
          ...incumbentBids({ seasonId, year: p, listings: shelf, incumbents: world.companies.filter((c) => c.kind === "incumbent") }),
        ];
        const funds = Object.fromEntries(world.companies.map((c) => [c.id, biddableFunds(c)]));
        for (const award of resolveBids(shelf, bids, funds)) {
          if (award.winnerId !== "us") continue;
          const listing = shelf.find((l) => l.id === award.listingId)!;
          bought = `${listing.asset.name} ($${Math.round(award.price).toLocaleString()})`;
          world = {
            ...world,
            companies: world.companies.map((c) => {
              if (c.id !== "us") return c;
              const fromCash = Math.min(Math.max(0, c.cash), award.price);
              return {
                ...c, cash: c.cash - fromCash, debt: c.debt + (award.price - fromCash),
                assets: [...(c.assets ?? []), listing.asset],
              };
            }),
          };
        }
      }
    }

    world = resolveYear({ ...world, year: p }, [d], economyFor(seasonId, p, 12)).world;
    const now = world.companies.find((c) => c.id === "us");
    if (!now) break;
    const total = world.companies.reduce((n, c) => n + held(c), 0);
    out.push({
      subs: held(now), share: total > 0 ? held(now) / total : 0, cash: Math.round(now.cash),
      quality: Math.round(now.quality), brand: Math.round(now.brand), spent: Math.round(spent),
      bust: !!now.bankruptSince, debt: Math.round(now.debt ?? 0), bought,
    });
    /*
     * Stop at insolvency and say so. A run that ends early used to leave a
     * bare dash in the table, which reads as "no data" when it means "the
     * company died" — and for the no-money run that is the whole finding.
     */
    if (now.bankruptSince) break;
  }
  return out;
}

const pc = (n: number) => `${(n * 100).toFixed(2)}%`;

async function main() {
  const briefs = BRIEFS.filter((b) => !ONLY || b.category === ONLY);
  console.log(`${briefs.length} markets, openings ${OPENINGS.map((o) => `$${o.toLocaleString()}`).join(" / ")}, ${MONTHS} months each\n`);

  const markets: { brief: Brief; niche: Niche }[] = [];
  for (const brief of briefs) {
    const niche = await marketFor(brief);
    if (niche) markets.push({ brief, niche });
  }
  console.log("");

  const summary: string[] = [];
  for (const { brief, niche } of markets) {
    const size = niche.segments.reduce((n, s) => n + s.size, 0);
    console.log(`\n${"=".repeat(78)}\n${brief.category.toUpperCase()} — ${niche.name}`);
    console.log(`${size.toLocaleString()} ${niche.voice?.customers ?? "customers"} in the market, ${niche.segments.length} segments, ${(niche.incumbents ?? []).length} rivals already in it`);

    for (const opening of OPENINGS) {
      const seasonId = `${brief.id}-${opening}`;
      const nova = play(niche, seasonId, opening, "nova");
      const hours = play(niche, seasonId, opening, "hours");
      const money = play(niche, seasonId, opening, "money");
      const credit = play(niche, seasonId, opening, "credit");

      console.log(`\n  opened at $${opening.toLocaleString()}`);
      console.log(`  month   Nova share    subs    spent     hours-only    money-only   on credit    debt      bought`);
      for (let i = 0; i < MONTHS; i++) {
        const n = nova[i]; const h = hours[i]; const m = money[i]; const k = credit[i];
        if (!n && !h && !m && !k) break;
        console.log(
          `  ${String(i + 1).padStart(5)}   ${(n ? pc(n.share) : "—").padStart(10)}  ${(n ? n.subs.toLocaleString() : "—").padStart(7)}  ${(n ? "$" + n.spent.toLocaleString() : "—").padStart(9)}  ${(h ? pc(h.share) : "—").padStart(12)}  ${(m ? pc(m.share) : "—").padStart(12)}  ${(k ? pc(k.share) : "—").padStart(9)}  ${(k ? "$" + k.debt.toLocaleString() : "—").padStart(9)}  ${k?.bought ?? ""}`,
        );
      }
      const last = (xs: Month[]) => xs[xs.length - 1];
      const n = last(nova), h = last(hours), m = last(money), k = last(credit);
      const died = (xs: Month[]) => (xs.length && xs[xs.length - 1].bust ? ` (insolvent in month ${xs.length})` : xs.length < MONTHS ? ` (stopped after month ${xs.length})` : "");
      const grewBy = h && hours[0] ? h.subs - (hours[0].subs ?? 0) : 0;
      const perMonth = hours.length > 1 ? Math.round(grewBy / (hours.length - 1)) : 0;
      summary.push(
        `${brief.id.padEnd(20)} $${String(opening).padStart(6)}  Nova ${(n ? pc(n.share) : "—").padStart(7)}${died(nova)}  hours-only ${(h ? pc(h.share) : "—").padStart(7)} (${perMonth >= 0 ? "+" : ""}${perMonth}/mo)${died(hours)}  money-only ${(m ? pc(m.share) : "—").padStart(7)}${died(money)}  on-credit ${(k ? pc(k.share) : "—").padStart(7)}${died(credit)}`,
      );
      if (n && h && m) {
        const ratio = m.subs > 0 ? h.subs / m.subs : 0;
        console.log(`  hours-only reached ${(ratio * 100).toFixed(0)}% of what money-only reached, and grew ${perMonth >= 0 ? "+" : ""}${perMonth} ${niche.voice?.customers ?? "customers"} a month`);
      }
    }
  }

  console.log(`\n${"=".repeat(78)}\nSUMMARY\n`);
  for (const line of summary) console.log(line);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
