/**
 * The whole picture, per startup: the market, the opening position, every
 * decision the optimiser makes, and whether the result is a sane business.
 *
 * Run: npx tsx script/simulation-report.ts
 *      npx tsx script/simulation-report.ts "coffee roastery"   (one of them)
 *
 * The other scripts in here each answer one question and were written while
 * chasing it. This is the standing report: for each of the seven written
 * markets, what `buildCustomMarket` made of it, what the company opens with,
 * what the optimiser clicks every year, and what the business looks like at
 * the end — plus a balance table across all seven, because "is it balanced" is
 * a question about the spread of outcomes rather than about any one of them.
 *
 * Everything here is one pass per market with no averaging, so the numbers are
 * exact and reproducible rather than means. `script/optimiser-feature-probe.ts`
 * is the one to use when a difference needs to survive seed variance.
 *
 * ## It opens them at £60,000
 *
 * Not the engine's own figure. `startingCashFor` gives a company
 * STARTING_YEARS_OF_RUNWAY — 5.45 — years of its own costs, which comes to £6m
 * for a five-seat catalogue market and £102k to £658k for the small written
 * ones. Nobody this product is for has any of those numbers. They have savings
 * or a small cheque, so a balance verdict computed from £6m is a verdict about
 * a business nobody is running.
 *
 * The engine's own figure is printed beside it, because the comparison is the
 * interesting part: the same market, the same search, a different bank.
 *
 * One caveat, and it makes these runs generous rather than harsh. `season.ts`
 * sizes the plant and the home region against the opening cash, and only the
 * cash is overridden here — so a company opened at £60k still owns the factory
 * a funded one would have built. If it struggles at £60k here, it would
 * struggle sooner honestly.
 */
import { buildCustomMarket } from "../shared/simulation/custom-market";
import { buildWorld, economyFor, STARTING_YEARS_OF_RUNWAY } from "../shared/simulation/season";
import { resolveYear } from "../shared/simulation/resolve";
import { optimise } from "../shared/simulation/optimiser";
import { winnabilityOf } from "../shared/simulation/winnable";
import { distressOf } from "../shared/simulation/recovery";
import { valuation } from "../shared/simulation/mergers";
import { marketScale } from "../shared/simulation/world";
import { yearOfCostsFor } from "../shared/simulation/decisions";
import { expectedPrice, priceStep } from "../shared/simulation/market";
import { ROLES, type Niche, type World, type Company } from "../shared/simulation/types";
import { STARTUP_SPECS } from "./lib/startup-specs";

const money = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1_000_000 ? `£${(n / 1_000_000).toFixed(2)}m`
    : a >= 1_000 ? `£${Math.round(n / 1_000)}k`
    : a >= 1 ? `£${n.toFixed(0)}`
    : `£${n.toFixed(2)}`;
  return s;
};
const exact = (n: number) => `£${Math.round(n).toLocaleString()}`;
const pad = (s: string, n: number) => s.padEnd(n);
const rp = (s: string, n: number) => s.padStart(n);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** What a person actually starts a business with. See the header. */
const POCKET = Number(process.env.POCKET ?? 60_000);

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const only = args[0]?.toLowerCase();
const markets: { label: string; note: string; niche: Niche }[] = [];
for (const s of STARTUP_SPECS) {
  if (only && !s.label.toLowerCase().includes(only)) continue;
  const niche = buildCustomMarket(s.spec, `rep-${s.label.replace(/\s+/g, "-")}`, { fresh: true });
  if (!niche) { console.log(`!! ${s.label}: buildCustomMarket refused it`); continue; }
  markets.push({ label: s.label, note: s.note, niche, });
}

interface Verdict {
  label: string;
  openCash: number;
  engineCash: number;
  endValue: number;
  endCash: number;
  customers: number;
  revenue: number;
  margin: number;
  priceFrom: number;
  priceTo: number;
  quality: number;
  brand: number;
  service: number;
  debt: number;
  bankruptFrom: number | null;
  leversUsed: Set<string>;
  idleYears: number;
  winnable: string;
}

const verdicts: Verdict[] = [];

for (const { label, note, niche } of markets) {
  const seasonId = `rep-${niche.id}`;
  const built = buildWorld({ seasonId, niche, teams: [{ id: "us", name: "Us", seats: [...ROLES] }] });
  /* What the engine would have given them, kept for the comparison below. */
  const engineCash = built.companies.find((c) => c.id === "us")!.cash ?? 0;
  const base: World = { ...built, companies: built.companies.map((c) => (c.id === "us" ? { ...c, cash: POCKET } : c)) };
  let world: World = base;
  const opening = base.companies.find((c) => c.id === "us")!;

  console.log("\n" + "=".repeat(118));
  console.log(`  ${label.toUpperCase()}  —  ${note}`);
  console.log("=".repeat(118));

  /* ── The market, as a listing would publish it ──────────────────────────── */
  const scale = marketScale(niche);
  const yearCost = yearOfCostsFor({ officers: 5, seats: [...ROLES], scale });
  let winnable = "—";
  try {
    const w = winnabilityOf(niche);
    winnable = w.ok ? "yes" : `NO — ${w.problems[0]?.slice(0, 60) ?? "unstated"}`;
  } catch (e: any) { winnable = `threw: ${e.message.slice(0, 30)}`; }

  console.log("\n  THE MARKET");
  for (const s of niche.segments) {
    console.log(`    ${pad(s.name.slice(0, 26), 28)} ${rp(s.size.toLocaleString(), 11)} buyers   pays ${rp(exact(s.referencePrice), 12)}`
      + `   price-sensitivity ${s.priceSensitivity.toFixed(2)}  quality ${s.qualityFocus.toFixed(2)}  brand ${s.brandFocus.toFixed(2)}  service ${s.serviceFocus.toFixed(2)}  loyalty ${s.loyalty.toFixed(2)}`);
  }
  for (const i of niche.incumbents ?? []) {
    console.log(`    rival: ${pad(i.name.slice(0, 22), 24)} holds ${rp(pct(i.startingShare ?? 0), 7)}   posture ${pad(String(i.posture), 10)} quality ${Math.round(i.quality)} brand ${Math.round(i.brand)} service ${Math.round(i.service)} price ×${(i.priceIndex ?? 1).toFixed(2)}`);
  }
  console.log(`    unit cost ${exact(niche.baseUnitCost)}   open share ${pct(niche.openShare ?? 0)}   innovation pace ${niche.innovationPace.toFixed(2)}   winnable: ${winnable}`);

  /* ── What the company opens with ────────────────────────────────────────── */
  const cheapest = [...niche.segments].sort((a, b) => a.referencePrice - b.referencePrice)[0];
  console.log("\n  THE OPENING POSITION");
  console.log(`    cash ${exact(opening.cash ?? 0)} — what a person actually starts with, not the ${exact(engineCash)} the engine would give`);
  console.log(`    a year of costs ${exact(yearCost)}   so ${((opening.cash ?? 0) / (yearCost || 1)).toFixed(2)} years of runway, against the ${STARTING_YEARS_OF_RUNWAY.toFixed(2)} it is designed for   market scale ${scale.toFixed(4)}`);
  console.log(`    capacity ${(opening.capacity ?? 0).toLocaleString()}   opening price ${exact(opening.price ?? 0)}   quality ${Math.round((opening as any).quality ?? 0)} brand ${Math.round((opening as any).brand ?? 0)} service ${Math.round((opening as any).service ?? 0)}`);
  console.log(`    price ladder is anchored on ${exact(expectedPrice(cheapest, 1))} (year 1) → ${exact(expectedPrice(cheapest, 14))} (year 14), in steps of ${exact(priceStep(cheapest.referencePrice))}`);

  /* ── Every decision, every year ─────────────────────────────────────────── */
  console.log("\n  WHAT THE OPTIMISER CLICKS");
  console.log("  " + pad("yr", 4) + rp("price", 10) + rp("brand", 11) + rp("perf", 11) + rp("feature", 10) + rp("reliab", 11)
    + rp("support", 10) + rp("effic", 11) + rp("capacity", 11) + rp("COMMITTED", 12));
  console.log("  " + pad("", 4) + rp("revenue", 10) + rp("profit", 11) + rp("cash", 11) + rp("debt", 10) + rp("customers", 11)
    + rp("qual", 10) + rp("brand", 11) + rp("serv", 11) + rp("value", 11) + rp("state", 12));
  console.log("  " + "-".repeat(114));

  const levers = new Set<string>();
  let idle = 0;
  let last: Company = opening;
  let firstPrice = 0;
  let lastPrice = 0;
  let lastRevenue = 0;
  let lastProfit = 0;

  for (let year = 1; year <= 14; year++) {
    const plan = optimise({ world, companyId: "us", year, economy: economyFor(seasonId, year, 1), totalYears: 14 });
    if (!plan) { console.log(`  ${pad(String(year), 4)}  — no plan: the company is gone`); break; }
    const d = plan.decisions;
    const spends: [string, number][] = [
      ["brandSpend", d.cmo?.brandSpend ?? 0], ["performanceSpend", d.cmo?.performanceSpend ?? 0],
      ["featureSpend", d.cto?.featureSpend ?? 0], ["reliabilitySpend", d.cto?.reliabilitySpend ?? 0],
      ["supportSpend", d.coo?.supportSpend ?? 0], ["efficiencySpend", d.coo?.efficiencySpend ?? 0],
    ];
    const committed = spends.reduce((n, [, v]) => n + v, 0);
    for (const [k, v] of spends) if (v > 0) levers.add(k);
    if (committed === 0) idle += 1;
    const price = d.cmo?.price ?? 0;
    if (year === 1) firstPrice = price;
    lastPrice = price;

    const out = resolveYear({ ...world, year }, [d as never], economyFor(seasonId, year, 1));
    const report: any = out.reports.find((r: any) => r.companyId === "us");
    world = out.world;
    const us = world.companies.find((c) => c.id === "us");
    if (!us) { console.log(`  ${pad(String(year), 4)}  — the company is gone`); break; }
    last = us;
    lastRevenue = report?.revenue ?? 0;
    lastProfit = report?.profit ?? 0;
    const customers = Object.values(us.customers ?? {}).reduce((a: number, b: any) => a + Number(b), 0);

    console.log("  " + pad(String(year), 4) + rp(exact(price), 10) + rp(money(spends[0][1]), 11) + rp(money(spends[1][1]), 11)
      + rp(money(spends[2][1]), 10) + rp(money(spends[3][1]), 11) + rp(money(spends[4][1]), 10) + rp(money(spends[5][1]), 11)
      + rp((d.coo?.capacityTarget ?? 0).toLocaleString(), 11) + rp(money(committed), 12));
    console.log("  " + pad("", 4) + rp(money(lastRevenue), 10) + rp(money(lastProfit), 11) + rp(money(us.cash ?? 0), 11)
      + rp(money(us.debt ?? 0), 10) + rp(customers.toLocaleString(), 11)
      + rp(String(Math.round((us as any).quality ?? 0)), 10) + rp(String(Math.round((us as any).brand ?? 0)), 11)
      + rp(String(Math.round((us as any).service ?? 0)), 11) + rp(money(valuation(us).fair), 11)
      + rp(`${distressOf(us)}${us.bankruptSince ? ` y${us.bankruptSince}` : ""}`, 12));
  }

  const customers = Object.values(last.customers ?? {}).reduce((a: number, b: any) => a + Number(b), 0);
  verdicts.push({
    label,
    openCash: opening.cash ?? 0,
    engineCash,
    endValue: valuation(last).fair,
    endCash: last.cash ?? 0,
    customers, revenue: lastRevenue,
    margin: lastRevenue > 0 ? lastProfit / lastRevenue : 0,
    priceFrom: firstPrice, priceTo: lastPrice,
    quality: Math.round((last as any).quality ?? 0),
    brand: Math.round((last as any).brand ?? 0),
    service: Math.round((last as any).service ?? 0),
    debt: last.debt ?? 0,
    bankruptFrom: last.bankruptSince ?? null,
    leversUsed: levers, idleYears: idle, winnable,
  });
}

/* ── Balance, across all of them ─────────────────────────────────────────── */
console.log("\n\n" + "=".repeat(118));
console.log("  BALANCE ACROSS ALL SEVEN");
console.log("=".repeat(118) + "\n");
console.log(`  Opened at ${exact(POCKET)} each — what a person has. The engine's own figure is in brackets.\n`);
console.log("  " + pad("startup", 20) + rp("opens on", 11) + rp("(engine)", 11) + rp("ends worth", 12) + rp("×", 7) + rp("customers", 11)
  + rp("net margin", 11) + rp("price move", 13) + rp("quality", 9) + rp("idle yrs", 9) + rp("levers", 8));
console.log("  " + "-".repeat(114));
for (const v of verdicts) {
  const mult = v.openCash > 0 ? `${(v.endValue / v.openCash).toFixed(0)}×` : "—";
  console.log("  " + pad(v.label, 20) + rp(money(v.openCash), 11) + rp(`(${money(v.engineCash)})`, 11) + rp(money(v.endValue), 12) + rp(mult, 7)
    + rp(v.customers.toLocaleString(), 11) + rp(pct(v.margin), 11)
    + rp(`${exact(v.priceFrom)}→${exact(v.priceTo)}`, 13) + rp(String(v.quality), 9)
    + rp(String(v.idleYears), 9) + rp(`${v.leversUsed.size}/6`, 8));
}

console.log("\n  READINGS");
const marginHigh = verdicts.filter((v) => v.margin > 0.3);
if (marginHigh.length) {
  console.log(`    · ${marginHigh.length}/${verdicts.length} finish on a net margin above 30%: `
    + marginHigh.map((v) => `${v.label} ${pct(v.margin)}`).join(", "));
  console.log("      Real comparators: vertical SaaS tops out around 25% and most are negative while growing;");
  console.log("      coffee roasting nets 5-12%; small-launch is negative across the sector.");
}
const flat = verdicts.filter((v) => v.priceTo === v.priceFrom);
if (flat.length) {
  console.log(`    · ${flat.length}/${verdicts.length} never change price: ${flat.map((v) => v.label).join(", ")}`);
  console.log("      Costs drift up 1.2% a year (PRICE_DRIFT_PER_YEAR) and so does what buyers expect to pay,");
  console.log("      so a flat price is a lever that could not move rather than one that chose not to.");
}
const noFeatures = verdicts.filter((v) => !v.leversUsed.has("featureSpend"));
if (noFeatures.length) {
  console.log(`    · ${noFeatures.length}/${verdicts.length} never fund the product at all: ${noFeatures.map((v) => v.label).join(", ")}`);
  console.log("      Known, measured and unexplained — see test/unit/optimiser.test.ts, the pinned test.");
}
const idlers = verdicts.filter((v) => v.idleYears >= 3);
if (idlers.length) {
  console.log(`    · ${idlers.length}/${verdicts.length} spend nothing at all in 3+ years: `
    + idlers.map((v) => `${v.label} (${v.idleYears})`).join(", "));
}
const broke = verdicts.filter((v) => v.bankruptFrom !== null);
console.log(`    · ${broke.length}/${verdicts.length} end insolvent`
  + (broke.length ? `: ${broke.map((v) => `${v.label} from year ${v.bankruptFrom}`).join(", ")}` : "."));
const unwinnable = verdicts.filter((v) => v.winnable !== "yes");
console.log(`    · ${unwinnable.length}/${verdicts.length} fail the winnability check`
  + (unwinnable.length ? `: ${unwinnable.map((v) => v.label).join(", ")}` : "."));
console.log("");
