/**
 * What the market prompt asks Nova for.
 *
 * `nova-market.ts` writes the whole world a real project competes in —
 * segments, regions, rivals — rather than choosing from the catalogue. These
 * assert the shape of the ask, because the shape of the ask is what came back
 * wrong: a range invites the floor.
 */
import { describe, it, expect } from "vitest";
import { buildMarketPrompt, parseMarket } from "../../server/nova-market";
import { MAX_INCUMBENTS, MAX_REGIONS, MIN_SEGMENT_SIZE } from "@shared/simulation/custom-market";
import { winnabilityOf } from "@shared/simulation/winnable";

/**
 * A market with two segments and three regions is the same market every time.
 *
 * The prompt asked for "two to five" segments and "3 to 10" regions, and a
 * model asked for a range takes the floor: three markets written from three
 * real projects came back with exactly two and exactly three, every time. Two
 * segments is two positioning choices, two price tiers and two kinds of buyer
 * to be for — the whole middle of the game, gone, whatever the business is.
 *
 * The incumbents block has always said "exactly four — not three, not five"
 * and named the four archetypes, and it gets four every time. Segments and
 * regions are written the same way now. Asking again after the change: four
 * segments and five or six regions in every market, and the one that had been
 * unplayable came back with twenty thousand customers instead of five.
 */
describe("what the market prompt asks for", () => {
  const prompt = buildMarketPrompt({
    project: { title: "A thing", description: "Something somebody is building.", goal: "ship_mvp", category: "saas" },
    startup: true,
  });

  it("asks for four segments, in the words that worked for the rivals", () => {
    expect(prompt.system, "a range invites the floor").not.toMatch(/two to five groups/i);
    expect(prompt.system).toMatch(/exactly four groups/i);
    expect(prompt.system, "and says what the four usually are").toMatch(/procurement/i);
  });

  it("asks for more than the minimum number of regions", () => {
    expect(prompt.system).toMatch(/five or six places/i);
    expect(prompt.system, "and says why, so it is not read as arbitrary").toMatch(/where to go next is a decision/i);
  });

  it("still asks for exactly four rivals", () => {
    // The instruction this one was modelled on, which has always been obeyed.
    expect(prompt.system).toMatch(/not three, not five/i);
  });
});

describe("reading back what Nova sends", () => {
  it("refuses an answer that is not a market", () => {
    expect(parseMarket("I'd be happy to help you design a market!", "x")).toBeNull();
    expect(parseMarket("", "x")).toBeNull();
    expect(parseMarket("{ not json", "x")).toBeNull();
  });
});

/*
 * The winnability guard, on the path a player's market actually takes.
 *
 * `parseMarket` now refuses a market a business cannot be built in, and the route
 * treats that as a market that did not come back: it falls back to the nearest of
 * the seven and says the market is not theirs. That is the right outcome for an
 * unplayable market and a terrible one for a playable market wrongly judged — the
 * fallback is silent by design, so a guard that was too strict would quietly take
 * every bespoke market away and the only trace would be a line in a log.
 *
 * Every test above this asserts a refusal. This asserts the other direction, which
 * is the one that would not have been noticed.
 */
describe("the winnability guard on a written market", () => {
  /*
   * The same shape `every-market-winnable.test.ts` sweeps as a generated market and
   * finds playable, written as the JSON a model would answer with so it goes
   * through the real path: `parseModelJson`, then the cleaner, then the guard.
   */
  const PLAYABLE = JSON.stringify({
    name: "Scrap yards",
    premise: "Routing and weighbridge software for independent yards.",
    baseUnitCost: 60,
    segments: [
      { id: "single", name: "Single-site yards", size: 4000, referencePrice: 600, growth: 0.03, priceSensitivity: 0.6, qualityFocus: 0.5, brandFocus: 0.2, serviceFocus: 0.6, loyalty: 0.6 },
      { id: "multi", name: "Multi-site", size: 2500, referencePrice: 1000, growth: 0.05, priceSensitivity: 0.4, qualityFocus: 0.6, brandFocus: 0.3, serviceFocus: 0.7, loyalty: 0.7 },
      { id: "groups", name: "Groups", size: 2000, referencePrice: 1200, growth: 0.06, priceSensitivity: 0.3, qualityFocus: 0.7, brandFocus: 0.4, serviceFocus: 0.7, loyalty: 0.8 },
    ],
    regions: [1, 2, 3, 4, 5].map((i) => ({ id: `r${i}`, name: `R${i}`, weight: i === 1 ? 0.32 : 0.17, entryCost: 20_000, note: "" })),
    incumbents: [0.32, 0.2, 0.15].map((startingShare, i) => ({ id: `riv${i}`, name: `Rival ${i}`, posture: "coaster", startingShare, quality: 55, brand: 50, service: 50, priceIndex: 1 })),
  });

  it("lets a market somebody could play through", () => {
    const niche = parseMarket(PLAYABLE, "scrap-yards");
    expect(niche, "the guard threw away a market the balance sweep finds playable").toBeTruthy();
    expect(niche!.segments.length).toBe(3);
  }, 30_000);

  /*
   * A market that is entirely legal and cannot be played.
   *
   * This is the shape the guard exists for, and finding it took some looking —
   * which is worth recording, because the first three fixtures tried all came back
   * playable and each one taught something about where the real defences are:
   *
   *   - rivals given `startingShare: 1` across every segment are **normalised**
   *     back down by the cleaner, so the unowned pool is never emptied that way;
   *   - a `baseUnitCost` above the price of everything is **clamped** (2,000
   *     became 420 against a cheapest price of 600), so a hopeless margin cannot
   *     be written directly either.
   *
   * So `buildCustomMarket` already repairs every one of those faults taken on its
   * own. What it cannot see is a *combination* of individually reasonable numbers:
   * the smallest segments allowed, no growth, customers almost perfectly loyal,
   * and the most incumbents allowed, all excellent and all undercutting. Every
   * field is inside its range; a competent founder still wins nobody in sixteen
   * quarters. Only playing it finds that.
   */
  const UNPLAYABLE = JSON.stringify({
    name: "Hostile", premise: "A market written badly.", baseUnitCost: 60,
    segments: ["a", "b"].map((id) => ({
      id, name: id.toUpperCase(), size: MIN_SEGMENT_SIZE, referencePrice: 20, growth: 0,
      priceSensitivity: 0.95, qualityFocus: 0.9, brandFocus: 0.9, serviceFocus: 0.9, loyalty: 0.95,
    })),
    regions: Array.from({ length: MAX_REGIONS }, (_, i) => ({ id: `r${i}`, name: `R${i}`, weight: 1 / MAX_REGIONS, entryCost: 20_000, note: "" })),
    incumbents: Array.from({ length: MAX_INCUMBENTS }, (_, i) => ({
      id: `riv${i}`, name: `Rival ${i}`, posture: "defender", startingShare: 0.9 / MAX_INCUMBENTS,
      quality: 98, brand: 98, service: 98, priceIndex: 0.5,
    })),
  });

  it("refuses one that is legal and still cannot be won", () => {
    expect(parseMarket(UNPLAYABLE, "hostile"), "an unwinnable market was handed to a player").toBeNull();
  }, 30_000);

  it("leaves a market already in play alone", () => {
    /*
     * Replay passes `check: false`, and must: a stored market that failed the guard
     * would come back as "nothing to replay", which takes away a season somebody
     * has already played in order to tell them it was unfair.
     */
    expect(parseMarket(UNPLAYABLE, "hostile", { check: false })).toBeTruthy();
  });
});

/*
 * The project types that are not software.
 *
 * `PROJECT_SUBCATEGORIES.ship_mvp` grew three: `physical`, `food` and `channel`.
 * The phase tree got variants for them; the market generator did not even know
 * which type a project was — `subcategory` was never passed — and its prompt
 * assumes throughout that a customer is somebody who pays a price.
 *
 * For two of the three that is survivable. A channel breaks it outright: the
 * audience does not pay. Asked "what does this segment consider a normal price"
 * about a viewer, a model either invents a subscription nobody charges or writes
 * $0.004 a view, which the market's own floor rounds up to a dollar — and one
 * viewer becomes worth as much as one enterprise licence.
 */
describe("a market for a project that is not software", () => {
  it("tells the model which type of project it is", () => {
    const prompt = buildMarketPrompt({
      project: { title: "Weeknight Woodwork", description: "A channel.", subcategory: "channel" },
      startup: true,
    });
    expect(prompt.user).toContain("Project type: channel");
  });

  it("says what a customer and a price are, for the trades where the prompt's answer is wrong", () => {
    for (const subcategory of ["channel", "food", "physical"]) {
      const prompt = buildMarketPrompt({ project: { title: "X", subcategory }, startup: true });
      expect(prompt.system, `${subcategory} got no shape note`).toContain("THIS TRADE");
    }
  });

  it("leaves the software types alone, because the general prompt is already theirs", () => {
    for (const subcategory of ["app", "saas", "game", "website", "other", ""]) {
      const prompt = buildMarketPrompt({ project: { title: "X", subcategory }, startup: true });
      expect(prompt.system, `${subcategory} was given a note it does not need`).not.toContain("THIS TRADE");
    }
  });

  it("tells a channel to write the audience large and the value per head small", () => {
    /*
     * Both halves, because either alone produces a market that reads as nonsense:
     * a large audience at licence prices, or a tiny audience whose viewers the
     * engine has to make valuable to keep the founder solvent.
     */
    const prompt = buildMarketPrompt({ project: { title: "X", subcategory: "channel" }, startup: true }).system;
    expect(prompt).toMatch(/subscriber is worth/);
    expect(prompt).toMatch(/single digits/);
    expect(prompt).toMatch(/hundreds of thousands/);
  });

  /*
   * And the shape has to survive the engine, which is the part a prompt cannot
   * promise. A channel market is unlike any of the seven: an enormous audience
   * worth a few dollars a head, against a cost base that is almost all people.
   */
  const CHANNEL = JSON.stringify({
    name: "Weeknight Woodwork",
    premise: "Small woodworking projects you can finish after work.",
    baseUnitCost: 1,
    voice: {
      customers: "subscribers", customer: "subscriber", sale: "a watched video",
      capacity: "uploads", capacityShort: "uploads", region: "territory",
      turnedAway: "people who clicked away",
    },
    segments: [
      { id: "dabblers", name: "Weekend dabblers", size: 380_000, referencePrice: 2, growth: 0.06, priceSensitivity: 0.85, qualityFocus: 0.35, brandFocus: 0.25, serviceFocus: 0.2, loyalty: 0.2 },
      { id: "regulars", name: "Regular makers", size: 160_000, referencePrice: 5, growth: 0.05, priceSensitivity: 0.5, qualityFocus: 0.7, brandFocus: 0.4, serviceFocus: 0.45, loyalty: 0.55 },
      { id: "pros", name: "Working joiners", size: 55_000, referencePrice: 9, growth: 0.03, priceSensitivity: 0.3, qualityFocus: 0.9, brandFocus: 0.5, serviceFocus: 0.6, loyalty: 0.75 },
      { id: "gifters", name: "Present-makers", size: 90_000, referencePrice: 3, growth: 0.08, priceSensitivity: 0.75, qualityFocus: 0.4, brandFocus: 0.6, serviceFocus: 0.25, loyalty: 0.15 },
    ],
    regions: [
      { id: "uk", name: "UK and Ireland", weight: 0.3, entryCost: 2_000, note: "" },
      { id: "us", name: "United States", weight: 0.34, entryCost: 12_000, note: "" },
      { id: "anz", name: "Australia and NZ", weight: 0.14, entryCost: 4_000, note: "" },
      { id: "ca", name: "Canada", weight: 0.12, entryCost: 3_500, note: "" },
      { id: "eu", name: "Europe, in English", weight: 0.1, entryCost: 5_000, note: "" },
    ],
    incumbents: [
      { id: "i1", name: "Shed & Chisel", posture: "fortress", startingShare: 0.24, quality: 78, brand: 82, service: 55, priceIndex: 1 },
      { id: "i2", name: "Quick Cuts Daily", posture: "brawler", startingShare: 0.14, quality: 48, brand: 62, service: 35, priceIndex: 0.7 },
      { id: "i3", name: "The Joinery School", posture: "innovator", startingShare: 0.1, quality: 88, brand: 44, service: 70, priceIndex: 1.4 },
      { id: "i4", name: "HomeFix Everything", posture: "coaster", startingShare: 0.08, quality: 52, brand: 70, service: 40, priceIndex: 0.9 },
    ],
    workforce: [
      { id: "editors", name: "editors", one: "an editor", does: "product", pay: 0.9, share: 0.5, serves: 400 },
      { id: "research", name: "researchers", one: "a researcher", does: "product", pay: 1.1, share: 0.2 },
      { id: "community", name: "community managers", one: "a community manager", does: "service", pay: 0.8, share: 0.3 },
    ],
  });

  it("builds a channel market the engine will accept", () => {
    const niche = parseMarket(CHANNEL, "weeknight-woodwork");
    expect(niche, "a channel market was refused outright").toBeTruthy();
    /* The voice is the whole point: this market must not talk about users and units. */
    expect(niche!.voice.customers).toBe("subscribers");
    expect(niche!.voice.capacityShort).toBe("uploads");
    expect(niche!.segments).toHaveLength(4);
  }, 30_000);

  it("keeps a subscriber worth single digits rather than making them an enterprise licence", () => {
    /*
     * `pricedForABusiness` lifts every price together until a founder can clear
     * break-even, which is right and is why the audience has to be written large:
     * at 75,000 subscribers the same market came back with a viewer worth $33.
     */
    const niche = parseMarket(CHANNEL, "weeknight-woodwork")!;
    const dearest = Math.max(...niche.segments.map((s) => s.referencePrice));
    expect(dearest, `a subscriber ended up worth ${dearest}`).toBeLessThan(30);
  }, 30_000);

  it("keeps the order Nova put the segments in, even when the prices move", () => {
    /*
     * The lift moves every price together so the *shape* survives — who pays more
     * than whom. That is the guarantee `pricedForABusiness` documents, and it is
     * what makes positioning mean anything in a generated market.
     */
    const niche = parseMarket(CHANNEL, "weeknight-woodwork")!;
    const byId = Object.fromEntries(niche.segments.map((s) => [s.id, s.referencePrice]));
    expect(byId.dabblers).toBeLessThan(byId.regulars);
    expect(byId.regulars).toBeLessThan(byId.pros);
    expect(byId.gifters).toBeLessThan(byId.regulars);
  }, 30_000);

  it("is a season somebody could actually play", () => {
    /*
     * The guard in `parseMarket` already refuses an unplayable market, so this
     * would fail as a null above — asserted on its own anyway, because "it parsed"
     * and "a founder can build something here" are different claims and this is
     * the one that matters to whoever gets the season.
     */
    const niche = parseMarket(CHANNEL, "weeknight-woodwork")!;
    const verdict = winnabilityOf(niche);
    expect(verdict.ok, `unwinnable: ${verdict.problems.join("; ")}`).toBe(true);
  }, 30_000);
});
