import { readFileSync } from "node:fs";
import { startingCompany } from "@shared/simulation/season";
import { marketScale } from "@shared/simulation/world";
import { expectationsFor } from "@shared/simulation/criteria";
import { ROLES } from "@shared/simulation/types";
const niche: any = JSON.parse(readFileSync(".sim-lab/rotaread.json", "utf8"));
const me: any = startingCompany({ id: "me", name: "M", niche, seats: [...ROLES], officers: 1 });
console.log(`scale ${marketScale(niche).toFixed(4)} · cash $${Math.round(me.cash).toLocaleString()} · room ${Math.round(me.capacity)} · price $${me.price} · quality ${me.quality} · home ${me.cities[0]}`);
for (const s of niche.segments) {
  const e = expectationsFor(s, 1);
  console.log(`  ${s.name.slice(0, 24).padEnd(26)} expects quality >= ${Math.round(e.quality)} · service >= ${Math.round(e.service)} · price ceiling $${Math.round(e.priceCeiling)}`);
}
