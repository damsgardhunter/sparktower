import { readFileSync } from "node:fs";
import { buildWorld } from "@shared/simulation/season";
import { NICHES } from "@shared/simulation/niches";
import { ROLES } from "@shared/simulation/types";

const customs = ["rotaread", "kilnshare", "tallyhold"].map((n) => JSON.parse(readFileSync(`.sim-lab/${n}.json`, "utf8")));
const all: any[] = [...NICHES, ...customs];
const seeds = ["a","h","m","q","w","y","grow","crowd"];
console.log("niche".padEnd(22), "written", " realised per-segment (min..max over seeds)");
for (const niche of all) {
  const written = niche.incumbents.reduce((s: number, i: any) => s + i.startingShare, 0);
  let lo = 9, hi = 0, bo = 0;
  for (const seed of seeds) {
    const world = buildWorld({ seasonId: seed, niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
    for (const seg of niche.segments) {
      const inc = world.companies.filter((c: any) => c.kind === "incumbent").reduce((s: number, c: any) => s + (c.customers?.[seg.id] ?? 0), 0) / seg.size;
      const bots = world.companies.filter((c: any) => c.kind !== "incumbent").reduce((s: number, c: any) => s + (c.customers?.[seg.id] ?? 0), 0) / seg.size;
      lo = Math.min(lo, inc); hi = Math.max(hi, inc); bo = Math.max(bo, bots);
    }
  }
  const flag = (hi + bo) > 0.90 ? "  <-- over 90% of a segment" : "";
  console.log(niche.id.padEnd(22), (written * 100).toFixed(0).padStart(5) + "%", ` ${(lo*100).toFixed(0)}%..${(hi*100).toFixed(0)}%${flag}`);
}
