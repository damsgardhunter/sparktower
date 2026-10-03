/**
 * Values that are safe to put in a log line.
 *
 * A log line is read by a person scanning for what happened, so anything that can
 * carry a newline into one can forge a second line looking exactly like something
 * this code wrote — a fake "payout released", a fake "signed in". Ids arrive from
 * requests, so every id interpolated into a log goes through here first.
 *
 * ## Why the line breaks are stripped twice over
 *
 * The `[\r\n]` replacement is redundant: the allow-list on the next call already
 * drops them, along with everything else that is not a word character or a hyphen.
 * It is here because the analyser does not read it that way. CodeQL's
 * log-injection query recognises a replacement of `\r` and `\n` as having removed
 * the danger and does not infer the same from a negated character class, so
 * without it the alert survives a sanitiser that is strictly stronger than the one
 * it is looking for.
 *
 * Lifted out of server/backer-badges.ts, where it was written, once a second and
 * third file needed it. That file keeps its own copy for now because another
 * session is editing it; collapse the two when that work lands.
 */
export const logId = (value: unknown): string =>
  String(value ?? "").replace(/[\r\n]/g, "").replace(/[^\w-]/g, "").slice(0, 64);
