import { readFileSync } from "node:fs";
import { openShareFor, pricedForABusiness } from "@shared/simulation/custom-market";
import { PLANS, season } from "./strategies.mts";
const load = (n: string) => {
  const raw: any = JSON.parse(readFileSync(`.sim-lab/${n}.json`,"utf8"));
  const openShare = typeof raw.openShare === "number" ? raw.openShare : openShareFor(raw);
  return { ...raw, openShare, segments: pricedForABusiness({ segments: raw.segments, cities: raw.cities, baseUnitCost: raw.baseUnitCost, openShare }) };
};
const REAL = Object.keys(PLANS).filter((p) => p !== "nothing");
const score = (niche: any) => {
  let ok = 0;
  for (const seed of ["a","d","h","m","q","t","w","y"]) if (REAL.some((p) => (season(niche, seed, p, true) as any).prof > 0)) ok++;
  return ok;
};
const q = load("quorumcast");
console.log("quorumcast measured first          :", score(q), "/8");
/* Now run other markets first, then measure the same object again. */
for (const other of ["cairnwait","tideturn","kilnshare"]) score(load(other));
console.log("quorumcast measured after 3 others :", score(q), "/8");
/* And a fresh object, after all that. */
console.log("quorumcast, fresh object, same run :", score(load("quorumcast")), "/8");
