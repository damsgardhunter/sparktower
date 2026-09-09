/**
 * The three paths a project can be on.
 *
 * Every project declares one, and everything that reasons about the project
 * — Nova's roadmaps, the briefing, what the dashboard leads with — reads it.
 * It is the answer to "what does winning look like for this one", which is
 * different for a weekend MVP, an agency that wants to run without its
 * founder, and a company preparing a round. Advice that ignores the
 * difference is the same advice for everyone, which is advice for no one.
 */
export const PROJECT_GOALS = [
  {
    id: "ship_mvp",
    label: "Ship an MVP",
    short: "Ship",
    description: "Get a first version in front of real people and learn from what they do.",
  },
  {
    id: "systemize_business",
    label: "Systemize a business",
    short: "Systemize",
    description: "Turn something that already works into something that runs without you in every step.",
  },
  {
    id: "raise_funding",
    label: "Raise funding",
    short: "Raise",
    description: "Get the story, the numbers and the plan into a shape investors will back.",
  },
] as const;

export type ProjectGoal = (typeof PROJECT_GOALS)[number]["id"];

/**
 * What kind of thing it is, within its path.
 *
 * Asked after the goal, and the options depend on it: "restaurant" is a
 * meaningful answer to "what are you systemizing" and a meaningless one to
 * "what are you shipping". Every path ends in "other" so the question never
 * blocks someone whose thing doesn't fit the list — but "other" is a real
 * answer they chose, not a default they fell into.
 *
 * Ids are flat and unique except "other", which is shared; validity is always
 * checked as a (goal, subcategory) pair, never by id alone.
 */
export const PROJECT_SUBCATEGORIES: Record<ProjectGoal, readonly { id: string; label: string }[]> = {
  ship_mvp: [
    { id: "app", label: "App" },
    { id: "saas", label: "SaaS" },
    { id: "game", label: "Game" },
    { id: "website", label: "Website" },
    { id: "other", label: "Other" },
  ],
  systemize_business: [
    { id: "restaurant", label: "Restaurant" },
    { id: "service", label: "Service business" },
    { id: "retail", label: "Retail" },
    { id: "other", label: "Other" },
  ],
  raise_funding: [
    { id: "startup_equity", label: "Startup equity" },
    { id: "local_community", label: "Local community" },
    { id: "loan_grant", label: "Loan or grant" },
    { id: "other", label: "Other" },
  ],
};

export const subcategoriesFor = (goal: ProjectGoal) => PROJECT_SUBCATEGORIES[goal];

export const isValidSubcategory = (goal: string | null | undefined, sub: string | null | undefined): boolean =>
  !!goal && !!sub && (PROJECT_SUBCATEGORIES as Record<string, readonly { id: string }[]>)[goal]?.some((s) => s.id === sub) === true;

/** Every subcategory id across all paths, for the column's allowed values. */
export const PROJECT_SUBCATEGORY_IDS = [
  ...new Set(Object.values(PROJECT_SUBCATEGORIES).flatMap((list) => list.map((s) => s.id))),
] as [string, ...string[]];

/** What every pre-existing project is assumed to be: chosen, in effect, by nobody. */
export const DEFAULT_PROJECT_SUBCATEGORY = "other";
export const PROJECT_GOAL_IDS = PROJECT_GOALS.map((g) => g.id) as [ProjectGoal, ...ProjectGoal[]];

/**
 * What every project that existed before goals did is assumed to be on.
 *
 * Shipping is the honest default: the product's own wedge starts there, and a
 * builder who is actually systemizing or raising will say so the first time
 * they see the field. Written once, here, so the DB default, the backfill and
 * the client fallback can't disagree.
 */
export const DEFAULT_PROJECT_GOAL: ProjectGoal = "ship_mvp";

export const projectGoal = (id: string | null | undefined) =>
  PROJECT_GOALS.find((g) => g.id === id) ?? PROJECT_GOALS[0];
