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
