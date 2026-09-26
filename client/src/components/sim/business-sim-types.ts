import { businessMoney } from "@shared/currency";
/**
 * What `/api/projects/:id/decision-sim` sends, in one place.
 *
 * Two panels read the same endpoint — the decision lab and the ten-year
 * outlook — because they are two questions about the same company and a second
 * round trip would only be a second chance for the two of them to disagree
 * about what its numbers are. The shared query key below is what makes them
 * share one cache entry rather than fetching it twice.
 */
import type { Answer, Baseline, Lever } from "@shared/simulation/decision-sim";
import type { Hindsight } from "@shared/simulation/hindsight";
import type { Sensitivity } from "@shared/simulation/what-matters";
import type { BaselineField } from "@shared/simulation/company-baseline";
import type { Allocation } from "@shared/sprints/budget";
import type { SpendOption } from "@shared/sprints/cards";
import type { Dimension, Verdict } from "@shared/sprints/scoring";

export interface Narrative {
  headline: string;
  body: string;
  watchFor: string[];
  alsoAsk: string[];
}

export interface Scenario {
  id: string;
  question: string;
  months: number;
  baseline: Baseline;
  levers: Lever[];
  assumptions: string[];
  result: Answer;
  narrative: Narrative;
  rerunOf: string | null;
  createdAt: string;
  /** How this projection has held up against the check-ins filed since. Null while it is too new. */
  hindsight: Hindsight | null;
  /** Which of this plan's numbers actually decide it, ranked by how much they move the answer. */
  matters: { headline: string | null; rows: Sensitivity[] } | null;
}

export interface Outlook {
  id: string;
  allocation: Allocation;
  verdict: Verdict;
  overall: number;
  band: string;
  fromModel: boolean;
  createdAt: string;
}

export interface FieldDef {
  field: BaselineField;
  unit: "money" | "percent" | "count";
  label: string;
  hint: string;
}

export interface SimPayload {
  today: string;
  aiAvailable: boolean;
  /** The business's own money (shared/currency.ts). The price below is dollars. */
  currency: string;
  /** Whether this is a software business, which decides which worked examples it is offered. */
  software: boolean;
  price: { cents: number; display: string; unlocked: boolean };
  baseline: Baseline;
  overridden: BaselineField[];
  sources: { field: BaselineField; from: string }[];
  missing: BaselineField[];
  fields: FieldDef[];
  notReady: string | null;
  horizons: number[];
  confidences: Record<string, { title: string; blurb: string }>;
  scenarios: Scenario[];
  tenYears: {
    budget: number;
    options: SpendOption[];
    dimensions: Dimension[];
    outlooks: Outlook[];
  };
}

export const simKey = (projectId: string) => ["/api/projects", projectId, "decision-sim"];

/**
 * "£14k", "−$2,300". The screen is full of money and none of it needs cents.
 *
 * Takes the business's own currency, which the status route sends: these are
 * the owner's figures, not this product's prices. Defaults to dollars so a
 * caller that hasn't got the currency yet renders something rather than
 * nothing — see shared/currency.ts.
 */
export function money(n: number, currency?: unknown): string {
  return businessMoney(n, currency);
}

/** "22 Sep 2026, 14:03" — two scenarios run the same afternoon need the hour. */
export const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
