import { startingCompany } from "@shared/simulation/season";
import { appealFor } from "@shared/simulation/market";
import { nicheById } from "@shared/simulation/niches";
import { ROLES } from "@shared/simulation/types";
const niche: any = nicheById("dating_apps")!;
const base: any = { ...startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] as any }), cash: 12_000_000, price: 22 };
const armed: any = { ...base, brand: Math.min(100, base.brand + 6), quality: Math.min(100, base.quality + 9) };
for (const seg of niche.segments) {
  const a = appealFor(base, seg, niche, { demand: 1, interestRate: 0.08, costIndex: 1, outlook: "steady" } as any);
  const b = appealFor(armed, seg, niche, { demand: 1, interestRate: 0.08, costIndex: 1, outlook: "steady" } as any);
  console.log(`${seg.name.padEnd(18)} plain ${a.toFixed(4)} · armed ${b.toFixed(4)} · ${b > a ? "better" : "WORSE"}`);
}
console.log("base brand/quality:", base.brand, base.quality, "-> armed:", armed.brand, armed.quality);
