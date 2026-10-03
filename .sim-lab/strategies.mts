import { readFileSync } from "node:fs";
import { buildWorld, economyFor } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { ROLES, type TeamDecisions, type World } from "@shared/simulation/types";
const held = (c: any) => Object.values(c?.customers ?? {}).reduce((s: number,n: any)=>s+Number(n||0),0);
/* Room for what is served plus a margin — grown freely, cut by at most a fifth a period. */
const room = (me: any, k: number) => {
  const want = Math.round(Math.max(held(me), 1) * k);
  const now = Math.max(0, Number(me.capacity) || 0);
  return Math.max(want > now ? want : Math.max(want, Math.round(now * 0.8)), 1);
};

/** Five ways a person might actually play, plus filing nothing. */
export const PLANS: Record<string, (p: number, me: any, niche: any, k?: number) => any> = {
  nothing: () => ({}),
  lean: (p, me, k = 1) => { const b = me.cash * 0.01 * k; return {
    ceo:{focus:"quality"}, cmo:{brandSpend:Math.round(b*0.4),performanceSpend:Math.round(b*0.2)},
    cto:{featureSpend:Math.round(b*0.4)}, coo:{capacityTarget:room(me,1.5)} }; },
  grower: (p, me, k = 1) => { const b = me.cash * 0.06 * k; return {
    ceo:{focus:p<=6?"quality":"growth"}, cmo:{brandSpend:Math.round(b*0.35),performanceSpend:Math.round(b*0.25)},
    cto:{featureSpend:Math.round(b*0.2),reliabilitySpend:Math.round(b*0.1)},
    coo:{capacityTarget:room(me,2),supportSpend:Math.round(b*0.1)} }; },
  /*
   * Premium, expressed with the instrument the game provides for it.
   *
   * It used to set one list price at nine tenths of the dearest segment's
   * reference, which in a market whose segments span fifteen times — building
   * at 900, 3,800 and 14,000 — is a price of 12,600 charged to everybody, and
   * it priced out all but a rounding error of the market. That is not a premium
   * strategy, it is a mistake, and it measured at 1% of the best play in
   * construction and 6% in drone delivery.
   *
   * A premium player prices each segment near what that segment will pay, leans
   * on the dear end, and declares themselves for it. Tiers are what the engine
   * has for exactly this.
   */
  premium: (p, me, niche, k = 1) => {
    const b = me.cash * 0.05 * k;
    const dear = [...niche.segments].sort((a: any, x: any) => x.referencePrice - a.referencePrice)[0];
    return {
      ceo: { focus: "quality", positioning: dear.id },
      cmo: {
        tiers: Object.fromEntries(niche.segments.map((sg: any) => [sg.id, Math.round(sg.referencePrice * 1.1)])),
        brandSpend: Math.round(b * 0.3),
      },
      cto: { featureSpend: Math.round(b * 0.4), reliabilitySpend: Math.round(b * 0.2) },
      coo: { capacityTarget: room(me, 1.6), supportSpend: Math.round(b * 0.1) },
    };
  },
  /*
   * Cost leadership, with the same correction as premium.
   *
   * It used to set one list price at four fifths of the *cheapest* segment's
   * reference — which in construction means charging the client who would have
   * paid 14,000 a price of 720, and throwing away almost all of what the market
   * is worth. It measured at 8% of the best play there. Undercutting means
   * being cheaper than the alternatives in each segment, not selling everything
   * at the price of the cheapest thing.
   */
  cheap: (p, me, niche, k = 1) => {
    const b = me.cash * 0.05 * k;
    return {
      ceo: { focus: "growth" },
      cmo: {
        tiers: Object.fromEntries(niche.segments.map((sg: any) => [sg.id, Math.max(1, Math.round(sg.referencePrice * 0.82))])),
        performanceSpend: Math.round(b * 0.5),
      },
      cto: { featureSpend: Math.round(b * 0.2) },
      coo: { capacityTarget: room(me, 2.5), efficiencySpend: Math.round(b * 0.3) },
    };
  },
  /* Spends out of what the business earns, not out of the bank it was handed. */
  sensible: (p, me, _n, k = 1) => { const b = Math.max(me.cash * 0.004, (me.lastRevenue ?? 0) * 0.45) * k; return {
    ceo:{focus:p<=6?"quality":"growth"}, cmo:{brandSpend:Math.round(b*0.3),performanceSpend:Math.round(b*0.2)},
    cto:{featureSpend:Math.round(b*0.25),reliabilitySpend:Math.round(b*0.15)},
    coo:{capacityTarget:room(me,1.8),supportSpend:Math.round(b*0.1)} }; },
  /* Prices each segment at what it expects, which is what tiers are for. */
  tiered: (p, me, niche, k = 1) => { const b = me.cash * 0.05 * k; return {
    ceo:{focus:p<=6?"quality":"growth"},
    cmo:{tiers:Object.fromEntries(niche.segments.map((s: any)=>[s.id, Math.round(s.referencePrice)])),brandSpend:Math.round(b*0.3),performanceSpend:Math.round(b*0.2)},
    cto:{featureSpend:Math.round(b*0.25),reliabilitySpend:Math.round(b*0.15)},
    coo:{capacityTarget:room(me,1.8),supportSpend:Math.round(b*0.1)} }; },
  /* The grower, but it never gives up plant — to isolate what empty room is worth. */
  growerBigPlant: (p, me, k = 1) => { const b = me.cash * 0.06 * k; return {
    ceo:{focus:p<=6?"quality":"growth"}, cmo:{brandSpend:Math.round(b*0.35),performanceSpend:Math.round(b*0.25)},
    cto:{featureSpend:Math.round(b*0.2),reliabilitySpend:Math.round(b*0.1)},
    coo:{capacityTarget:Math.max(Number(me.capacity)||0,Math.round(held(me)*2)),supportSpend:Math.round(b*0.1)} }; },
  product: (p, me, k = 1) => { const b = me.cash * 0.05 * k; return {
    ceo:{focus:"quality"}, cmo:{brandSpend:Math.round(b*0.15)},
    cto:{featureSpend:Math.round(b*0.45),reliabilitySpend:Math.round(b*0.25),researchSpend:Math.round(b*0.15)},
    coo:{capacityTarget:room(me,1.8)} }; },
};

export function season(niche: any, seed: string, plan: string, withEvents = false, k = 1) {
  let world: World = buildWorld({ seasonId: seed, niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
  let previous: any; let last: any; let prof = 0; const seen: string[] = [];
  for (let p = 1; p <= 16; p++) {
    const me: any = world.companies.find((c: any) => c.id === "me")!;
    (me as any).lastRevenue = last?.revenue ?? 0;
    const want: any = PLANS[plan](p, me, niche, k);
    const filed: any = { companyId: "me" };
    for (const r of ROLES) filed[r] = { ...defaultDraft(r, me, previous?.[r]), ...(want[r] ?? {}) };
    const out = resolveYear({ ...world, year: p }, [filed as TeamDecisions], economyFor(seed, p, 4), withEvents ? {} : { withoutEvent: true });
    last = out.reports.find((x: any)=>x.companyId==="me");
    if (last.profit > 0) prof++;
    if ((out as any).event) seen.push(String((out as any).event.headline ?? (out as any).event.id ?? "?"));
    previous = filed; world = out.world;
  }
  const fin: any = world.companies.find((c: any) => c.id === "me");
  return { seen, prof, cash: last.cash ?? 0, debt: fin?.debt ?? 0, profit: last.profit ?? 0, revenue: last.revenue ?? 0, periods: 16, cust: held(world.companies.find((c: any)=>c.id==="me")), worth: last.value ?? 0, bankrupt: !!last.bankrupt };
}
