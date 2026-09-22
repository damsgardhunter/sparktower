/**
 * The world the markets sit in.
 *
 * Two things are being held here. The map is *real* — the populations are the
 * world's, so a player who knows that India and China are a third of humanity
 * between them is rewarded for knowing it, and a designer cannot quietly make
 * Europe the centre of it. And a market built on the map is still a market:
 * the weights add up, the prices stay in that market's own money, and the
 * regions a company wrote for itself survive being placed on it.
 */
import { describe, it, expect } from "vitest";
import {
  CONTINENTS, ALL_REGIONS, WORLD_POPULATION, regionById, continentOf, marketWeightOf,
  canEnter, entryMultiplier, fitMultiplier, worldRegionsFor, openableIn,
  GUARDED_ENTRY, GUARDED_FIT,
} from "@shared/simulation/geography";
import { NICHES, nicheById } from "@shared/simulation/niches";

/** The mainland, as the four markets it is. All guarded, all one licence regime. */
const CHINA = ["yangtze", "greater_bay", "north_china", "inland_china"];
const AMERICA = ["us_east", "us_central", "us_west"];

describe("the map", () => {
  it("is seven continents, cut where the lines actually are", () => {
    expect(CONTINENTS).toHaveLength(7);
    // Five each, except Asia: China alone is four markets, and Hong Kong and
    // Taiwan are not behind the same door as the mainland.
    for (const c of CONTINENTS) expect(c.regions.length, c.id).toBeGreaterThanOrEqual(5);
    expect(ALL_REGIONS.length).toBeGreaterThanOrEqual(35);
    expect(new Set(ALL_REGIONS.map((r) => r.id)).size, "two regions share an id").toBe(ALL_REGIONS.length);
  });

  it("holds about as many people as the world does", () => {
    // Eight billion, in millions, give or take how the lines are drawn.
    expect(WORLD_POPULATION).toBeGreaterThan(7_000);
    expect(WORLD_POPULATION).toBeLessThan(8_600);
  });

  it("knows where the people actually are", () => {
    // Not a design decision — a fact, and one the game should not get wrong.
    const china = CHINA.map((id) => regionById(id)!);
    const india = regionById("india")!;
    const chinaPeople = china.reduce((sum, r) => sum + r.population, 0);
    expect(chinaPeople).toBeGreaterThan(1_300);
    expect(india.population).toBeGreaterThan(1_300);
    expect(chinaPeople + india.population).toBeGreaterThan(WORLD_POPULATION * 0.3);
    expect(continentOf("yangtze")).toBe("asia");
    expect(continentOf("uk_ireland")).toBe("europe");

    // And that Africa is the biggest young market and the poorest to sell to.
    const africa = ALL_REGIONS.filter((r) => r.continent === "africa");
    const europe = ALL_REGIONS.filter((r) => r.continent === "europe");
    const people = (rs: typeof africa) => rs.reduce((sum, r) => sum + r.population, 0);
    const money = (rs: typeof africa) => rs.reduce((sum, r) => sum + marketWeightOf(r), 0);
    expect(people(africa), "Africa has more people than Europe").toBeGreaterThan(people(europe));
    expect(money(africa), "and less money in it").toBeLessThan(money(europe));
  });
});

describe("getting in", () => {
  const home = "europe" as const;

  it("lets anybody into an open region, from anywhere", () => {
    const brazil = regionById("brazil")!;
    expect(canEnter(brazil, home)).toBe(true);
    expect(canEnter(brazil, undefined)).toBe(true);
  });

  it("charges for distance, and charges properly for a guarded market", () => {
    const dach = regionById("dach")!;
    const brazil = regionById("brazil")!;
    const china = regionById("yangtze")!;

    // Your own continent is your own continent.
    expect(entryMultiplier(dach, home)).toBe(1);
    expect(fitMultiplier(dach, home)).toBe(1);

    // Somewhere else costs more and works less well.
    expect(entryMultiplier(brazil, home)).toBeGreaterThan(1);
    expect(fitMultiplier(brazil, home)).toBeLessThan(1);

    // And a guarded market is the sharp case.
    expect(entryMultiplier(china, home)).toBe(GUARDED_ENTRY);
    expect(fitMultiplier(china, home)).toBe(GUARDED_FIT);
  });

  it("gives the company that started there the advantage nobody can buy", () => {
    const china = regionById("inland_china")!;
    expect(entryMultiplier(china, "asia"), "a company from Asia pays the ordinary price").toBe(1);
    expect(fitMultiplier(china, "asia"), "and sells there as a local does").toBe(1);
  });

  it("keeps a closed market closed to everyone but its own", () => {
    const iran = regionById("iran")!;
    expect(canEnter(iran, "europe")).toBe(false);
    expect(canEnter(iran, "middle_east")).toBe(true);
    const openable = openableIn(worldRegionsFor(nicheById("mmos")!), "europe");
    expect(openable.some((c) => c.id === "iran"), "a European company was offered Iran").toBe(false);
  });
});

describe("a market placed on the map", () => {
  it("gives every market the whole world, and keeps its own regions where it has them", () => {
    for (const niche of NICHES) {
      const regions = worldRegionsFor(niche);
      const ids = new Set(regions.map((c) => c.id));
      expect(regions.length, `${niche.id} lost regions`).toBeGreaterThanOrEqual(35);

      if (niche.worldHome) {
        // Leeds is still Leeds, and the piece of the map it sits in is gone —
        // replaced by the detail the market wrote for itself.
        for (const city of niche.cities) expect(ids.has(city.id), `${niche.id} lost ${city.id}`).toBe(true);
        expect(ids.has(niche.worldHome), `${niche.id} kept both the home region and its detail`).toBe(false);
      }
    }
  });

  it("is still a market: the weights add up", () => {
    for (const niche of NICHES) {
      const total = worldRegionsFor(niche).reduce((sum, c) => sum + c.weight, 0);
      expect(total, `${niche.id} weights sum to ${total}`).toBeCloseTo(1, 6);
    }
  });

  it("puts the market where the money is, not only where the people are", () => {
    /*
     * The correction that makes the map usable. Measured in heads, every
     * market sends every company to the places with the most people and the
     * least money to spend; measured in money, America is the largest thing
     * on it, which is what it is.
     */
    const regions = worldRegionsFor(nicheById("project_saas")!);
    const by = (id: string) => regions.find((c) => c.id === id)!.weight;
    const sum = (ids: string[]) => ids.reduce((total, id) => total + by(id), 0);

    expect(by("us_east"), "the largest single region a business sells to").toBeGreaterThan(by("inland_china"));
    expect(sum(AMERICA), "America, against India's people").toBeGreaterThan(by("india") * 4);
    expect(by("png")).toBeGreaterThan(0);

    // Where the industry lives, the industry's home wins: games are Asia's.
    const games = worldRegionsFor(nicheById("mmos")!);
    const inGames = (ids: string[]) => ids.reduce((t, id) => t + games.find((c) => c.id === id)!.weight, 0);
    expect(inGames(CHINA)).toBeGreaterThan(inGames(AMERICA));
  });

  it("makes the mainland four markets, and leaves Hong Kong its own way in", () => {
    const regions = worldRegionsFor(nicheById("mmos")!);
    const by = (id: string) => regions.find((c) => c.id === id)!;
    for (const id of CHINA) expect(by(id), id).toBeTruthy();
    // No single square holds a fifth of the board any more.
    for (const id of CHINA) expect(by(id).weight, id).toBeLessThan(0.15);
    // And the open door beside it: small, and nothing like the same thing.
    expect(regionById("hong_kong")!.access).toBe("open");
    expect(by("hong_kong").weight).toBeLessThan(by("yangtze").weight);
    expect(by("hong_kong").entryCost).toBeLessThan(by("yangtze").entryCost);
  });

  it("lets a market say what it is worth to it, without rewriting the world", () => {
    // Drones cannot serve Central Africa the way its people and money suggest.
    const drones = worldRegionsFor(nicheById("drone_delivery")!);
    const saas = worldRegionsFor(nicheById("project_saas")!);
    const shareOf = (rs: typeof drones, id: string) => rs.find((c) => c.id === id)!.weight;
    expect(shareOf(drones, "central_africa")).toBeLessThan(shareOf(drones, "japan_korea"));
    // And a mobile game is worth more in Asia than a project tool is.
    const mmos = worldRegionsFor(nicheById("mmos")!);
    expect(shareOf(mmos, "sea")).toBeGreaterThan(shareOf(saas, "sea"));
  });

  it("prices entry in the market's own money", () => {
    for (const niche of NICHES) {
      const regions = worldRegionsFor(niche);
      const own = niche.cities.reduce((sum, c) => sum + c.entryCost, 0) / niche.cities.length;
      const added = regions.filter((c) => !niche.cities.some((o) => o.id === c.id));
      for (const c of added) {
        expect(c.entryCost, `${niche.id}/${c.id} is free`).toBeGreaterThan(0);
        // In the same world as what this market already charges: never a
        // thousand times it, which is what happens when a builder invents money.
        expect(c.entryCost, `${niche.id}/${c.id} costs ${c.entryCost} against ${own}`).toBeLessThan(own * 120);
      }
      const china = regions.find((c) => c.id === "yangtze");
      const sea = regions.find((c) => c.id === "sea");
      if (china && sea) {
        // Guarded, and so dearer than its size alone would say.
        expect(china.entryCost / china.weight).toBeGreaterThan(sea.entryCost / sea.weight);
      }
    }
  });
});
