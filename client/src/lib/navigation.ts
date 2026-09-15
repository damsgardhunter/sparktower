/**
 * The sidebar, as data — so the sequencing decision (docs/decisions/0001-path-loops-first.md)
 * is checked, not just followed: the primary group is the path loops and nothing that waits
 * for the wedge; everything else is secondary, and every secondary item that belongs to a
 * surface names it, so its kill switch hides it. test/unit/navigation.test.ts holds it.
 *
 * Icons are named rather than imported, to keep this free of React.
 */
export interface NavItem {
  title: string;
  url: string;
  icon: "Home" | "FolderKanban" | "Compass" | "Users" | "Handshake" | "MessageSquare" | "Trophy" | "Medal" | "CreditCard";
  /** The surface whose flag hides this item. None for pages that aren't feature areas. */
  surface?: string;
}

/** Where the work happens: your home (with your paths) and your projects' paths. */
export const PRIMARY_NAV: NavItem[] = [
  { title: "Home", url: "/", icon: "Home" },
  { title: "Projects", url: "/projects", icon: "FolderKanban" },
];

/** Real, reachable, and quieter: the network surfaces and the rest, each behind its flag. */
export const SECONDARY_NAV: NavItem[] = [
  { title: "Discover", url: "/discover", icon: "Compass", surface: "discover" },
  { title: "Matches", url: "/matches", icon: "Users", surface: "matches" },
  { title: "Sprints", url: "/sprints", icon: "Handshake", surface: "sprints" },
  { title: "Messages", url: "/messages", icon: "MessageSquare", surface: "messages" },
  { title: "Leaderboard", url: "/leaderboard", icon: "Trophy", surface: "leaderboard" },
  { title: "Contests and Communities", url: "/contests", icon: "Medal", surface: "contests" },
  { title: "Pricing", url: "/pricing", icon: "CreditCard" },
];
