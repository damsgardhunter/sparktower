import { readFileSync } from "node:fs";
import { NICHES } from "@shared/simulation/niches";
import { openShareFor, pricedForABusiness } from "@shared/simulation/custom-market";
import { season } from "./strategies.mts";
const asToday = (raw: any) => {
  const openShare = typeof raw.openShare === "number" ? raw.openShare : openShareFor(raw);
  return { ...raw, openShare, segments: pricedForABusiness({ segments: raw.segments, cities: raw.cities, baseUnitCost: raw.baseUnitCost, openShare }) };
};
const CUSTOM = ["cairnwait","quorumcast","kilnshare","rotaread","tideturn","saltbox","hedgerow","parishpay"];
const ALL = [...(NICHES as any[]).map((n) => ({ id: n.id, niche: n })),
  ...CUSTOM.map((f) => ({ id: f, niche: asToday(JSON.parse(readFileSync(`.sim-lab/${f}.json`,"utf8"))) }))];
const SEEDS = ["a","d","h","m","q","t","w","y"];
const SCALES = [0.25, 0.5, 1, 2, 4];
console.log("market".padEnd(17) + "a cautious player: seeds with a profitable quarter · bankruptcies · beats filing nothing");
for (const { id, niche } of ALL) {
  let prof = 0, broke = 0, beats = 0;
  for (const seed of SEEDS) {
    const nothing = (season(niche, seed, "nothing", true) as any).worth;
    const runs = SCALES.map((k) => season(niche, seed, "lean", true, k) as any);
    if (runs.some((r) => r.prof > 0)) prof++;
    if (runs.every((r) => r.bankrupt)) broke++;
    if (Math.max(...runs.map((r) => r.worth)) > nothing) beats++;
  }
  const bad = (prof < 8 || broke > 0) ? "  <--" : "";
  console.log(`${id.padEnd(17)} ${prof}/8 · ${broke}/8 · ${beats}/8${bad}`);
}
