import { readFileSync } from "node:fs";
import { buildCustomMarket } from "@shared/simulation/custom-market";
const raw: any = JSON.parse(readFileSync(".sim-lab/kilnshare.raw.txt","utf8").replace(/^[^{]*/, "").replace(/[^}]*$/, ""));
const once: any = buildCustomMarket(raw, "kiln");
if (!once) { console.log("first build refused"); process.exit(0); }
const twice: any = buildCustomMarket(once, "kiln");
const thrice: any = twice ? buildCustomMarket(twice, "kiln") : null;
const show = (n: any, label: string) => n
  ? console.log(`${label.padEnd(12)} prices ${n.segments.map((s: any)=>s.referencePrice).join("/")} · regions ${n.cities.length} · openShare ${n.openShare?.toFixed(3)} · sizes ${n.segments.map((s: any)=>s.size).join("/")}`)
  : console.log(`${label.padEnd(12)} REFUSED`);
show(once, "built once"); show(twice, "re-cleaned"); show(thrice, "again");
