/**
 * Each market's marketplace, in its own words.
 *
 * Every market was offered the same nine generic things, so a dating app bid
 * for a "Sports federation licence". The catalogues fix the words; these tests
 * make sure they fix *only* the words — same price, same lifespan, same
 * effect, slot for slot — so the change cannot rebalance a season by accident.
 */
import { describe, it, expect } from "vitest";
import { ASSET_SLOTS, marketListings, templatesFor } from "@shared/simulation/assets";
import { CATALOGUES } from "@shared/simulation/catalogues";
import { NICHES, nicheById } from "@shared/simulation/niches";

describe("every market has a catalogue of its own", () => {
  it("covers all seven markets", () => {
    for (const niche of NICHES) {
      expect(CATALOGUES[niche.id], `${niche.id} has no catalogue`).toBeTruthy();
    }
  });

  /*
   * Entry n is slot n. A catalogue with an entry missing, or two swapped,
   * would put one slot's effect under another thing's name — a licence that
   * adds capacity, a building that adds brand.
   */
  it("lines up with the slots, entry for entry and kind for kind", () => {
    for (const [id, catalogue] of Object.entries(CATALOGUES)) {
      expect(catalogue.length, `${id}: one entry per slot`).toBe(ASSET_SLOTS.length);
      catalogue.forEach((entry, i) => {
        expect(entry.kind, `${id} entry ${i} (${entry.name})`).toBe(ASSET_SLOTS[i].kind);
      });
    }
  });

  it("gives every market different things to buy", () => {
    const names = (id: string) => CATALOGUES[id].map((e) => e.name).join("|");
    const all = NICHES.map((n) => names(n.id));
    expect(new Set(all).size, "two markets share a catalogue").toBe(all.length);
  });

  it("never repeats a name inside one market", () => {
    for (const [id, catalogue] of Object.entries(CATALOGUES)) {
      const names = catalogue.map((e) => e.name);
      expect(new Set(names).size, `${id} lists something twice`).toBe(names.length);
    }
  });
});

describe("a dating app's marketplace", () => {
  const niche = nicheById("dating_apps")!;
  const everything = marketListings({ seasonId: "s", year: 1, niche, count: 100 });

  it("offers things a dating app would actually buy", () => {
    const names = everything.map((l) => l.asset.name);
    expect(names).toContain("Trust & safety moderation centre");
    expect(names).toContain("Matching algorithm patent");
  });

  it("no longer offers the generic items that made no sense for it", () => {
    const names = everything.map((l) => l.asset.name);
    for (const generic of ["Sports federation licence", "Second operations centre", "Retail shelf agreement", "Carrier bundle"]) {
      expect(names, generic).not.toContain(generic);
    }
  });
});

describe("the change is words only", () => {
  /*
   * The point of re-skinning rather than rebalancing: every slot's numbers
   * come through untouched, in every market.
   */
  it("keeps every slot's price, lifespan and effect in every market", () => {
    for (const niche of NICHES) {
      const mine = templatesFor(niche);
      mine.forEach((template, i) => {
        const slot = ASSET_SLOTS[i];
        expect(template.weight, `${niche.id} ${template.name} weight`).toBe(slot.weight);
        expect(template.life, `${niche.id} ${template.name} life`).toBe(slot.life);
        expect(template.effect(niche), `${niche.id} ${template.name} effect`).toEqual(slot.effect(niche));
      });
    }
  });

  it("still deals three things a season, the same three on a replay", () => {
    const niche = nicheById("dating_apps")!;
    const once = marketListings({ seasonId: "s1", year: 2, niche });
    expect(once).toHaveLength(3);
    expect(marketListings({ seasonId: "s1", year: 2, niche })).toEqual(once);
  });
});
