/**
 * The loop that brings strangers in, counted.
 *
 * Somebody finishes a step, publishes what it produced, and the page goes out
 * with no sign-in wall on it. A stranger reads it, presses "start your own
 * path", signs up, lands in project create on the same goal, takes their first
 * step, publishes it — and that page brings the next person in. The whole loop
 * is built and tested; what it has never been able to answer is *how many*,
 * and where they stop.
 *
 * The existing analytics deliberately has no hand-placed `track()` calls:
 * every non-GET API request is recorded as `api.write`, which is enough to
 * know something happened and never enough to know what it meant. Six moments
 * in this loop are worth naming, so a funnel can be counted from them rather
 * than reverse-engineered out of URL paths.
 *
 * Counted in sessions rather than events, like the Explore funnel: one person
 * reading three artifacts is one arrival, not three.
 */

export const PATH_FUNNEL_EVENTS = {
  /** A public artifact page was read. */
  artifactView: "path_funnel.artifact_view",
  /** The reader pressed "start your own path" — intent, before any account. */
  artifactCta: "path_funnel.artifact_cta",
  /** An account was created carrying that artifact with it. */
  signup: "path_funnel.signup",
  /** A project was made from the carried choice, on the goal the artifact was on. */
  projectCreated: "path_funnel.project_created",
  /** Their first step on that path was finished. */
  firstStep: "path_funnel.first_step",
  /** And published — which is where the loop starts again, for somebody else. */
  published: "path_funnel.published",
} as const;

export type PathFunnelEventName = typeof PATH_FUNNEL_EVENTS[keyof typeof PATH_FUNNEL_EVENTS];

export const PATH_FUNNEL_EVENT_NAMES: readonly PathFunnelEventName[] = Object.values(PATH_FUNNEL_EVENTS);

export const isPathFunnelEvent = (name: string): name is PathFunnelEventName =>
  (PATH_FUNNEL_EVENT_NAMES as readonly string[]).includes(name);

/**
 * The funnel, in the order it happens.
 *
 * Reading and pressing are separate steps on purpose: the gap between them is
 * the artifact's own fault (was it worth acting on), and every gap after it is
 * the product's.
 */
export const PATH_FUNNEL = [
  { key: "read", label: "Read a published step", events: [PATH_FUNNEL_EVENTS.artifactView] },
  { key: "wanted", label: "Pressed start your own path", events: [PATH_FUNNEL_EVENTS.artifactCta] },
  { key: "joined", label: "Signed up from it", events: [PATH_FUNNEL_EVENTS.signup] },
  { key: "started", label: "Made a project on that goal", events: [PATH_FUNNEL_EVENTS.projectCreated] },
  { key: "stepped", label: "Finished their first step", events: [PATH_FUNNEL_EVENTS.firstStep] },
  { key: "published", label: "Published it — the loop closes", events: [PATH_FUNNEL_EVENTS.published] },
] as const;

export const PATH_FUNNEL_LABEL: Record<PathFunnelEventName, string> = {
  "path_funnel.artifact_view": "Read a published step",
  "path_funnel.artifact_cta": "Pressed start your own path",
  "path_funnel.signup": "Signed up from a published step",
  "path_funnel.project_created": "Made a project from it",
  "path_funnel.first_step": "Finished their first step",
  "path_funnel.published": "Published a step of their own",
};

/** For the live feed: a readable line for one of these rows, or null for anything else. */
export const pathFunnelLabel = (name: string): string | null =>
  (isPathFunnelEvent(name) ? PATH_FUNNEL_LABEL[name] : null);

/**
 * What may ride along with one of these events.
 *
 * An allowlist rather than whatever the caller sent: these rows are written
 * from a public page by people with no account, and an analytics table is a
 * bad place to discover that somebody posted an essay into a prop. Ids are
 * shaped, the goal is one of the three, and everything else is dropped.
 */
export function sanitizePathFunnelProps(raw: unknown): Record<string, string> {
  const props = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  const id = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : null);
  const word = (v: unknown, max = 32) =>
    (typeof v === "string" && /^[a-z_]{2,32}$/.test(v.trim()) ? v.trim().slice(0, max) : null);

  const artifactId = id(props.artifactId);
  if (artifactId) out.artifactId = artifactId;
  const projectId = id(props.projectId);
  if (projectId) out.projectId = projectId;
  const goal = word(props.goal);
  if (goal) out.goal = goal;
  const subcategory = word(props.subcategory);
  if (subcategory) out.subcategory = subcategory;
  const intent = props.intent === "explore" || props.intent === "start" ? props.intent : null;
  if (intent) out.intent = intent;
  return out;
}
