import { buildCustomMarket } from "../shared/simulation/custom-market";
import { buildWorld } from "../shared/simulation/season";

const SPEC = {
  name: "Saddleback mobile bike repair",
  premise:
    "A van, a toolkit and one mechanic, fixing bicycles on people's driveways in a mid-sized English town. "
    + "The shops in town are busy and make you bring the bike to them; this comes to you.",
  segments: [
    {
      id: "commuters", name: "Commuters", description: "Ride to work most days, notice a problem on a Tuesday and want it gone by Thursday.",
      size: 9_000, growth: 0.04, priceSensitivity: 0.65, qualityFocus: 0.45, brandFocus: 0.25, serviceFocus: 0.8, loyalty: 0.55, referencePrice: 48,
    },
    {
      id: "enthusiasts", name: "Weekend enthusiasts", description: "Expensive bikes, strong opinions, and they will pay to have it done properly.",
      size: 2_600, growth: 0.07, priceSensitivity: 0.3, qualityFocus: 0.85, brandFocus: 0.45, serviceFocus: 0.6, loyalty: 0.7, referencePrice: 140,
    },
    {
      id: "families", name: "Families", description: "Four bikes in a shed, all of them flat, once a year before the summer holiday.",
      size: 7_400, growth: 0.03, priceSensitivity: 0.8, qualityFocus: 0.35, brandFocus: 0.2, serviceFocus: 0.5, loyalty: 0.25, referencePrice: 35,
    },
  ],
  regions: [
    { id: "town", name: "The town", weight: 0.45, entryCost: 1_200, note: "Where the van already is. Twenty minutes between jobs." },
    { id: "villages", name: "The villages", weight: 0.3, entryCost: 4_000, note: "Better bikes, more driving, fewer jobs a day." },
    { id: "city", name: "The city, forty minutes off", weight: 0.25, entryCost: 15_000, note: "Three shops already there and a fourth opening." },
  ],
  incumbents: [
    { id: "highstreet", name: "The High Street shop", posture: "coaster", startingShare: 0.52, quality: 58, brand: 72, service: 40, priceIndex: 1.15 },
    { id: "chain", name: "A national chain's service desk", posture: "shark", startingShare: 0.3, quality: 42, brand: 80, service: 28, priceIndex: 0.85 },
  ],
  /* Parts, consumables and the diesel to get there. The real marginal cost of one job. */
  baseUnitCost: 14,
  innovationPace: 0.5,
  voice: { customer: "rider", customers: "riders", unit: "repair", capacity: "jobs a month" },
  workforce: [
    /* One mechanic does about four jobs a day, five days a week: ~1,000 a year. */
    { id: "mechanics", name: "mechanics", one: "a mechanic", does: "room", pay: 0.85, share: 0.8, serves: 1_000 },
    { id: "office", name: "a bookings person", one: "a bookings assistant", does: "service", pay: 0.6, share: 0.2 },
  ],
};


const niche = buildCustomMarket(SPEC, "saddleback", { fresh: true })!;
for (const progress of [0.05, 0.3, 0.6, 0.9]) {
  const w = buildWorld({
    seasonId: "probe", niche,
    teams: [{ id: "us", name: "S", seats: ["ceo"], officers: 1, standing: { progress, people: 1 } }],
    opening: "actual", cadence: "monthly",
  });
  const us = w.companies.find((c) => c.id === "us")!;
  console.log(`progress ${progress}  cash £${Math.round(us.cash ?? 0).toLocaleString()}  credit line £${Math.round(us.creditLimit ?? 0).toLocaleString()}  capacity ${us.capacity}  riders ${Object.values(us.customers ?? {}).reduce((a: number, b: any) => a + Number(b), 0)}`);
}
const funded = buildWorld({ seasonId: "probe", niche, teams: [{ id: "us", name: "S", seats: ["ceo"], officers: 1 }], cadence: "monthly" });
const f = funded.companies.find((c) => c.id === "us")!;
console.log(`competitive       cash £${Math.round(f.cash ?? 0).toLocaleString()}  credit line £${Math.round(f.creditLimit ?? 0).toLocaleString()}  capacity ${f.capacity}`);
