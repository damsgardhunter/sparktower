/**
 * What counts as a password here.
 *
 * Length first, because length is what makes offline guessing expensive after
 * a dump leaks — and a short password is cheap however slow the hash. Eight is
 * the floor NIST settles on, and it's what this asks for.
 *
 * Then the list. Attackers don't start at "aaaaaaaa"; they start at the
 * passwords everyone picks, which is why a six-character minimum and a
 * "password123" are the same problem. The list below is small on purpose —
 * the hundred or so that top every leaked-password ranking, plus the shapes
 * this product invites ("sparktower1"). It is not a substitute for the
 * breached-password range API, which is the better check and needs a network
 * call; `looksBreachable` is where that goes when it's wanted.
 *
 * What this deliberately does NOT do: composition rules (a symbol, a digit, a
 * capital) or rotation. Both are known to produce worse passwords — Pa$$w0rd1
 * satisfies every rule and is on every list — and both are what people route
 * around with a sticky note.
 */

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

/**
 * The passwords guessed first. Lowercased; a password is compared lowercased,
 * so "Password1" is caught by "password1".
 */
const COMMON = new Set([
  "password", "password1", "password12", "password123", "password1234", "passw0rd", "p@ssword", "p@ssw0rd",
  "12345678", "123456789", "1234567890", "123123123", "11111111", "00000000", "87654321", "123321123",
  "qwertyui", "qwerty123", "qwertyuiop", "asdfghjk", "asdfghjkl", "zxcvbnm1", "1q2w3e4r", "1qaz2wsx", "qazwsxedc",
  "iloveyou", "princess", "sunshine", "football", "baseball", "superman", "batman123", "pokemon1",
  "monkey12", "dragon123", "trustno1", "letmein1", "welcome1", "welcome123", "admin123", "administrator",
  "abc12345", "abcd1234", "test1234", "testtest", "changeme", "secret12", "whatever", "freedom1",
  "starwars", "computer", "internet", "samsung1", "google123", "facebook", "michael1", "jennifer",
  "shadow12", "master12", "jordan23", "hunter123", "buster12", "soccer12", "harley12", "ranger12",
  "matthew1", "daniel12", "andrew12", "joshua12", "amanda12", "ashley12", "jessica1", "charlie1",
  // The ones a builder types into their own product.
  "sparktower", "sparktower1", "sparktower123", "startup1", "founder1", "buildinpublic",
]);

export interface PasswordProblem { message: string; field: "password" }

/**
 * Checks a password someone is setting. Returns null when it's fine.
 *
 * `email` is taken so the local part can be refused: "casey" for
 * casey@example.com is guessed on the first try by anyone who has the address,
 * which is everyone who can see a comment they wrote.
 */
export function checkPassword(password: unknown, opts: { email?: string | null } = {}): PasswordProblem | null {
  const value = typeof password === "string" ? password : "";
  if (value.length < PASSWORD_MIN) {
    return { message: `Use at least ${PASSWORD_MIN} characters. Length is what makes a password hard to guess — a passphrase of a few words beats a short scramble.`, field: "password" };
  }
  if (value.length > PASSWORD_MAX) {
    return { message: `Keep it under ${PASSWORD_MAX} characters.`, field: "password" };
  }
  const lower = value.toLowerCase();
  if (COMMON.has(lower)) {
    return { message: "That's one of the most common passwords in every leaked list, so it's tried first. Pick something else.", field: "password" };
  }
  // A single repeated character, or a run up or down the keyboard's digits.
  if (/^(.)\1+$/.test(value) || /^(0123456789|1234567890|9876543210)/.test(value)) {
    return { message: "That pattern is guessed in the first handful of attempts. Pick something else.", field: "password" };
  }
  const local = String(opts.email ?? "").split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 3 && (lower === local || lower === `${local}1` || lower === `${local}123`)) {
    return { message: "That's your email address with a little on the end — the first thing anyone who knows it would try.", field: "password" };
  }
  return null;
}

/*
 * The breach check used to be a seam here — a function that returned "yes,
 * check this one" and nothing that called it. It is real now, and it lives in
 * server/password-breach.ts rather than in this file: it makes a network call,
 * and this module is imported by the browser and by the mobile app, neither of
 * which should be reaching for an external service or carrying the code that
 * would. Every server-side place a password is set calls it after this check
 * passes.
 */
