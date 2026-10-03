import { readFileSync } from "node:fs";
import { NICHES } from "@shared/simulation/niches";
import { openShareFor, pricedForABusiness } from "@shared/simulation/custom-market";
import { PLANS, season } from "./strategies.mts";
const asToday = (raw: any) => {
  const openShare = typeof raw.openShare === "number" ? raw.openShare : openShareFor(raw);
  return { ...raw, openShare, segments: pricedForABusiness({ segments: raw.segments, cities: raw.cities, baseUnitCost: raw.baseUnitCost, openShare }) };
};
const CUSTOM = ["cairnwait","quorumcast","kilnshare","rotaread","tideturn","saltbox","hedgerow","parishpay"];
const ALL = [...(NICHES as any[]).map((n) => ({ id: n.id, niche: n })),
  ...CUSTOM.map((f) => ({ id: f, niche: asToday(JSON.parse(readFileSync(`.sim-lab/${f}.json`,"utf8"))) }))];
const SEEDS = ["a","d","h","m","q","t","w","y"];
/* Each archetype free to pick how hard it spends: an archetype, not one rate. */
const SCALES = [0.25, 0.5, 1, 2, 4];
const ARCH = Object.keys(PLANS).filter((p) => p !== "nothing" && p !== "growerBigPlant");
const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return (s[3] + s[4]) / 2; };

console.log("market".padEnd(17) + ARCH.map((a) => a.slice(0, 6).padEnd(8)).join("") + " | weakest as a share of the best");
const trouble: string[] = [];
for (const { id, niche } of ALL) {
  const best: Record<string, number> = {};
  for (const a of ARCH) {
    /* An archetype's result is its best spend level, median over the seeds. */
    best[a] = Math.max(...SCALES.map((k) => med(SEEDS.map((s) => (season(niche, s, a, true, k) as any).worth))));
  }
  const top = Math.max(...Object.values(best));
  const share = (a: string) => best[a] / Math.max(1, top);
  const weakest = ARCH.reduce((w, a) => (share(a) < share(w) ? a : w), ARCH[0]);
  const cells = ARCH.map((a) => `${(share(a) * 100).toFixed(0)}%`.padEnd(8)).join("");
  if (share(weakest) < 0.4) trouble.push(`${id}: ${weakest} at ${(share(weakest) * 100).toFixed(0)}%`);
  console.log(`${id.padEnd(17)}${cells} | ${weakest} ${(share(weakest) * 100).toFixed(0)}%`);
}
console.log("\nmarkets where some way of playing has no real route (under 40% of the best):");
console.log(trouble.length ? trouble.map((t) => "  " + t).join("\n") : "  none");
