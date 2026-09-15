import type { ProjectGoal } from "@shared/goals";

export const METRIC_CATEGORIES = ["activation", "retention", "revenue", "referral"] as const;
export type MetricCategory = (typeof METRIC_CATEGORIES)[number];

export const CATEGORY_DOT: Record<string, string> = {
  activation: "bg-blue-500",
  retention: "bg-emerald-500",
  revenue: "bg-amber-500",
  referral: "bg-purple-500",
};

export interface StarterMetric {
  eventName: string;
  label: string;
  category: MetricCategory;
  description: string;
}

/** One-click suggestions for each section's "What to measure". Short on purpose. */
export const STARTER_METRICS: Record<ProjectGoal | "all", StarterMetric[]> = {
  ship_mvp: [
    { eventName: "user_signed_up", label: "Signups", category: "activation", description: "Someone creates an account" },
    { eventName: "user_activated", label: "Activation", category: "activation", description: "A new user does the core thing once" },
    { eventName: "user_returned_week_1", label: "Week-1 retention", category: "retention", description: "They come back within 7 days" },
    { eventName: "first_payment", label: "First payment", category: "revenue", description: "A user pays for the first time" },
  ],
  systemize_business: [
    { eventName: "order_handled_without_you", label: "Orders handled without you", category: "activation", description: "An order goes start to finish with no founder touch" },
    { eventName: "hours_saved_weekly", label: "Hours saved / week", category: "retention", description: "Founder hours a system took over" },
    { eventName: "repeat_customer", label: "Repeat customers", category: "retention", description: "A customer buys a second time" },
    { eventName: "referral_received", label: "Referrals", category: "referral", description: "A new customer came from an existing one" },
  ],
  raise_funding: [
    { eventName: "investor_intro", label: "Investor intros", category: "referral", description: "A warm intro to an investor" },
    { eventName: "investor_meeting", label: "Meetings", category: "activation", description: "A first meeting with an investor" },
    { eventName: "investor_follow_up", label: "Follow-ups", category: "retention", description: "An investor asks for a second meeting or data" },
    { eventName: "commitment", label: "Commitments", category: "revenue", description: "A soft or signed commitment" },
  ],
  all: [
    { eventName: "user_signed_up", label: "Signups", category: "activation", description: "Someone creates an account" },
    { eventName: "user_activated", label: "Activation", category: "activation", description: "A new user does the core thing once" },
    { eventName: "user_returned_week_1", label: "Week-1 retention", category: "retention", description: "They come back within 7 days" },
    { eventName: "first_payment", label: "First payment", category: "revenue", description: "A user pays for the first time" },
  ],
};
