/**
 * Seven brand-new startups, in the shape Nova answers in.
 *
 * Shared by the diagnostics in this directory so they are all describing the
 * same seven businesses. Deliberately different shapes, and three of them
 * awkward on purpose: an audience that does not pay, a hardware business with a
 * vast unit cost and a handful of buyers, and a consultancy with eleven clients
 * in the whole market.
 *
 * Hand-written to the documented shape rather than produced by a live model
 * call. What `buildCustomMarket` does to a spec is arithmetic and holds whoever
 * wrote it; whether Nova would write these exact numbers is a separate
 * question, and one only a live run can answer.
 */
export const STARTUP_SPECS: { label: string; note: string; spec: any }[] = [
  {
    label: "vet software",
    note: "B2B SaaS, small market, service-led",
    spec: {
      name: "Veterinary practice software", premise: "Scheduling and records for small animal clinics.",
      segments: [
        { id: "single_site", name: "Single-site clinics", description: "One vet, one nurse.", size: 40_000, growth: 0.04, priceSensitivity: 0.7, qualityFocus: 0.5, brandFocus: 0.2, serviceFocus: 0.8, loyalty: 0.5, referencePrice: 120 },
        { id: "groups", name: "Clinic groups", description: "Five to fifty sites.", size: 9_000, growth: 0.09, priceSensitivity: 0.3, qualityFocus: 0.8, brandFocus: 0.5, serviceFocus: 0.7, loyalty: 0.7, referencePrice: 900 },
      ],
      regions: [
        { id: "north", name: "The North", weight: 0.3, entryCost: 120_000, note: "Price-led." },
        { id: "midlands", name: "The Midlands", weight: 0.3, entryCost: 140_000, note: "Mixed." },
        { id: "south", name: "The South", weight: 0.4, entryCost: 260_000, note: "The groups are here." },
      ],
      incumbents: [
        { id: "oldco", name: "Oldco", posture: "coaster", startingShare: 0.5, quality: 50, brand: 70, service: 40, priceIndex: 1.1 },
        { id: "newco", name: "Newco", posture: "innovator", startingShare: 0.3, quality: 75, brand: 35, service: 60, priceIndex: 0.9 },
      ],
      baseUnitCost: 30, innovationPace: 1.1,
      voice: { customer: "clinic", customers: "clinics", unit: "licence", capacity: "seats" },
    },
  },
  {
    label: "youtube channel",
    note: "the audience does not pay — the shape nova-market.ts warns about",
    spec: {
      name: "A woodworking channel", premise: "Furniture built on camera, paid for by sponsors and a membership tier.",
      segments: [
        { id: "casuals", name: "Casual watchers", description: "Watch two minutes, never subscribe.", size: 900_000, growth: 0.2, priceSensitivity: 0.95, qualityFocus: 0.4, brandFocus: 0.7, serviceFocus: 0.1, loyalty: 0.05, referencePrice: 2 },
        { id: "members", name: "Members", description: "Pay monthly for the plans and the early cut.", size: 24_000, growth: 0.12, priceSensitivity: 0.5, qualityFocus: 0.75, brandFocus: 0.5, serviceFocus: 0.4, loyalty: 0.6, referencePrice: 8 },
      ],
      regions: [
        { id: "uk", name: "UK", weight: 0.25, entryCost: 20_000, note: "Home audience." },
        { id: "us", name: "US", weight: 0.5, entryCost: 60_000, note: "Where the sponsors pay." },
        { id: "row", name: "Everywhere else", weight: 0.25, entryCost: 30_000, note: "Cheap reach, thin money." },
      ],
      incumbents: [
        { id: "bigsaw", name: "BigSaw", posture: "shark", startingShare: 0.45, quality: 70, brand: 85, service: 20, priceIndex: 0.8 },
        { id: "steady", name: "SteadyHands", posture: "coaster", startingShare: 0.25, quality: 55, brand: 50, service: 30, priceIndex: 1 },
      ],
      baseUnitCost: 1, innovationPace: 1.6,
      voice: { customer: "viewer", customers: "viewers", unit: "video", capacity: "uploads" },
    },
  },
  {
    label: "coffee roastery",
    note: "physical, low price, high volume, local",
    spec: {
      name: "A city coffee roastery", premise: "Roasting for cafés and a subscription box.",
      segments: [
        { id: "cafes", name: "Independent cafés", description: "Buy by the kilo, switch on price and consistency.", size: 2_400, growth: 0.05, priceSensitivity: 0.75, qualityFocus: 0.8, brandFocus: 0.3, serviceFocus: 0.6, loyalty: 0.55, referencePrice: 22 },
        { id: "boxes", name: "Home subscribers", description: "A bag a fortnight, cancel when money is tight.", size: 70_000, growth: 0.11, priceSensitivity: 0.6, qualityFocus: 0.7, brandFocus: 0.6, serviceFocus: 0.35, loyalty: 0.3, referencePrice: 14 },
      ],
      regions: [
        { id: "city", name: "The city", weight: 0.6, entryCost: 40_000, note: "Deliver by van." },
        { id: "region", name: "The region", weight: 0.3, entryCost: 90_000, note: "Courier, thinner margin." },
        { id: "national", name: "National", weight: 0.1, entryCost: 220_000, note: "Pallets and a broker." },
      ],
      incumbents: [
        { id: "roast", name: "Roastworks", posture: "shark", startingShare: 0.4, quality: 65, brand: 60, service: 55, priceIndex: 0.95 },
        { id: "import", name: "Continental Import", posture: "coaster", startingShare: 0.35, quality: 45, brand: 40, service: 35, priceIndex: 0.8 },
      ],
      baseUnitCost: 7, innovationPace: 0.6,
      voice: { customer: "café", customers: "cafés", unit: "kilo", capacity: "roasting hours" },
    },
  },
  {
    label: "indie game studio",
    note: "one-off purchase, hits-driven, brand matters most",
    spec: {
      name: "An indie game studio", premise: "One game every two years, sold outright on PC and console.",
      segments: [
        { id: "enthusiasts", name: "Genre enthusiasts", description: "Read the patch notes, buy on day one.", size: 180_000, growth: 0.07, priceSensitivity: 0.35, qualityFocus: 0.85, brandFocus: 0.45, serviceFocus: 0.3, loyalty: 0.6, referencePrice: 25 },
        { id: "sale_buyers", name: "Sale buyers", description: "Wishlist it, buy at 70% off two years later.", size: 1_300_000, growth: 0.09, priceSensitivity: 0.9, qualityFocus: 0.5, brandFocus: 0.65, serviceFocus: 0.15, loyalty: 0.1, referencePrice: 8 },
      ],
      regions: [
        { id: "eu", name: "Europe", weight: 0.35, entryCost: 50_000, note: "Localisation pays here." },
        { id: "na", name: "North America", weight: 0.45, entryCost: 80_000, note: "The streamers are here." },
        { id: "asia", name: "Asia", weight: 0.2, entryCost: 120_000, note: "Needs a publisher." },
      ],
      incumbents: [
        { id: "studioa", name: "Studio Aurora", posture: "innovator", startingShare: 0.3, quality: 80, brand: 75, service: 25, priceIndex: 1.2 },
        { id: "mill", name: "Content Mill", posture: "shark", startingShare: 0.4, quality: 35, brand: 55, service: 20, priceIndex: 0.5 },
      ],
      baseUnitCost: 2, innovationPace: 1.8,
      voice: { customer: "player", customers: "players", unit: "copy", capacity: "build slots" },
    },
  },
  {
    label: "carbon consultancy",
    note: "eleven clients in the whole market, enormous prices",
    spec: {
      name: "Carbon accounting consultancy", premise: "Measuring and reporting emissions for industrial clients.",
      segments: [
        { id: "majors", name: "Industrial majors", description: "Regulated, slow, and they never leave.", size: 11, growth: 0.02, priceSensitivity: 0.15, qualityFocus: 0.9, brandFocus: 0.55, serviceFocus: 0.85, loyalty: 0.95, referencePrice: 240_000 },
        { id: "mid", name: "Mid-market manufacturers", description: "Need it for a tender, want it cheap.", size: 480, growth: 0.14, priceSensitivity: 0.65, qualityFocus: 0.6, brandFocus: 0.3, serviceFocus: 0.6, loyalty: 0.45, referencePrice: 18_000 },
      ],
      regions: [
        { id: "uk", name: "UK", weight: 0.5, entryCost: 200_000, note: "Where the regulation bites first." },
        { id: "eu", name: "EU", weight: 0.35, entryCost: 600_000, note: "Bigger, and already served." },
        { id: "nordics", name: "The Nordics", weight: 0.15, entryCost: 300_000, note: "Small, strict, pays on time." },
      ],
      incumbents: [
        { id: "big4", name: "A Big Four practice", posture: "coaster", startingShare: 0.55, quality: 60, brand: 95, service: 45, priceIndex: 1.6 },
        { id: "boutique", name: "Boutique", posture: "innovator", startingShare: 0.25, quality: 85, brand: 35, service: 80, priceIndex: 1.1 },
      ],
      baseUnitCost: 4_000, innovationPace: 0.8,
      voice: { customer: "client", customers: "clients", unit: "engagement", capacity: "consultant days" },
    },
  },
  {
    label: "launch hardware",
    note: "vast unit cost, a handful of buyers — the SparkTower shape",
    spec: {
      name: "Small-launch vehicles", premise: "Dedicated rides to low orbit for smallsat operators.",
      segments: [
        { id: "operators", name: "Constellation operators", description: "Book a year out, care only about schedule.", size: 40, growth: 0.18, priceSensitivity: 0.3, qualityFocus: 0.95, brandFocus: 0.2, serviceFocus: 0.7, loyalty: 0.75, referencePrice: 4_500_000 },
        { id: "research", name: "Research payloads", description: "Grant-funded, price-led, patient.", size: 260, growth: 0.08, priceSensitivity: 0.8, qualityFocus: 0.7, brandFocus: 0.15, serviceFocus: 0.5, loyalty: 0.4, referencePrice: 600_000 },
      ],
      regions: [
        { id: "us", name: "US", weight: 0.6, entryCost: 2_000_000, note: "The customers and the regulator." },
        { id: "eu", name: "Europe", weight: 0.3, entryCost: 1_200_000, note: "Fewer launches, friendlier terms." },
        { id: "apac", name: "Asia-Pacific", weight: 0.1, entryCost: 900_000, note: "New pads, political risk." },
      ],
      incumbents: [
        { id: "rideshare", name: "A rideshare giant", posture: "shark", startingShare: 0.6, quality: 85, brand: 90, service: 40, priceIndex: 0.4 },
        { id: "legacy", name: "Legacy prime", posture: "coaster", startingShare: 0.25, quality: 70, brand: 65, service: 55, priceIndex: 2.2 },
      ],
      baseUnitCost: 180_000, innovationPace: 1.3,
      voice: { customer: "operator", customers: "operators", unit: "launch", capacity: "launch slots" },
    },
  },
  {
    label: "fitness app",
    note: "consumer subscription, churny, brand-led",
    spec: {
      name: "A strength training app", premise: "Programmes and tracking, sold monthly.",
      segments: [
        { id: "beginners", name: "Beginners", description: "Join in January, gone by March.", size: 1_100_000, growth: 0.15, priceSensitivity: 0.85, qualityFocus: 0.45, brandFocus: 0.7, serviceFocus: 0.3, loyalty: 0.08, referencePrice: 10 },
        { id: "committed", name: "The committed", description: "Four years in, will pay for the detail.", size: 95_000, growth: 0.06, priceSensitivity: 0.3, qualityFocus: 0.85, brandFocus: 0.35, serviceFocus: 0.55, loyalty: 0.8, referencePrice: 30 },
      ],
      regions: [
        { id: "uk", name: "UK", weight: 0.3, entryCost: 70_000, note: "Cheap to reach." },
        { id: "us", name: "US", weight: 0.55, entryCost: 300_000, note: "Expensive, and everyone is there." },
        { id: "anz", name: "Australia & NZ", weight: 0.15, entryCost: 90_000, note: "Cheap, and nobody is fighting for it." },
      ],
      incumbents: [
        { id: "giant", name: "A fitness giant", posture: "shark", startingShare: 0.5, quality: 60, brand: 90, service: 35, priceIndex: 1.3 },
        { id: "free", name: "The free one", posture: "coaster", startingShare: 0.3, quality: 40, brand: 55, service: 15, priceIndex: 0.2 },
      ],
      baseUnitCost: 2, innovationPace: 1.4,
      voice: { customer: "member", customers: "members", unit: "subscription", capacity: "coach hours" },
    },
  },
];
