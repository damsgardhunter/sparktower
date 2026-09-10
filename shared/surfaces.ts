/**
 * Every feature area in the product, and whether it's switched on.
 *
 * This is the surface-area audit turned into something the code can act on.
 * Three problems it solves at once:
 *
 *  - **Sharing.** Inviting testers means being able to turn a half-finished
 *    area off without a deploy, and back on the week it's ready.
 *  - **Empty rooms.** Several areas can't function below a certain number of
 *    people — a matching engine with one comparable profile isn't off-strategy,
 *    it's broken. `needsPeople` records that, so the reason a surface is off is
 *    written down rather than remembered.
 *  - **Reversibility.** Nothing is deleted. Everything stays compiled and
 *    tested; it just isn't reachable.
 *
 * Shared so web, mobile and the server can't disagree about what exists. A nav
 * link hidden on the client whose endpoint still accepts writes is not off.
 */

export type SurfaceClass = "core" | "momentum" | "later" | "network" | "off";

export interface SurfaceDef {
  id: string;
  label: string;
  cls: SurfaceClass;
  /** Shipped default. The database overrides this once a flag row exists. */
  defaultEnabled: boolean;
  /** One line, shown in the admin toggle, explaining the call. */
  note: string;
  /**
   * Roughly how many active accounts this needs before it does anything.
   * Null means it works for one person alone. Advisory — it's shown next to
   * the toggle so the decision to enable is an informed one.
   */
  needsPeople?: number;
}

export const SURFACES: SurfaceDef[] = [
  // --- Core: the company-building toolkit -------------------------------
  { id: "projects",   label: "Projects & brief",     cls: "core", defaultEnabled: true, note: "The object everything else hangs off." },
  { id: "signup",     label: "New accounts",         cls: "core", defaultEnabled: true, note: "Registration, web and mobile. Off closes the door to new people without touching anyone signed in." },
  { id: "uploads",    label: "Uploads",              cls: "core", defaultEnabled: true, note: "Every file upload. The first thing to turn off under a storage or abuse incident." },
  { id: "tasks",      label: "Tasks & kanban",       cls: "core", defaultEnabled: true, note: "Most-used surface in the product." },
  { id: "milestones", label: "Milestones",           cls: "core", defaultEnabled: true, note: "In use." },
  { id: "roadmap",    label: "Roadmap",              cls: "core", defaultEnabled: true, note: "In use." },
  { id: "nova",       label: "Nova assistant",       cls: "core", defaultEnabled: true, note: "The differentiator; drives every other surface." },
  { id: "codeAudit",  label: "Codebase audit",       cls: "core", defaultEnabled: true, note: "In use, and genuinely unusual." },
  { id: "documents",  label: "Documents",            cls: "core", defaultEnabled: true, note: "In use." },
  { id: "personas",   label: "Personas & research",  cls: "core", defaultEnabled: true, note: "In use." },

  // --- Momentum: proof the company is moving ----------------------------
  { id: "checkIns",   label: "Weekly check-ins",     cls: "momentum", defaultEnabled: true, note: "The retention loop. Public permalinks — needs moderation before wide sharing." },
  { id: "discover",   label: "Discover",             cls: "momentum", defaultEnabled: true, note: "Where a shared link lands." },

  // --- Later: real, but earns its place as a project matures ------------
  { id: "investor",   label: "Investor tools",       cls: "later", defaultEnabled: true, note: "In use, and squarely on the mission." },
  { id: "backing",    label: "Backing & merch",      cls: "later", defaultEnabled: false, note: "Real money and an escrow obligation. Off until the payment path has been walked end to end." },
  { id: "launch",     label: "Launch, legal, pricing", cls: "later", defaultEnabled: true, note: "Pre-launch tooling." },
  { id: "storyboards", label: "Storyboards & video", cls: "later", defaultEnabled: true, note: "Marketing output." },

  // --- Network: needs other people to mean anything ---------------------
  { id: "feed",       label: "Feed",                 cls: "network", defaultEnabled: true,  note: "Works at small numbers — a post needs no counterpart. Highest spam surface.", needsPeople: 3 },
  { id: "matches",    label: "Matches",              cls: "network", defaultEnabled: true,  note: "Compares profiles; thin until several people have onboarded.", needsPeople: 10 },
  { id: "sprints",    label: "Sprints & matchmaking", cls: "network", defaultEnabled: true, note: "Needs a partner. Largest subsystem in the codebase.", needsPeople: 6 },
  { id: "connections", label: "Connections",         cls: "network", defaultEnabled: true,  note: "Needs people to connect to.", needsPeople: 5 },
  { id: "messages",   label: "Messages / DMs",       cls: "network", defaultEnabled: true,  note: "Highest abuse surface. Needs rate limits and reporting before wide sharing.", needsPeople: 5 },
  { id: "leaderboard", label: "Leaderboard",         cls: "network", defaultEnabled: true,  note: "Ranks public projects; a list until there are several.", needsPeople: 8 },
  { id: "contests",   label: "Contests",             cls: "network", defaultEnabled: false, note: "Needs entrants and a judge. Nothing has ever been run.", needsPeople: 15 },
  { id: "liveChat",   label: "Live chat & support",  cls: "network", defaultEnabled: false, note: "Needs a team on one side and a customer on the other.", needsPeople: 4 },

  // --- Off --------------------------------------------------------------
  { id: "games",      label: "Games",                cls: "off", defaultEnabled: false, note: "Sidelined — pulls attention with nothing downstream of it." },
];

export type SurfaceId = string;

export const SURFACE_IDS = SURFACES.map((s) => s.id);

export const surface = (id: string): SurfaceDef | undefined =>
  SURFACES.find((s) => s.id === id);

/** The shipped defaults, used before the database has been read. */
export function defaultSurfaceMap(): Record<string, boolean> {
  return Object.fromEntries(SURFACES.map((s) => [s.id, s.defaultEnabled]));
}

export const SURFACE_CLASS_LABEL: Record<SurfaceClass, string> = {
  core: "Core toolkit",
  momentum: "Momentum",
  later: "Matures with the project",
  network: "Needs other people",
  off: "Sidelined",
};

/**
 * Client routes each surface owns.
 *
 * Used to filter the router and the nav. Paths are prefixes — `/games` covers
 * `/games/typing/:id` — so a new sub-route can't accidentally escape the flag
 * it belongs to.
 */
export const SURFACE_ROUTES: Record<string, string[]> = {
  games: ["/games"],
  contests: ["/contests"],
  sprints: ["/sprints"],
  matches: ["/matches"],
  messages: ["/messages"],
  leaderboard: ["/leaderboard"],
  discover: ["/discover"],
  checkIns: ["/c/", "/feedback"],
  backing: ["/admin/backing"],
};

/**
 * API prefixes each surface owns. Mounted as one guard per prefix on the
 * server, so a surface that is off answers 404 for everything under it —
 * sub-routes that don't exist yet included. This is the map the kill
 * switches enforce; the client routes above are cosmetics on top of it.
 * Express prefix matching is by path segment: "/api/projects/:id/nova"
 * covers "/api/projects/x/nova/apply" and not "/api/projects/x/nova-notes".
 */
export const SURFACE_API_PREFIXES: Record<string, string[]> = {
  signup: ["/api/auth/register", "/api/auth/mobile/register", "/api/auth/mobile/google"],
  uploads: ["/api/uploads", "/api/objects/upload", "/internal-local-upload"],
  nova: ["/api/chat", "/api/projects/:id/nova", "/api/projects/:id/nova-guide", "/api/projects/:id/tasks/nova-assist", "/api/projects/:id/path/work", "/api/projects/:id/path/expand", "/api/projects/:id/path/inject", "/api/projects/:id/path/adopt", "/api/projects/:id/next-actions", "/api/projects/:id/health-check"],
  roadmap: ["/api/projects/:id/roadmap"],
  codeAudit: ["/api/projects/:id/code-audit", "/api/code-audits"],
  documents: ["/api/projects/:id/documents", "/api/documents"],
  personas: ["/api/projects/:id/personas", "/api/projects/:id/interviews", "/api/projects/:id/experiments"],
  investor: ["/api/investor", "/api/mock-interviews", "/api/projects/:id/investor", "/api/projects/:id/pitch"],
  launch: ["/api/projects/:id/waitlist", "/api/projects/:id/landing", "/api/projects/:id/legal", "/api/projects/:id/deploy-checklist", "/api/projects/:id/launch", "/api/projects/:id/pricing"],
  storyboards: ["/api/storyboards", "/api/projects/:id/storyboards", "/api/generate-image"],
  backing: ["/api/projects/:id/backing", "/api/backing-tiers", "/api/admin/backing", "/api/backer-badges", "/api/me/badges"],
  checkIns: ["/api/check-ins", "/api/loop-events", "/api/projects/:id/check-ins"],
  discover: ["/api/discover"],
  feed: ["/api/feed", "/api/projects/:id/comments", "/api/project-comments"],
  matches: ["/api/matches"],
  sprints: ["/api/sprints", "/api/sprint"],
  connections: ["/api/connections"],
  messages: ["/api/messages", "/api/conversations"],
  leaderboard: ["/api/leaderboard"],
  contests: ["/api/contests"],
  liveChat: ["/api/projects/:id/live-chat"],
  games: ["/api/games"],
};

/** True when a path belongs to a surface that's currently off. */
export function isPathDisabled(path: string, enabled: Record<string, boolean>): boolean {
  for (const [id, prefixes] of Object.entries(SURFACE_ROUTES)) {
    if (enabled[id] === false && prefixes.some((p) => path === p || path.startsWith(p))) {
      return true;
    }
  }
  return false;
}
