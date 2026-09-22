/**
 * The world the markets sit in.
 *
 * Every market used to carry its own ten regions and nothing joined them up: a
 * dating app sold in Leeds and Manchester, an MMO in China and LATAM, and
 * neither knew what a continent was. That is fine while a company only ever
 * grows inside one market, and it falls apart the moment the question is
 * "where in the world should we go next", which is the question a company
 * season is for.
 *
 * So: seven continents, five regions each, and every region carries the number
 * of people who actually live there. The populations are real — rounded 2024
 * estimates — because the point is that the map behaves like the world. India
 * and China are enormous and difficult; Oceania is rich, easy and small;
 * Africa is the largest young population on earth and the hardest to serve.
 * None of that had to be invented, and a player who knows it is rewarded for
 * knowing it.
 *
 * What this file is not: a market. A region's population is people, not
 * customers. How many of those people are worth anything to *this* business is
 * the market's own business — see `penetration` on a niche, and `regionsFor`
 * below, which is where a population becomes a share of a market.
 */

import type { City, Niche } from "./types";

export type ContinentId =
  | "north_america" | "south_america" | "europe" | "africa" | "middle_east" | "asia" | "oceania";

/**
 * How hard a region is to get into from outside.
 *
 * `open` is the ordinary case: pay the entry cost and you are selling there.
 *
 * `guarded` is a market that is genuinely hard to enter and genuinely worth
 * entering — a licence regime, a partner requirement, a state that prefers its
 * own. It costs several times what its size suggests, and it never quite
 * works as well as it would for somebody already inside it. A company that
 * *started* there pays neither penalty, which is the whole point: being from
 * somewhere is an advantage nobody else can buy.
 *
 * `closed` cannot be entered at all from outside. Only a company whose home it
 * is sells there.
 */
export type Access = "open" | "guarded" | "closed";

export interface WorldRegion {
  id: string;
  name: string;
  continent: ContinentId;
  /** People who live there, in millions. Rounded 2024 estimates. */
  population: number;
  /**
   * How rich the region is, as a multiple of the world average, roughly.
   * A hundred people in Switzerland are not a hundred people in Malawi, and a
   * market priced in money rather than heads has to know the difference.
   */
  wealth: number;
  access: Access;
  note: string;
}

export interface Continent {
  id: ContinentId;
  name: string;
  regions: WorldRegion[];
}

const region = (
  id: string, name: string, continent: ContinentId,
  population: number, wealth: number, access: Access, note: string,
): WorldRegion => ({ id, name, continent, population, wealth, access, note });

/**
 * The map.
 *
 * Five regions a continent, drawn where the lines actually are rather than
 * evenly: the United States is three regions because it behaves like three,
 * and the whole of Oceania is five because the alternative is pretending
 * Papua New Guinea is a market.
 */
export const CONTINENTS: Continent[] = [
  {
    id: "north_america",
    name: "North America",
    regions: [
      region("us_east", "US East", "north_america", 140, 2.6, "open",
        "The money and the media. Everything launched here is judged here."),
      region("us_central", "US Central", "north_america", 95, 2.1, "open",
        "Cheaper to serve and slower to switch. Loyalty here is real loyalty."),
      region("us_west", "US West", "north_america", 100, 2.8, "open",
        "Early to everything, and the first to leave for whatever is next."),
      region("canada", "Canada", "north_america", 40, 2.4, "open",
        "Small, wealthy and concentrated in five cities. Easy to reach, hard to grow."),
      region("mexico", "Mexico", "north_america", 130, 1.0, "open",
        "Young, urban, and priced nothing like the country above it."),
    ],
  },
  {
    id: "south_america",
    name: "South America",
    regions: [
      region("brazil", "Brazil", "south_america", 215, 0.9, "open",
        "A continent's worth of people in one language. Nobody wins the rest without it."),
      region("andean", "Andean states", "south_america", 120, 0.7, "open",
        "Colombia, Peru, Ecuador, Bolivia. Mobile-first, cash-poor, and growing fast."),
      region("southern_cone", "Southern Cone", "south_america", 60, 1.1, "open",
        "Argentina, Chile, Uruguay. The wealthiest here, and the least predictable currency."),
      region("caribbean", "Caribbean", "south_america", 45, 0.9, "open",
        "Dozens of small markets that each need their own answer."),
      region("central_america", "Central America", "south_america", 50, 0.7, "open",
        "Tied to the north economically and to the south culturally."),
    ],
  },
  {
    id: "europe",
    name: "Europe",
    regions: [
      region("uk_ireland", "UK & Ireland", "europe", 75, 2.0, "open",
        "One language, one regulator, and a press that decides quickly whether it likes you."),
      region("dach", "DACH", "europe", 100, 2.4, "open",
        "Germany, Austria, Switzerland. Slow to adopt, expensive to lose, and it reads the terms."),
      region("france_benelux", "France & Benelux", "europe", 100, 2.1, "open",
        "Protective of its own, and worth the trouble once you are one of them."),
      region("southern_europe", "Southern Europe", "europe", 125, 1.4, "open",
        "Spain, Italy, Portugal, Greece. Price-sensitive, social, and it spreads by word of mouth."),
      region("eastern_europe", "Eastern Europe", "europe", 120, 1.0, "open",
        "Technical, cheap to serve, and it will build its own if you overcharge."),
    ],
  },
  {
    id: "africa",
    name: "Africa",
    regions: [
      region("west_africa", "West Africa", "africa", 420, 0.35, "open",
        "Nigeria and its neighbours. The youngest large market on earth, and the loudest."),
      region("east_africa", "East Africa", "africa", 300, 0.3, "open",
        "Kenya, Ethiopia, Tanzania. Mobile money worked here before it worked anywhere."),
      region("north_africa", "North Africa", "africa", 260, 0.6, "open",
        "Egypt and the Maghreb. Arabic-speaking, and it looks north as much as south."),
      region("southern_africa", "Southern Africa", "africa", 95, 0.8, "open",
        "South Africa and around it. The continent's deepest infrastructure, and its sharpest inequality."),
      region("central_africa", "Central Africa", "africa", 150, 0.25, "open",
        "Enormous, young, and the hardest place here to deliver anything at all."),
    ],
  },
  {
    id: "middle_east",
    name: "Middle East",
    regions: [
      region("gulf", "The Gulf", "middle_east", 60, 2.6, "open",
        "Small, extremely wealthy, and it buys the best available rather than the cheapest."),
      region("turkey", "Türkiye", "middle_east", 85, 1.0, "open",
        "Young, urban, and it sits in both directions at once."),
      region("levant", "Levant", "middle_east", 60, 0.6, "open",
        "Fragmented and well-educated. Hard logistics, cheap talent."),
      region("iran", "Iran", "middle_east", 90, 0.5, "closed",
        "Ninety million people behind sanctions. Nobody sells here from outside."),
      region("central_asia", "Central Asia", "middle_east", 80, 0.7, "open",
        "The Stans. Newly reachable, and nobody has bothered yet."),
    ],
  },
  {
    id: "asia",
    name: "Asia",
    regions: [
      region("china", "China", "asia", 1410, 1.2, "guarded",
        "A fifth of the world, a licence regime, and a domestic competitor for everything. Being from here is worth more than any amount of money."),
      region("india", "India", "asia", 1430, 0.5, "open",
        "The same size and the opposite problem: open to anyone, and it will not pay much."),
      region("sea", "Southeast Asia", "asia", 690, 0.7, "open",
        "Indonesia, Vietnam, Philippines, Thailand. Eleven markets sold as one, to everyone's cost."),
      region("japan_korea", "Japan & Korea", "asia", 175, 2.2, "open",
        "Demanding, wealthy, and unforgiving about quality. The best reference customers on earth."),
      region("south_asia", "Pakistan & Bangladesh", "asia", 420, 0.35, "open",
        "Vast, young and almost entirely unserved by anybody's software."),
    ],
  },
  {
    id: "oceania",
    name: "Oceania",
    regions: [
      region("australia_east", "Eastern Australia", "oceania", 20, 2.5, "open",
        "Sydney, Melbourne, Brisbane. Where the money and the head offices are."),
      region("australia_west", "Western Australia", "oceania", 7, 2.4, "open",
        "Resources money, a long way from everywhere, including the rest of Australia."),
      region("new_zealand", "New Zealand", "oceania", 5, 2.0, "open",
        "Small enough to take seriously as a test, and it knows it."),
      region("pacific", "Pacific Islands", "oceania", 12, 0.5, "open",
        "Hundreds of islands and no cheap way to reach any of them."),
      region("png", "Papua New Guinea", "oceania", 10, 0.3, "open",
        "Ten million people, eight hundred languages, and almost no infrastructure."),
    ],
  },
];

export const ALL_REGIONS: WorldRegion[] = CONTINENTS.flatMap((c) => c.regions);

export const regionById = (id: string): WorldRegion | undefined => ALL_REGIONS.find((r) => r.id === id);

export const continentOf = (regionId: string): ContinentId | undefined => regionById(regionId)?.continent;

/** Everyone alive on the map, in millions. Used to turn a population into a share. */
export const WORLD_POPULATION = ALL_REGIONS.reduce((sum, r) => sum + r.population, 0);

/**
 * What a region is worth to a business, before that business's own market is
 * taken into account: people, weighted by what those people can spend.
 *
 * A market measured in heads makes Central Africa four times Japan and gets
 * every decision in the game wrong. A market measured in money alone makes the
 * Gulf larger than India, which is wrong in the other direction. This is the
 * product of the two, which is the crude, defensible middle.
 */
export const marketWeightOf = (r: WorldRegion): number => r.population * r.wealth;

// ─── Getting in ──────────────────────────────────────────────────────────────

/** What a guarded region costs to enter, against what its size alone suggests. */
export const GUARDED_ENTRY = 4;
/** And how well it works once you are in, coming from outside. */
export const GUARDED_FIT = 0.55;

/**
 * Whether a company can open here at all.
 *
 * Home is the continent it started on. A closed region is only ever sold to
 * from inside it, and a guarded one can be entered from outside — at a price,
 * and never as well as a local does it.
 */
export function canEnter(region: WorldRegion, home: ContinentId | undefined): boolean {
  if (region.access === "closed") return region.continent === home;
  return true;
}

/** What entering costs, as a multiple of the ordinary cost for a region this size. */
export function entryMultiplier(region: WorldRegion, home: ContinentId | undefined): number {
  if (region.continent === home) return 1;
  if (region.access === "guarded") return GUARDED_ENTRY;
  // Another continent is simply further away: a different regulator, a
  // different language, and nobody there has heard of you.
  return 1.6;
}

/**
 * How well selling here works, for a company that is not from here.
 *
 * Not a punishment for ambition — an honest account of what being foreign
 * costs. A guarded market is the sharp case: you are competing with somebody
 * who has the regulator's ear and the home market's habits.
 */
export function fitMultiplier(region: WorldRegion, home: ContinentId | undefined): number {
  if (region.continent === home) return 1;
  if (region.access === "guarded") return GUARDED_FIT;
  return 0.85;
}

// ─── Turning a map into a market ─────────────────────────────────────────────

/** How much of a market lives on a continent, where the market has an opinion. */
const penetrationOf = (niche: Pick<Niche, "penetration">, continent: ContinentId): number =>
  Math.max(0, niche.penetration?.[continent] ?? 1);

/**
 * What one region is worth to one market: people, times what they can spend,
 * times how much this particular business means to them.
 */
export const weightFor = (niche: Pick<Niche, "penetration">, r: WorldRegion): number =>
  marketWeightOf(r) * penetrationOf(niche, r.continent);

/**
 * The regions a market has, at world scale.
 *
 * A market that names a `worldHome` keeps its own regions as the detail inside
 * that one piece of the map — Leeds is still Leeds, and still the cheapest
 * place to find out whether the thing works — and gains the other thirty-four
 * around it. A market whose regions are already continental is rebuilt from
 * the map outright.
 *
 * Weights come out of the map rather than out of a designer's head: a region
 * is worth its people times their money times what this business means to
 * them, and the whole thing is normalised so a market is still a market. That
 * is why China is a fifth of most of these and Papua New Guinea is a rounding
 * error — which is also true.
 */
export function worldRegionsFor(niche: Niche): City[] {
  const home = niche.worldHome ? regionById(niche.worldHome) : undefined;
  const others = ALL_REGIONS.filter((r) => r.id !== home?.id);

  /*
   * What a region costs to open, in this market's money.
   *
   * Taken from what this market already charges for the regions it has, per
   * point of weight, so a construction firm's entry costs stay construction
   * money and a podcast's stay podcast money. Nothing here invents a price.
   */
  const ownWeight = niche.cities.reduce((sum, c) => sum + c.weight, 0) || 1;
  const ownCost = niche.cities.reduce((sum, c) => sum + c.entryCost, 0);
  const costPerWeight = ownCost / ownWeight;

  const homeWeight = home ? weightFor(niche, home) : 0;
  const rest = others.map((r) => ({ region: r, weight: weightFor(niche, r) }));
  const total = homeWeight + rest.reduce((sum, r) => sum + r.weight, 0);
  if (total <= 0) return niche.cities;

  const out: City[] = [];

  // The home region, still in the detail the market wrote for itself.
  if (home) {
    const share = homeWeight / total;
    for (const city of niche.cities) {
      const within = city.weight / ownWeight;
      out.push({ ...city, weight: share * within });
    }
  }

  for (const { region: r, weight } of rest) {
    const share = weight / total;
    out.push({
      id: r.id,
      name: r.name,
      weight: share,
      /*
       * Priced off what this market already pays for reach, and then off how
       * far away it is: another continent costs more to open than the one you
       * are on, and a guarded market costs several times over.
       */
      entryCost: Math.max(
        10_000,
        Math.round((share * costPerWeight * entryMultiplier(r, home?.continent)) / 10_000) * 10_000,
      ),
      note: r.note,
      /*
       * Left neutral on purpose. A region's character — which kind of customer
       * it suits — is a market's own business and a balance surface of its
       * own; the map's job is how many people live there and how hard they are
       * to reach. Markets can give their regions character as they always
       * have (see `mix` in niches.ts).
       */
      mix: {},
    });
  }

  return out;
}

/** Every region a market has at world scale that this company could still open. */
export const openableIn = (regions: City[], home: ContinentId | undefined): City[] =>
  regions.filter((c) => {
    const r = regionById(c.id);
    return !r || canEnter(r, home);
  });
