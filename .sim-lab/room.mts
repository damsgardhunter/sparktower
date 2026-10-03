import { readFileSync } from "node:fs";
import { openShareFor, pricedForABusiness } from "@shared/simulation/custom-market";
import { PLANS, season } from "./strategies.mts";
const SEEDS = ["a","d","h","m","q","t","w","y"];
const REAL = Object.keys(PLANS).filter((p) => p !== "nothing");
for (const n of ["quorumcast","hearthmap"]) {
  const raw: any = JSON.parse(readFileSync(`.sim-lab/${n}.json`,"utf8"));
  for (const open of [0.35, 0.5, 0.65]) {
    const segments = pricedForABusiness({ segments: raw.segments, cities: raw.cities, baseUnitCost: raw.baseUnitCost, openShare: open });
    const niche = { ...raw, openShare: open, segments };
    let ok = 0, beaten = 0; const works: string[] = [];
    const per: Record<string, number> = {}; for (const p of REAL) per[p] = 0;
    for (const seed of SEEDS) {
      const nothing = season(niche, seed, "nothing");
      let any = false;
      for (const p of REAL) { const r = season(niche, seed, p); if (r.prof > 0) { per[p]++; any = true; } if (r.worth <= nothing.worth) beaten++; }
      if (any) ok++;
    }
    for (const p of REAL) if (per[p] === 8) works.push(p);
    console.log(`${n.padEnd(11)} openShare ${open.toFixed(2)} · seeds with a profitable plan ${ok}/8 · plans working everywhere ${works.length}/5 (${works.join(",")||"none"}) · beaten ${beaten}/40`);
  }
}
