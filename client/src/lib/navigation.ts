/**
 * The sidebar, as data — so the sequencing decision (docs/decisions/0001-path-loops-first.md)
 * is checked, not just followed: the primary group is the path loops and nothing that waits
 * for the wedge; everything else is secondary, and every item in either group that belongs
 * to a surface names it, so its kill switch hides it. test/unit/navigation.test.ts holds it.
 *
 * Icons are named rather than imported, to keep this free of React.
 */
export interface NavItem {
  title: string;
  url: string;
  icon: "Home" | "FolderKanban" | "Compass" | "Telescope" | "Users" | "Handshake" | "Gamepad2" | "MessageSquare" | "Trophy" | "Medal" | "CreditCard" | "Banknote";
  /** The surface whose flag hides this item. None for pages that aren't feature areas. */
  surface?: string;
}

/**
 * Where the work happens: your home, the path waiting across your projects, and
 * the one place to go looking outward.
 *
 * "Your path" is an address, which the home feed's card isn't: coming back to
 * pick up where you left off is the retention loop, and a loop needs somewhere
 * to return to that isn't "scroll the feed until you find the card".
 *
 * Discover takes the slot Projects held. Your own projects were never a
 * destination you browsed to — you arrive at one from the path, the feed or
 * your profile — whereas Discover is now the whole outward half of the product
 * (projects to find, people to match with, the ranking), so it earns the
 * standing address. It is the one primary item that names a surface: it is
 * "supports", not "after-wedge", so the sequencing decision lets it lead, but
 * it is still a switchable feature area and the sidebar must drop it when the
 * flag is off rather than leave a primary link to a 404.
 */
export const PRIMARY_NAV: NavItem[] = [
  { title: "Home", url: "/", icon: "Home" },
  { title: "Your path", url: "/path", icon: "Compass" },
  { title: "Discover", url: "/discover", icon: "Telescope", surface: "discover" },
];

/** Real, reachable, and quieter: the network surfaces and the rest, each behind its flag. */
export const SECONDARY_NAV: NavItem[] = [
  /* Matches and the leaderboard are sections of Discover now, not addresses of their own; their
     old URLs still resolve, they just redirect. Their flags still hide them — inside Discover. */
  /*
   * "Simulations", not "Sprints & simulations".
   *
   * The co-founder sprint it was half-named after is retired — there is no
   * longer a way to start one — so the word survived only in the label, and a
   * menu item naming a feature that no longer exists is a menu item people
   * learn to skip. Both things behind it are simulations: a company invented
   * in half an hour and valued ten years out, and a market run for a
   * fortnight. The URL stays `/sprints` because links to it exist.
   */
  { title: "Simulations", url: "/sprints", icon: "Gamepad2", surface: "sprints" },
  { title: "Messages", url: "/messages", icon: "MessageSquare", surface: "messages" },
  { title: "Contests and Communities", url: "/contests", icon: "Medal", surface: "contests" },
  // For existing businesses: training seasons, recruiting, challenges they sponsor, startups they follow.
  { title: "Companies", url: "/companies", icon: "Users", surface: "companies" },
  // Real problems companies put up, for founders to answer.
  { title: "Challenges", url: "/challenges", icon: "Trophy", surface: "companies" },
  /*
   * Ungated, and deliberately not hidden behind owning a project. The only way
   * to reach payout setup used to be a campaign's backing tab, so somebody who
   * had won a challenge prize had nowhere to add a bank account at all.
   */
  { title: "Earnings", url: "/earnings", icon: "Banknote" },
  { title: "Pricing", url: "/pricing", icon: "CreditCard" },
];
