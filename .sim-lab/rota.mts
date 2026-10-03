import { readFileSync } from "node:fs";
import { play } from "./customviable.mts";
const raw: any = JSON.parse(readFileSync(".sim-lab/rotaread.json","utf8"));
for (const open of [0.1, 0.2, 0.3]) {
  const niche = { ...raw, openShare: open };
  const out: string[] = [];
  for (const seed of ["a","d","h","m","q","t","w","y"]) {
    let best: any = null, prof = 0;
    for (const rate of [0,0.005,0.01,0.03,0.06,0.12]) { const r = play(niche, seed, rate); prof = Math.max(prof, r.prof); if (!best || r.worth > best.worth) best = r; }
    const nothing = play(niche, seed, 0);
    out.push(`${seed}:${best.cust}c/${prof}p${best.worth <= nothing.worth ? "!" : ""}`);
  }
  console.log(`openShare ${open.toFixed(2)}  ` + out.join("  "));
}
