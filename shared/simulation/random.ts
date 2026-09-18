/**
 * Repeatable randomness.
 *
 * The simulation has no `Math.random()` anywhere, and this is what replaces
 * it. Everything that looks random — which assets come up for sale in year
 * six, which challenge a chief financial officer is set — is a pure function
 * of a seed made from things that are already fixed: the season's id, the
 * year, a person's id.
 *
 * Two reasons, and the second is the one that matters.
 *
 * The first is testing: a season can be replayed exactly, so a complaint about
 * year nine can be reproduced rather than guessed at.
 *
 * The second is fairness, and it is the reason this is not negotiable. A tick
 * can be re-run — it is built to be, because a process can die halfway through
 * writing it. If the market's contents were drawn from real randomness, the
 * second run would deal a different hand, and a player who had already seen
 * the first one would be looking at a screen that no longer matched the
 * database. Seeded, the retry produces the same world, and re-running a tick
 * stays the harmless thing it is designed to be.
 */

/** FNV-1a. Small, fast, and stable across engines — which a `hashCode` is not. */
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}

/**
 * A deterministic stream of numbers in [0, 1).
 *
 * Mulberry32: one line of arithmetic, no dependencies, and a long enough
 * period that nothing here will ever see it repeat.
 */
export function rng(seed: string | number): () => number {
  let a = (typeof seed === "string" ? hash(seed) : seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One item, chosen by seed. */
export function pick<T>(seed: string, items: readonly T[]): T {
  if (items.length === 0) throw new RangeError("pick from an empty list");
  return items[Math.floor(rng(seed)() * items.length) % items.length];
}

/**
 * `count` distinct items, chosen by seed.
 *
 * A shuffle rather than repeated picks, because repeated picks can hand back
 * the same item twice — which for a marketplace would mean the same patent
 * listed alongside itself.
 */
export function sample<T>(seed: string, items: readonly T[], count: number): T[] {
  const next = rng(seed);
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(0, Math.min(count, pool.length)));
}

/** A number in [min, max], by seed. */
export const between = (seed: string, min: number, max: number): number =>
  min + rng(seed)() * (max - min);
