import { atStanding, positionFor } from "@shared/simulation/opening";
import { startingCompany } from "@shared/simulation/season";
import { nicheById } from "@shared/simulation/niches";
import { ROLES } from "@shared/simulation/types";
const niche: any = nicheById("dating_apps")!;
const funded: any = startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] as any });
console.log(`funded          cash ${Math.round(funded.cash).toLocaleString().padStart(10)} credit ${Math.round(funded.creditLimit).toLocaleString().padStart(10)} score ${funded.creditScore ?? "-"} brand ${funded.brand} cust ${Object.values(funded.customers ?? {}).reduce((a: number,b: any)=>a+b,0)}`);
for (const progress of [0.05, 0.3, 0.6, 0.95]) {
  const at: any = atStanding(funded, { progress } as any, niche);
  const cust = Object.values(at.customers ?? {}).reduce((a: number, b: any) => a + Number(b||0), 0);
  const p = positionFor({ progress } as any);
  console.log(`progress ${progress.toFixed(2)}  cash ${Math.round(at.cash).toLocaleString().padStart(10)} credit ${Math.round(at.creditLimit).toLocaleString().padStart(10)} score ${at.creditScore} brand ${at.brand} cust ${Math.round(cust)}  "${p.label}"`);
}
