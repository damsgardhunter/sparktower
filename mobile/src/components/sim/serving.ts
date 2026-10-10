/**
 * Whether you could serve the customers you are about to buy.
 *
 * Mirrors `servingAfter` and `SERVING_TIGHT` in `shared/simulation/mergers.ts`,
 * and checked against them by `test/unit/mobile-mirror.test.ts`.
 *
 * ## Why this is its own file
 *
 * It lived in `offers.ts`, which is the right place for it by subject and the
 * wrong one for it by dependency: `offers.ts` imports `../../theme` for the eleven
 * colours its verdict copy carries, so it reaches React Native, so the mirror test
 * cannot load it. That matters more than tidiness here. The engine hands a buyer
 * every customer the seller had and none of their plant, so anybody beyond
 * capacity is turned away — in public, in the year every other team is watching
 * the company that just bought somebody — and the asking price says nothing about
 * it while `canOffer` will not refuse it. Two clients disagreeing about whether a
 * deal is survivable is worse than neither warning, because one of them then gets
 * trusted.
 *
 * So the sum moved out here where it can be pinned, and `offers.ts` re-exports it
 * so nothing that already imported it has to change. Nothing is imported into this
 * file at all — not even a type — because a type-only import of `./offers` would
 * be erased at runtime and still fail the guard that reads import specifiers out
 * of the source, which is the guard doing its job.
 */

/**
 * One in ten of your own room is the line between "tight" and "fine".
 *
 * Not zero: a deal that lands you exactly at capacity has no slack for a good
 * year and the screen should say so without crying wolf. Not a quarter either — a
 * company deliberately buying a crowd it intends to build for is playing well, and
 * a warning it sees every time is a warning it stops reading.
 */
export const SERVING_TIGHT = 0.1;

export interface ServiceGap {
  /** Everybody you would hold, yours plus theirs. */
  held: number;
  /** What you can serve, now. Room ordered but not yet open does not count. */
  capacity: number;
  /** How many of them would be turned away. */
  short: number;
  over: boolean;
  /** Room enough, and none to spare. */
  tight: boolean;
  /**
   * The sentence to show, or null when there is nothing honest to say.
   *
   * Null only when the server sent no capacity: a reassuring guess there would
   * read as "this deal is fine", which is the one thing it must never say by
   * accident.
   */
  line: string | null;
}

export function serviceGap(input: {
  you: { capacity: number; customers: number } | null | undefined;
  target: { customers: number };
}): ServiceGap {
  const { you, target } = input;
  const capacity = Number.isFinite(you?.capacity) ? Number(you?.capacity) : Number.NaN;
  const yours = Number.isFinite(you?.customers) ? Number(you?.customers) : Number.NaN;
  const arriving = Number.isFinite(target.customers) ? Math.max(0, target.customers) : 0;

  // Without the server's figures there is nothing honest to say, and a
  // reassuring guess here would be worse than silence.
  if (!Number.isFinite(capacity) || !Number.isFinite(yours)) {
    return { held: arriving, capacity: 0, short: 0, over: false, tight: false, line: null };
  }

  const held = Math.max(0, yours) + arriving;
  const short = Math.max(0, held - capacity);
  const tight = short === 0 && held > capacity * (1 - SERVING_TIGHT);

  const sum = `You would hold ${held.toLocaleString()} customers and can serve ${capacity.toLocaleString()}.`;
  return {
    held,
    capacity,
    short,
    over: short > 0,
    tight,
    line: short > 0
      ? `${sum} ${short.toLocaleString()} of them get turned away — in public, and it costs reputation. Operations have a year to fix that.`
      : tight
        ? `${sum} That leaves nothing spare: a good year, or anybody they bring with them, and you start turning people away.`
        : `${sum} Everybody who arrives gets served.`,
  };
}
