import { NICHES } from "@shared/simulation/niches";
import { PLANS, season } from "./strategies.mts";
const SEEDS = ["a","d","h","m","q","t","w","y"];
const REAL = Object.keys(PLANS).filter((p) => p !== "nothing");
let onlyWithEvents = 0, onlyWithout = 0, both = 0, runs = 0;
const blamed: Record<string, number> = {};
for (const niche of (NICHES as any[])) {
  for (const seed of SEEDS) for (const p of REAL) {
    runs++;
    const off: any = season(niche, seed, p, false);
    const on: any = season(niche, seed, p, true);
    if (on.bankrupt && !off.bankrupt) { onlyWithEvents++; for (const e of on.seen) blamed[e] = (blamed[e] ?? 0) + 1; }
    else if (!on.bankrupt && off.bankrupt) onlyWithout++;
    else if (on.bankrupt && off.bankrupt) both++;
  }
}
console.log(`${runs} runs (7 catalogue markets x 8 seeds x 6 plans)`);
console.log(`  bankrupt only when events are on : ${onlyWithEvents}`);
console.log(`  bankrupt only when events are off: ${onlyWithout}`);
console.log(`  bankrupt either way              : ${both}`);
console.log("\nevents present in the runs that only failed with events on:");
for (const [e, n] of Object.entries(blamed).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${String(n).padStart(3)}  ${e.slice(0, 56)}`);
