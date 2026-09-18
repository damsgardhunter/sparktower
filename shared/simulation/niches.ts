/**
 * The markets a team can enter.
 *
 * Each one is a different shape of problem rather than a different noun: the
 * incumbents' postures, how loyal the segments are and how fast quality moves
 * decide what winning looks like. A niche where everybody is loyal and quality
 * moves slowly is a grinding brand war; one with a flighty segment and a fast
 * pace can be cracked in three years by a team that reads it.
 */
import type { Niche } from "./types";

export const NICHES: Niche[] = [
  {
    id: "fitness_app",
    name: "Fitness apps",
    premise: "Subscription training apps. Cheap to copy, hard to keep — people quit in January and again in March.",
    baseUnitCost: 4,
    innovationPace: 1.25,
    segments: [
      { id: "resolvers", name: "New year resolvers", description: "Arrive in a rush, leave quietly. Cheap to win, impossible to hold — they will try anything that looks like a deal, including yours.", size: 8_400_000, growth: 0.04, priceSensitivity: 0.9, qualityFocus: 0.25, brandFocus: 0.28, serviceFocus: 0.2, loyalty: 0.18, referencePrice: 12 },
      { id: "committed", name: "Committed amateurs", description: "Train four days a week and will pay for something that works.", size: 5_200_000, growth: 0.07, priceSensitivity: 0.35, qualityFocus: 0.8, brandFocus: 0.35, serviceFocus: 0.5, loyalty: 0.72, referencePrice: 22 },
      { id: "coached", name: "Coached athletes", description: "Want a person behind the product. Expensive to serve, nearly impossible to poach.", size: 1_800_000, growth: 0.09, priceSensitivity: 0.2, qualityFocus: 0.7, brandFocus: 0.25, serviceFocus: 0.9, loyalty: 0.86, referencePrice: 55 },
    ],
    incumbents: [
      { id: "inc_peak", name: "PeakForm", posture: "fortress", startingShare: 0.34, quality: 72, brand: 80, service: 68, priceIndex: 1.15 },
      { id: "inc_rep", name: "RepCount", posture: "brawler", startingShare: 0.26, quality: 58, brand: 66, service: 45, priceIndex: 0.82 },
      { id: "inc_still", name: "Stillwater", posture: "coaster", startingShare: 0.18, quality: 49, brand: 71, service: 40, priceIndex: 1.0 },
      { id: "inc_kin", name: "Kinetic Labs", posture: "innovator", startingShare: 0.12, quality: 81, brand: 54, service: 61, priceIndex: 1.28 },
    ],
  },
  {
    id: "field_software",
    name: "Field service software",
    premise: "Software for people who work in vans. Bought slowly, kept for years, and switching costs a week of chaos.",
    baseUnitCost: 38,
    innovationPace: 0.85,
    segments: [
      { id: "solo", name: "Sole traders", description: "One van, one phone. Price is most of the decision.", size: 1_800_000, growth: 0.05, priceSensitivity: 0.8, qualityFocus: 0.4, brandFocus: 0.3, serviceFocus: 0.45, loyalty: 0.45, referencePrice: 45 },
      { id: "small_fleet", name: "Small fleets", description: "Five to twenty vans. Wants it to work and someone to call.", size: 950_000, growth: 0.08, priceSensitivity: 0.45, qualityFocus: 0.7, brandFocus: 0.4, serviceFocus: 0.85, loyalty: 0.74, referencePrice: 120 },
      { id: "enterprise", name: "National operators", description: "Hundreds of vans, a procurement process, and a two-year memory.", size: 220_000, growth: 0.06, priceSensitivity: 0.3, qualityFocus: 0.85, brandFocus: 0.65, serviceFocus: 0.9, loyalty: 0.9, referencePrice: 600 },
    ],
    incumbents: [
      { id: "inc_dispatch", name: "Dispatchly", posture: "fortress", startingShare: 0.38, quality: 74, brand: 78, service: 76, priceIndex: 1.2 },
      { id: "inc_routeco", name: "RouteCo", posture: "coaster", startingShare: 0.27, quality: 52, brand: 69, service: 44, priceIndex: 0.95 },
      { id: "inc_vanops", name: "VanOps", posture: "brawler", startingShare: 0.15, quality: 57, brand: 51, service: 52, priceIndex: 0.78 },
      { id: "inc_meridian", name: "Meridian Field", posture: "innovator", startingShare: 0.1, quality: 83, brand: 58, service: 66, priceIndex: 1.35 },
    ],
  },
];

export const nicheById = (id: string): Niche | undefined => NICHES.find((n) => n.id === id);
