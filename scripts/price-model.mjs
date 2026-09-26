/**
 * What a builder actually consumes, and therefore what a plan can cost.
 *
 * Pricing arguments go in circles because both sides are guessing at the same
 * missing number: how many credits does using this product properly actually
 * take? That is answerable from `CREDIT_COSTS` and an honest account of what
 * somebody does in a month, which is what this is.
 *
 * Three builders, none of them invented to flatter a price: one dipping in,
 * one using it the way the product is meant to be used, and one leaning on it
 * hard. The middle one is the one to price against — the light user subsidises
 * nobody and the heavy one is who you get if the plan is good.
 *
 *   npx tsx scripts/price-model.mjs
 */
import { CREDIT_COSTS, COST_PER_CREDIT_USD, netOf, creditsAtMargin } from "../shared/plans.ts";

const C = CREDIT_COSTS;

/** One month of use, as a list of [what, how many times]. */
const JOURNEYS = {
  "Dipping in": [
    ["Nova chat", C.novaChat, 20],
    ["Coaching replies", C.novaGuide, 8],
    ["Task generation", C.taskGeneration, 6],
    ["Health check", C.healthCheck, 1],
    ["Progress summary", C.progressSummary, 2],
  ],
  "Building properly": [
    ["Nova chat", C.novaChat, 60],
    ["Coaching replies", C.novaGuide, 25],
    ["Task generation", C.taskGeneration, 20],
    ["Task planning", C.taskAssist, 4],
    ["Surface assists", C.novaAssist, 8],
    ["Roadmap updates", C.roadmapUpdate, 3],
    ["Health checks", C.healthCheck, 4],
    ["Next actions", C.nextActions, 4],
    ["Progress summaries", C.progressSummary, 4],
    ["A document, planned and filled", C.documentPlan + C.documentFillMin * 2, 1],
    ["Loop audit", C.loopAudit, 1],
    ["Codebase audit", C.codeAudit, 1],
  ],
  "Leaning on it": [
    ["Nova chat", C.novaChat, 150],
    ["Coaching replies", C.novaGuide, 60],
    ["Task generation", C.taskGeneration, 40],
    ["Task planning", C.taskAssist, 10],
    ["Surface assists", C.novaAssist, 20],
    ["Roadmap rebuild", C.roadmapRebuildMin, 1],
    ["Roadmap updates", C.roadmapUpdate, 6],
    ["Health checks + fixes", C.healthCheck + C.healthFix, 8],
    ["Next actions", C.nextActions, 8],
    ["Documents", C.documentPlan + C.documentFillMax, 2],
    ["Loop audits", C.loopAudit, 3],
    ["Codebase audits", C.codeAudit, 4],
    ["Pitch deck + readiness + critique", C.pitchDeckOutline + C.investorReadinessScore + C.pitchCritique, 1],
    ["Pricing analysis", C.pricingAnalysis, 1],
  ],
};

const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(n).toFixed(2);

console.log(`\nA credit costs ${money(COST_PER_CREDIT_USD)} to serve.\n`);
console.log("One month of use            credits     cost to serve");
const usage = {};
for (const [name, rows] of Object.entries(JOURNEYS)) {
  const credits = rows.reduce((sum, [, each, times]) => sum + each * times, 0);
  usage[name] = credits;
  console.log(name.padEnd(28) + String(credits).padEnd(12) + money(credits * COST_PER_CREDIT_USD));
}

/*
 * What each price earns against each of them. The allowance is set at the
 * price's 70%-margin figure, so these are the margins on a plan sized
 * honestly rather than on today's allowances.
 */
console.log("\n\nMonthly profit per customer, by price, if the allowance is sized to that price\n");
const prices = [15, 20, 25, 30, 39, 49];
console.log("price   allowance   " + Object.keys(JOURNEYS).map((k) => k.padEnd(20)).join(""));
for (const p of prices) {
  const allowance = creditsAtMargin(p, 0.7);
  const net = netOf(p);
  const cells = Object.entries(usage).map(([, credits]) => {
    // Nobody spends past the allowance: the ceiling is what makes this true.
    const served = Math.min(credits, allowance);
    const profit = net - served * COST_PER_CREDIT_USD;
    const capped = credits > allowance ? " (capped)" : "";
    return (money(profit) + capped).padEnd(20);
  });
  console.log(("$" + p).padEnd(8) + String(allowance).padEnd(12) + cells.join(""));
}

/*
 * The ladder this suggests. Each tier is sized so the builder it is aimed at
 * is never capped — capping the customer a tier exists to serve is how a
 * plan loses the people it most wants to keep — and the worst case, where
 * every customer spends the whole allowance, still clears two thirds margin.
 */
const LADDER = [
  { name: "Starter",  price: 19, credits: 150, serves: "Dipping in" },
  { name: "Builder",  price: 39, credits: 300, serves: "Building properly" },
  { name: "Business", price: 89, credits: 700, serves: "Leaning on it" },
];

console.log("\n\nA ladder sized so nobody is capped doing what their tier is for\n");
console.log("tier       price  credits  its user uses  COGS     profit   margin  headroom");
for (const t of LADDER) {
  const used = usage[t.serves];
  const cogs = used * COST_PER_CREDIT_USD, net = netOf(t.price), profit = net - cogs;
  console.log(t.name.padEnd(11) + ("$" + t.price).padEnd(7) + String(t.credits).padEnd(9)
    + String(used).padEnd(15) + money(cogs).padEnd(9) + money(profit).padEnd(9)
    + ((profit / net) * 100).toFixed(0).padStart(3) + "%"
    + ("  " + Math.round((t.credits / used - 1) * 100) + "%").padStart(10));
}

console.log("\nAnd the worst case, where every customer spends the lot:\n");
console.log("tier       price  allowance  COGS at cap  profit   margin");
for (const t of LADDER) {
  const cogs = t.credits * COST_PER_CREDIT_USD, net = netOf(t.price), profit = net - cogs;
  console.log(t.name.padEnd(11) + ("$" + t.price).padEnd(7) + String(t.credits).padEnd(11)
    + money(cogs).padEnd(13) + money(profit).padEnd(9) + ((profit / net) * 100).toFixed(0) + "%");
}

console.log("\n\nA one-time payment, for completeness — how long before it is underwater\n");
for (const [who, credits] of Object.entries(usage)) {
  const perMonth = credits * COST_PER_CREDIT_USD;
  console.log("  " + who.padEnd(22) + (30 / perMonth).toFixed(1) + " months at $30, then "
    + money(perMonth) + " a month of pure loss, for ever");
}

console.log("\n\nWhat it takes to serve 'Building properly' at all, by price\n");
const proper = usage["Building properly"];
console.log(`That builder uses ${proper} credits a month — ${money(proper * COST_PER_CREDIT_USD)} of model spend.\n`);
console.log("price   net revenue   profit if uncapped   margin");
for (const p of prices) {
  const net = netOf(p);
  const profit = net - proper * COST_PER_CREDIT_USD;
  console.log(("$" + p).padEnd(8) + money(net).padEnd(14) + money(profit).padEnd(21)
    + (net > 0 ? ((profit / net) * 100).toFixed(0) + "%" : "—"));
}
