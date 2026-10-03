import { readFileSync } from "node:fs";
import { openShareFor, pricedForABusiness } from "@shared/simulation/custom-market";
import { PLANS, season } from "./strategies.mts";
const raw: any = JSON.parse(readFileSync(".sim-lab/quorumcast.json","utf8"));
const openShare = typeof raw.openShare === "number" ? raw.openShare : openShareFor(raw);
const niche = { ...raw, openShare, segments: pricedForABusiness({ segments: raw.segments, cities: raw.cities, baseUnitCost: raw.baseUnitCost, openShare }) };
console.log("openShare", openShare, "prices", niche.segments.map((s: any)=>s.referencePrice).join("/"));
const REAL = Object.keys(PLANS).filter((p) => p !== "nothing");
let ok = 0;
for (const seed of ["a","d","h","m","q","t","w","y"]) {
  const per = REAL.map((p) => `${p.slice(0,4)}:${(season(niche, seed, p, false) as any).prof}`);
  const any = REAL.some((p) => (season(niche, seed, p, false) as any).prof > 0);
  if (any) ok++;
  const { economyFor } = await import("@shared/simulation/season");
  const trend = economyFor(seed, 16, 4).demand - economyFor(seed, 1, 4).demand;
  console.log(`seed ${seed} ${any ? "OK " : "DEAD"} trend ${trend >= 0 ? "+" : ""}${trend.toFixed(3)} ${per.join(" ")}`);
}
console.log("seeds with a profitable plan:", ok, "/8");
