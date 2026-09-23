/**
 * The three paths a project can be on: build something new, systemize (and
 * finance) a business, or run one that already exists.
 *
 * There used to be a "Raise funding" path. Systemize already covered most of
 * it — its first four weeks were money — so everything Raise did that
 * Systemize didn't (the scored capital profile and how to raise it, the
 * capital map, the five funding routes and their roadmaps, the investor
 * tools) moved into Systemize, and its slot went to a path for companies that
 * already exist and need help with this week, not with starting. See
 * `LEGACY_GOALS` for how old Raise projects are carried across.
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
    id: "run_company",
    label: "Run a company",
    short: "Run",
    description: "Keep an existing business on track every week: the numbers, the team's recurring work, and what to fix next.",
  },
] as const;

/**
 * Goals that no longer exist, and the path that took over their work.
 *
 * Every read of a stored goal goes through `normaliseGoal`, so a row written
 * before the change — or a link still carrying `?section=raise_funding` —
 * lands somewhere real instead of nowhere. The rows themselves are rewritten
 * by migration 0033; this is the belt to that migration's braces.
 */
export const LEGACY_GOALS: Record<string, ProjectGoal> = {
  raise_funding: "systemize_business",
};

export const normaliseGoal = (v: unknown): ProjectGoal | null => {
  if (typeof v !== "string") return null;
  if (LEGACY_GOALS[v]) return LEGACY_GOALS[v];
  return PROJECT_GOALS.some((g) => g.id === v) ? (v as ProjectGoal) : null;
};

export type ProjectGoal = (typeof PROJECT_GOALS)[number]["id"];

export const isProjectGoal = (v: unknown): v is ProjectGoal => PROJECT_GOALS.some((g) => g.id === v);

/**
 * A project works all three paths side by side, one section each — Ship,
 * Systemize, Raise. Every path's milestone ids carry their tree's prefix
 * (SHIP.M1.1, SYS.F1.1, FUND.C1.1), which is how a task on the board is
 * known to belong to one section without a lookup.
 */
export const GOAL_BACKBONE_PREFIX: Record<ProjectGoal, string> = {
  ship_mvp: "SHIP",
  systemize_business: "SYS",
  run_company: "RUN",
};

/**
 * Prefixes that belong to a path other than the one they are named after.
 *
 * The funding milestones kept their `FUND.` ids when they moved into
 * Systemize, deliberately: every finished step on every project is a task
 * tagged with that id, and the capital profile's score reads its answers by
 * it. Renaming them would have meant rewriting every one of those tasks for no
 * benefit to anybody; mapping the prefix costs one line.
 */
const PREFIX_ALIASES: Record<string, ProjectGoal> = { FUND: "systemize_business" };

/** The path a milestone id belongs to, from its prefix; null for anything else. */
export function goalOfBackboneId(id: string | null | undefined): ProjectGoal | null {
  if (!id) return null;
  const prefix = id.split(".")[0];
  if (PREFIX_ALIASES[prefix]) return PREFIX_ALIASES[prefix];
  return (Object.entries(GOAL_BACKBONE_PREFIX).find(([, p]) => p === prefix)?.[0] as ProjectGoal | undefined) ?? null;
}

const tagValue = (tags: string[] | null | undefined, prefix: string) => tags?.find((t) => t.startsWith(prefix))?.slice(prefix.length) ?? null;

/**
 * The section a board task belongs to: its `track:` tag, else its milestone's
 * prefix (its own or its parent's). A task that's on no path — one someone
 * added by hand without a section — returns null: it shows in every section.
 */
export function sectionOfTask(tags: string[] | null | undefined, primary: ProjectGoal): ProjectGoal | null {
  const tagged = normaliseGoal(tagValue(tags, "track:"));
  if (tagged) return tagged;
  const id = tagValue(tags, "backbone:") ?? tagValue(tags, "parent:");
  if (id) return goalOfBackboneId(id) ?? primary;
  if (tagValue(tags, "injected:")) return primary;
  return null;
}

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
  run_company: [
    { id: "restaurant", label: "Restaurant or café" },
    { id: "service", label: "Service business" },
    { id: "retail", label: "Retail or e-commerce" },
    { id: "agency", label: "Agency or studio" },
    { id: "software", label: "Software company" },
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
  PROJECT_GOALS.find((g) => g.id === normaliseGoal(id)) ?? PROJECT_GOALS[0];
