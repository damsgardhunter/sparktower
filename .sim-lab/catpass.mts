import { NICHES } from "@shared/simulation/niches";
import { openShareFor } from "@shared/simulation/custom-market";
import { PLANS, season } from "./strategies.mts";
const SEEDS = ["a","d","h","m","q","t","w","y"];
const REAL = Object.keys(PLANS).filter((p) => p !== "nothing");
console.log("market            | open  | seeds with a profitable plan · bankruptcies · beaten-by-nothing");
for (const base of (NICHES as any[])) {
  for (const mode of ["as written", "the rule"]) {
    const open = mode === "the rule" ? openShareFor(base) : 0.1;
    const niche = { ...base, openShare: open };
    let ok = 0, broke = 0, beaten = 0;
    for (const seed of SEEDS) {
      const nothing = season(niche, seed, "nothing", true);
      let any = false;
      for (const p of REAL) { const r: any = season(niche, seed, p, true); if (r.prof > 0) any = true; if (r.bankrupt) broke++; if (r.worth <= nothing.worth) beaten++; }
      if (any) ok++;
    }
    console.log(`${base.id.padEnd(17)} | ${open.toFixed(3)} | ${ok}/8 · ${String(broke).padStart(2)} · ${String(beaten).padStart(2)}   ${mode}`);
  }
}
