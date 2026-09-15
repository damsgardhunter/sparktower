/**
 * Applications to invest, through a project's public page.
 *
 * The first half of investors finding founders: an investor tells a founder
 * they'd like to put money in, and how; the founder reviews it and decides
 * whether to talk. An application to talk, never an investment — no money
 * moves through SparkTower, and nothing here offers or sells a security.
 * That line is stated on every screen that touches it.
 */

export const INVESTMENT_AMOUNTS = [
  { id: "lt10k", label: "Under $10k" },
  { id: "10k_25k", label: "$10k–$25k" },
  { id: "25k_100k", label: "$25k–$100k" },
  { id: "100k_250k", label: "$100k–$250k" },
  { id: "250k_1m", label: "$250k–$1M" },
  { id: "1m_plus", label: "$1M+" },
] as const;

export const INVESTMENT_INSTRUMENTS = [
  { id: "equity", label: "Equity" },
  { id: "convertible", label: "SAFE or convertible note" },
  { id: "profit_share", label: "Profit share" },
  { id: "revenue_share", label: "Revenue share" },
  { id: "loan", label: "A loan" },
  { id: "open", label: "Open to discuss" },
] as const;

export const INVESTOR_TYPES = [
  { id: "individual", label: "Individual" },
  { id: "angel", label: "Angel investor" },
  { id: "network", label: "Angel group or network" },
  { id: "fund", label: "Venture or investment fund" },
  { id: "family_office", label: "Family office" },
  { id: "strategic", label: "Business in the industry" },
  { id: "lender", label: "Lender or CDFI" },
] as const;

export const ACCREDITED_ANSWERS = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
  { id: "unsure", label: "Not sure" },
] as const;

export const INVESTMENT_STATUSES = ["new", "reviewing", "accepted", "declined", "withdrawn"] as const;
export type InvestmentStatus = (typeof INVESTMENT_STATUSES)[number];
/** What the founder can move an application to. Withdrawing is the investor's. */
export const OWNER_STATUSES = ["reviewing", "accepted", "declined"] as const;

export const INVESTMENT_STATUS_LABEL: Record<InvestmentStatus, string> = {
  new: "New",
  reviewing: "Reviewing",
  accepted: "Want to talk",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

export const INVESTMENT_MESSAGE_MAX = 2000;

/** What the founder shows would-be investors. */
export interface InvestmentAsk {
  headline: string;
  /** One of INVESTMENT_AMOUNTS: what they're raising. */
  amount: string | null;
  /** One of INVESTMENT_AMOUNTS: the smallest check that makes sense. */
  minimum: string | null;
  instruments: string[];
  useOfFunds: string;
}

export const INVESTMENT_DISCLAIMER =
  "This is an application to talk about investing, not an investment. No money moves through SparkTower, and nothing here is an offer or sale of securities. Any investment happens directly between you and the founder, on terms you agree with your own advisers.";

const ids = (list: readonly { id: string }[]) => list.map((x) => x.id) as readonly string[];
const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** An ask from the founder, held to its shape. */
export function sanitizeAsk(raw: any): InvestmentAsk {
  return {
    headline: str(raw?.headline, 160),
    amount: ids(INVESTMENT_AMOUNTS).includes(raw?.amount) ? raw.amount : null,
    minimum: ids(INVESTMENT_AMOUNTS).includes(raw?.minimum) ? raw.minimum : null,
    instruments: Array.isArray(raw?.instruments) ? [...new Set(raw.instruments.map(String).filter((x: string) => ids(INVESTMENT_INSTRUMENTS).includes(x)))] as string[] : [],
    useOfFunds: str(raw?.useOfFunds, 1000),
  };
}

export type ApplicationInput = {
  amount: string; instrument: string; investorType: string; accredited: string;
  message: string; phone: string | null; linkedinUrl: string | null;
};

/** An application from an investor, or the first thing wrong with it. */
export function validateApplication(raw: any): { ok: true; value: ApplicationInput } | { ok: false; field: string; message: string } {
  const pick = (field: string, list: readonly { id: string }[], what: string) =>
    ids(list).includes(raw?.[field]) ? null : { ok: false as const, field, message: `Choose ${what}.` };
  const bad = pick("amount", INVESTMENT_AMOUNTS, "how much you'd consider")
    ?? pick("instrument", INVESTMENT_INSTRUMENTS, "how you'd invest")
    ?? pick("investorType", INVESTOR_TYPES, "what kind of investor you are")
    ?? pick("accredited", ACCREDITED_ANSWERS, "whether you're accredited");
  if (bad) return bad;
  const message = str(raw?.message, INVESTMENT_MESSAGE_MAX);
  if (message.length < 20) return { ok: false, field: "message", message: "Tell the founder a little about you and why this project — a couple of sentences." };
  if (raw?.consent !== true) return { ok: false, field: "consent", message: "Confirm you understand this is an application, and that the founder will see your contact details." };
  const linkedin = str(raw?.linkedinUrl, 300);
  if (linkedin && !/^https:\/\/([a-z]+\.)?linkedin\.com\//i.test(linkedin)) return { ok: false, field: "linkedinUrl", message: "That doesn't look like a LinkedIn link." };
  const phone = str(raw?.phone, 40);
  if (phone && !/^[+()\d\s.-]{7,40}$/.test(phone)) return { ok: false, field: "phone", message: "That doesn't look like a phone number." };
  return { ok: true, value: { amount: raw.amount, instrument: raw.instrument, investorType: raw.investorType, accredited: raw.accredited, message, phone: phone || null, linkedinUrl: linkedin || null } };
}

export const labelOf = (list: readonly { id: string; label: string }[], id: string | null | undefined) =>
  list.find((x) => x.id === id)?.label ?? id ?? "";
