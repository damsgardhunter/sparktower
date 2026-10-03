import { readFileSync } from "node:fs";
import { openShareFor, pricedForABusiness } from "@shared/simulation/custom-market";
import { PLANS, season } from "./strategies.mts";
const load = (n: string) => {
  const raw: any = JSON.parse(readFileSync(`.sim-lab/${n}.json`,"utf8"));
  const openShare = typeof raw.openShare === "number" ? raw.openShare : openShareFor(raw);
  return { ...raw, openShare, segments: pricedForABusiness({ segments: raw.segments, cities: raw.cities, baseUnitCost: raw.baseUnitCost, openShare }) };
};
const REAL = Object.keys(PLANS).filter((p) => p !== "nothing");
for (const n of ["quorumcast","hearthmap","kilnshare","hedgerow"]) {
  const niche = load(n);
  const out: string[] = [];
  for (const ev of [false, true]) {
    let ok = 0;
    for (const seed of ["a","d","h","m","q","t","w","y"]) if (REAL.some((p) => (season(niche, seed, p, ev) as any).prof > 0)) ok++;
    out.push(`${ev ? "events on " : "events off"} ${ok}/8`);
  }
  console.log(`${n.padEnd(11)} ${out.join("   ")}`);
}
