import { NICHES } from "@shared/simulation/niches";
import { marketScale, marketPotential } from "@shared/simulation/world";
console.log("market              customers    potential/yr   marketScale  home weight  reach(open x home)");
for (const niche of NICHES as any[]) {
  const people = niche.segments.reduce((s: number, x: any) => s + x.size, 0);
  const pot = marketPotential(niche);
  const topCity = [...niche.cities].sort((a: any, b: any) => b.weight - a.weight)[0];
  console.log(`${niche.id.padEnd(18)} ${people.toLocaleString().padStart(10)} ${Math.round(pot).toLocaleString().padStart(15)} ${marketScale(niche).toFixed(3).padStart(12)} ${String(topCity.weight).padStart(12)} ${Math.round(people*0.1*topCity.weight).toLocaleString().padStart(18)}`);
}
