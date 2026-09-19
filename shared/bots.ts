/**
 * Who the product's bots are.
 *
 * One cast, shared by everything that needs to fill an empty seat: the
 * simulation lobby that needs five people to be a company, and the co-founder
 * sprint queue where somebody is waiting for a partner who hasn't arrived.
 *
 * It lives here rather than under `simulation/` because the alternative — a
 * second set of identities for sprints — would mean two definitions of what a
 * bot is, two places to remember to exclude them from matches and league
 * tables, and eventually one of them being forgotten. There is one `isBot`
 * column; there should be one cast to go with it.
 *
 * The rules they are built to, wherever they appear:
 *
 *   - **They are always labelled.** A bot carries an ordinary name, because a
 *     league table reading "Bot 3" is worse than one reading "Ada Fournier" —
 *     but every surface that shows one says what it is. Passing for a person
 *     is the product lying about who somebody is working with.
 *   - **They only appear when somebody is actually waiting.** An empty room is
 *     not a room to fill.
 *   - **They are deterministic.** Seeded from what they are filling, so the
 *     same situation produces the same cast and a surprising result can be
 *     traced rather than shrugged at.
 */
import { rng } from "./simulation/random";

/**
 * How long somebody waits alone before the product fills the gap.
 *
 * A minute. Short enough that nobody sits looking at an empty table, long
 * enough that two people arriving together still get each other. The clocks
 * this undercuts are much longer — fifteen minutes in a simulation lobby, and
 * a sprint queue with no ceiling at all — and they exist to give real people
 * time to arrive. This exists for when they don't.
 */
export const BOT_FILL_AFTER_SECONDS = 60;

/** What a bot is called in every surface that shows one. */
export const BOT_LABEL = "Bot";

/**
 * Names bots are drawn from.
 *
 * Ordinary and unremarkable on purpose: a lobby of "TestUser1".."TestUser5"
 * reads as a broken deployment, and the people around these names are meant to
 * feel like people you are building something with. The label beside the name
 * is what keeps it honest; the name itself is only there to be readable.
 *
 * Deliberately not generated from a model — a fixed list is reproducible, has
 * no per-call cost, and can be read by a person checking that none of them
 * resembles a real user of this product.
 */
const FIRST_NAMES = [
  "Ada", "Bea", "Cai", "Dev", "Esme", "Finn", "Greta", "Hugo", "Iris", "Jonas",
  "Kira", "Luca", "Maya", "Nils", "Otis", "Priya", "Quinn", "Rosa", "Sven", "Tara",
  "Umi", "Vera", "Wren", "Xan", "Yusuf", "Zara",
] as const;

const LAST_NAMES = [
  "Fournier", "Okafor", "Lindqvist", "Marchetti", "Halvorsen", "Nakamura",
  "Delgado", "Abernathy", "Sørensen", "Варга", "Kowalski", "Mbeki",
  "Ferreira", "Novak", "Rasmussen", "Aziz",
].filter((n) => /^[\x20-\x7E]+$/.test(n)); // ASCII only: these go in email local-parts too.

export interface BotIdentity {
  /** Stable key: the same index always produces the same person. */
  index: number;
  firstName: string;
  lastName: string;
  /** On a domain that can never receive mail, so nothing is ever sent to one. */
  email: string;
}

/** How many distinct bots exist at all. */
export const BOT_POOL_SIZE = FIRST_NAMES.length;

/**
 * The bot at `index`.
 *
 * Stable across restarts and deployments, because the account is looked up by
 * this address. A bot whose name changed between seasons would look like a
 * different player holding the same history.
 */
export function botIdentity(index: number): BotIdentity {
  const i = Math.abs(Math.floor(index));
  const firstName = FIRST_NAMES[i % FIRST_NAMES.length];
  const lastName = LAST_NAMES[(i * 7 + 3) % LAST_NAMES.length];
  return {
    index: i,
    firstName,
    lastName,
    // `.invalid` is reserved by RFC 2606 and resolves nowhere: even a bug that
    // tried to email a bot could not reach anybody.
    email: `bot-${i}-${firstName}.${lastName}@bots.sparktower.invalid`.toLowerCase(),
  };
}

/** The display name a surface shows, beside the label that keeps it honest. */
export const botDisplayName = (b: Pick<BotIdentity, "firstName" | "lastName">) => `${b.firstName} ${b.lastName}`;

/**
 * Which bot identities to use for a given thing being filled.
 *
 * Seeded from `seed` — a venture id, a queue entry id — so re-running a fill
 * picks the same people rather than a fresh cast each time it is retried.
 */
export function botsFor(seed: string, count: number, poolSize = BOT_POOL_SIZE): BotIdentity[] {
  const next = rng(`bots:${seed}`);
  const chosen: number[] = [];
  // Distinct: two bots with one name in a five-person company reads as a bug.
  while (chosen.length < Math.min(count, poolSize)) {
    const i = Math.floor(next() * poolSize) % poolSize;
    if (!chosen.includes(i)) chosen.push(i);
  }
  return chosen.map(botIdentity);
}

/**
 * How many bots to add to something that has waited long enough.
 *
 * Up to its size, never past it, and never when it is already full. Returns 0
 * when nobody is waiting: a room with no people in it is not a room to fill,
 * it is a room to retire, and filling it would have bots playing against each
 * other for nobody's benefit.
 */
export function botsNeeded(input: { humans: number; lobbySize: number }): number {
  const { humans, lobbySize } = input;
  if (humans <= 0) return 0;
  return Math.max(0, lobbySize - humans);
}
