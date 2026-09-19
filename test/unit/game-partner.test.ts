/**
 * The bot partner in Ten Years From Now.
 *
 * It exists because without it the game's only mode was broken: a solo game's
 * bot never answered, so every pick round ran its full clock. What is worth
 * pinning is the shape of what it plays — opinions only where an opinion needs
 * no judgement, never an answer that could halve yours.
 */
import { describe, it, expect } from "vitest";
import { BOT_AGREES, BOT_BUDGET_DRIFT, botMove } from "@shared/sprints/partner";
import { CUSTOMER_CARDS, MODEL_CARDS } from "@shared/sprints/cards";

const nurses = { cardId: "night-nurses", label: "Night-shift nurses", detail: "…" };

describe("what the bot backs", () => {
  /*
   * Judging an idea or a product's advantages is not something a bot can do,
   * so it backs yours rather than pretend to an opinion it has no basis for.
   */
  it("backs your idea and your product, exactly as you gave them", () => {
    const idea = { name: "Lighthouse", pitch: "p", proposedBy: "u1" };
    expect(botMove({ round: "idea", gameId: "g", human: idea })).toBe(idea);

    const product = { claims: [{ text: "Works offline", core: true }] };
    expect(botMove({ round: "product", gameId: "g", human: product })).toBe(product);
  });

  /*
   * Returned as the same object, not rebuilt. Invented cards carry their
   * author in the id, so a rebuilt copy would read as a disagreement.
   */
  it("backs an invented card by returning it untouched", () => {
    const mine = { cardId: "custom:u1:0", label: "My old football coach", detail: "" };
    const games = Array.from({ length: 200 }, (_, i) => botMove({
      round: "customer", gameId: `g${i}`, human: mine, deck: CUSTOMER_CARDS,
    }));
    for (const move of games) {
      if (move.cardId.startsWith("custom:")) expect(move).toBe(mine);
    }
  });
});

describe("where the bot has a view", () => {
  it("mostly agrees on a card, and sometimes argues for another", () => {
    const moves = Array.from({ length: 400 }, (_, i) =>
      botMove({ round: "customer", gameId: `g${i}`, human: nurses, deck: CUSTOMER_CARDS }));
    const agreed = moves.filter((m) => m === nurses).length / moves.length;

    // Close to the stated rate, with room for a seeded sample.
    expect(agreed).toBeGreaterThan(BOT_AGREES - 0.1);
    expect(agreed).toBeLessThan(BOT_AGREES + 0.1);
    expect(agreed, "a partner who never disagrees is a mirror").toBeLessThan(1);
  });

  it("only ever argues for a card that is really in the deck", () => {
    const ids = new Set(MODEL_CARDS.map((c) => c.id));
    for (let i = 0; i < 200; i++) {
      const move = botMove({ round: "model", gameId: `g${i}`, human: { cardId: "subscription" }, deck: MODEL_CARDS });
      expect(ids.has(move.cardId), move.cardId).toBe(true);
    }
  });

  it("makes the same call for the same game, so a result can be traced", () => {
    const once = botMove({ round: "customer", gameId: "g1", human: nurses, deck: CUSTOMER_CARDS });
    expect(botMove({ round: "customer", gameId: "g1", human: nurses, deck: CUSTOMER_CARDS })).toEqual(once);
  });
});

describe("the bot's budget", () => {
  it("stays close to yours, never moving a line by more than its drift", () => {
    const yours = { allocation: { marketing: 200_000, "first-engineer": 300_000 } };
    for (let i = 0; i < 50; i++) {
      const theirs = botMove({ round: "spend", gameId: `g${i}`, human: yours }).allocation;
      for (const [line, amount] of Object.entries(yours.allocation)) {
        const drift = Math.abs(theirs[line] - amount) / amount;
        // Drift plus a step's worth of snapping.
        expect(drift, `${line} in game ${i}`).toBeLessThanOrEqual(BOT_BUDGET_DRIFT + 0.05);
      }
    }
  });

  it("never spends past the million", () => {
    const yours = { allocation: { marketing: 500_000, "build-product": 500_000 } };
    for (let i = 0; i < 50; i++) {
      const theirs = botMove({ round: "spend", gameId: `g${i}`, human: yours }).allocation;
      const total = Object.values(theirs as Record<string, number>).reduce((a, b) => a + b, 0);
      expect(total).toBeLessThanOrEqual(1_000_000);
    }
  });

  /*
   * A budget of nothing, averaged with yours, would halve every line you
   * funded. If drift snaps the bot's to nothing it backs yours instead.
   */
  it("backs yours rather than offering a budget of nothing", () => {
    const tiny = { allocation: { community: 5_000 } };
    for (let i = 0; i < 50; i++) {
      const theirs = botMove({ round: "spend", gameId: `g${i}`, human: tiny });
      const total = Object.values(theirs.allocation as Record<string, number>).reduce((a, b) => a + b, 0);
      expect(total, "an empty bot budget would halve yours").toBeGreaterThan(0);
    }
  });
});
