import { readFileSync } from "node:fs";
import { buildWorld } from "@shared/simulation/season";
import { allocate, appealFor, regionalReach, regionalFit } from "@shared/simulation/market";
import { topPriceCeiling } from "@shared/simulation/criteria";
import { ROLES } from "@shared/simulation/types";
const niche: any = JSON.parse(readFileSync(".sim-lab/rotaread.json", "utf8"));
for (const seed of ["w", "h"]) {
  const world = buildWorld({ seasonId: seed, niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
  const me: any = world.companies.find((c: any) => c.id === "me");
  const out = allocate(world.companies as any, niche, 1, world.economy as any, 4);
  console.log(`\nseed ${seed} (demand ${(world.economy as any).demand})`);
  for (const seg of niche.segments) {
    const heldStart = world.companies.reduce((s: number, c: any) => s + (c.customers?.[seg.id] ?? 0), 0);
    const mineAfter = out.held.me?.[seg.id] ?? 0;
    const within = seg.size * regionalReach(me, niche) * regionalFit(me, niche, seg.id);
    console.log(`  ${seg.name.slice(0, 20).padEnd(22)} size ${String(seg.size).padStart(6)} · rivals hold ${String(Math.round(heldStart)).padStart(6)} (${((heldStart / seg.size) * 100).toFixed(0)}%) · my ceiling ${Math.round(within)} · I won ${mineAfter.toFixed(2)}`);
  }
}
