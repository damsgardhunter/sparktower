/**
 * What Nova actually decides, month by month, and what it gets for it.
 *
 * The growth reports answer "how far did it get"; this answers "what did it
 * do", which is the question you ask when the answer to the first one is
 * disappointing. Every lever Nova moves is printed with its value, every month,
 * beside what the company looked like afterwards — so a month where it files
 * nothing is visible as a month where it files nothing, rather than hidden
 * inside a share figure that went up anyway.
 *
 * Reads the markets `nova-growth-report.ts` cached, so it costs no API calls.
 *
 * Usage:
 *   npx tsx --env-file=.env script/nova-decisions.ts
 *   npx tsx --env-file=.env script/nova-decisions.ts --only=saas --opening=25000 --months=6
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseMarket } from "../server/nova-market";
import { buildWorld, economyFor } from "@shared/simulation/season";
import { optimise } from "@shared/simulation/optimiser";
import { resolveYear } from "@shared/simulation/resolve";
import { foundersActions, buildableActions, isBuild, buildListingId } from "@shared/simulation/actions";
import { marketListings } from "@shared/simulation/assets";
import { ROLES, type Niche, type World } from "@shared/simulation/types";
import { BRIEFS } from "./nova-growth-briefs";

const CACHE = join(import.meta.dirname ?? "script", ".cache", "nova-markets");
const args = process.argv.slice(2);
const flag = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const ONLY = flag("only");
const OPENINGS = (flag("opening") ?? "0,5000,25000").split(",").map(Number);
const MONTHS = Number(flag("months") ?? 12);

const held = (c: any) => Object.values(c?.customers ?? {}).reduce((a: number, b: any) => a + Number(b), 0);
const m = (n: number) => `$${Math.round(n).toLocaleString()}`;

/** Only the levers that were actually moved, said in money or in words. */
function whatItDid(d: any, niche: Niche, shelf: { id: string; asset: { name: string } }[]): string[] {
  const out: string[] = [];
  const say = (label: string, value: unknown, asMoney = true) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return;
    out.push(`${label} ${asMoney ? m(n) : n.toLocaleString()}`);
  };
  say("brand", d.cmo?.brandSpend);
  say("promotion", d.cmo?.performanceSpend);
  say("sponsorship", d.cmo?.celebritySpend);
  say("PR", d.cmo?.prSpend);
  say("referrals", d.cmo?.referralSpend);
  say("win-back", d.cmo?.winbackSpend);
  say("features", d.cto?.featureSpend);
  say("reliability", d.cto?.reliabilitySpend);
  say("tech debt", d.cto?.techDebtPaydown);
  say("research", d.cto?.researchSpend);
  say("security", d.cto?.securitySpend);
  say("data", d.cto?.dataSpend);
  say("support", d.coo?.supportSpend);
  say("efficiency", d.coo?.efficiencySpend);
  say("training", d.coo?.trainingSpend);
  say("recruiting", d.coo?.recruitingSpend);
  say("borrow", d.cfo?.borrow);
  say("raise", d.cfo?.raiseAmount);
  say("repay", d.cfo?.repay);
  say("buffer", d.cfo?.cashBuffer);
  if (d.coo?.headcount) out.push(`hire ${d.coo.headcount}`);
  if (d.cmo?.price) out.push(`price ${m(d.cmo.price)}`);
  if (d.coo?.capacityTarget) out.push(`room for ${Number(d.coo.capacityTarget).toLocaleString()}`);
  if (d.ceo?.focus && d.ceo.focus !== "growth") out.push(`focus ${d.ceo.focus}`);
  if (d.ceo?.positioning) {
    const seg = niche.segments.find((s) => s.id === d.ceo.positioning);
    out.push(`aimed at ${seg?.name ?? d.ceo.positioning}`);
  }
  if (d.coo?.sourcing && d.coo.sourcing !== "in_house") out.push(`sourcing ${d.coo.sourcing}`);
  if (d.coo?.expand) out.push(`opening ${d.coo.expand}`);

  /* The week, which is the lever that costs no money. */
  const hours = (d.ceo?.founderHours ?? {}) as Record<string, number>;
  const names = new Map([
    ...foundersActions(niche).map((a) => [a.id, a.name] as const),
    ...buildableActions(shelf as never).map((a) => [a.id, a.name] as const),
  ]);
  const week = Object.entries(hours)
    .filter(([, h]) => Number(h) > 0)
    .map(([id, h]) => `${Math.round(Number(h))}h ${isBuild(id) ? `making "${shelf.find((l) => l.id === buildListingId(id))?.asset.name ?? id}"` : (names.get(id) ?? id)}`);
  if (week.length) out.push(`week: ${week.join(" + ")}`);
  return out;
}

function run(niche: Niche, seasonId: string, opening: number): void {
  let world: World = buildWorld({
    seasonId, niche, cadence: "monthly",
    teams: [{ id: "us", name: "Us", seats: [...ROLES], foundersPaid: false }],
  });
  world = { ...world, companies: world.companies.map((c) => (c.id === "us" ? { ...c, cash: opening } : c)) };

  const market = niche.segments.reduce((n, s) => n + s.size, 0);
  console.log(`\n  opened at ${m(opening)} — ${market.toLocaleString()} ${niche.voice?.customers ?? "customers"} in the market`);

  for (let p = 1; p <= MONTHS; p++) {
    const us = world.companies.find((c) => c.id === "us");
    if (!us) break;
    const shelf = marketListings({ seasonId, year: p, niche, periods: 12, owned: (us.assets ?? []).map((a) => a.name) });
    const plan = optimise({ world, companyId: "us", year: p, economy: economyFor(seasonId, p, 12), periods: 12, totalYears: Math.ceil(MONTHS / 12) });
    if (!plan) { console.log(`    month ${p}: no plan`); break; }
    const d: any = { companyId: "us", ...(plan.decisions as any) };
    const did = whatItDid(d, niche, shelf as never);

    const r = resolveYear({ ...world, year: p }, [d], economyFor(seasonId, p, 12));
    world = r.world;
    const now = world.companies.find((c) => c.id === "us");
    if (!now) break;
    const total = world.companies.reduce((n, c) => n + held(c), 0);
    const pnl = r.reports.find((x) => x.companyId === "us")?.pnl as any;

    console.log(`\n    month ${String(p).padStart(2)}  ${((held(now) / total) * 100).toFixed(2)}% · ${held(now).toLocaleString()} ${niche.voice?.customers ?? "customers"} · cash ${m(now.cash)} · debt ${m(now.debt ?? 0)} · q${Math.round(now.quality)} b${Math.round(now.brand)} s${Math.round(now.service)} rep${Math.round(now.reputation)} · ${(now.assets ?? []).length} items · founders own ${Math.round((now.founderShare ?? 1) * 100)}% · ${m(pnl?.profit ?? 0)}/mo`);
    console.log(`            committed ${m(plan.spends)}: ${did.length ? did.join(" | ") : "nothing"}`);
    const notes = (r.reports.find((x) => x.companyId === "us")?.notes ?? [])
      .filter((n: string) => /yourselves|coming along|Paid for|emergency|ran out|turned away/i.test(n));
    for (const n of notes) console.log(`            → ${n}`);
    if (now.bankruptSince) { console.log(`            insolvent`); break; }
  }
}

function main() {
  for (const brief of BRIEFS.filter((b) => !ONLY || b.category === ONLY)) {
    const path = join(CACHE, `${brief.id}.json`);
    if (!existsSync(path)) continue;
    const niche = parseMarket(JSON.stringify(JSON.parse(readFileSync(path, "utf-8"))), brief.id, { check: false });
    if (!niche) continue;
    console.log(`\n${"=".repeat(100)}\n${brief.category.toUpperCase()} — ${niche.name}`);
    for (const opening of OPENINGS) run(niche, `${brief.id}-${opening}`, opening);
  }
  process.exit(0);
}

main();
