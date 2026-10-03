import { readFileSync } from "node:fs";
import { openShareFor } from "@shared/simulation/custom-market";
import { play } from "./customviable.mts";
const NAMES = ["hedgerow","pressfit","quorumcast","saltbox","ledgerloom","kilnshare","tallyhold","rotaread"];
const SEEDS = ["a","d","h","m","q","t","w","y"];
const RATES = [0, 0.005, 0.01, 0.03, 0.06, 0.12];
console.log("market        openShare | seeds winnable (customers>0) · profitable · bankrupt · beaten-by-nothing");
for (const n of NAMES) {
  const raw: any = JSON.parse(readFileSync(`.sim-lab/${n}.json`, "utf8"));
  for (const label of ["a tenth", "the rule"]) {
    const open = label === "the rule" ? openShareFor(raw) : 0.1;
    const niche = { ...raw, openShare: open };
    let winnable = 0, profitable = 0, broke = 0, beaten = 0;
    for (const seed of SEEDS) {
      const nothing = play(niche, seed, 0);
      let anyProfit = 0, best: any = null;
      for (const rate of RATES) { const r = play(niche, seed, rate); anyProfit = Math.max(anyProfit, r.prof); if (!best || r.worth > best.worth) best = r; }
      if (best.cust > 0) winnable++;
      if (anyProfit > 0) profitable++;
      if (best.bankrupt) broke++;
      if (best.worth <= nothing.worth) beaten++;
    }
    const bad = (winnable < 8 || profitable === 0 || broke > 0 || beaten > 0) ? "  <-- " : "";
    console.log(`${n.padEnd(12)} ${label === "the rule" ? open.toFixed(3) : "0.100"} ${label.padEnd(9)} ${winnable}/8 · ${profitable}/8 · ${broke}/8 · ${beaten}/8${bad}`);
  }
}
