import { NICHES } from "@shared/simulation/niches";
import { PLANS, season } from "./strategies.mts";
const SEEDS = ["a","d","h","m","q","t","w","y"];
const REAL = Object.keys(PLANS).filter((p) => p !== "nothing");
const beforeBankrupt: Record<string, number> = {};
const everywhere: Record<string, number> = {};
for (const niche of (NICHES as any[])) {
  for (const seed of SEEDS) for (const p of REAL) {
    const r: any = season(niche, seed, p, true);
    for (const e of r.seen) everywhere[e] = (everywhere[e] ?? 0) + 1;
    if (r.bankrupt) for (const e of r.seen) beforeBankrupt[e] = (beforeBankrupt[e] ?? 0) + 1;
  }
}
const rows = Object.entries(everywhere).map(([e, n]) => ({ e, n, b: beforeBankrupt[e] ?? 0, rate: (beforeBankrupt[e] ?? 0) / n }));
rows.sort((a, b) => b.rate - a.rate);
console.log("event headline                                             seen  in-bankrupt-runs  rate");
for (const r of rows.slice(0, 16)) console.log(`${r.e.slice(0, 54).padEnd(56)} ${String(r.n).padStart(4)} ${String(r.b).padStart(14)}  ${(r.rate*100).toFixed(0)}%`);
