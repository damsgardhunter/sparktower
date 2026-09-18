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
    cities: [
      { id: "london", name: "London", weight: 0.3, entryCost: 900_000, note: "A third of the market and everybody already selling to it." },
      { id: "manchester", name: "Manchester", weight: 0.16, entryCost: 450_000, note: "Big enough to matter, cheap enough to start." },
      { id: "birmingham", name: "Birmingham", weight: 0.15, entryCost: 420_000, note: "Underserved by the incumbents, who all opened in London first." },
      { id: "glasgow", name: "Glasgow", weight: 0.13, entryCost: 380_000, note: "Loyal once you are in, slow to be convinced." },
      { id: "bristol", name: "Bristol", weight: 0.14, entryCost: 400_000, note: "Younger, and the first to try something new." },
      { id: "leeds", name: "Leeds", weight: 0.12, entryCost: 350_000, note: "The cheapest door into the market, and the quietest." },
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
    cities: [
      { id: "south_east", name: "The South East", weight: 0.32, entryCost: 1_100_000, note: "Densest fleet population in the country, and the most contested." },
      { id: "midlands", name: "The Midlands", weight: 0.2, entryCost: 550_000, note: "Where the vans actually are. Practical buyers." },
      { id: "north_west", name: "The North West", weight: 0.17, entryCost: 480_000, note: "Long relationships, hard to break into, harder to lose." },
      { id: "scotland", name: "Scotland", weight: 0.13, entryCost: 420_000, note: "Distances make service expensive and valuable." },
      { id: "south_west", name: "The South West", weight: 0.1, entryCost: 330_000, note: "Smaller operators, price sensitive." },
      { id: "north_east", name: "The North East", weight: 0.08, entryCost: 280_000, note: "Cheap to enter and genuinely underserved." },
    ],
    incumbents: [
      { id: "inc_dispatch", name: "Dispatchly", posture: "fortress", startingShare: 0.38, quality: 74, brand: 78, service: 76, priceIndex: 1.2 },
      { id: "inc_routeco", name: "RouteCo", posture: "coaster", startingShare: 0.27, quality: 52, brand: 69, service: 44, priceIndex: 0.95 },
      { id: "inc_vanops", name: "VanOps", posture: "brawler", startingShare: 0.15, quality: 57, brand: 51, service: 52, priceIndex: 0.78 },
      { id: "inc_meridian", name: "Meridian Field", posture: "innovator", startingShare: 0.1, quality: 83, brand: 58, service: 66, priceIndex: 1.35 },
    ],
  },
  {
    id: "coffee",
    name: "Coffee shops",
    premise: "Physical shops, in real places. Where you open decides almost everything, and the rent is due whether anybody comes in or not.",
    baseUnitCost: 1.6,
    innovationPace: 0.55,
    segments: [
      { id: "commuters", name: "Commuters", description: "Same time, same order, every weekday. Enormous, impatient, and gone the moment there is a shorter queue.", size: 40_000_000, growth: 0.03, priceSensitivity: 0.75, qualityFocus: 0.3, brandFocus: 0.35, serviceFocus: 0.55, loyalty: 0.3, referencePrice: 4.5 },
      { id: "remote", name: "People working from a table", description: "Stay for hours, buy twice, and judge you entirely on whether the wifi works and somebody was nice to them.", size: 15_000_000, growth: 0.09, priceSensitivity: 0.4, qualityFocus: 0.5, brandFocus: 0.3, serviceFocus: 0.85, loyalty: 0.66, referencePrice: 6 },
      { id: "connoisseurs", name: "People who care about the beans", description: "Small, vocal, and worth far more than their number. They will travel, and they will tell everyone.", size: 4_500_000, growth: 0.07, priceSensitivity: 0.25, qualityFocus: 0.92, brandFocus: 0.4, serviceFocus: 0.6, loyalty: 0.78, referencePrice: 8 },
    ],
    cities: [
      { id: "london", name: "London", weight: 0.34, entryCost: 1_400_000, note: "The rent is the whole problem. So is everybody else's shop." },
      { id: "manchester", name: "Manchester", weight: 0.17, entryCost: 520_000, note: "A real coffee city already. You will be judged by people who know." },
      { id: "birmingham", name: "Birmingham", weight: 0.15, entryCost: 460_000, note: "Big, and oddly underserved at the good end." },
      { id: "bristol", name: "Bristol", weight: 0.13, entryCost: 430_000, note: "Independents do well here and chains struggle." },
      { id: "glasgow", name: "Glasgow", weight: 0.12, entryCost: 390_000, note: "Loyal to whoever got there first, which could be you." },
      { id: "leeds", name: "Leeds", weight: 0.09, entryCost: 300_000, note: "Cheapest door in the market." },
    ],
    incumbents: [
      { id: "inc_grind", name: "The Daily Grind", posture: "fortress", startingShare: 0.36, quality: 61, brand: 84, service: 62, priceIndex: 1.1 },
      { id: "inc_beanco", name: "BeanCo", posture: "brawler", startingShare: 0.27, quality: 48, brand: 70, service: 44, priceIndex: 0.8 },
      { id: "inc_roast", name: "Roasthouse", posture: "innovator", startingShare: 0.15, quality: 85, brand: 55, service: 70, priceIndex: 1.3 },
      { id: "inc_corner", name: "Corner Cafe Group", posture: "coaster", startingShare: 0.12, quality: 44, brand: 58, service: 47, priceIndex: 0.95 },
    ],
  },
  {
    id: "mobile_games",
    name: "Mobile games",
    premise: "Almost free to make a copy, almost impossible to be noticed. Nine in ten players never pay anything, and the tenth pays for all of them.",
    baseUnitCost: 0.9,
    innovationPace: 1.7,
    segments: [
      { id: "casual", name: "Casual players", description: "Play on the bus, quit without noticing, spend small amounts on impulse. There are a staggering number of them, and the thing they were already playing has a head start no newcomer can price away.", size: 24_000_000, growth: 0.06, priceSensitivity: 0.8, qualityFocus: 0.35, brandFocus: 0.68, serviceFocus: 0.2, loyalty: 0.36, referencePrice: 6 },
      { id: "midcore", name: "Regular players", description: "Play most days, know what good looks like, and will leave loudly if you get greedy.", size: 8_000_000, growth: 0.1, priceSensitivity: 0.45, qualityFocus: 0.82, brandFocus: 0.4, serviceFocus: 0.55, loyalty: 0.68, referencePrice: 18 },
      { id: "devoted", name: "The devoted few", description: "A fraction of a per cent of players and a large fraction of the money. Extremely hard to win and worth almost any effort.", size: 400_000, growth: 0.12, priceSensitivity: 0.15, qualityFocus: 0.8, brandFocus: 0.3, serviceFocus: 0.9, loyalty: 0.88, referencePrice: 180 },
    ],
    cities: [
      { id: "global_en", name: "English-speaking markets", weight: 0.33, entryCost: 1_200_000, note: "Where everybody launches, and where everybody is already fighting." },
      { id: "eu", name: "Europe", weight: 0.22, entryCost: 700_000, note: "Several languages, several regulators, real money." },
      { id: "latam", name: "Latin America", weight: 0.16, entryCost: 420_000, note: "Enormous and cheap to enter. Pays less per player and far more of them." },
      { id: "sea", name: "South East Asia", weight: 0.15, entryCost: 460_000, note: "Mobile-first, brutally competitive, and growing faster than anywhere." },
      { id: "japan", name: "Japan and Korea", weight: 0.09, entryCost: 950_000, note: "Pays more per player than anywhere on earth, and will not tolerate a bad game." },
      { id: "india", name: "India", weight: 0.05, entryCost: 260_000, note: "Cheapest entry in the market, and the longest wait for it to pay." },
    ],
    incumbents: [
      { id: "inc_tapjoy", name: "Tapworks", posture: "brawler", startingShare: 0.31, quality: 54, brand: 86, service: 38, priceIndex: 0.75 },
      { id: "inc_pixel", name: "Pixel Foundry", posture: "innovator", startingShare: 0.26, quality: 88, brand: 62, service: 64, priceIndex: 1.25 },
      { id: "inc_everplay", name: "Everplay", posture: "fortress", startingShare: 0.21, quality: 68, brand: 86, service: 60, priceIndex: 1.12 },
      { id: "inc_idleco", name: "Idle Kingdom", posture: "coaster", startingShare: 0.12, quality: 41, brand: 66, service: 33, priceIndex: 0.9 },
    ],
  },
];

export const nicheById = (id: string): Niche | undefined => NICHES.find((n) => n.id === id);
