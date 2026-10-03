import { seedIncumbents } from "@shared/simulation/incumbents";
import { NICHES } from "@shared/simulation/niches";
for (const niche of NICHES as any[]) {
  const written = niche.incumbents.reduce((s: number, i: any) => s + i.startingShare, 0);
  const seeded = seedIncumbents(niche, "crowd", 1);
  const people = niche.segments.reduce((s: number, x: any) => s + x.size, 0);
  const held = seeded.reduce((s: number, c: any) => s + Object.values(c.customers).reduce((a: number, n: any) => a + n, 0), 0);
  const per = niche.segments.map((seg: any) => {
    const h = seeded.reduce((s: number, c: any) => s + (c.customers[seg.id] ?? 0), 0) / seg.size;
    return (h * 100).toFixed(0);
  }).join("/");
  console.log(`${niche.id.padEnd(18)} written ${(written*100).toFixed(0)}% · realised overall ${((held/people)*100).toFixed(1)}% · per segment ${per}`);
}
