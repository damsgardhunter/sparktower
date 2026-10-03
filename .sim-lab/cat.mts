import { NICHES } from "@shared/simulation/niches";
import { PLANS, season } from "./strategies.mts";
const SEEDS = ["a","d","h","m","q","t","w","y"];
const REAL = Object.keys(PLANS).filter((p) => p !== "nothing");
console.log("hand-written | seeds with a profitable plan · plans profitable on all 8 seeds · bankrupt · beaten-by-nothing");
for (const niche of NICHES as any[]) {
  let ok = 0, bankrupt = 0, beaten = 0; const per: Record<string, number> = {};
  for (const p of REAL) per[p] = 0;
  for (const seed of SEEDS) {
    const nothing = season(niche, seed, "nothing");
    let any = false;
    for (const p of REAL) { const r = season(niche, seed, p); if (r.prof > 0) { per[p]++; any = true; } if (r.bankrupt) bankrupt++; if (r.worth <= nothing.worth) beaten++; }
    if (any) ok++;
  }
  const works = REAL.filter((p) => per[p] === 8);
  console.log(`${niche.id.padEnd(16)} ${ok}/8 · ${works.length}/${REAL.length} (${works.join(",")||"none"}) · ${bankrupt} · ${beaten}`);
}
