/**
 * What a bot partner does in Ten Years From Now.
 *
 * The only way into the game today is a solo game against a bot, and until
 * this module existed the bot did nothing at all. That broke the game in its
 * only mode: a pick round ends early only when both players agree, so with a
 * partner who never answered every round ran its whole clock — twenty-six
 * minutes, most of it spent watching a timer — and every round ended with
 * "only one of you answered".
 *
 * So the bot now plays its side, the moment the person does. Two rules shape
 * what it plays:
 *
 *   - **It has opinions only where an opinion needs no judgement.** Picking a
 *     customer or a business model from a deck is a choice anybody can make,
 *     so the bot sometimes argues for a different card — the hint of
 *     randomness — and a disagreement goes to the same coin two people's
 *     would. Judging an idea or a product's advantages is not something it
 *     can do, so there it backs yours: a bot confidently rewriting your
 *     product would be the product pretending to an opinion it has no basis
 *     for.
 *   - **It never makes you wait.** A person has nobody to persuade in a solo
 *     game, so the round settles as soon as they commit — the server forces it
 *     once the bot has answered.
 *
 * Pure and seeded on the game and round, so a game replays identically and a
 * surprising call can be traced rather than shrugged at.
 */
import { between, pick, rng } from "../simulation/random";
import { cleanAllocation, type Allocation } from "./budget";
import type { Card } from "./cards";
import type { Round } from "./game";

/**
 * How often the bot backs your card rather than arguing for another.
 *
 * Mostly agreeable, on purpose. A partner who disagrees with everything turns
 * every card round into a coin toss, which takes the decision away from the
 * only person actually playing; one who never disagrees is a mirror. Two
 * times in three it goes along with you, and the third it makes a case.
 */
export const BOT_AGREES = 0.65;

/**
 * How far the bot's budget strays from yours, line by line.
 *
 * Its budget is averaged with yours like any partner's, so this is the whole
 * of its influence on the round the valuation leans on hardest — enough that
 * the committed numbers are recognisably a negotiation, never so much that a
 * bot moves a quarter of your million somewhere you didn't put it.
 */
export const BOT_BUDGET_DRIFT = 0.15;

/**
 * The bot's answer to a round, given yours.
 *
 * `human` is your answer as the server has already cleaned it. Where the bot
 * backs you it returns that same object, so agreement is agreement — rebuilt
 * independently it could differ in some incidental field and read as a
 * disagreement, which is exactly what happened with invented cards, whose ids
 * carry their author.
 *
 * Returns null for a round the bot has nothing to say about, which leaves the
 * person's answer standing on its own.
 */
export function botMove(input: {
  round: Round;
  gameId: string;
  human: any;
  /** The deck for a card round, so an argued-for card is a real one. */
  deck?: readonly Card[];
}): any | null {
  const { round, gameId, human, deck } = input;
  if (!human) return null;
  const seed = `game-bot:${gameId}:${round}`;

  switch (round) {
    // Your idea, your product: the bot backs them rather than pretend to judge.
    case "idea":
    case "product":
      return human;

    case "customer":
    case "model": {
      const others = (deck ?? []).filter((c) => c.id !== human.cardId);
      if (others.length === 0 || rng(seed)() < BOT_AGREES) return human;
      const card = pick(`${seed}:card`, others);
      return { cardId: card.id, label: card.label, detail: card.detail };
    }

    case "spend": {
      const mine = (human.allocation ?? {}) as Allocation;
      const drifted: Allocation = {};
      for (const [id, amount] of Object.entries(mine)) {
        drifted[id] = Number(amount) * (1 + between(`${seed}:${id}`, -BOT_BUDGET_DRIFT, BOT_BUDGET_DRIFT));
      }
      // Through the same cleaner a person's budget goes through: snapped to
      // each line's step and held inside the million.
      const allocation = cleanAllocation(drifted);
      /*
       * Small lines can snap to nothing. A bot budget of nothing, averaged with
       * yours, would halve every line you funded — so if drift wiped it out
       * the bot backs your budget instead.
       */
      const total = Object.values(allocation).reduce((a, b) => a + b, 0);
      return total > 0 ? { allocation } : human;
    }

    default:
      return null;
  }
}
