/**
 * The main contest: announced, not open. Static on purpose — there's nothing
 * to join yet, so there's nothing to store. When entries open this becomes a
 * row in `contests` with real terms; until then it's the announcement copy.
 */
export const FEATURED_CONTEST = {
  slug: "50-billion",
  name: "The $50 Billion Challenge",
  amount: "$50,000,000,000",
  short: "$50B",
  headline: "Build the first $50 billion company on SparkTower.",
  prize: "Win majority ownership of SparkTower.",
  pitch: "One founder. One company built from the ground up on SparkTower. The first to reach a $50 billion valuation takes the majority of the platform that helped build it.",
  status: "Entries opening soon",
  about: [
    "SparkTower exists to turn ideas into companies. So here is the biggest bet we can make on the people using it: build something truly enormous here, and SparkTower becomes yours.",
    "Start with nothing but an idea. Plan it, build it, fund it and scale it on SparkTower — your path, your team, your code, your raise. The first founder whose company reaches a $50 billion valuation wins majority ownership of SparkTower.",
  ],
  steps: [
    { title: "Start on SparkTower", body: "Create the company as a SparkTower project from day one." },
    { title: "Build it from zero", body: "Ship, systemize and raise — with Nova and your team on the platform." },
    { title: "Reach $50 billion", body: "Hit a verified $50B valuation first, and SparkTower is majority yours." },
  ],
  rules: [
    { title: "Built from the ground up", body: "The company must start from zero on SparkTower — no existing business, revenue or acquired company folded in to get there." },
    { title: "SparkTower from day one", body: "The company is created, planned and run as a SparkTower project from its very first step, and stays on the platform the whole way." },
    { title: "A real $50 billion valuation", body: "The valuation must be independently verified — a priced funding round, a public market capitalization, or an acquisition offer." },
    { title: "First to get there wins", body: "There is one winner: the first founder whose company reaches the mark, as verified by SparkTower." },
    { title: "The prize", body: "The winning founder receives majority ownership of SparkTower, on terms that will be set out in the official rules." },
    { title: "One founder per entry", body: "Each company names one lead founder. Teams can build together, but the prize goes to the lead founder of record." },
  ],
  fineprint: "This is an announcement, not an offer. Entries are not open. Official terms, eligibility, verification and prize details will be published before the contest opens, and those terms will govern the contest.",
} as const;
