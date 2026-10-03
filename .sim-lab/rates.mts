import { NICHES } from "@shared/simulation/niches";
import { season } from "./sweep.mts";
const niche: any = (NICHES as any[]).find((n) => n.id === "drone_delivery");
for (const seed of ["w","a","h"]) {
  const parts: string[] = [];
  for (const rate of [0, 0.02, 0.04, 0.06, 0.09, 0.12, 0.18, 0.25]) {
    const r = season(niche, seed, rate);
    parts.push(`${rate}: ${Math.round(r.worth).toLocaleString()}${r.bankrupt ? "*" : ""}`);
  }
  console.log(`seed ${seed}  ` + parts.join("  "));
}
