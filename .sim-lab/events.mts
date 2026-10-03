import { readFileSync } from "node:fs";
import { NICHES } from "@shared/simulation/niches";
import { openShareFor, pricedForABusiness } from "@shared/simulation/custom-market";
import { PLANS, season } from "./strategies.mts";
const asToday = (raw: any) => {
  const openShare = typeof raw.openShare === "number" ? raw.openShare : openShareFor(raw);
  return { ...raw, openShare, segments: pricedForABusiness({ segments: raw.segments, cities: raw.cities, baseUnitCost: raw.baseUnitCost, openShare }) };
};
const CUSTOM = ["cairnwait","loomlight","parishpay","scrapline","tideturn","hearthmap","hedgerow","pressfit","quorumcast","saltbox","ledgerloom","kilnshare","tallyhold","rotaread"];
const ALL = [...(NICHES as any[]).map((n) => ({ id: n.id, niche: n })), ...CUSTOM.map((f) => ({ id: f, niche: asToday(JSON.parse(readFileSync(`.sim-lab/${f}.json`,"utf8"))) }))];
const SEEDS = ["a","d","h","m","q","t","w","y"];
const REAL = Object.keys(PLANS).filter((p) => p !== "nothing");
console.log("market            | events OFF: seeds-ok/bankrupt/beaten | events ON: seeds-ok/bankrupt/beaten");
for (const { id, niche } of ALL) {
  const row: string[] = [];
  for (const withEvents of [false, true]) {
    let ok = 0, bankrupt = 0, beaten = 0;
    for (const seed of SEEDS) {
      const nothing = season(niche, seed, "nothing", withEvents);
      let any = false;
      for (const p of REAL) {
        const r = season(niche, seed, p, withEvents);
        if (r.prof > 0) any = true;
        if (r.bankrupt) bankrupt++;
        if (r.worth <= nothing.worth) beaten++;
      }
      if (any) ok++;
    }
    row.push(`${ok}/8 · ${String(bankrupt).padStart(2)} · ${String(beaten).padStart(2)}`);
  }
  const worse = row[0] !== row[1] ? "  <-- changed" : "";
  console.log(`${id.padEnd(17)} | ${row[0].padEnd(20)} | ${row[1]}${worse}`);
}
