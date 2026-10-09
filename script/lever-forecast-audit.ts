/**
 * Which levers move the forecast, and which do not.
 *
 *   npx tsx script/lever-forecast-audit.ts [niche] [year]
 *
 * Every lever on every desk, moved one at a time against an ordinary plan, and
 * the projection the desk shows compared before and after. A lever that moves
 * nothing a seat can see is a decision the screen cannot explain — which is
 * the complaint this exists to answer: "every decision should directly change
 * something about the forecast."
 */
import { buildWorld, economyFor, decisionsForYear } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { projectYear, type Projection } from "@shared/simulation/projection";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type Role, type World } from "@shared/simulation/types";
import { LEVER_FIELDS } from "@shared/simulation/levers";
import { withOptions } from "@shared/simulation/lever-options";
import { foundersActions } from "@shared/simulation/actions";
import { dealsFor } from "@shared/simulation/world";
import { valuation } from "@shared/simulation/mergers";
import { candidatesFor } from "@shared/simulation/optimiser";

const niche = nicheById(process.argv[2] ?? "dating_apps")!;
const target = Number(process.argv[3] ?? 6);

let world: World = buildWorld({ seasonId: "audit", niche, teams: [{ id: "us", name: "Us", seats: [...ROLES] as Role[] }] });
const ordinary = (w: World) => {
  const c = w.companies.find((x) => x.id === "us")!;
  return {
    cmo: { price: c.price, brandSpend: 150_000 * (c.scale ?? 1), performanceSpend: 100_000 * (c.scale ?? 1), celebritySpend: 0, targetCities: c.cities },
    cto: { featureSpend: 100_000 * (c.scale ?? 1), reliabilitySpend: 80_000 * (c.scale ?? 1), techDebtPaydown: 20_000 * (c.scale ?? 1) },
    coo: { capacityTarget: Math.round(c.capacity * 1.2), supportSpend: 80_000 * (c.scale ?? 1), efficiencySpend: 50_000 * (c.scale ?? 1), headcount: 4 },
    cfo: { borrow: 0, repay: 0, cashBuffer: 0 },
    ceo: { focus: "growth" },
  } as Record<Role, any>;
};
for (let y = 1; y < target; y++) {
  const company = world.companies.find((c) => c.id === "us")!;
  const { decisions } = decisionsForYear({ company, niche, submitted: ordinary(world) });
  world = resolveYear({ ...world, year: y }, [{ ...decisions, companyId: "us" }], economyFor("audit", y), { withoutEvent: true }).world;
}
const year = target;
world = { ...world, year };
const company = world.companies.find((c) => c.id === "us")!;
const economy = economyFor("audit", year);
const base = ordinary(world);
const offers = dealsFor({ seasonId: "audit", year, company, niche, incumbents: world.companies.filter((c) => c.kind === "incumbent"), worth: valuation(company).fair });

const read = (p: Projection) => ({
  revenue: p.revenue, profit: p.profit, cash: p.cashEnd, customers: p.customers,
  brand: p.stats.brand.now, brandNext: p.stats.brand.coming, quality: p.stats.quality.now, qualityNext: p.stats.quality.coming,
  service: p.stats.service.now, reputation: p.stats.reputation.now,
  capacityNext: p.capacityNext, nextDemand: p.nextYearDemand?.likely ?? 0, credit: p.credit.score, founderShare: p.founderShare,
  nextRevenue: p.nextYear?.revenue ?? 0, nextProfit: p.nextYear?.profit ?? 0, nextCustomers: p.nextYear?.customers ?? 0,
  nextUnitCost: p.nextYear?.unitCost ?? 0, nextQuality: p.nextYear?.quality ?? 0, nextService: p.nextYear?.service ?? 0,
  loyalty: p.team.reduce((sum, t) => sum + t.loyaltyNext + (t.stretch === "aggressive" ? 1000 : t.stretch === "easy" ? -1000 : 0), 0),
});
/*
 * What has to be true before a lever can matter at all. A vote counts only on
 * something put to the table; repaying needs a debt; build-or-copy needs a
 * bet. Tested with the precondition in place, so "moves nothing" means the
 * lever really is unconnected rather than merely idle this year.
 */
const expandOpt = withOptions(LEVER_FIELDS.coo.find((f) => f.id === "expand")!, { company, niche, seasonId: "audit", year, solo: false, offers }).options?.[1]?.value;
const betOpt = withOptions(LEVER_FIELDS.cto.find((f) => f.id === "featureBet")!, { company, niche, seasonId: "audit", year, solo: false, offers }).options?.[1]?.value;
const scale = company.scale ?? 1;
type Ctx = { filed?: Partial<Record<Role, any>>; company?: Partial<typeof company>; previous?: boolean; extra?: unknown[] };
const voteAll = Object.fromEntries(offers.map((o) => [o.id, "vote"]));
const CONTEXT: Record<string, Ctx> = {
  dealVotes: { filed: { ceo: { deals: voteAll } } },
  expandVote: { filed: { coo: { expand: expandOpt } } },
  featureMode: { filed: { cto: { featureBet: betOpt } } },
  borrowTerm: { filed: { cfo: { borrow: 2_000_000 * scale } } },
  repay: { company: { debt: 1_000_000 * scale } },
  refinance: { company: { debt: 1_000_000 * scale } },
  factorPct: { filed: { cfo: { terms: "60" } } },
  holdBackSeat: { filed: { cfo: { holdBack: 20 } } },
  replaceBid: { filed: { ceo: { replaceSeat: "cmo" } } },
  overrule: { previous: true },
  cashBuffer: { company: { cash: 400_000 * scale, creditLimit: 0, debt: 0 }, extra: [300_000 * scale] },
  budget: { company: { cash: 400_000 * scale, creditLimit: 0, debt: 0 }, extra: [{ cmo: 5, cto: 5, coo: 5 }] },
  shockAnswer: { company: { shock: { kind: "outage", year: year - 1, reputation: 12, headline: "The app went down for a weekend" } } },
  rehire: { company: { seats: ["ceo", "cfo", "cto", "coo"] } },
  regionFocus: { company: { cities: niche.cities.map((c) => c.id) } },
  buyback: { company: { founderShare: 0.6 } as any },
};
const merge = (a: any, b: any) => { const out = { ...a }; for (const r of Object.keys(b ?? {})) out[r] = { ...(a[r] ?? {}), ...b[r] }; return out; };
const previousPlan = { companyId: "us", ...merge(base, { cmo: { brandSpend: base.cmo.brandSpend * 3 }, cto: { featureSpend: base.cto.featureSpend * 3 }, coo: { supportSpend: base.coo.supportSpend * 3 } }) };

const dead: string[] = [];
const moved: string[] = [];
for (const role of ROLES) {
  for (const raw of LEVER_FIELDS[role]) {
    const ctx = CONTEXT[raw.id] ?? {};
    const w = ctx.company ? { ...world, companies: world.companies.map((c) => c.id === "us" ? { ...c, ...ctx.company } : c) } : world;
    const startFiled = merge(base, ctx.filed);
    const prev = ctx.previous ? previousPlan as any : undefined;
    const before = read(projectYear({ world: w, companyId: "us", economy, filed: startFiled, previous: prev })!.filed);
    const field = raw.kind === "cities"
      ? { ...raw, options: niche.cities.map((c) => ({ value: c.id, label: c.name, help: "" })) }
      : raw.kind === "actions"
      ? { ...raw, options: foundersActions(niche).map((a) => ({ value: a.id, label: a.name, help: "" })) }
      : withOptions(raw, { company: w.companies.find((c) => c.id === "us")!, niche, seasonId: "audit", year, solo: false, offers, openedNiches: world.openedNiches });
    const tries = [...candidatesFor(field as any, w.companies.find((c) => c.id === "us")!, startFiled[role]), ...(ctx.extra ?? [])];
    if (!tries.length) { dead.push(`${role}.${raw.id}  (nothing to try this year)`); continue; }
    let best = "";
    for (const value of tries) {
      const filed = { ...startFiled, [role]: { ...startFiled[role], [raw.id]: value } };
      const after = read(projectYear({ world: w, companyId: "us", economy, filed, previous: prev })!.filed);
      const changed = Object.entries(after).filter(([k, v]) => Math.abs(v - (before as any)[k]) > 1e-6).map(([k]) => k);
      if (changed.length) { best = changed.join(","); break; }
    }
    (best ? moved : dead).push(`${role}.${raw.id}${best ? `  → ${best}` : ""}`);
  }
}
console.log(`${niche.name}, year ${year}`);
console.log(`\nMOVES THE FORECAST (${moved.length})\n  ` + moved.join("\n  "));
console.log(`\nMOVES NOTHING ON THE FORECAST (${dead.length})\n  ` + dead.join("\n  "));
