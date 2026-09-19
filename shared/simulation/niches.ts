/**
 * The markets a team can enter.
 *
 * Each one is a different shape of problem rather than a different noun: the
 * incumbents' postures, how loyal the segments are and how fast quality moves
 * decide what winning looks like. A niche where everybody is loyal and quality
 * moves slowly is a grinding brand war; one with a flighty segment and a fast
 * pace can be cracked in three years by a team that reads it.
 *
 * ## Every market is roughly the same size, and that is not decoration
 *
 * Each of these totals somewhere between three and four hundred million a year
 * at the reference prices. That is a hard constraint the engine imposes, and
 * breaking it quietly breaks the game.
 *
 * A company here pays around 1.1m a year in fixed costs before anybody decides
 * anything, and moving brand or quality at all costs a few hundred thousand,
 * because that is where `lift`'s half-saturation sits. A market worth 15m a
 * year cannot support a company with those costs: every team in it goes
 * bankrupt in year one whatever they do, and the season stops being a game and
 * becomes arithmetic. That is exactly what happened when these markets were
 * first written an order of magnitude too small, and it took running a full
 * fourteen-year season to notice.
 *
 * So when adding one: multiply each segment's size by its reference price, add
 * them up, and land near 350m. `test/unit/balance.test.ts` then plays it for a
 * whole season with four different strategies and will say so if the result is
 * unwinnable, a walkover, or rewards exactly what every other market rewards.
 *
 * ## Loyalty is the dial that decides how a market plays
 *
 * Whether customers stay is what makes one of these a knife fight and another
 * a decade-long siege. A flighty segment is the door a newcomer comes through;
 * a loyal one is what makes the fortnight's work worth something afterwards.
 * Every market here has at least one of each, because a market of only loyal
 * customers cannot be entered and a market of only flighty ones cannot be held.
 */
import type { Niche } from "./types";

export const NICHES: Niche[] = [
  {
    id: "dating_apps",
    name: "Dating apps",
    premise: "Everybody has an opinion and nobody admits to paying. Your best customers leave the moment you succeed.",
    baseUnitCost: 6,
    innovationPace: 1.2,
    segments: [
      { id: "swipers", name: "Swipers", description: "On three apps at once, delete them all on a Sunday night, reinstall by Wednesday.", size: 4_000_000, growth: 0.03, priceSensitivity: 0.8, qualityFocus: 0.3, brandFocus: 0.62, serviceFocus: 0.2, loyalty: 0.15, referencePrice: 40 },
      { id: "recently_single", name: "The recently single", description: "Arrive raw and generous, download everything, and are gone within six months either way.", size: 1_400_000, growth: 0.06, priceSensitivity: 0.45, qualityFocus: 0.55, brandFocus: 0.4, serviceFocus: 0.45, loyalty: 0.22, referencePrice: 70 },
      { id: "long_haulers", name: "The long-haulers", description: "Four years on premium. Blame the algorithm, never the app.", size: 650_000, growth: 0.04, priceSensitivity: 0.25, qualityFocus: 0.75, brandFocus: 0.28, serviceFocus: 0.62, loyalty: 0.86, referencePrice: 160 },
    ],
    cities: [
      { id: "london", name: "London", weight: 0.31, entryCost: 1_300_000, note: "Density is the product here, and everybody already has it." },
      { id: "manchester", name: "Manchester", weight: 0.17, entryCost: 500_000, note: "Big enough that the app feels alive on a Friday night." },
      { id: "birmingham", name: "Birmingham", weight: 0.15, entryCost: 460_000, note: "Underserved, and nobody has made it feel local yet." },
      { id: "glasgow", name: "Glasgow", weight: 0.14, entryCost: 420_000, note: "Word of mouth travels faster here than any advert." },
      { id: "bristol", name: "Bristol", weight: 0.13, entryCost: 400_000, note: "Young, online, and quick to try whatever is new." },
      { id: "leeds", name: "Leeds", weight: 0.1, entryCost: 320_000, note: "The cheapest place to find out whether the thing works at all." },
    ],
    incumbents: [
      { id: "inc_ember", name: "Ember", posture: "fortress", startingShare: 0.39, quality: 66, brand: 88, service: 58, priceIndex: 1.18 },
      { id: "inc_pairwise", name: "Pairwise", posture: "brawler", startingShare: 0.24, quality: 57, brand: 71, service: 46, priceIndex: 0.78 },
      { id: "inc_spark", name: "Spark", posture: "coaster", startingShare: 0.17, quality: 45, brand: 69, service: 38, priceIndex: 0.96 },
      { id: "inc_lantern", name: "Lantern", posture: "innovator", startingShare: 0.1, quality: 83, brand: 52, service: 67, priceIndex: 1.32 },
    ],
  },
  {
    id: "drone_delivery",
    name: "Drone delivery",
    premise: "Ten minutes from warehouse to doorstep, if the weather holds and the regulator is in a good mood. Half the cost is the drone; the other half is explaining it to the neighbours.",
    baseUnitCost: 10,
    innovationPace: 0.9,
    segments: [
      { id: "novelty", name: "Novelty orderers", description: "Order once to watch it land, film it, and never think about it again.", size: 2_200_000, growth: 0.02, priceSensitivity: 0.75, qualityFocus: 0.3, brandFocus: 0.6, serviceFocus: 0.25, loyalty: 0.12, referencePrice: 25 },
      { id: "rural", name: "Rural households", description: "Forty minutes from the nearest shop. Once you're the only one who reaches them, you're theirs until somebody else does.", size: 1_100_000, growth: 0.07, priceSensitivity: 0.35, qualityFocus: 0.6, brandFocus: 0.25, serviceFocus: 0.85, loyalty: 0.8, referencePrice: 150 },
      { id: "clinics", name: "Pharmacies and clinics", description: "Prescriptions, samples, things that can't wait. A year of paperwork to sign, and they never switch a supplier that hasn't dropped anything.", size: 180_000, growth: 0.09, priceSensitivity: 0.2, qualityFocus: 0.85, brandFocus: 0.3, serviceFocus: 0.95, loyalty: 0.9, referencePrice: 700 },
    ],
    cities: [
      { id: "south_east", name: "The South East", weight: 0.29, entryCost: 1_500_000, note: "Dense, wealthy, and the strictest airspace in the country." },
      { id: "midlands", name: "The Midlands", weight: 0.2, entryCost: 620_000, note: "Warehouses everywhere, and short hops between them." },
      { id: "north_west", name: "The North West", weight: 0.17, entryCost: 540_000, note: "The weather costs you a dozen days a year, every year." },
      { id: "scotland", name: "Scotland", weight: 0.15, entryCost: 480_000, note: "The distances that make this expensive are the ones that make it worth it." },
      { id: "south_west", name: "The South West", weight: 0.11, entryCost: 380_000, note: "Scattered villages, and nobody else bothering with them." },
      { id: "wales", name: "Wales", weight: 0.08, entryCost: 300_000, note: "Cheapest licence in the country, and the hardest terrain to fly." },
    ],
    incumbents: [
      { id: "inc_skyhop", name: "Skyhop", posture: "fortress", startingShare: 0.36, quality: 71, brand: 80, service: 74, priceIndex: 1.16 },
      { id: "inc_dropzone", name: "Dropzone", posture: "brawler", startingShare: 0.28, quality: 55, brand: 64, service: 47, priceIndex: 0.76 },
      { id: "inc_hummingbird", name: "Hummingbird", posture: "innovator", startingShare: 0.15, quality: 86, brand: 53, service: 68, priceIndex: 1.34 },
      { id: "inc_kestrel", name: "Kestrel", posture: "coaster", startingShare: 0.11, quality: 48, brand: 57, service: 43, priceIndex: 0.98 },
    ],
  },
  {
    id: "podcasts",
    name: "Podcasts",
    premise: "Free to start, free to listen, and the same twenty shows have sat at the top of the chart for five years. Listeners don't pay you; advertisers pay you to talk about mattresses.",
    baseUnitCost: 2,
    innovationPace: 1.35,
    segments: [
      { id: "chart_hoppers", name: "Chart-hoppers", description: "Listen to whatever's number one, skip the ads, forget the host's name.", size: 9_000_000, growth: 0.05, priceSensitivity: 0.85, qualityFocus: 0.35, brandFocus: 0.7, serviceFocus: 0.15, loyalty: 0.14, referencePrice: 14 },
      { id: "commuters", name: "Commute regulars", description: "Every weekday, same slot, same voices. Will stay through a bad year but not through a co-host leaving.", size: 3_200_000, growth: 0.06, priceSensitivity: 0.4, qualityFocus: 0.7, brandFocus: 0.45, serviceFocus: 0.4, loyalty: 0.74, referencePrice: 38 },
      { id: "superfans", name: "Superfans", description: "Pay for the bonus feed, wear the merch, know the dog's name. A few thousand of them are worth more than a million of the others.", size: 240_000, growth: 0.1, priceSensitivity: 0.15, qualityFocus: 0.8, brandFocus: 0.3, serviceFocus: 0.9, loyalty: 0.9, referencePrice: 380 },
    ],
    cities: [
      { id: "north_america", name: "North America", weight: 0.33, entryCost: 1_600_000, note: "Six times the money and thirty times the competition." },
      { id: "uk", name: "The UK", weight: 0.26, entryCost: 700_000, note: "Where you start, and where the advertisers already know your name." },
      { id: "australia", name: "Australia and New Zealand", weight: 0.13, entryCost: 450_000, note: "Small, loyal, and pays close to American rates." },
      { id: "south_africa", name: "South Africa", weight: 0.1, entryCost: 340_000, note: "Growing fast, and almost nobody selling advertising into it." },
      { id: "india", name: "India", weight: 0.1, entryCost: 380_000, note: "An enormous audience at a fraction of the advertising rate." },
      { id: "ireland", name: "Ireland", weight: 0.08, entryCost: 260_000, note: "Cheap to enter, and a chart you can actually reach the top of." },
    ],
    incumbents: [
      { id: "inc_daily_brief", name: "The Daily Brief", posture: "fortress", startingShare: 0.33, quality: 74, brand: 87, service: 55, priceIndex: 1.14 },
      { id: "inc_two_guys", name: "Two Guys Talking", posture: "coaster", startingShare: 0.27, quality: 44, brand: 76, service: 33, priceIndex: 0.92 },
      { id: "inc_echo", name: "Echo Media", posture: "brawler", startingShare: 0.18, quality: 59, brand: 62, service: 48, priceIndex: 0.74 },
      { id: "inc_nightcap", name: "Nightcap", posture: "innovator", startingShare: 0.12, quality: 85, brand: 51, service: 70, priceIndex: 1.3 },
    ],
  },
  {
    id: "restaurant_chain",
    name: "Restaurant chain",
    premise: "Same menu in forty towns. The food is the easy part; the hard part is finding four hundred people who'll show up on a Saturday to cook it.",
    baseUnitCost: 6,
    innovationPace: 0.5,
    segments: [
      { id: "lunch", name: "Lunch crowd", description: "Twelve minutes, under fifteen pounds, gone. Will switch for a shorter queue or a coupon.", size: 12_000_000, growth: 0.03, priceSensitivity: 0.85, qualityFocus: 0.35, brandFocus: 0.35, serviceFocus: 0.5, loyalty: 0.18, referencePrice: 13 },
      { id: "families", name: "Friday families", description: "Need a high chair, a kids' menu, and no surprises. Once you are the place, you are the place for a decade.", size: 3_000_000, growth: 0.05, priceSensitivity: 0.45, qualityFocus: 0.65, brandFocus: 0.45, serviceFocus: 0.8, loyalty: 0.82, referencePrice: 42 },
      { id: "delivery", name: "Delivery-app orderers", description: "Have never seen your building. Loyal to the app, not to you, and the app takes thirty per cent for the introduction.", size: 5_000_000, growth: 0.09, priceSensitivity: 0.7, qualityFocus: 0.5, brandFocus: 0.3, serviceFocus: 0.45, loyalty: 0.16, referencePrice: 22 },
    ],
    cities: [
      { id: "london", name: "London", weight: 0.28, entryCost: 1_700_000, note: "The rent is the business plan. Everything else is detail." },
      { id: "north_west", name: "The North West", weight: 0.19, entryCost: 620_000, note: "Forty towns within an hour of each other. Made for a chain." },
      { id: "midlands", name: "The Midlands", weight: 0.18, entryCost: 580_000, note: "Nobody has owned this properly since the nineties." },
      { id: "yorkshire", name: "Yorkshire", weight: 0.15, entryCost: 470_000, note: "Loyal once you have earned it, and slow to give it." },
      { id: "scotland", name: "Scotland", weight: 0.12, entryCost: 420_000, note: "Staffing is the whole problem here, not footfall." },
      { id: "south_west", name: "The South West", weight: 0.08, entryCost: 300_000, note: "Cheapest doors in the country, and three good months of trade a year." },
    ],
    incumbents: [
      { id: "inc_burger_barn", name: "Burger Barn", posture: "brawler", startingShare: 0.38, quality: 48, brand: 85, service: 44, priceIndex: 0.72 },
      { id: "inc_fresco", name: "Fresco", posture: "fortress", startingShare: 0.25, quality: 69, brand: 76, service: 71, priceIndex: 1.2 },
      { id: "inc_noodle_house", name: "Noodle House", posture: "innovator", startingShare: 0.16, quality: 82, brand: 54, service: 63, priceIndex: 1.28 },
      { id: "inc_southside", name: "Southside Grill", posture: "coaster", startingShare: 0.11, quality: 46, brand: 58, service: 41, priceIndex: 0.97 },
    ],
  },
  {
    id: "construction",
    name: "Construction",
    premise: "Bid low, build slow, get paid late. Every job is a one-off, and every reputation is one bad roof from over.",
    baseUnitCost: 340,
    innovationPace: 0.45,
    segments: [
      { id: "homeowners", name: "Homeowners", description: "A kitchen, an extension, a fence. Get three quotes, pick the cheapest, and tell the whole street how it went.", size: 190_000, growth: 0.03, priceSensitivity: 0.85, qualityFocus: 0.55, brandFocus: 0.35, serviceFocus: 0.6, loyalty: 0.15, referencePrice: 900 },
      { id: "developers", name: "Developers", description: "Ten jobs a year to whoever finished the last one on time. Slow to win, and they'll bring you along for the next decade.", size: 26_000, growth: 0.06, priceSensitivity: 0.5, qualityFocus: 0.8, brandFocus: 0.4, serviceFocus: 0.75, loyalty: 0.82, referencePrice: 3_800 },
      { id: "public", name: "Public sector", description: "Schools, roads, a hospital wing. A tender process longer than the build, and a blacklist that never expires.", size: 5_500, growth: 0.04, priceSensitivity: 0.45, qualityFocus: 0.85, brandFocus: 0.55, serviceFocus: 0.8, loyalty: 0.92, referencePrice: 14_000 },
    ],
    cities: [
      { id: "south_east", name: "The South East", weight: 0.3, entryCost: 1_600_000, note: "Most of the money, and most of the firms chasing it." },
      { id: "midlands", name: "The Midlands", weight: 0.19, entryCost: 600_000, note: "Steady work, and buyers who remember who turned up." },
      { id: "north_west", name: "The North West", weight: 0.17, entryCost: 520_000, note: "Regeneration money, with a decade of it still to spend." },
      { id: "scotland", name: "Scotland", weight: 0.14, entryCost: 450_000, note: "Its own procurement rules, and a shorter building season." },
      { id: "yorkshire", name: "Yorkshire", weight: 0.12, entryCost: 400_000, note: "Relationships here are measured in decades, not tenders." },
      { id: "wales", name: "Wales", weight: 0.08, entryCost: 280_000, note: "Cheapest entry, smallest jobs, and very little competition." },
    ],
    incumbents: [
      { id: "inc_hartwell", name: "Hartwell Builders", posture: "fortress", startingShare: 0.32, quality: 73, brand: 78, service: 76, priceIndex: 1.22 },
      { id: "inc_bricktop", name: "Bricktop", posture: "brawler", startingShare: 0.26, quality: 52, brand: 61, service: 44, priceIndex: 0.73 },
      { id: "inc_ironwood", name: "Ironwood", posture: "innovator", startingShare: 0.2, quality: 84, brand: 55, service: 69, priceIndex: 1.3 },
      { id: "inc_northgate", name: "Northgate", posture: "coaster", startingShare: 0.12, quality: 47, brand: 60, service: 42, priceIndex: 0.95 },
    ],
  },
  {
    id: "project_saas",
    name: "Project management software",
    premise: "Software for people who need to know who's doing what. Free for five users, priced per seat, and every company already has three of them.",
    baseUnitCost: 11,
    innovationPace: 1.25,
    segments: [
      { id: "startups", name: "Startups", description: "Sign up on the free tier, invite the whole team, and leave the week they hire an ops person who prefers the other one.", size: 3_800_000, growth: 0.07, priceSensitivity: 0.8, qualityFocus: 0.5, brandFocus: 0.4, serviceFocus: 0.3, loyalty: 0.16, referencePrice: 55 },
      { id: "midsize", name: "Mid-size teams", description: "Two hundred seats and four years of project history. Nobody wants to be the person who migrated it.", size: 1_300_000, growth: 0.06, priceSensitivity: 0.4, qualityFocus: 0.72, brandFocus: 0.35, serviceFocus: 0.7, loyalty: 0.8, referencePrice: 95 },
      { id: "enterprise", name: "Enterprise", description: "A security questionnaire, a procurement process, and a three-year contract. Eighteen months to win, and they'll renew without reading it.", size: 260_000, growth: 0.05, priceSensitivity: 0.3, qualityFocus: 0.8, brandFocus: 0.6, serviceFocus: 0.9, loyalty: 0.93, referencePrice: 180 },
    ],
    cities: [
      { id: "north_america", name: "North America", weight: 0.33, entryCost: 1_700_000, note: "Half the money in the category, and every rival already there." },
      { id: "uk_ireland", name: "UK and Ireland", weight: 0.17, entryCost: 520_000, note: "Where you start, and small enough to run out of quickly." },
      { id: "dach", name: "Germany, Austria and Switzerland", weight: 0.16, entryCost: 720_000, note: "Slow to sign, then impossible to shift. The data rules are the entry fee." },
      { id: "nordics", name: "The Nordics", weight: 0.12, entryCost: 480_000, note: "Small, rich, and they buy software properly." },
      { id: "anz", name: "Australia and New Zealand", weight: 0.12, entryCost: 460_000, note: "Far away, English-speaking, and nobody is serving it well." },
      { id: "benelux", name: "The Benelux", weight: 0.1, entryCost: 380_000, note: "The cheapest way onto the continent." },
    ],
    incumbents: [
      { id: "inc_taskwell", name: "Taskwell", posture: "fortress", startingShare: 0.35, quality: 72, brand: 84, service: 70, priceIndex: 1.18 },
      { id: "inc_gridline", name: "Gridline", posture: "brawler", startingShare: 0.27, quality: 58, brand: 66, service: 45, priceIndex: 0.75 },
      { id: "inc_boardroom", name: "Boardroom", posture: "innovator", startingShare: 0.17, quality: 86, brand: 56, service: 66, priceIndex: 1.33 },
      { id: "inc_plannr", name: "Plannr", posture: "coaster", startingShare: 0.11, quality: 46, brand: 63, service: 39, priceIndex: 0.94 },
    ],
  },
  {
    id: "mmos",
    name: "MMOs",
    premise: "Five years and fifty million to make, and the players will judge it on the first weekend. Nobody plays an MMO alone, which is the whole point and the whole problem.",
    baseUnitCost: 4,
    innovationPace: 1.5,
    segments: [
      { id: "tourists", name: "Launch tourists", description: "Buy every big release, hit level twenty, quit the moment the login queue's gone.", size: 4_200_000, growth: 0.04, priceSensitivity: 0.75, qualityFocus: 0.6, brandFocus: 0.65, serviceFocus: 0.2, loyalty: 0.12, referencePrice: 45 },
      { id: "guilds", name: "Guild members", description: "Play because their friends play. You can't take one; you have to take all forty at once.", size: 900_000, growth: 0.05, priceSensitivity: 0.35, qualityFocus: 0.75, brandFocus: 0.3, serviceFocus: 0.6, loyalty: 0.88, referencePrice: 130 },
      { id: "veterans", name: "Veterans", description: "Ten years, six alts, a subscription they've never cancelled. Complain constantly, and would sooner die than leave.", size: 320_000, growth: 0.03, priceSensitivity: 0.2, qualityFocus: 0.7, brandFocus: 0.2, serviceFocus: 0.85, loyalty: 0.94, referencePrice: 190 },
    ],
    cities: [
      { id: "north_america", name: "North America", weight: 0.31, entryCost: 1_600_000, note: "The launch that decides whether anybody else covers you." },
      { id: "europe", name: "Europe", weight: 0.24, entryCost: 900_000, note: "Seven languages, and a server everybody will complain about." },
      { id: "korea_japan", name: "Korea and Japan", weight: 0.15, entryCost: 1_100_000, note: "Pays more per player than anywhere, and will not tolerate a bad launch." },
      { id: "sea", name: "South East Asia", weight: 0.14, entryCost: 460_000, note: "Vast, mobile-first, and growing faster than anywhere else." },
      { id: "latam", name: "Latin America", weight: 0.09, entryCost: 340_000, note: "Cheap to enter, loyal once you are in, and almost nobody localises for it." },
      { id: "oceania", name: "Oceania", weight: 0.07, entryCost: 280_000, note: "Small, and they will forgive almost anything except lag." },
    ],
    incumbents: [
      { id: "inc_aether", name: "Realms of Aether", posture: "fortress", startingShare: 0.41, quality: 78, brand: 89, service: 72, priceIndex: 1.15 },
      { id: "inc_starforge", name: "Starforge Online", posture: "innovator", startingShare: 0.24, quality: 88, brand: 61, service: 65, priceIndex: 1.3 },
      { id: "inc_dominion", name: "Dominion", posture: "brawler", startingShare: 0.14, quality: 57, brand: 63, service: 44, priceIndex: 0.74 },
      { id: "inc_emberfall", name: "Emberfall", posture: "coaster", startingShare: 0.11, quality: 45, brand: 58, service: 38, priceIndex: 0.96 },
    ],
  },
];

export const nicheById = (id: string): Niche | undefined => NICHES.find((n) => n.id === id);
