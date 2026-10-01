/**
 * What an event costs, in the money of the market it lands in.
 *
 * Every absolute figure in the engine is scaled to the size of the market —
 * `atScale` exists for exactly that, and the reason is that Nova writes small
 * markets on purpose, so a number that is a hard year in a catalogue market is
 * an extinction event in a generated one.
 *
 * `events.ts` had one piece of money in it and it was the one that was not
 * scaled: a recall cost a flat GBP 450,000. That is about four tenths of the
 * opening bank in the seven hand-written markets, and measured across the
 * markets Nova wrote for real projects it was:
 *
 *     hedgerow (allotment gluts)      29.1x the company's entire bank
 *     kilnshare (spare kiln firings)  22.5x
 *     quorumcast (parish councils)    17.3x
 *     saltbox (sea swimmers)          11.9x
 *
 * Recalls are not rare in those markets either — three or four across eighteen
 * seasons of each — so a founder could lose twenty-nine times everything they
 * had to a single event, with no decision available that would have made it
 * smaller. It is earned by a quality score, which makes it fair; the size of
 * it was not.
 */
import { describe, it, expect } from "vitest";
import { eventFor } from "@shared/simulation/events";
import { buildWorld } from "@shared/simulation/season";
import { nicheById, NICHES } from "@shared/simulation/niches";
import { ROLES, type Role, type World } from "@shared/simulation/types";

/** A company that has let its product slide, which is what earns the recall. */
const sliding = (world: World) => ({
  ...world,
  companies: world.companies.map((c) => (c.kind === "player" ? { ...c, quality: 20, reputation: 50 } : c)),
});

const recallIn = (nicheId: string, niche = nicheById(nicheId)!) => {
  const world = buildWorld({
    seasonId: "recall", niche, cadence: "yearly",
    teams: [{ id: "me", name: "Mine", seats: [...ROLES] as Role[], officers: 1 }],
  });
  const me = world.companies.find((c) => c.id === "me")!;
  /* Walk the years until the draw hands this company its recall. */
  for (let year = 1; year <= 14; year++) {
    const event = eventFor({ world: { ...sliding(world), year }, year, economy: world.economy });
    if (event?.headline?.includes("recall")) return { cost: -(event.effect.cash ?? 0), cash: me.cash };
  }
  return null;
};

describe("what a recall costs", () => {
  it("is a hard year in every market, not an extinction in the small ones", () => {
    for (const niche of NICHES) {
      const hit = recallIn(niche.id);
      if (!hit) continue;
      expect(hit.cost, `${niche.id}: a recall costs nothing`).toBeGreaterThan(0);
      expect(hit.cost / hit.cash, `${niche.id}: a recall costs more than the company has`).toBeLessThan(1);
    }
  });

  it("scales with the market, so a small one is not wiped out by one event", () => {
    /*
     * A market two hundredths the size of a catalogue one. The point is the
     * ratio: the recall has to come down with the market, or the founder loses
     * many times everything they have to a single draw.
     */
    const tiny = {
      ...nicheById("dating_apps")!,
      id: "tiny",
      segments: nicheById("dating_apps")!.segments.map((s) => ({ ...s, size: Math.round(s.size / 200) })),
    };
    const small = recallIn("tiny", tiny);
    const big = recallIn("dating_apps");
    expect(small, "the small market never drew a recall").toBeTruthy();
    expect(big, "the catalogue market never drew a recall").toBeTruthy();
    expect(small!.cost, "a recall costs the same in a market a two-hundredth the size").toBeLessThan(big!.cost);
    expect(small!.cost / small!.cash, "one event took the whole bank").toBeLessThan(1);
  });
});
