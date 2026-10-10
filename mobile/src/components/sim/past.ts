/**
 * Last year, on a phone.
 *
 * Mirrors `client/src/components/sim/past-year.tsx`. Metro cannot resolve the
 * web app's `@shared` alias, so the phone re-implements what it needs to read a
 * payload — and `readDecision` below is checked against the web's by
 * `test/unit/mobile-mirror.test.ts`, because two clients that disagree about
 * what a team filed is worse than one client that cannot show it.
 *
 * The gap this fills: the phone could tell a player what happened to their
 * company and never what the five of them did to cause it. The decisions live
 * on the desk for a fortnight and then vanish, and the bids are deleted the
 * moment they settle, so a phone-only table could lose a third of its cash at
 * auction and have nothing afterwards but one line of prose saying so. The
 * server has sent `lastFiled` and `standing` all along.
 *
 * No React Native imports in this file. That is what lets the mirror test
 * import it, and the mirror test is the only thing standing between these
 * copies and the engine drifting apart.
 */

/** One lot, after it settled. Mirrors `AuctionRow` on the stored report (`simulation-tick.ts`). */
export interface AuctionRow {
  listingId: string;
  name: string;
  kind: string;
  reserve: number;
  bidders: number;
  winner: string | null;
  winnerId: string | null;
  price: number | null;
  /** What this company bid, written onto its own copy of the report. Null if it did not. */
  yourBid?: number | null;
}

/** Where one company stands. Mirrors the `standing` block in `server/simulation-desk-routes.ts`. */
export interface Standing {
  id: string;
  name: string;
  kind: string;
  isYou: boolean;
  price: number;
  quality: number;
  service: number;
  brand: number;
  customers: number;
  positioning: string | null;
  /** Only ever set for teams; an incumbent's books are nobody's business. */
  grade: string | null;
  creditScore: number | null;
}

/** What the table filed last year, and who filed it. Mirrors `lastFiled` on the desk payload. */
export interface LastFiled {
  decisions: Record<string, Record<string, unknown>> | null;
  filedBy?: Record<string, string> | null;
}

export interface DecidedLine {
  label: string;
  value: string;
}

const count = (n: number): string => Math.round(n).toLocaleString();

/**
 * What one seat committed, in the fewest words that are still true.
 *
 * Every lever a seat has, read off the payload it filed — not a curated subset,
 * because the point of the card is that nothing quietly goes unrecorded.
 *
 * Deliberately the web's arithmetic and the web's wording, down to which keys
 * read as money and which as a percentage — `test/unit/mobile-mirror.test.ts`
 * runs both on the same payload and compares the output.
 *
 * How money reads is the one thing passed in rather than written here, because
 * the two clients genuinely differ: the web's copy has a `£` hardcoded into it,
 * and this phone's `money()` carries no symbol at all on purpose, so that a
 * figure on a card reads the same as the same figure inside a sentence the
 * server wrote. The mirror test supplies the web's formatter when comparing, so
 * what is being checked is the reading and not the currency.
 */
export function readDecision(
  payload: Record<string, unknown> | undefined | null,
  money: (n: number) => string = (n) => count(n),
): DecidedLine[] {
  if (!payload) return [];
  const out: DecidedLine[] = [];
  const say = (key: string, value: unknown): string => {
    if (value === null || value === undefined || value === "") return "—";
    if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
    if (typeof value === "object") {
      const parts = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== "" && v !== null);
      return parts.length ? parts.map(([k, v]) => `${k} ${v}`).join(" · ") : "none";
    }
    if (typeof value === "number") {
      if (/Spend|Pool|Bid|borrow|repay|raiseAmount|buffer|refinance|buyback/i.test(key)) return money(value);
      if (/Pct|Discount|holdBack|costReview|automation|engineerPay/i.test(key)) return `${value}%`;
      return count(value);
    }
    return String(value);
  };
  for (const [key, value] of Object.entries(payload)) {
    if (key === "companyId") continue;
    out.push({
      label: key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
      value: say(key, value),
    });
  }
  return out;
}

export type LotOutcome = "won" | "outbid" | "watched" | "unsold";

/**
 * How one lot went for this company, which the prose could not say.
 *
 * `winnerId` against your own company id rather than comparing your bid to the
 * price: in a sealed auction the winner pays the reserve or the runner-up's
 * bid depending on how it settled, so "your bid equals the price" is neither
 * necessary nor sufficient for having won it. The web card infers it the other
 * way and gets the near-miss wrong.
 */
export function lotOutcome(row: AuctionRow, yourCompanyId: string | null): LotOutcome {
  if (!row.winnerId) return "unsold";
  if (yourCompanyId && row.winnerId === yourCompanyId) return "won";
  return Number(row.yourBid) > 0 ? "outbid" : "watched";
}

export function lotLabel(outcome: LotOutcome): string {
  if (outcome === "won") return "Yours";
  if (outcome === "outbid") return "Outbid";
  if (outcome === "unsold") return "Nobody bid enough";
  return "You did not bid";
}

/**
 * Where this company's credit stands against the other teams'.
 *
 * Ranked on `creditScore` rather than on the letter, because two companies can
 * both be a "B" and only one of them can borrow. Incumbents are left out: they
 * are not graded and including them would put a team's rank against companies
 * that cannot be in the running.
 */
export function creditPlace(standing: Standing[]): { place: number; of: number; grade: string | null } | null {
  const teams = standing.filter((s) => s.kind === "player" && s.grade);
  if (teams.length === 0) return null;
  const you = teams.find((s) => s.isYou);
  if (!you) return null;
  const ranked = [...teams].sort((a, b) => (b.creditScore ?? 0) - (a.creditScore ?? 0));
  return { place: ranked.findIndex((s) => s.id === you.id) + 1, of: teams.length, grade: you.grade };
}

/**
 * The market as rows rather than as a scatter chart.
 *
 * The web plots price against quality and that is the right drawing for a
 * mouse. On a phone the same argument reads better as a sorted list, so this
 * orders by what each company charges — the axis a table is usually arguing
 * about — and leaves the drawing to the web.
 */
export function marketRows(standing: Standing[]): Standing[] {
  return [...standing].sort((a, b) => b.price - a.price);
}

/**
 * Which seats filed nothing at all.
 *
 * Worth naming rather than leaving as a blank row: a seat that filed nothing
 * had its levers run by the caretaker on last year's numbers, and that is the
 * single most useful thing a table can learn from the year behind it.
 */
export function seatsThatFiledNothing(
  roles: (string | null)[],
  filed: Record<string, Record<string, unknown>> | null | undefined,
): string[] {
  return roles
    .filter((role): role is string => !!role)
    .filter((role) => readDecision(filed?.[role]).length === 0);
}
