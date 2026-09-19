/**
 * Round four: what it does better than what already exists.
 *
 * The one round that is still free text, because this is the one place where a
 * card deck would be actively wrong. "Faster" and "cheaper" are the two
 * answers every deck would contain and the two answers that mean nothing; the
 * interesting claim is always specific to the thing these two people just
 * invented, and no catalogue can hold it.
 *
 * ## Why it merges instead of settling
 *
 * The other rounds pick one of something. This one keeps both. Two people
 * listing what their product does better are not in competition — a longer
 * list of real advantages is a better answer than either of their lists alone,
 * and making them vote one out would be the game destroying its own material.
 *
 * ## Why core features are capped
 *
 * A pair that marks all ten claims core has said nothing. The cap is what
 * forces the second, harder question the round is actually for: of the things
 * this does better, which are the *reason* it exists, and which are pleasant?
 * A company that cannot answer that ships all ten badly.
 */

/** How many advantages a pair may claim in total. The brief said up to ten. */
export const MAX_CLAIMS = 10;

/**
 * How many of those can be core.
 *
 * Three. Small enough to hurt, which is the point — the cap is the round's
 * whole teaching mechanism, and one that never binds teaches nothing.
 */
export const MAX_CORE_CLAIMS = 3;

export interface Claim {
  text: string;
  /** One of the reasons this exists, as opposed to something nice it also does. */
  core: boolean;
  /** Who wrote it, so the results screen can show who brought what. */
  by?: string;
}

const MAX_CLAIM_LENGTH = 160;

/** Loose enough to catch "Works offline" and "works offline." as one claim. */
const normalise = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

export const cleanClaimText = (text: unknown): string =>
  String(text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CLAIM_LENGTH);

/** One player's list, cleaned: no blanks, no duplicates, no more than the cap. */
export function cleanClaims(raw: unknown, by?: string): Claim[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: Claim[] = [];
  const seen = new Set<string>();

  for (const item of list) {
    const text = cleanClaimText(typeof item === "string" ? item : (item as any)?.text);
    if (text.length < 3) continue;
    const key = normalise(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ text, core: !!(item as any)?.core, by });
    if (out.length >= MAX_CLAIMS) break;
  }

  return capCore(out);
}

/**
 * Hold the core list to its cap, keeping the earliest.
 *
 * Earliest rather than, say, longest or the most recently marked: the order a
 * pair wrote their advantages in is a real signal about which they think
 * matter, and it is the only one available without asking them a further
 * question the round has no time for.
 */
export function capCore(claims: Claim[]): Claim[] {
  let kept = 0;
  return claims.map((c) => {
    if (!c.core) return c;
    kept += 1;
    return kept <= MAX_CORE_CLAIMS ? c : { ...c, core: false };
  });
}

/**
 * Two lists into the one the company ships.
 *
 * Interleaved rather than concatenated. Concatenating means that when the two
 * lists together exceed ten, the second player's best idea is cut and the
 * first player's tenth-best survives — an arbitrary punishment for whoever the
 * database happened to return second. Taking one from each in turn means a cut
 * falls on both of them equally.
 *
 * A claim both of them wrote is kept once, and is core if *either* marked it
 * so: two people independently arriving at the same advantage and one of them
 * calling it essential is the strongest signal this round produces.
 */
export function mergeClaims(lists: Claim[][]): Claim[] {
  const ordered: Claim[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      if (list[i]) ordered.push(list[i]);
    }
  }

  const byKey = new Map<string, Claim>();
  for (const claim of ordered) {
    const key = normalise(claim.text);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...claim });
      continue;
    }
    // Both wrote it. Keep the first wording; take the stronger opinion of it.
    if (claim.core) existing.core = true;
  }

  return capCore([...byKey.values()].slice(0, MAX_CLAIMS));
}

/** Whether a list is worth committing. */
export function claimsAreReady(claims: Claim[]): { ok: true } | { ok: false; reason: string } {
  if (claims.length === 0) return { ok: false, reason: "Name at least one thing it does better." };
  if (!claims.some((c) => c.core)) {
    return { ok: false, reason: "Mark at least one as a core feature — the reason it exists." };
  }
  return { ok: true };
}

export const coreClaims = (claims: Claim[]) => claims.filter((c) => c.core);
