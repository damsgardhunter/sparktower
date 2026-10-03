import { readFileSync } from "node:fs";
import { openShareFor, pricedForABusiness } from "@shared/simulation/custom-market";
import { NICHES } from "@shared/simulation/niches";
import { marketScale } from "@shared/simulation/world";
import { atScale } from "@shared/simulation/market";
import { buildWorld } from "@shared/simulation/season";
import { ROLES } from "@shared/simulation/types";
import { PLANS, season } from "./strategies.mts";
const asToday = (raw: any) => {
  const openShare = typeof raw.openShare === "number" ? raw.openShare : openShareFor(raw);
  return { ...raw, openShare, segments: pricedForABusiness({ segments: raw.segments, cities: raw.cities, baseUnitCost: raw.baseUnitCost, openShare }) };
};
const CUSTOM = ["kilnshare","hedgerow","quorumcast","saltbox","rotaread"];
const ALL = [...(NICHES as any[]).slice(0, 3).map((n) => ({ id: n.id, niche: n })), ...CUSTOM.map((f) => ({ id: f, niche: asToday(JSON.parse(readFileSync(`.sim-lab/${f}.json`,"utf8"))) }))];
console.log("market         opening cash   a recall costs   as a share of the bank   recalls seen");
for (const { id, niche } of ALL) {
  let recalls = 0;
  for (const seed of ["a","h","w"]) for (const p of Object.keys(PLANS)) {
    const r: any = season(niche, seed, p, true);
    recalls += r.seen.filter((e: string) => /has a recall/.test(e)).length;
  }
  const w: any = buildWorld({ seasonId: "a", niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
  const cash = w.companies.find((c: any) => c.id === "me").cash;
  const me: any = w.companies.find((c: any) => c.id === "me");
  const hit = atScale(450_000, me.scale);
  console.log(`${id.padEnd(14)} ${Math.round(cash).toLocaleString().padStart(12)}   ${Math.round(hit).toLocaleString().padStart(14)}   ${(hit/cash).toFixed(2).padStart(22)}x   ${recalls}`);
}
