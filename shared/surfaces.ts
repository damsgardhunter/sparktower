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
  /**
   * Where this surface sits in the sequencing decision (docs/decisions/0001-path-loops-first.md):
   * "wedge" — the three path loops and what they can't run without; "supports" — a tool a path
   * step asks for, or what closes a path loop; "after-wedge" — real, kept compiled and tested,
   * but not where work goes until the wedge is proven. After-wedge surfaces sit in the secondary
   * nav and must be behind this flag on the server and the client.
   */
  sequence: SurfaceSequence;
  /** For an after-wedge surface: what has to be true before it gets new work. */
  unlocksWhen?: string;
}

export type SurfaceSequence = "wedge" | "supports" | "after-wedge";

export const SURFACE_SEQUENCE_LABEL: Record<SurfaceSequence, string> = {
  wedge: "The wedge — the three path loops",
  supports: "Supports a path step or closes a loop",
  "after-wedge": "After the wedge is proven",
};

/** What "the wedge is proven" means, so an after-wedge surface can't be unlocked by feel. Proposed thresholds: the owner sets the real ones. */
export const WEDGE_PROOF = "Path loops retain: of builders who start a path, 40% finish a step in week 2 and 25% publish a step or update in week 4, for four cohorts running.";

export const SURFACES: SurfaceDef[] = [
  // --- Core: the company-building toolkit -------------------------------
  { id: "projects",   label: "Projects & brief",     cls: "core", defaultEnabled: true, note: "The object everything else hangs off.", sequence: "wedge" },
  { id: "signup",     label: "New accounts",         cls: "core", defaultEnabled: true, note: "Registration, web and mobile. Off closes the door to new people without touching anyone signed in.", sequence: "wedge" },
  { id: "uploads",    label: "Uploads",              cls: "core", defaultEnabled: true, note: "Every file upload. The first thing to turn off under a storage or abuse incident.", sequence: "wedge" },
  { id: "tasks",      label: "Tasks & kanban",       cls: "core", defaultEnabled: true, note: "Most-used surface in the product.", sequence: "wedge" },
  { id: "milestones", label: "Milestones",           cls: "core", defaultEnabled: true, note: "In use.", sequence: "wedge" },
  { id: "roadmap",    label: "Roadmap",              cls: "core", defaultEnabled: true, note: "In use.", sequence: "supports" },
  { id: "nova",       label: "Nova assistant",       cls: "core", defaultEnabled: true, note: "The differentiator; drives every other surface.", sequence: "wedge" },
  { id: "codeAudit",  label: "Codebase audit",       cls: "core", defaultEnabled: true, note: "In use, and genuinely unusual.", sequence: "supports" },
  { id: "mcp",        label: "Editor bridge (MCP)",  cls: "core", defaultEnabled: true, note: "Nova over MCP, for Claude Code, Cursor and VS Code agent mode. Long-lived tokens and whole source trees arrive here — the first switch to reach for if one leaks.", sequence: "supports" },
  { id: "documents",  label: "Documents",            cls: "core", defaultEnabled: true, note: "In use.", sequence: "supports" },
  { id: "personas",   label: "Personas & research",  cls: "core", defaultEnabled: true, note: "In use.", sequence: "supports" },

  // --- Momentum: proof the company is moving ----------------------------
  { id: "discover",   label: "Discover",             cls: "momentum", defaultEnabled: true, note: "Where a shared link lands.", sequence: "supports" },

  // --- Later: real, but earns its place as a project matures ------------
  { id: "investor",   label: "Investor tools",       cls: "later", defaultEnabled: true, note: "In use, and squarely on the mission.", sequence: "supports" },
  { id: "backing",    label: "Backing & merch",      cls: "later", defaultEnabled: true, note: "Real money and an escrow obligation. Pledges are held until a reviewer approves the project. Turn off here if the payment path misbehaves.", sequence: "after-wedge", unlocksWhen: "The wedge is proven, and a project on the Fund path asks for backers." },
  { id: "launch",     label: "Launch, legal, pricing", cls: "later", defaultEnabled: true, note: "Pre-launch tooling.", sequence: "supports" },
  { id: "storyboards", label: "Storyboards & video", cls: "later", defaultEnabled: true, note: "Marketing output, including the AI visuals on project pages.", sequence: "after-wedge", unlocksWhen: "The wedge is proven, and published steps show builders want marketing output." },

  // --- Network: needs other people to mean anything ---------------------
  { id: "feed",       label: "Feed",                 cls: "network", defaultEnabled: true,  note: "Works at small numbers — a post needs no counterpart. Highest spam surface.", needsPeople: 3, sequence: "wedge" },
  { id: "matches",    label: "Matches",              cls: "network", defaultEnabled: true,  note: "Compares profiles; thin until several people have onboarded.", needsPeople: 10, sequence: "after-wedge", unlocksWhen: "The wedge is proven, and 10+ active builders a week are on paths." },
  { id: "sprints",    label: "Sprints & simulations", cls: "network", defaultEnabled: true, note: "Needs a partner, or four. Trial sprints, matchmaking, and the market simulation.", needsPeople: 6, sequence: "after-wedge", unlocksWhen: "The wedge is proven, and builders ask for a partner to do a step with." },
  { id: "connections", label: "Connections",         cls: "network", defaultEnabled: true,  note: "Needs people to connect to.", needsPeople: 5, sequence: "after-wedge", unlocksWhen: "The wedge is proven; follows on published steps come first." },
  { id: "messages",   label: "Messages / DMs",       cls: "network", defaultEnabled: true,  note: "Highest abuse surface. Needs rate limits and reporting before wide sharing.", needsPeople: 5, sequence: "after-wedge", unlocksWhen: "The wedge is proven, and reporting and limits are in place for DMs." },
  { id: "leaderboard", label: "Leaderboard",         cls: "network", defaultEnabled: true,  note: "Ranks public projects; a list until there are several.", needsPeople: 8, sequence: "after-wedge", unlocksWhen: "The wedge is proven, and there are enough public projects to rank." },
  { id: "contests",   label: "Contests",             cls: "network", defaultEnabled: true,  note: "In the main nav. Empty until the first contest is run — it needs entrants and a judge.", needsPeople: 15, sequence: "after-wedge", unlocksWhen: "The wedge is proven, and a first contest has entrants and a judge." },
  { id: "communities", label: "Communities",         cls: "network", defaultEnabled: true,  note: "Groups builders join; lives inside the Contests page. Empty until people join one.", needsPeople: 15, sequence: "after-wedge", unlocksWhen: "The wedge is proven, and builders on the same path want somewhere to gather." },
  { id: "liveChat",   label: "Live chat & support",  cls: "network", defaultEnabled: false, note: "Needs a team on one side and a customer on the other.", needsPeople: 4, sequence: "after-wedge", unlocksWhen: "The wedge is proven, and a project has customers to support." },
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
 * Used to filter the router and the nav. Paths are prefixes — `/sprints` covers
 * `/sprints/:id` — so a new sub-route can't accidentally escape the flag
 * it belongs to.
 */
export const SURFACE_ROUTES: Record<string, string[]> = {
  contests: ["/contests"],
  sprints: ["/sprints"],
  messages: ["/messages"],
  discover: ["/discover"],
  /*
   * `/matches` and `/leaderboard` are deliberately absent, though both surfaces
   * still exist and still gate their APIs below. Both pages were absorbed into
   * Discover and their addresses are now redirects, kept because old links,
   * emails and notifications still point at them. Listing them here would make
   * turning either surface off render a 404 at an address whose only job is to
   * forward — the kill switch would break the redirect rather than the feature.
   * The matching and ranking they gate are reached through Discover, which has
   * its own flag.
   */
  feed: ["/posts", "/a/"],
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
  uploads: ["/api/uploads", "/internal-local-upload"],
  nova: ["/api/chat", "/api/projects/:id/nova", "/api/projects/:id/nova-guide", "/api/projects/:id/tasks/nova-assist", "/api/projects/:id/path/work", "/api/projects/:id/path/expand", "/api/projects/:id/path/inject", "/api/projects/:id/path/adopt", "/api/projects/:id/health-check"],
  roadmap: ["/api/projects/:id/roadmap"],
  codeAudit: ["/api/projects/:id/code-audit", "/api/code-audits"],
  mcp: ["/api/mcp", "/api/mcp-tokens"],
  documents: ["/api/projects/:id/documents", "/api/documents"],
  personas: ["/api/projects/:id/personas", "/api/projects/:id/interviews", "/api/projects/:id/experiments"],
  investor: ["/api/mock-interviews", "/api/projects/:id/investment", "/api/investment-applications", "/api/projects/:id/investor-artifacts", "/api/projects/:id/pitch-deck", "/api/projects/:id/readiness-score", "/api/projects/:id/pitch-critique", "/api/projects/:id/pricing-analysis", "/api/projects/:id/mock-interview", "/api/investor-personas"],
  launch: ["/api/projects/:id/waitlist", "/api/projects/:id/deploy-checklist", "/api/projects/:id/pricing", "/api/projects/:id/legal-docs", "/api/projects/:id/launch-tasks", "/api/projects/:id/support-tickets"],
  storyboards: ["/api/storyboards", "/api/projects/:id/storyboards", "/api/projects/:id/visuals", "/api/projects/:id/generate-video"],
  backing: ["/api/projects/:id/backing", "/api/backing-tiers", "/api/admin/backing", "/api/backer-badges", "/api/me/badges", "/api/projects/:id/merch", "/api/merch-orders", "/api/admin/printful", "/api/users/:userId/backings", "/api/backings", "/api/users/:userId/badges/backer", "/api/me/backings", "/api/payouts", "/api/stripe/connect-account", "/api/stripe/connect-onboarding", "/api/stripe/connect-dashboard", "/api/projects/:id/donations", "/api/projects/:id/donate-checkout"],
  discover: ["/api/discover"],
  feed: ["/api/feed", "/api/projects/:id/comments", "/api/project-comments", "/api/artifacts", "/api/public/artifacts", "/api/promotions"],
  matches: ["/api/matches", "/api/projects/:id/recommend-people"],
  sprints: ["/api/sprints"],
  connections: ["/api/connections"],
  messages: ["/api/messages"],
  leaderboard: ["/api/leaderboard", "/api/reputation"],
  contests: ["/api/contests"],
  communities: ["/api/communities"],
  liveChat: ["/api/projects/:id/live-chat"],
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
