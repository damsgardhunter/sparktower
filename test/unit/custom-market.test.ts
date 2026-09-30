/**
 * A market Nova wrote has to be playable, whatever Nova said.
 *
 * The seven hand-made markets are balanced against each other and against
 * years of play. A written one is a model's best guess, and the failure that
 * matters is not "unfair" — a hard market is fine — but "the engine divides
 * by zero" or "the incumbents own 140% of it and nothing a team does can
 * matter". Both read to a player as the game being broken.
 *
 * So the contract is narrow: `buildCustomMarket` either returns something the
 * engine can run or returns null, and never anything in between.
 */
import { describe, it, expect } from "vitest";
import {
  buildCustomMarket, marketProblems, marketShares, MIN_SEGMENT_SIZE, MAX_SEGMENT_SIZE,
  INCUMBENT_SHARE_MIN, INCUMBENT_SHARE_MAX, INCUMBENT_STRENGTH_MEAN_MAX, ENTRY_COST_MAX_SHARE,
  openShareFor, ROOM_FOR_A_BUSINESS, OPEN_SHARE_MAX, PRICE_ROOM_FOR_A_BUSINESS,
} from "@shared/simulation/custom-market";
import { officerCost } from "@shared/simulation/decisions";
import { marketScale } from "@shared/simulation/world";
import { TRULY_OPEN_SHARE } from "@shared/simulation/incumbents";
import { NICHES } from "@shared/simulation/niches";
import { resolveYear } from "@shared/simulation/resolve";
import { startingCompany } from "@shared/simulation/season";
import { seedIncumbents } from "@shared/simulation/incumbents";
import { LEVER_FIELDS, speak } from "@shared/simulation/levers";
import { marketListings, templatesFor } from "@shared/simulation/assets";
import { ROLES, type World } from "@shared/simulation/types";

const sane = {
  name: "Veterinary practice software",
  premise: "Software for small animal clinics.",
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
  baseUnitCost: 30,
  innovationPace: 1.1,
  voice: { customer: "clinic", customers: "clinics", unit: "licence", capacity: "seats" },
};

describe("a market Nova wrote", () => {
  it("comes back playable when the answer is sane", () => {
    const m = buildCustomMarket(sane, "fallback")!;
    expect(m).toBeTruthy();
    expect(marketProblems(m)).toEqual([]);
    expect(m.name).toBe("Veterinary practice software");
    expect(m.voice.customers).toBe("clinics");
  });

  it("actually runs a year in the engine", () => {
    /*
     * The claim that matters. Everything else here is about not producing
     * nonsense; this is about the nonsense-free thing being a game.
     */
    const niche = buildCustomMarket(sane, "fallback")!;
    const company = startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] });
    const world: World = {
      seasonId: "custom", niche, year: 1,
      economy: { demand: 1, interestRate: 0.06, costIndex: 1, outlook: "steady" },
      companies: [...seedIncumbents(niche), company],
    };
    const out = resolveYear(world, [{
      companyId: "t",
      cmo: { price: 130, brandSpend: 200_000, performanceSpend: 100_000, celebritySpend: 0, targetCities: ["north"] },
      cto: { featureSpend: 150_000, reliabilitySpend: 80_000, techDebtPaydown: 0 },
      coo: { capacityTarget: company.capacity, supportSpend: 90_000, efficiencySpend: 0, headcount: 4 },
      cfo: { borrow: 0, repay: 0, cashBuffer: 0 },
      ceo: { focus: "growth" },
    } as any]);
    const report = out.reports.find((r) => r.companyId === "t")!;
    expect(report.revenue).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(report.profit)).toBe(true);
    expect(Number.isFinite(report.marketShare)).toBe(true);
  });

  it("normalises region weights and incumbent share rather than refusing them", () => {
    const m = buildCustomMarket({
      ...sane,
      regions: sane.regions.map((r) => ({ ...r, weight: 7 })),        // all wrong, all equal
      incumbents: sane.incumbents.map((i) => ({ ...i, startingShare: 0.9 })), // 180% of the market
    }, "fallback")!;
    expect(m.cities.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 6);
    expect(m.incumbents.reduce((s, i) => s + i.startingShare, 0), "180% of a market is pulled back to the ceiling").toBeCloseTo(INCUMBENT_SHARE_MAX, 6);
    expect(marketProblems(m)).toEqual([]);
  });

  it("keeps a market it can run out of a market that is far too big or far too small", () => {
    const tiny = buildCustomMarket({ ...sane, segments: sane.segments.map((s) => ({ ...s, size: 3 })) }, "f")!;
    expect(tiny.segments.every((s) => s.size >= MIN_SEGMENT_SIZE)).toBe(true);

    const huge = buildCustomMarket({ ...sane, segments: sane.segments.map((s) => ({ ...s, size: 9e9 })) }, "f")!;
    expect(huge.segments.every((s) => s.size <= MAX_SEGMENT_SIZE)).toBe(true);
  });

  it("never lets a segment price at nothing", () => {
    const m = buildCustomMarket({ ...sane, segments: sane.segments.map((s) => ({ ...s, referencePrice: 0 })) }, "f")!;
    expect(m.segments.every((s) => s.referencePrice >= 1)).toBe(true);
    expect(marketProblems(m)).toEqual([]);
  });

  it("gives two things that would share an id different ones", () => {
    const m = buildCustomMarket({
      ...sane,
      segments: [{ ...sane.segments[0], id: "same" }, { ...sane.segments[1], id: "same" }],
      regions: sane.regions.map((r) => ({ ...r, id: "one" })),
    }, "f")!;
    expect(new Set(m.segments.map((s) => s.id)).size).toBe(2);
    expect(new Set(m.cities.map((c) => c.id)).size).toBe(3);
    expect(marketProblems(m)).toEqual([]);
  });

  it("drops a region's mix for segments that do not exist", () => {
    const m = buildCustomMarket({
      ...sane,
      regions: [{ ...sane.regions[0], segmentMix: { single_site: 1.4, invented: 9 } }, ...sane.regions.slice(1)],
    }, "f")!;
    const mix = (m.cities[0] as any).segmentMix ?? {};
    expect(Object.keys(mix)).toEqual(["single_site"]);
  });

  it("returns null rather than a broken market when there is not one in the answer", () => {
    for (const bad of [
      null, undefined, "a market", 42, {},
      { ...sane, segments: [sane.segments[0]] },              // one segment is not a market
      { ...sane, regions: sane.regions.slice(0, 1) },          // nowhere to expand to
      { ...sane, incumbents: [sane.incumbents[0]] },           // nobody to take share from
      { ...sane, segments: "not a list" },
    ]) {
      expect(buildCustomMarket(bad, "f"), JSON.stringify(bad)?.slice(0, 40)).toBeNull();
    }
  });

  it("fills in everything a hurried answer left out", () => {
    const bare = {
      segments: [{ name: "A" }, { name: "B" }],
      regions: [{ name: "One" }, { name: "Two" }, { name: "Three" }],
      incumbents: [{ name: "X" }, { name: "Y" }],
    };
    const m = buildCustomMarket(bare, "fallback-id")!;
    expect(m).toBeTruthy();
    expect(marketProblems(m)).toEqual([]);
    expect(m.id).toBe("fallback-id");
    expect(m.voice.customers).toBe("customers");
    expect(m.incumbents[0].persona.tagline.length).toBeGreaterThan(0);
  });
});

/**
 * The screen somebody reads before deciding whether to play.
 *
 * It answers one question — is there room for me? — so the numbers on it have
 * to be the numbers the first year is allocated from, not a second opinion
 * about them. A rival that looks unbeatable there has to be unbeatable in the
 * season, and an open share that reads 12% has to be 12% of something.
 */
describe("who holds the market, and what is left", () => {
  const rivals = (...shares: number[]) => ({
    incumbents: shares.map((startingShare, i) => ({
      id: `r${i}`, name: `Rival ${i}`, posture: "fortress" as const,
      startingShare, quality: 60, brand: 60, service: 60, priceIndex: 1,
      persona: { tagline: "", boss: "", character: "", known: "", knock: `knock ${i}`, voice: "" },
    })),
  });

  it("leaves the newcomer what the incumbents do not hold", () => {
    const { rivals: out, open } = marketShares(rivals(0.3, 0.2, 0.2, 0.1));
    expect(out).toHaveLength(4);
    expect(open).toBeCloseTo(0.2, 6);
    expect(out.map((r) => r.share)).toEqual([0.3, 0.2, 0.2, 0.1]);
  });

  it("keeps a door open when the model hands back a market with none", () => {
    /*
     * Four rivals holding 1.4 between them is not a market, it is a model that
     * did not add up its own numbers. Scaled back rather than rejected,
     * because their *relative* sizes are the part it did think about.
     */
    const { rivals: out, open } = marketShares(rivals(0.5, 0.4, 0.3, 0.2));
    expect(open, "there is always somewhere to enter").toBeGreaterThan(0);
    expect(out.reduce((n, r) => n + r.share, 0)).toBeCloseTo(0.95, 6);
    expect(out[0].share / out[3].share, "and who is biggest is unchanged").toBeCloseTo(2.5, 6);
  });

  it("does not inflate a market that already left room", () => {
    const { open } = marketShares(rivals(0.2, 0.15, 0.1, 0.05));
    expect(open, "half of it is genuinely open; say so").toBeCloseTo(0.5, 6);
  });

  it("never reports a negative share, whatever it is handed", () => {
    const { rivals: out, open } = marketShares(rivals(-0.3, 0.4, 0.2, 0.1));
    expect(out.every((r) => r.share >= 0)).toBe(true);
    expect(open).toBeGreaterThanOrEqual(0);
  });
});

/**
 * How contested a market is, kept as a fact about the market.
 *
 * Every custom market used to be renormalised onto one number, so the answer
 * to "is there room here" was the same 12% whatever Nova had written — a
 * constant wearing the clothes of an analysis. What a founder is choosing
 * between is precisely a crowded trade and an open one, and the engine could
 * not tell them apart.
 */
describe("how contested the market is", () => {
  const withShares = (...shares: number[]) => buildCustomMarket({
    ...sane,
    incumbents: shares.map((startingShare, i) => ({
      id: `r${i}`, name: `Rival ${i}`, posture: "coaster", startingShare,
      quality: 50, brand: 50, service: 50, priceIndex: 1,
    })),
  }, "fallback")!;

  const held = (m: { incumbents: { startingShare: number }[] }) =>
    m.incumbents.reduce((s, i) => s + i.startingShare, 0);

  it("leaves an open market open", () => {
    const m = withShares(0.25, 0.2);
    expect(held(m), "45% held is a real market shape; keep it").toBeCloseTo(0.45, 6);
    expect(marketShares(m).open, "and over half of it is genuinely there to win").toBeCloseTo(0.55, 6);
  });

  it("leaves a crowded market crowded", () => {
    const m = withShares(0.45, 0.35);
    expect(held(m)).toBeCloseTo(0.8, 6);
    expect(marketShares(m).open).toBeCloseTo(0.2, 6);
  });

  it("tells the two apart, which is the whole point", () => {
    expect(held(withShares(0.25, 0.2))).toBeLessThan(held(withShares(0.45, 0.35)));
  });

  it("will not hand over a market nobody is in", () => {
    // Two rivals holding a twentieth between them is a greenfield, not a trade.
    expect(held(withShares(0.03, 0.02))).toBeCloseTo(INCUMBENT_SHARE_MIN, 6);
  });

  it("keeps who is biggest, whichever edge it is pulled to", () => {
    const m = withShares(0.6, 0.3);   // 90% — over the ceiling
    expect(held(m)).toBeCloseTo(INCUMBENT_SHARE_MAX, 6);
    expect(m.incumbents[0].startingShare / m.incumbents[1].startingShare).toBeCloseTo(2, 6);
  });
});

/**
 * A market Nova wrote has every word a desk needs.
 *
 * `cleanVoice` filled nine of the fourteen fields and ended with
 * `as NicheVoice`, so the other five were `undefined` at runtime on a type
 * that promised strings. It went unnoticed because the levers reading them
 * belong to the operations and technology desks, and a seat is only ever sent
 * its own desk's levers — so a Nova-built season crashed for the chief
 * operating officer and for nobody else. A solo founder holding all five desks
 * hit it on the first poll: `voice.capacityShort.charAt` of undefined, 500,
 * forever.
 *
 * The test walks every lever of every desk, because that is the thing that was
 * actually broken and checking the keys exist would not have caught a
 * fifteenth being added later.
 */
describe("the words a written market speaks", () => {
  /* Exactly what a model actually returned: nine of the fourteen fields. */
  const bare = {
    ...sane,
    voice: {
      per: "per active builder per month", unit: "active builder", brand: "cred",
      place: "city hub", places: "city hubs", quality: "signal",
      capacity: "active build squads", customer: "builder", customers: "builders",
    },
  };

  it("fills in every word the model left out", () => {
    const m = buildCustomMarket(bare, "fallback")!;
    expect(m).toBeTruthy();
    for (const [key, value] of Object.entries(m.voice)) {
      expect(typeof value, `voice.${key}`).toBe("string");
      expect(value, `voice.${key} is empty`).not.toBe("");
    }
  });

  it("speaks every lever on every desk without throwing", () => {
    const m = buildCustomMarket(bare, "fallback")!;
    for (const role of ROLES) {
      for (const field of LEVER_FIELDS[role]) {
        expect(() => speak(field, m.voice), `${role}.${field.id}`).not.toThrow();
      }
    }
  });

  /* Derived from what the model did say, not replaced by a generic word. */
  it("borrows the market's own vocabulary for the words it invents", () => {
    const m = buildCustomMarket(bare, "fallback")!;
    expect(m.voice.capacityShort).toContain("builders");
    expect(m.voice.turnedAway).toContain("builders");
  });

  /* And the same holds for the four-word voice the other tests here use. */
  it("leaves nothing undefined however little the model said", () => {
    const m = buildCustomMarket(sane, "fallback")!;
    for (const role of ROLES) {
      for (const field of LEVER_FIELDS[role]) {
        expect(() => speak(field, m.voice), `${role}.${field.id}`).not.toThrow();
      }
    }
  });
});

/**
 * A market Nova wrote names the things it sells.
 *
 * The nine asset slots are shapes — a distribution deal, somewhere to serve
 * people from — and the seven catalogue markets name theirs by hand. A written
 * market had no catalogue entry, so it fell through to the generic slot names,
 * and a founder rehearsing a SaaS business was offered a retail shelf
 * agreement and a carrier bundle for a product with no shelves.
 */
describe("what a written market calls the things it sells", () => {
  const named = (assets: unknown) => buildCustomMarket({ ...sane, assets }, "f")!;

  it("uses the market's own names where the kinds line up", () => {
    const m = named([
      { kind: "distribution", name: "App store placement", blurb: "Found without looking." },
      { kind: "distribution", name: "Reseller agreement", blurb: "Somebody else sells it." },
      { kind: "celebrity", name: "Founder residency", blurb: "A name people know." },
      { kind: "patent", name: "Scheduling patent", blurb: "Yours, permanently." },
      { kind: "patent", name: "Interface portfolio", blurb: "A fence round the screen." },
      { kind: "facility", name: "Another cloud region", blurb: "Room to serve more clinics." },
      { kind: "facility", name: "Automated onboarding", blurb: "Cheaper per clinic, for good." },
      { kind: "brand_licence", name: "Association endorsement", blurb: "Borrowed credibility." },
      { kind: "brand_licence", name: "Journal partnership", blurb: "Quieter than a celebrity." },
    ]);
    const names = templatesFor(m).map((t) => t.name);
    expect(names).toContain("Another cloud region");
    expect(names).toContain("App store placement");
    expect(names, "and none of retail's").not.toContain("Retail shelf agreement");
  });

  /*
   * One bad entry costs its own slot and nothing else's. Taken by kind rather
   * than by position precisely so a dropped entry cannot shift a patent's
   * economics onto something called a warehouse.
   */
  it("keeps the rest when one entry names the wrong kind", () => {
    const m = named([
      { kind: "warehouse", name: "Nonsense", blurb: "Not a kind." },
      { kind: "facility", name: "Another cloud region", blurb: "Room to serve more." },
    ]);
    const facility = templatesFor(m).filter((t) => t.kind === "facility");
    expect(facility[0].name, "the good one still lands on a facility").toBe("Another cloud region");
    for (const t of templatesFor(m)) expect(t.name).not.toBe("Nonsense");
  });

  /*
   * A season already under way cannot be re-written — the market is the thing
   * somebody is playing — so a market built before Nova named anything still
   * has to stop offering software a retail shelf. Derived from the voice every
   * market already carries, which costs nothing and asks nobody.
   */
  it("says the slots in its own words when nobody named them", () => {
    const m = buildCustomMarket({ ...sane, voice: { ...sane.voice, capacity: "consulting rooms", customers: "clinics" } }, "f")!;
    const names = templatesFor(m).map((t) => t.name);
    expect(names, "retail's words are gone").not.toContain("Retail shelf agreement");
    expect(names).toContain("More consulting rooms");
    expect(names.some((n) => n.includes("clinics")), "and it knows who the customers are").toBe(true);
  });

  /* A patent is a patent in every trade; assembling one out of tokens is worse English. */
  it("leaves the slots that were never wrong alone", () => {
    const names = templatesFor(buildCustomMarket(sane, "f")!).map((t) => t.name);
    expect(names).toContain("Core process patent");
    expect(names).toContain("Three-year ambassador");
  });

  it("prefers what Nova wrote over what it would have derived", () => {
    const m = named([{ kind: "facility", name: "Another cloud region", blurb: "Room to serve more." }]);
    const names = templatesFor(m).map((t) => t.name);
    expect(names).toContain("Another cloud region");
    expect(names.filter((n) => n.startsWith("More ")), "the derived one gave way").toHaveLength(0);
  });

  /* Priced at the size of the market, not at a corporation's. */
  it("prices what it sells against this market's payroll", () => {
    const startup = buildCustomMarket({ ...sane, segments: sane.segments.map((s) => ({ ...s, size: 400, referencePrice: 30 })) }, "f")!;
    const big = buildCustomMarket(sane, "f")!;
    const cheapest = (n: typeof big) => Math.min(...marketListings({ seasonId: "s", year: 1, niche: n }).map((l) => l.reserve));
    expect(cheapest(startup)).toBeLessThan(cheapest(big));
  });
});

/**
 * A market you can actually sell in.
 *
 * `baseUnitCost` was taken as written, bounded only by 1 and 50,000, with no
 * relationship to the prices the same answer invented. One market came back
 * with a unit cost of 18 and segments paying 12, 7, 29 and 119: two of the
 * four could never be sold to at any volume, at any price they would accept,
 * in any year of the season. The desk said so on every screen — "every unit
 * sold at 17 costs 18 to make" — and it was right, and there was nothing to
 * be done about it.
 */
describe("what it costs to serve one customer", () => {
  const priced = (prices: number[], baseUnitCost: number) => buildCustomMarket({
    ...sane,
    baseUnitCost,
    segments: prices.map((referencePrice, i) => ({
      id: `s${i}`, name: `S${i}`, description: "x", size: 10_000, growth: 0.05,
      priceSensitivity: 0.5, qualityFocus: 0.5, brandFocus: 0.3, serviceFocus: 0.5,
      loyalty: 0.5, referencePrice,
    })),
  }, "f")!;

  it("leaves a sensible answer alone", () => {
    expect(priced([50, 200], 12).baseUnitCost).toBe(12);
  });

  /* The exact shape that was reported. */
  it("caps a cost the cheapest customer could never cover", () => {
    const m = priced([12, 7, 29, 119], 18);
    const cheapest = Math.min(...m.segments.map((s) => s.referencePrice));
    expect(m.baseUnitCost).toBeLessThan(cheapest);
  });

  it("leaves every segment worth serving at a price it would pay", () => {
    for (const prices of [[12, 7, 29, 119], [5, 5, 5], [900, 30]]) {
      const m = priced(prices, 10_000);
      for (const s of m.segments) {
        expect(m.baseUnitCost, `${s.referencePrice} must cover ${m.baseUnitCost}`).toBeLessThan(s.referencePrice);
      }
    }
  });

  /* Not a floor on margin: a thin segment is a real thing to discover. */
  it("still allows a market where the margin is thin", () => {
    const m = priced([10, 100], 7);
    expect(m.baseUnitCost).toBe(7);
  });
});

/**
 * A market whose rivals are all excellent is decided before anybody sits down.
 *
 * The share they hold is banded (see `INCUMBENT_SHARE_MIN`) and how *good*
 * they are was not, so Nova could truthfully describe a field averaging ninety
 * for quality and brand. A company opens at quality 38 and brand 8, and four
 * years of good play reaches about 64 and 57 — against that field nothing a
 * founder does changes the ordering.
 */
describe("how strong a market Nova wrote is allowed to be", () => {
  const withRivals = (rivals: any[]) => buildCustomMarket({ ...sane, incumbents: rivals }, "x")!;

  it("takes a hard market as written", () => {
    // One fortress and three ordinary rivals: a real market shape, untouched.
    const m = withRivals([
      { id: "a", name: "A", posture: "fortress", startingShare: 0.34, quality: 88, brand: 88, service: 65, priceIndex: 1.2 },
      { id: "b", name: "B", posture: "coaster", startingShare: 0.22, quality: 48, brand: 60, service: 45, priceIndex: 1 },
      { id: "c", name: "C", posture: "innovator", startingShare: 0.18, quality: 72, brand: 40, service: 55, priceIndex: 0.85 },
      { id: "d", name: "D", posture: "discounter", startingShare: 0.14, quality: 38, brand: 28, service: 30, priceIndex: 0.6 },
    ]);
    expect(m.incumbents[0].quality, "the market leader is still excellent").toBe(88);
    expect(m.incumbents.map((i) => i.brand)).toEqual([88, 60, 40, 28]);
  });

  it("pulls back a field nobody could out-build, keeping who is best", () => {
    const m = withRivals([
      { id: "a", name: "A", posture: "fortress", startingShare: 0.3, quality: 95, brand: 95, service: 90, priceIndex: 1.2 },
      { id: "b", name: "B", posture: "brawler", startingShare: 0.25, quality: 92, brand: 90, service: 88, priceIndex: 1 },
      { id: "c", name: "C", posture: "innovator", startingShare: 0.2, quality: 90, brand: 88, service: 85, priceIndex: 0.9 },
      { id: "d", name: "D", posture: "coaster", startingShare: 0.13, quality: 88, brand: 85, service: 80, priceIndex: 1 },
    ]);
    const mean = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / ns.length;
    expect(mean(m.incumbents.map((i) => i.quality))).toBeLessThanOrEqual(INCUMBENT_STRENGTH_MEAN_MAX);
    expect(mean(m.incumbents.map((i) => i.brand))).toBeLessThanOrEqual(INCUMBENT_STRENGTH_MEAN_MAX);
    // Scaled, not clipped: the ordering the model thought about survives.
    const q = m.incumbents.map((i) => i.quality);
    expect([...q].sort((a, b) => b - a)).toEqual(q);
    expect(q[0]).toBeGreaterThan(q[3]);
  });

  it("leaves every catalogue market alone", () => {
    for (const niche of NICHES) {
      const mean = niche.incumbents.reduce((sum, i) => sum + i.quality, 0) / niche.incumbents.length;
      expect(mean, `${niche.name} is written under the ceiling already`).toBeLessThanOrEqual(INCUMBENT_STRENGTH_MEAN_MAX);
    }
  });
});

/**
 * A market written for a real project is small, and the floors were not.
 *
 * Asked about a stocktake app for independent bottle shops, Nova wrote a
 * market worth £210,000 a year with three regions priced at 5,000, 7,000 and
 * 4,000 to open — deliberately different, the small one cheapest. Entry costs
 * were clamped to at least £10,000, a figure from the catalogue where a market
 * turns over £400m, so all three were lifted to the floor and came out
 * identical. Every distinction the model drew was gone before anybody saw it.
 */
describe("what a region costs to open, in a market this size", () => {
  const market = (entry: number[]) => ({
    ...sane,
    segments: [
      { id: "a", name: "Established", description: "x", size: 3_000, growth: 0.03, priceSensitivity: 0.3, qualityFocus: 0.7, brandFocus: 0.5, serviceFocus: 0.6, loyalty: 0.7, referencePrice: 50 },
      { id: "b", name: "New", description: "x", size: 2_000, growth: 0.1, priceSensitivity: 0.6, qualityFocus: 0.5, brandFocus: 0.3, serviceFocus: 0.4, loyalty: 0.3, referencePrice: 30 },
    ],
    regions: [
      { id: "leeds", name: "Leeds", weight: 0.6, entryCost: entry[0], note: "Home." },
      { id: "manchester", name: "Manchester", weight: 0.2, entryCost: entry[1], note: "Bigger." },
      { id: "york", name: "York", weight: 0.2, entryCost: entry[2], note: "Smaller." },
    ],
  });

  it("keeps the order the model wrote them in", () => {
    const m = buildCustomMarket(market([5_000, 7_000, 4_000]), "x")!;
    const [leeds, manchester, york] = m.cities;
    expect(manchester.entryCost, "the dearest stays the dearest").toBeGreaterThan(leeds.entryCost);
    expect(york.entryCost, "and the cheapest stays the cheapest").toBeLessThan(leeds.entryCost);
  });

  it("prices them against what the market is worth", () => {
    const m = buildCustomMarket(market([5_000, 7_000, 4_000]), "x")!;
    /* The market turns over 3,000 x 50 + 2,000 x 30 = 210,000 a year. */
    for (const city of m.cities) {
      expect(city.entryCost, `${city.name} costs more than its share of the market is worth in a year`)
        .toBeLessThanOrEqual(210_000 * city.weight * ENTRY_COST_MAX_SHARE + 1);
      expect(city.entryCost, `${city.name} is free to open`).toBeGreaterThan(0);
    }
  });

  it("takes a market written inside the ceiling exactly as written", () => {
    /*
     * 210,000 a year, so the ceiling is 2% of each region's share: 2,520 for
     * Leeds and 840 for the other two. Written under that, nothing moves.
     */
    const m = buildCustomMarket(market([2_000, 800, 700]), "x")!;
    expect(m.cities.map((c) => c.entryCost)).toEqual([2_000, 800, 700]);
  });

  it("fills in a sensible figure when the model leaves it out", () => {
    const m = buildCustomMarket(market([undefined as any, undefined as any, undefined as any]), "x")!;
    for (const city of m.cities) {
      expect(city.entryCost, `${city.name} was defaulted to a catalogue-sized number`)
        .toBeLessThanOrEqual(210_000 * city.weight * ENTRY_COST_MAX_SHARE + 1);
      expect(city.entryCost).toBeGreaterThan(0);
    }
  });
});

/**
 * A market you can actually run a business in.
 *
 * Every other rule in the cleaner checks a market's *shape* — how many
 * segments, how big, how much the rivals hold, what a region costs to enter.
 * None of them asked whether a company could live in the result, and markets
 * came back where one could not.
 *
 * Nova is asked to write small, because it is writing about a real project:
 * nine of nine markets generated from real briefs came back under GBP 2.5m a
 * year, five of them under GBP 700,000. A tenth of a market that size, split
 * again by region, is not a business. Measured on the worst of them — a
 * kiln-firing marketplace, 9,000 people, GBP 235,000 a year — a founder had a
 * home region with 270 unowned customers against a break-even of 181, and was
 * **never once profitable**: not on any of eight season seeds, not at any rate
 * of spending from nothing to an eighth of the bank each period, never in
 * sixteen quarters. The most anyone reached was 104 customers of 9,000.
 *
 * Two rules answer it, and they are deliberately not the same bar.
 * `openShareFor` opens the market up until the home region holds enough
 * unowned customers to clear break-even, because how much of a young market is
 * unserved is a number nobody wrote down and nobody will miss.
 * `pricedForABusiness` lifts the prices only for whatever that could not
 * reach, because a price is something Nova *said*. Held to the same bar, a
 * sea-swimming app's prices went up 246-fold; split, the same markets get
 * there on a 20-fold lift with the open share doing the work.
 */
describe("a market you can run a business in", () => {
  /** The rule, restated: the home region holds enough unowned customers to clear break-even. */
  const roomInHome = (niche: any) => {
    const people = niche.segments.reduce((sum: number, s: any) => sum + s.size, 0);
    const biggest = [...niche.segments].sort((a: any, b: any) => b.size - a.size)[0];
    const contribution = Math.max(1, biggest.referencePrice - niche.baseUnitCost);
    const payroll = officerCost({ officers: 1, scale: marketScale(niche) });
    const breakEven = payroll / contribution;
    const home = Math.max(...niche.cities.map((c: any) => c.weight));
    return (people * home * (niche.openShare ?? TRULY_OPEN_SHARE)) / breakEven;
  };

  it("asks for something near a tenth in the markets it was not written for", () => {
    /*
     * The rule has to agree, roughly, with seven markets it had no part in, or
     * it is not a rule about whether a business is possible — it is a number
     * picked to rescue a few generated ones.
     *
     * It asks those seven for between 0.126 and 0.265: never less than the
     * tenth they were built with, never within reach of the cap, and between
     * 1.3x and 2.6x rather than the 3.5x it asks of the markets Nova writes.
     * They keep their tenth regardless, because they are hand-tuned and never
     * go through the cleaner.
     *
     * What is worth more than the range is the order. The market it asks least
     * of is project SaaS, which is the one market profitable on eight seeds of
     * eight; two of the three it asks most of are drone delivery and podcasts,
     * profitable on two of eight. The rule ranks them about the way playing
     * them does, which is the evidence that it is measuring the right thing.
     */
    for (const niche of NICHES) {
      const asked = openShareFor(niche);
      expect(asked, `${niche.id}: the rule would leave less room than the catalogue does`).toBeGreaterThanOrEqual(TRULY_OPEN_SHARE);
      expect(asked, `${niche.id}: a hand-written market should not need opening up like a tiny one`).toBeLessThan(OPEN_SHARE_MAX);
    }
  });

  it("opens a market up when a tenth of it is not a business", () => {
    /* The kiln-firing marketplace, to scale: small, cheap, and split five ways. */
    const tiny = buildCustomMarket({
      name: "Kiln hire", premise: "Spare firings, booked by the shelf.", baseUnitCost: 5,
      segments: [
        { id: "solo", name: "Solo hobbyists", size: 3000, referencePrice: 15, growth: 0.04, priceSensitivity: 0.6, qualityFocus: 0.4, brandFocus: 0.3, serviceFocus: 0.4, loyalty: 0.3 },
        { id: "groups", name: "Collectives", size: 2000, referencePrice: 25, growth: 0.03, priceSensitivity: 0.5, qualityFocus: 0.5, brandFocus: 0.3, serviceFocus: 0.5, loyalty: 0.4 },
      ],
      regions: [1, 2, 3, 4, 5].map((i) => ({ id: `r${i}`, name: `R${i}`, weight: i === 1 ? 0.3 : 0.175, entryCost: 500, note: "" })),
      incumbents: [0.3, 0.2, 0.15].map((startingShare, i) => ({
        id: `r${i}`, name: `Rival ${i}`, posture: "coaster", startingShare,
        quality: 50, brand: 50, service: 50, priceIndex: 1,
      })),
    }, "kiln")!;
    expect(tiny, "the market was refused outright").toBeTruthy();
    expect(tiny.openShare!, "a market this small was left at a tenth").toBeGreaterThan(TRULY_OPEN_SHARE);
    expect(tiny.openShare!, "no incumbents left in it").toBeLessThanOrEqual(OPEN_SHARE_MAX);
    /* A whole customer of slack, because prices are rounded to the pound. */
    expect(roomInHome(tiny), "the home region still cannot pay for the business")
      .toBeGreaterThanOrEqual(Math.min(ROOM_FOR_A_BUSINESS, PRICE_ROOM_FOR_A_BUSINESS) - 1);
  });

  it("lifts the prices when the biggest segment earns nothing per customer", () => {
    /*
     * The sea-swimming app: 50,000 people, and the segment the opening
     * defaults sell at paying GBP 1 a year against a GBP 1 unit cost. No
     * number of customers covers a salary at zero margin, and the unit-cost
     * clamp cannot help, because `num` floors a unit cost at 1.
     */
    const free = buildCustomMarket({
      name: "Swim", premise: "Tides, temperature and who else is going.", baseUnitCost: 1,
      segments: [
        { id: "casual", name: "Casual", size: 20000, referencePrice: 1, growth: 0.05, priceSensitivity: 0.8, qualityFocus: 0.3, brandFocus: 0.4, serviceFocus: 0.3, loyalty: 0.2 },
        { id: "keen", name: "Enthusiasts", size: 15000, referencePrice: 3, growth: 0.06, priceSensitivity: 0.5, qualityFocus: 0.6, brandFocus: 0.3, serviceFocus: 0.5, loyalty: 0.5 },
      ],
      regions: [1, 2, 3, 4, 5].map((i) => ({ id: `r${i}`, name: `R${i}`, weight: i === 1 ? 0.3 : 0.175, entryCost: 500, note: "" })),
      incumbents: [0.3, 0.2, 0.15].map((startingShare, i) => ({
        id: `r${i}`, name: `Rival ${i}`, posture: "coaster", startingShare,
        quality: 50, brand: 50, service: 50, priceIndex: 1,
      })),
    }, "swim")!;
    const biggest = [...free.segments].sort((a, b) => b.size - a.size)[0];
    expect(biggest.referencePrice - free.baseUnitCost, "the biggest segment still earns nothing").toBeGreaterThan(1);
    /* And the shape Nova wrote survives: the keen still pay more than the casual. */
    const casual = free.segments.find((s) => s.id === "casual")!;
    const keen = free.segments.find((s) => s.id === "keen")!;
    expect(keen.referencePrice / casual.referencePrice, "who pays more than whom was rewritten").toBeCloseTo(3, 0);
  });
});
