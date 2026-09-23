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

/** "$14k", "−$2,300". The screen is full of money and none of it needs cents. */
export function money(n: number): string {
  const a = Math.abs(Math.round(n));
  const body = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(2)}m` : a >= 10_000 ? `${Math.round(a / 1000)}k` : a.toLocaleString("en-GB");
  return `${n < 0 ? "−" : ""}$${body}`;
}

/** "22 Sep 2026, 14:03" — two scenarios run the same afternoon need the hour. */
export const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
