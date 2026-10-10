/**
 * Four ways to grow a startup, measured against each other.
 *
 * Built because the growth report answered "does Nova grow the company" and
 * not "what actually grows a company", which is the question behind it. Each
 * market Nova wrote (cached by `nova-growth-report.ts`) is played a month at a
 * time for a year, from the same opening, five ways:
 *
 *   - **nova** — the button. Everything Nova decides, including the week and
 *     what it bids for.
 *   - **hands** — sixty hours a month and not a penny. The week goes into
 *     making whatever is on the shelf that can be made, and into the product
 *     when there is nothing to make.
 *   - **buyer** — money only. Bids on the shelf every month, on credit if
 *     need be, and leaves the week empty.
 *   - **both** — buys what it can and builds what it cannot.
 *   - **promo** — the control for the thing the owner suspects is broken:
 *     everything into performance marketing and brand, nothing else.
 *
 * And then a sweep, separately, of what a pound of promotion actually buys,
 * because "buying subscribers should work and I'm not sure it is" deserves a
 * measurement rather than an opinion.
 *
 * Usage:
 *   npx tsx --env-file=.env script/startup-strategies.ts
 *   npx tsx --env-file=.env script/startup-strategies.ts --only=saas --opening=5000
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseMarket } from "../server/nova-market";
import { buildWorld, economyFor } from "@shared/simulation/season";
import { optimise } from "@shared/simulation/optimiser";
import { resolveYear } from "@shared/simulation/resolve";
import { HOURS_A_WEEK, buildableActions, foundersActions } from "@shared/simulation/actions";
import { marketListings, chooseBid, incumbentBids, resolveBids, biddableFunds, type Bid } from "@shared/simulation/assets";
import { atScale } from "@shared/simulation/market";
import { ROLES, type Niche, type World, type Company } from "@shared/simulation/types";
import { BRIEFS } from "./nova-growth-briefs";

const CACHE = join(import.meta.dirname ?? "script", ".cache", "nova-markets");
const args = process.argv.slice(2);
const flag = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const ONLY = flag("only");
const OPENING = Number(flag("opening") ?? 0);
const MONTHS = Number(flag("months") ?? 12);

const held = (c: any) => Object.values(c?.customers ?? {}).reduce((a: number, b: any) => a + Number(b), 0);
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

type Plan = "nova" | "hands" | "buyer" | "both" | "promo";

interface Row {
  subs: number; share: number; cash: number; debt: number; profit: number;
  assets: number; built: number; bought: number; spent: number; bust: boolean;
}

/** One company, one strategy, a year of months. */
function play(niche: Niche, seasonId: string, plan: Plan): Row[] {
  /*
   * `foundersPaid: false`, because that is what a founder's season actually
   * is: a season built from a project draws no officer salary until somebody
   * is hired (see `startSeason`). Without it the harness was measuring a
   * company paying $1,440 a month in founder salaries against $50 of revenue
   * — which killed every strategy and had nothing to do with the strategies.
   */
  let world: World = buildWorld({
    seasonId, niche, cadence: "monthly",
    teams: [{ id: "us", name: "Us", seats: [...ROLES], foundersPaid: false }],
  });
  world = { ...world, companies: world.companies.map((c) => (c.id === "us" ? { ...c, cash: OPENING } : c)) };

  const out: Row[] = [];
  let built = 0;
  let bought = 0;

  for (let p = 1; p <= MONTHS; p++) {
    let us = world.companies.find((c) => c.id === "us");
    if (!us) break;

    const shelf = marketListings({
      seasonId, year: p, niche, periods: 12,
      owned: (us.assets ?? []).map((a) => a.name),
    });
    const makeable = buildableActions(shelf);

    /* Buying, where the strategy buys: on credit if the bank is short. */
    let boughtThis = 0;
    if (plan === "buyer" || plan === "both") {
      const pick = chooseBid(us, shelf);
      if (pick) {
        const bids: Bid[] = [
          { ventureId: "us", listingId: pick.listingId, amount: pick.amount },
          ...incumbentBids({ seasonId, year: p, listings: shelf, incumbents: world.companies.filter((c) => c.kind === "incumbent") }),
        ];
        const funds = Object.fromEntries(world.companies.map((c) => [c.id, biddableFunds(c)]));
        for (const award of resolveBids(shelf, bids, funds)) {
          if (award.winnerId !== "us") continue;
          const lot = shelf.find((l) => l.id === award.listingId)!;
          boughtThis += 1;
          world = {
            ...world,
            companies: world.companies.map((c) => {
              if (c.id !== "us") return c;
              const fromCash = Math.min(Math.max(0, c.cash), award.price);
              return { ...c, cash: c.cash - fromCash, debt: c.debt + (award.price - fromCash), assets: [...(c.assets ?? []), lot.asset] };
            }),
          };
        }
      }
    }
    bought += boughtThis;
    us = world.companies.find((c) => c.id === "us")!;

    /* The week, where the strategy works it. */
    const week = (): Record<string, number> => {
      if (plan === "nova" || plan === "buyer" || plan === "promo") return {};
      /* The best thing on the shelf that can be made — and the whole week into it. */
      if (makeable.length) {
        const pick = [...makeable].sort((a, b) => (a.asks ?? 99) - (b.asks ?? 99))[0];
        return { [pick.id]: HOURS_A_WEEK };
      }
      /* Nothing to make: the week goes into the product and the service. */
      const nine = foundersActions(niche);
      return { [nine[0].id]: 30, [nine[2].id]: 30 };
    };

    const plant = optimise({ world, companyId: "us", year: p, economy: economyFor(seasonId, p, 12), periods: 12, totalYears: Math.ceil(MONTHS / 12) });
    let d: any;
    let spent = 0;
    if (plan === "nova") {
      if (!plant) break;
      d = { companyId: "us", ...(plant.decisions as any) };
      spent = plant.spends;
    } else if (plan === "promo") {
      /* Everything it can lay hands on, into being noticed. Nothing else. */
      const purse = Math.max(0, us.cash) * 0.5;
      d = {
        companyId: "us",
        cmo: { price: us.price, brandSpend: Math.round(purse * 0.5), performanceSpend: Math.round(purse * 0.5), celebritySpend: 0, targetCities: us.cities },
        cto: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0 },
        coo: { capacityTarget: (plant?.decisions as any)?.coo?.capacityTarget ?? us.capacity, supportSpend: 0, efficiencySpend: 0, headcount: us.staff ?? 0 },
        cfo: { borrow: Math.round(Math.max(0, (us.creditLimit ?? 0) - (us.debt ?? 0)) * 0.3), repay: 0, cashBuffer: 0 },
        ceo: { focus: "growth", founderHours: {} },
      };
      spent = purse;
    } else {
      /* hands and both: the plant Nova would build, no spending, and the week. */
      d = {
        companyId: "us",
        cmo: { price: us.price, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: us.cities },
        cto: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0 },
        coo: { capacityTarget: (plant?.decisions as any)?.coo?.capacityTarget ?? us.capacity, supportSpend: 0, efficiencySpend: 0, headcount: us.staff ?? 0 },
        cfo: { borrow: 0, repay: 0, cashBuffer: 0 },
        ceo: { focus: "growth", founderHours: week() },
      };
    }

    const before = (us.assets ?? []).length;
    const r = resolveYear({ ...world, year: p }, [d], economyFor(seasonId, p, 12));
    world = r.world;
    const now = world.companies.find((c) => c.id === "us");
    if (!now) break;
    built += Math.max(0, (now.assets ?? []).length - before - boughtThis);
    const total = world.companies.reduce((n, c) => n + held(c), 0);
    const pnl = r.reports.find((x) => x.companyId === "us")?.pnl as any;
    out.push({
      subs: held(now), share: total > 0 ? held(now) / total : 0,
      cash: Math.round(now.cash), debt: Math.round(now.debt ?? 0),
      profit: Math.round(pnl?.profit ?? 0), assets: (now.assets ?? []).length,
      built, bought, spent: Math.round(spent), bust: !!now.bankruptSince,
    });
    if (now.bankruptSince) break;
  }
  return out;
}

/** What a pound of promotion actually buys, everything else held still. */
/**
 * The same sweep twice: once with the product a startup actually opens with,
 * once with a good one.
 *
 * Because the question "does paying for users work" has two answers and only
 * the second is interesting. Bought customers are customers: they leave if the
 * product does not keep them, and a startup opens at quality 38 against rivals
 * at 81. If the curve is flat with a weak product and steep with a strong one,
 * then paid growth is gated on retention rather than on price — which is the
 * right place for it to be gated, and means the lever is not broken.
 */
function promotionSweep(niche: Niche, seasonId: string, quality?: number): void {
  let base = buildWorld({ seasonId: `${seasonId}-promo`, niche, cadence: "monthly", teams: [{ id: "us", name: "Us", seats: [...ROLES], foundersPaid: false }] });
  if (quality !== undefined) {
    base = { ...base, companies: base.companies.map((c) => (c.id === "us" ? { ...c, quality, service: quality, brand: Math.round(quality * 0.6) } : c)) };
  }
  const opener = base.companies.find((c) => c.id === "us")!;
  const threshold = atScale(180_000, opener.scale) / 12;
  console.log(`\n  what promotion buys ${quality === undefined ? "with the product a startup opens with" : `with a good product (quality ${quality})`} — threshold ${money(threshold)}:`);
  console.log(`  per month        subs after ${MONTHS}m    share     spent in all`);
  for (const times of [0, 0.5, 1, 5, 20]) {
    const each = Math.round(threshold * times);
    let w: World = { ...base, companies: base.companies.map((c) => (c.id === "us" ? { ...c, cash: 50_000_000 } : c)) };
    let spent = 0;
    for (let p = 1; p <= MONTHS; p++) {
      const us = w.companies.find((c) => c.id === "us");
      if (!us) break;
      /* Cash topped up each month so the question is the lift, not the purse. */
      w = { ...w, companies: w.companies.map((c) => (c.id === "us" ? { ...c, cash: 50_000_000 } : c)) };
      spent += each;
      w = resolveYear({ ...w, year: p }, [{
        companyId: "us",
        cmo: { price: us.price, brandSpend: 0, performanceSpend: each, celebritySpend: 0, targetCities: us.cities },
        cto: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0 },
        coo: { capacityTarget: Math.max(us.capacity, 200_000), supportSpend: 0, efficiencySpend: 0, headcount: us.staff ?? 0 },
        cfo: { borrow: 0, repay: 0, cashBuffer: 0 },
        ceo: { focus: "growth", founderHours: {} },
      } as never], economyFor(`${seasonId}-promo`, p, 12)).world;
    }
    const us = w.companies.find((c) => c.id === "us")!;
    const total = w.companies.reduce((n, c) => n + held(c), 0);
    console.log(`  ${money(each).padStart(10)}      ${String(held(us)).padStart(10)}   ${((held(us) / total) * 100).toFixed(2)}%   ${money(spent).padStart(12)}`);
  }
}

function main() {
  const briefs = BRIEFS.filter((b) => !ONLY || b.category === ONLY);
  console.log(`opening ${money(OPENING)}, ${MONTHS} months\n`);

  for (const brief of briefs) {
    const path = join(CACHE, `${brief.id}.json`);
    if (!existsSync(path)) { console.log(`${brief.id}: not cached — run nova-growth-report.ts first`); continue; }
    const niche = parseMarket(JSON.stringify(JSON.parse(readFileSync(path, "utf-8"))), brief.id, { check: false });
    if (!niche) continue;

    console.log(`\n${"=".repeat(96)}\n${brief.category.toUpperCase()} — ${niche.name}`);
    const plans: Plan[] = ["nova", "hands", "buyer", "both", "promo"];
    const runs = Object.fromEntries(plans.map((p) => [p, play(niche, `${brief.id}-${OPENING}`, p)])) as Record<Plan, Row[]>;

    console.log(`\n  month  ${plans.map((p) => p.padStart(16)).join("")}`);
    for (let i = 0; i < MONTHS; i++) {
      const cells = plans.map((p) => {
        const r = runs[p][i];
        return (r ? `${(r.share * 100).toFixed(2)}% ${r.subs.toLocaleString()}` : "—").padStart(16);
      });
      if (plans.every((p) => !runs[p][i])) break;
      console.log(`  ${String(i + 1).padStart(5)}  ${cells.join("")}`);
    }
    console.log(`\n  ${"after a year".padEnd(10)} ${plans.map((p) => p.padStart(16)).join("")}`);
    const last = (p: Plan) => runs[p][runs[p].length - 1];
    for (const [label, read] of [
      ["subs", (r: Row) => r.subs.toLocaleString()],
      ["share", (r: Row) => `${(r.share * 100).toFixed(2)}%`],
      ["cash", (r: Row) => money(r.cash)],
      ["debt", (r: Row) => money(r.debt)],
      ["profit/mo", (r: Row) => money(r.profit)],
      ["items", (r: Row) => `${r.assets} (${r.built} made, ${r.bought} bought)`],
    ] as const) {
      console.log(`  ${label.padEnd(10)} ${plans.map((p) => { const r = last(p); return (r ? read(r) : "—").padStart(16); }).join("")}`);
    }
    for (const p of plans) {
      const r = last(p);
      if (r?.bust) console.log(`  ${p} went insolvent in month ${runs[p].length}`);
    }
    promotionSweep(niche, brief.id);
    promotionSweep(niche, brief.id, 70);
  }
  process.exit(0);
}

main();
