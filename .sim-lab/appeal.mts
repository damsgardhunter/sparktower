import { readFileSync } from "node:fs";
import { buildWorld } from "@shared/simulation/season";
import { appealFor, regionalReach } from "@shared/simulation/market";
import { expectationsFor, topPriceCeiling } from "@shared/simulation/criteria";
import { ROLES } from "@shared/simulation/types";
for (const f of ["rotaread", "tallyhold"]) {
  const niche: any = JSON.parse(readFileSync(`.sim-lab/${f}.json`, "utf8"));
  const w = buildWorld({ seasonId: f, niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
  const me: any = w.companies.find((c: any) => c.id === "me");
  console.log(`\n=== ${f} === (my price $${me.price}, quality ${me.quality}, brand ${me.brand}, reach ${(regionalReach(me, niche) * 100).toFixed(0)}%)`);
  console.log(`market price ceiling $${Math.round(topPriceCeiling(niche.segments, 1))}`);
  for (const seg of niche.segments) {
    const e = expectationsFor(seg, 1);
    const weights = w.companies.map((c: any) => Math.pow(appealFor(c, seg, 1, topPriceCeiling(niche.segments, 1)), 2) * regionalReach(c, niche));
    const tot = weights.reduce((a: number, b: number) => a + b, 0);
    const mine = weights[w.companies.findIndex((c: any) => c.id === "me")] / tot;
    console.log(`  ${seg.name.slice(0, 22).padEnd(24)} floors ${e.floors.map((x: any) => `${x.axis}>=${x.atLeast}`).join(",") || "none"} · ceiling $${Math.round(e.priceCeiling)} · my share of the pool ${(mine * 100).toFixed(2)}%`);
  }
}
