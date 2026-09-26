/**
 * The categories a project can be filed under.
 *
 * One list, because two lists drift: the create form offered "Content
 * Creation" while a browse filter that had been copied from it months earlier
 * didn't, so projects existed that no filter could find. Anything that offers
 * a category to choose from — creating, filtering, searching, web or mobile —
 * reads it from here.
 *
 * Mobile can't import @shared, so `mobile/` restates it; if you add one, add
 * it there too.
 */
export const PROJECT_CATEGORIES = [
  "Web App",
  "Mobile App",
  "AI/ML",
  "SaaS",
  "Fintech",
  "Sustainability",
  "IoT",
  "Design",
  "Data Analytics",
  "Marketing",
  "E-Commerce",
  "Education",
  "Healthcare",
  "Social Media",
  "Gaming",
  "Blockchain",
  "Content Creation",
  "DevOps",
  "Research",
  "Nonprofit",

  /*
   * Businesses that are not software.
   *
   * Two of the three paths this product offers — Systemize a business and Run
   * a company — ask, one step later, whether the thing is a restaurant, a
   * service business or a retail shop. This list offered none of those: a
   * landscaper filing an eleven-year-old company had Web App, SaaS, Fintech,
   * IoT, Blockchain and DevOps to choose from, and "Other". The category is
   * what Discover filters on and what Nova reads for tone and examples, so
   * "Other" is not a harmless answer — it is a business the rest of the
   * product cannot recognise.
   *
   * Appended rather than interleaved: these strings are stored on every
   * existing project row, and reordering the list is free while renaming one
   * is a migration.
   */
  "Food & Drink",
  "Retail & Shops",
  "Trades & Home Services",
  "Professional Services",
  "Health & Wellness",
  "Beauty & Personal Care",
  "Construction & Property",
  "Transport & Logistics",
  "Events & Hospitality",
  "Agriculture & Food Production",
  "Manufacturing",

  "Other",
] as const;

export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];

/**
 * The categories that are not software — the appended block above.
 *
 * The list has drawn this line since those categories were added; nothing
 * could read it. The comment above says the category is "what Nova reads for
 * tone and examples", and the examples were not reading it: the decision
 * simulator offered a worldwide web app "Can I afford a 60,000 van on
 * finance?", "What if I stopped opening on Mondays?" and "Can I afford a 1,500
 * trailer with nothing in the bank?", and the marketing box suggested posting
 * cards through 200 doors on a street in Leeds. Every worked example on the
 * page was a business with premises and a vehicle.
 *
 * Named by what it is rather than by a flag on each entry, so adding a
 * category to the list above is still a one-line change, and a category
 * nobody classified reads as software — which is what the first block is.
 */
export const OFFLINE_CATEGORIES: ReadonlySet<string> = new Set([
  "Food & Drink",
  "Retail & Shops",
  "Trades & Home Services",
  "Professional Services",
  "Health & Wellness",
  "Beauty & Personal Care",
  "Construction & Property",
  "Transport & Logistics",
  "Events & Hospitality",
  "Agriculture & Food Production",
  "Manufacturing",
]);

/**
 * Whether this project's examples should be software ones.
 *
 * "Other" counts as offline: it is the answer a business that found nothing
 * else fitting gives, and offering it a van is a smaller mistake than offering
 * a landscaper a churn rate.
 */
export const isSoftwareCategory = (category: unknown): boolean =>
  typeof category === "string" && category !== "Other" && !OFFLINE_CATEGORIES.has(category);

/** What a project's lifecycle says about it, and what each word means to someone browsing. */
export const PROJECT_STATUSES = ["planning", "active", "completed"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const isProjectStatus = (v: unknown): v is ProjectStatus =>
  typeof v === "string" && (PROJECT_STATUSES as readonly string[]).includes(v);
