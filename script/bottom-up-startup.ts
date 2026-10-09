/**
 * One startup, from nothing, a month at a time, on £1,000.
 *
 * Run: npx tsx script/bottom-up-startup.ts
 *
 * Every other diagnostic here opens a company on five and a half years of its
 * own running costs — £6m in a catalogue market, £100k to £650k in a written
 * one — and plays it a year at a time. That is a funded business making annual
 * decisions, and it is not what anybody starting out is doing.
 *
 * This one starts with £2,000 in the bank, decides every month, and is allowed
 * to commit £1,000 in its first month. What it may commit after that is a
 * function of what it earned, not of what it has: a tenth of last month's
 * takings on top of the floor, which is roughly how a business with no outside
 * money actually grows — you can spend what came in.
 *
 * ## The market
 *
 * Saddleback, a one-person mobile bike-repair round in a mid-sized English
 * town. Written to the schema and the rules `server/nova-market.ts` sets out
 * for Nova — small rather than enormous, `serves` answered from the trade,
 * `baseUnitCost` the real marginal cost of one job — but written by hand rather
 * than by a model call, because a model call costs money and the shape is what
 * matters here. Swap in a live one and nothing below changes.
 *
 * ## The decisions
 *
 * The optimiser proposes the shape of each month and the budget is then capped
 * to what the business can actually afford, proportionally. So the strategy is
 * the engine's and the constraint is the founder's, which is the honest
 * division: an optimiser handed £1,000 and an optimiser handed £40,000 make
 * very different plans, and the interesting question is what the small one does.
 */
import { buildCustomMarket } from "../shared/simulation/custom-market";
import { buildWorld, economyFor } from "../shared/simulation/season";
import { resolveYear } from "../shared/simulation/resolve";
import { optimise } from "../shared/simulation/optimiser";
import { winnabilityOf } from "../shared/simulation/winnable";
import { distressOf } from "../shared/simulation/recovery";
import { valuation } from "../shared/simulation/mergers";
import { servesPerHead } from "../shared/simulation/workforce";
import { periodsPerYear } from "../shared/simulation/cadence";
import type { TeamDecisions } from "../shared/simulation/decisions";
import { type World, type Niche } from "../shared/simulation/types";

const money = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${n < 0 ? "-" : ""}£${(a / 1_000_000).toFixed(2)}m`;
  if (a >= 1_000) return `${n < 0 ? "-" : ""}£${(a / 1_000).toFixed(1)}k`;
  return `${n < 0 ? "-" : ""}£${a.toFixed(0)}`;
};
const exact = (n: number) => `${n < 0 ? "-" : ""}£${Math.round(Math.abs(n)).toLocaleString()}`;
const pad = (s: string, n: number) => s.padEnd(n);
const rp = (s: string, n: number) => s.padStart(n);

/** What a founder with no outside money may commit this month. */
const FIRST_MONTH = 1_000;
const EARNED_SHARE = 0.1;
/*
 * A tenth of last month's takings, on top of the floor rather than instead of
 * it.
 *
 * The first version was `max(floor, revenue/10)`, which never engaged: a tenth
 * of £2,200 is £220, the floor won every month, and "progressively more" never
 * happened across two years. The floor is what a founder can find from
 * somewhere; the share is what the business itself has earned the right to
 * spend, and they add.
 */
const budgetFor = (month: number, lastRevenue: number): number =>
  month === 1 ? FIRST_MONTH : FIRST_MONTH + Math.round(Math.max(0, lastRevenue) * EARNED_SHARE);

const SPEC = {
  name: "Saddleback mobile bike repair",
  premise:
    "A van, a toolkit and one mechanic, fixing bicycles on people's driveways in a mid-sized English town. "
    + "The shops in town are busy and make you bring the bike to them; this comes to you.",
  segments: [
    {
      id: "commuters", name: "Commuters", description: "Ride to work most days, notice a problem on a Tuesday and want it gone by Thursday.",
      size: 9_000, growth: 0.04, priceSensitivity: 0.65, qualityFocus: 0.45, brandFocus: 0.25, serviceFocus: 0.8, loyalty: 0.55, referencePrice: 48,
    },
    {
      id: "enthusiasts", name: "Weekend enthusiasts", description: "Expensive bikes, strong opinions, and they will pay to have it done properly.",
      size: 2_600, growth: 0.07, priceSensitivity: 0.3, qualityFocus: 0.85, brandFocus: 0.45, serviceFocus: 0.6, loyalty: 0.7, referencePrice: 140,
    },
    {
      id: "families", name: "Families", description: "Four bikes in a shed, all of them flat, once a year before the summer holiday.",
      size: 7_400, growth: 0.03, priceSensitivity: 0.8, qualityFocus: 0.35, brandFocus: 0.2, serviceFocus: 0.5, loyalty: 0.25, referencePrice: 35,
    },
  ],
  regions: [
    { id: "town", name: "The town", weight: 0.45, entryCost: 1_200, note: "Where the van already is. Twenty minutes between jobs." },
    { id: "villages", name: "The villages", weight: 0.3, entryCost: 4_000, note: "Better bikes, more driving, fewer jobs a day." },
    { id: "city", name: "The city, forty minutes off", weight: 0.25, entryCost: 15_000, note: "Three shops already there and a fourth opening." },
  ],
  incumbents: [
    { id: "highstreet", name: "The High Street shop", posture: "coaster", startingShare: 0.52, quality: 58, brand: 72, service: 40, priceIndex: 1.15 },
    { id: "chain", name: "A national chain's service desk", posture: "shark", startingShare: 0.3, quality: 42, brand: 80, service: 28, priceIndex: 0.85 },
  ],
  /* Parts, consumables and the diesel to get there. The real marginal cost of one job. */
  baseUnitCost: 14,
  innovationPace: 0.5,
  voice: { customer: "rider", customers: "riders", unit: "repair", capacity: "jobs a month" },
  workforce: [
    /* One mechanic does about four jobs a day, five days a week: ~1,000 a year. */
    { id: "mechanics", name: "mechanics", one: "a mechanic", does: "room", pay: 0.85, share: 0.8, serves: 1_000 },
    { id: "office", name: "a bookings person", one: "a bookings assistant", does: "service", pay: 0.6, share: 0.2 },
  ],
};

const niche = buildCustomMarket(SPEC, "saddleback", { fresh: true });
if (!niche) { console.error("buildCustomMarket refused the market."); process.exit(1); }

const MONTHS = 24;
const seasonId = "saddleback";
const periods = periodsPerYear("monthly");

const built = buildWorld({
  seasonId, niche,
  /*
   * One chair, and opened where the founder actually is.
   *
   * `opening: "actual"` is the mode `shared/simulation/opening.ts` was written
   * for — no cash, no trading history, no customers — and `progress: 0.05`
   * puts this in its first band: "an idea, and the work so far". The funded
   * opening, which is the default and which the first run of this script got
   * by saying nothing, hands a one-van business 508 riders and £2,223 of
   * revenue before anybody decides anything.
   */
  teams: [{
    id: "us", name: "Saddleback", seats: ["ceo"], officers: 1,
    standing: { progress: 0.05, people: 1 },
  }],
  opening: "actual",
  cadence: "monthly",
});
/* Two thousand pounds, which is a van's deposit and a toolkit. */
let world: World = { ...built, companies: built.companies.map((c) => (c.id === "us" ? { ...c, cash: 2_000 } : c)) };

const opening = world.companies.find((c) => c.id === "us")!;
const w = winnabilityOf(niche);

console.log("\n" + "=".repeat(112));
console.log(`  ${SPEC.name.toUpperCase()}`);
console.log("=".repeat(112));
console.log(`\n  ${niche.premise}\n`);
for (const s of niche.segments) {
  console.log(`    ${pad(s.name, 22)} ${rp(s.size.toLocaleString(), 7)} riders   pays ${rp(exact(s.referencePrice), 6)}`
    + `   price ${s.priceSensitivity.toFixed(2)}  quality ${s.qualityFocus.toFixed(2)}  service ${s.serviceFocus.toFixed(2)}  loyalty ${s.loyalty.toFixed(2)}`);
}
for (const i of niche.incumbents ?? []) {
  console.log(`    rival: ${pad(i.name, 34)} ${rp(`${Math.round((i.startingShare ?? 0) * 100)}%`, 4)} of the town   quality ${Math.round(i.quality)} brand ${Math.round(i.brand)} service ${Math.round(i.service)}`);
}
console.log(`\n    one mechanic covers ${servesPerHead(niche).toLocaleString()} repairs a year   ·   parts and diesel ${exact(niche.baseUnitCost)} a job   ·   ${Math.round((niche.openShare ?? 0) * 100)}% of the town unspoken for   ·   winnable: ${w.ok ? "yes" : `NO — ${w.problems[0]}`}`);
console.log(`\n    opens with ${exact(opening.cash ?? 0)}, capacity ${(opening.capacity ?? 0).toLocaleString()} jobs a month, and may commit ${exact(FIRST_MONTH)} in month one`);
console.log(`    after that: a tenth of last month's takings, never less than ${exact(FIRST_MONTH)}\n`);

console.log("  " + pad("mo", 4) + rp("budget", 9) + rp("price", 8) + rp("marketing", 11) + rp("product", 10) + rp("service", 10)
  + rp("effic", 9) + rp("capacity", 10) + rp("spent", 9) + rp("revenue", 10) + rp("profit", 10) + rp("cash", 10) + rp("riders", 8) + rp("state", 11));
console.log("  " + "-".repeat(108));

let lastRevenue = 0;
const log: { month: number; budget: number; spent: number; revenue: number; profit: number; cash: number; riders: number; price: number; shape: string }[] = [];

for (let month = 1; month <= MONTHS; month++) {
  const budget = budgetFor(month, lastRevenue);
  const proposed = optimise({
    world, companyId: "us", year: month,
    economy: economyFor(seasonId, month, periods),
    periods, totalYears: Math.ceil(MONTHS / periods),
  });
  if (!proposed) { console.log(`  ${pad(String(month), 4)}  — no plan: the business is gone`); break; }

  /*
   * The founder's constraint, applied to the engine's shape.
   *
   * Scaled proportionally rather than truncated, so a plan that wanted to put
   * two thirds into marketing still does — on a tenth of the money. Capacity
   * and price are decisions rather than spending and are left alone.
   */
  const d: TeamDecisions = structuredClone(proposed.decisions);
  const wanted = (d.cmo?.brandSpend ?? 0) + (d.cmo?.performanceSpend ?? 0)
    + (d.cto?.featureSpend ?? 0) + (d.cto?.reliabilitySpend ?? 0)
    + (d.coo?.supportSpend ?? 0) + (d.coo?.efficiencySpend ?? 0);
  const scale = wanted > budget ? budget / wanted : 1;
  if (scale < 1) {
    d.cmo!.brandSpend = Math.round((d.cmo!.brandSpend ?? 0) * scale);
    d.cmo!.performanceSpend = Math.round((d.cmo!.performanceSpend ?? 0) * scale);
    d.cto!.featureSpend = Math.round((d.cto!.featureSpend ?? 0) * scale);
    d.cto!.reliabilitySpend = Math.round((d.cto!.reliabilitySpend ?? 0) * scale);
    d.coo!.supportSpend = Math.round((d.coo!.supportSpend ?? 0) * scale);
    d.coo!.efficiencySpend = Math.round((d.coo!.efficiencySpend ?? 0) * scale);
  }

  const marketing = (d.cmo?.brandSpend ?? 0) + (d.cmo?.performanceSpend ?? 0);
  const product = (d.cto?.featureSpend ?? 0) + (d.cto?.reliabilitySpend ?? 0);
  const service = d.coo?.supportSpend ?? 0;
  const effic = d.coo?.efficiencySpend ?? 0;
  const spent = marketing + product + service + effic;

  const out = resolveYear({ ...world, year: month }, [d as never], economyFor(seasonId, month, periods));
  const report: any = out.reports.find((r: any) => r.companyId === "us");
  world = out.world;
  const us = world.companies.find((c) => c.id === "us");
  if (!us) { console.log(`  ${pad(String(month), 4)}  — the business is gone`); break; }
  const riders = Object.values(us.customers ?? {}).reduce((a: number, b: any) => a + Number(b), 0);
  lastRevenue = report?.revenue ?? 0;

  const shape = [
    marketing > 0 ? `marketing ${exact(marketing)}` : null,
    product > 0 ? `product ${exact(product)}` : null,
    service > 0 ? `service ${exact(service)}` : null,
    effic > 0 ? `efficiency ${exact(effic)}` : null,
  ].filter(Boolean).join(", ") || "nothing";

  log.push({ month, budget, spent, revenue: lastRevenue, profit: report?.profit ?? 0, cash: us.cash ?? 0, riders, price: d.cmo?.price ?? 0, shape });

  /* What the year itself said happened, which is where an unexplained £52k shows up. */
  if (process.env.NOTES) {
    for (const note of (report?.notes ?? []) as string[]) console.log(`        · ${note}`);
    const bridge: any = report?.cashBridge;
    if (bridge) {
      console.log(`        cash ${exact(bridge.opening)} → ${exact(bridge.closing)}`);
      for (const l of bridge.lines ?? []) console.log(`          ${l.label ?? l.kind ?? "?"}: ${exact(l.amount ?? 0)}`);
    }
  }

  console.log("  " + pad(String(month), 4) + rp(money(budget), 9) + rp(exact(d.cmo?.price ?? 0), 8)
    + rp(money(marketing), 11) + rp(money(product), 10) + rp(money(service), 10) + rp(money(effic), 9)
    + rp((d.coo?.capacityTarget ?? 0).toLocaleString(), 10) + rp(money(spent), 9)
    + rp(money(lastRevenue), 10) + rp(money(report?.profit ?? 0), 10) + rp(money(us.cash ?? 0), 10)
    + rp(riders.toLocaleString(), 8) + rp(`${distressOf(us)}${us.bankruptSince ? ` y${us.bankruptSince}` : ""}`, 11));
}

const end = world.companies.find((c) => c.id === "us");
console.log("\n  WHAT HAPPENED, MONTH BY MONTH\n");
for (const r of log) {
  console.log(`    month ${String(r.month).padStart(2)}  budget ${rp(exact(r.budget), 8)}  charged ${rp(exact(r.price), 5)}  spent on ${r.shape}`);
  console.log(`              took ${rp(exact(r.revenue), 9)}, ${r.profit >= 0 ? "made" : "lost"} ${rp(exact(Math.abs(r.profit)), 8)}, ${exact(r.cash)} in the bank, ${r.riders.toLocaleString()} riders`);
}

if (end) {
  const months = log.length;
  const totalSpent = log.reduce((n, r) => n + r.spent, 0);
  const totalRevenue = log.reduce((n, r) => n + r.revenue, 0);
  const totalProfit = log.reduce((n, r) => n + r.profit, 0);
  console.log(`\n  AFTER ${months} MONTHS`);
  console.log(`    ${exact(end.cash ?? 0)} in the bank, worth ${exact(valuation(end).fair)}, ${Object.values(end.customers ?? {}).reduce((a: number, b: any) => a + Number(b), 0).toLocaleString()} riders`);
  console.log(`    took ${exact(totalRevenue)} in all, spent ${exact(totalSpent)} growing it, kept ${exact(totalProfit)}`);
  console.log(`    quality ${Math.round((end as any).quality ?? 0)}  brand ${Math.round((end as any).brand ?? 0)}  service ${Math.round((end as any).service ?? 0)}  ·  ${distressOf(end)}`);
  console.log(`    margin over the whole run: ${totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(1) : "0"}%`);
}
console.log("");
