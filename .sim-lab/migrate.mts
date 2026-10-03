import { readFileSync } from "node:fs";
import { buildCustomMarket } from "@shared/simulation/custom-market";
console.log("a season stored before the rules existed, re-read today:");
for (const n of ["kilnshare","saltbox","quorumcast","rotaread","tallyhold"]) {
  const stored: any = JSON.parse(readFileSync(`.sim-lab/${n}.json`,"utf8"));
  const reread: any = buildCustomMarket(stored, n);
  if (!reread) { console.log(`${n.padEnd(11)} REFUSED on re-read`); continue; }
  const before = stored.segments.map((s: any)=>s.referencePrice).join("/");
  const after = reread.segments.map((s: any)=>s.referencePrice).join("/");
  const lift = reread.segments[0].referencePrice / stored.segments[0].referencePrice;
  console.log(`${n.padEnd(11)} prices ${before.padEnd(22)} -> ${after.padEnd(22)} (x${lift.toFixed(1)}) · openShare ${(stored.openShare ?? 0.1).toFixed(2)} -> ${(reread.openShare ?? 0.1).toFixed(2)}`);
}
