import { readFileSync } from "node:fs";
import { PLANS, season } from "./strategies.mts";
import { openShareFor, pricedForABusiness } from "@shared/simulation/custom-market";
/* Markets written before the cleaner had these rules do not carry them; apply what it would now do. */
const asCleanedToday = (raw: any) => {
  const openShare = typeof raw.openShare === "number" ? raw.openShare : openShareFor(raw);
  return { ...raw, openShare, segments: pricedForABusiness({ segments: raw.segments, cities: raw.cities, baseUnitCost: raw.baseUnitCost, openShare }) };
};
const NEW = ["cairnwait","loomlight","parishpay","scrapline","tideturn","hearthmap"];
const OLD = ["hedgerow","pressfit","quorumcast","saltbox","ledgerloom","kilnshare","tallyhold","rotaread"];
const SEEDS = ["a","d","h","m","q","t","w","y"];
const REAL = Object.keys(PLANS).filter((p) => p !== "nothing" && p !== "growerBigPlant");
console.log("market       | seeds with a profitable plan · plans profitable on all 8 seeds · bankrupt · beaten-by-nothing");
for (const group of [NEW, OLD]) {
  for (const n of group) {
    const niche: any = asCleanedToday(JSON.parse(readFileSync(`.sim-lab/${n}.json`, "utf8")));
    let allSeedsOk = 0, bankrupt = 0, beaten = 0;
    const worksEverywhere: string[] = [];
    const perPlan: Record<string, number> = {};
    for (const plan of REAL) perPlan[plan] = 0;
    for (const seed of SEEDS) {
      const nothing = season(niche, seed, "nothing");
      let anyPlanProfitable = false;
      for (const plan of REAL) {
        const r = season(niche, seed, plan);
        if (r.prof > 0) { perPlan[plan]++; anyPlanProfitable = true; }
        if (r.bankrupt) bankrupt++;
        if (r.worth <= nothing.worth) beaten++;
      }
      if (anyPlanProfitable) allSeedsOk++;
    }
    for (const plan of REAL) if (perPlan[plan] === SEEDS.length) worksEverywhere.push(plan);
    const bad = (allSeedsOk < 8 || bankrupt || beaten) ? "  <--" : "";
    console.log(`${n.padEnd(12)} | ${allSeedsOk}/8 · ${worksEverywhere.length}/${REAL.length} (${worksEverywhere.join(",") || "none"}) · ${bankrupt} · ${beaten}${bad}`);
  }
  console.log("");
}
