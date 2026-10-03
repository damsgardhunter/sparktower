/**
 * Hashing a password, in one place and off the request thread.
 *
 * ## Why this file exists at all
 *
 * The cost factor used to be the literal `12` written out at five call sites,
 * which is five chances for one of them to drift and no way to notice. It is
 * one constant now, and the only way in is through these two functions.
 *
 * ## Why the native `bcrypt` and not `bcryptjs`
 *
 * `bcryptjs` is pure JavaScript, so its work happens on the one thread that
 * serves every request. Measured on this laptop, 200 passwords at cost 12:
 *
 *                wall clock      event-loop lag (p50)
 *   bcryptjs        75,403ms              20,181ms
 *   native          16,036ms                   1ms
 *
 * Twenty seconds of event-loop lag is not a slow endpoint, it is a process
 * that has stopped answering. The async `bcryptjs` path does chunk its work
 * with `setImmediate`, which is why HTTP requests still trickle through — a
 * bystander on an unrelated screen saw 225ms rather than the full 420ms of a
 * single hash — but a continuous stream of `setImmediate` callbacks starves
 * timers outright, and it does nothing about the total: 200 arrivals is 75
 * seconds of CPU that everything else queues behind.
 *
 * The native module hashes on libuv's threadpool, so the request thread stays
 * free and four hash at once. That is the whole of the change.
 *
 * This matters because registering and signing in are the *only* routes that
 * hash, and they are exactly what a launch morning or a workshop consists of.
 * See `docs/ops/scaling-to-2000.md` step 8, and `scripts/sim-load.ts`, whose
 * bystander probe is how this was found.
 *
 * ## Why this is safe for rows that already exist
 *
 * Both libraries read and write the same standard format, in both directions —
 * proven before the swap and held by `password-hash.test.ts`, which verifies a
 * hash this codebase stored when `bcryptjs` wrote them. No migration, no
 * rehash-on-login, no column saying which scheme a row uses.
 *
 * ## Deploying it
 *
 * `bcrypt@6` ships N-API prebuilds via `prebuildify`/`node-gyp-build` for
 * linux-x64 in both glibc and musl flavours, so `npm ci` on Render takes the
 * prebuilt binary and never invokes a compiler — checked: no `build/`
 * directory appears and `node-gyp` is not in the tree. N-API also means it
 * survives a Node major upgrade without a rebuild, which the old
 * `node-pre-gyp` generation of this package did not.
 */
import bcrypt from "bcrypt";

/**
 * How expensive one password is to check.
 *
 * Twelve, unchanged by the move to the native module — this is the number that
 * makes a stolen hash worth little, and it is the one knob here that must not
 * be turned down to buy speed. The speed came from where the work runs, not
 * from doing less of it.
 */
export const PASSWORD_COST = 12;

/** A hash to store. */
export const hashPassword = (plain: string): Promise<string> =>
  bcrypt.hash(plain, PASSWORD_COST);

/**
 * Does this password match that hash?
 *
 * False rather than throwing on a malformed or empty stored hash. An account
 * row with no usable hash — one created through an identity provider, say —
 * must answer "no" to a password attempt, not 500: a crash here is an oracle
 * telling an attacker which accounts have passwords at all.
 */
export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!plain || !hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
