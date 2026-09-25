/**
 * The manager's tabs, in the three places they live: the row under the
 * sections (each section's own view of it), the More menu, and the rail on
 * the right that belongs to the whole project.
 */
import {
  Sparkles, Map, ListChecks, FolderOpen, BarChart3, Eye, Flag, Activity, Target,
  Beaker, Crosshair, HandCoins, Rocket, Headphones, LayoutDashboard, ScanSearch, Users, MessageSquare, Gamepad2, Settings,
  type LucideIcon,
} from "lucide-react";

export type TabId =
  | "nova" | "roadmap" | "kanban" | "files" | "analytics"
  | "public" | "milestones" | "activity" | "personas" | "research" | "strategy" | "investors" | "launch" | "support"
  | "setup" | "codebase" | "team" | "chat" | "simulations";

/** `surface`: the kill switch that hides the tab (shared/surfaces.ts). The path's own tabs have none. */
export interface TabDef { id: TabId; label: string; icon: LucideIcon; ownerOnly?: boolean; surface?: string }

/** Each section's own Dashboard, Roadmap, Tasks, Files and Analytics. */
export const SECTION_TABS: TabDef[] = [
  { id: "nova", label: "Dashboard", icon: Sparkles },
  { id: "roadmap", label: "Roadmap", icon: Map },
  { id: "kanban", label: "Tasks", icon: ListChecks },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
];

export const MORE_TABS: TabDef[] = [
  /*
   * "Settings", not "Public Page".
   *
   * The id stays `public` because it is in saved links and in `?tab=`, and
   * renaming it would break somebody's bookmark for the sake of tidiness. What
   * the tab holds outgrew its name: it is where the owner decides what the
   * world sees of this project, and now where they can delete it.
   */
  { id: "public", label: "Settings", icon: Settings },
  { id: "milestones", label: "Milestones", icon: Flag },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "personas", label: "Personas", icon: Target, surface: "personas" },
  { id: "research", label: "Research", icon: Beaker, surface: "personas" },
  { id: "strategy", label: "Strategy", icon: Crosshair },
  { id: "investors", label: "Investors", icon: HandCoins, ownerOnly: true, surface: "investor" },
  { id: "launch", label: "Launch", icon: Rocket, surface: "launch" },
  { id: "support", label: "Support", icon: Headphones, surface: "launch" },
];

/**
 * The project-wide tabs, always on the right.
 *
 * Simulations holds two things. The first is the owner's own business run
 * month by month — what happens if you hire, borrow, or put prices up — which
 * needs nobody but the person looking at it. The second is the market season:
 * five people take the five seats of one company in an invented market and run
 * it for a fortnight, which is why the tab sits directly under Team.
 *
 * It carries no `surface`, and that is deliberate. The season half is behind
 * the `sprints` kill switch inside the panel, where it belongs — that switch
 * exists for surfaces that need other people, and the simulator does not. A
 * tab gated on `sprints` would have taken an owner's projections away with
 * the matchmaking.
 */
export const RAIL_TABS: TabDef[] = [
  { id: "setup", label: "Setup", icon: LayoutDashboard },
  { id: "codebase", label: "Codebase", icon: ScanSearch, surface: "codeAudit" },
  { id: "team", label: "Team", icon: Users },
  { id: "simulations", label: "Simulations", icon: Gamepad2 },
  { id: "chat", label: "Chat", icon: MessageSquare, surface: "liveChat" },
];

export const ALL_TABS: TabDef[] = [...SECTION_TABS, ...MORE_TABS, ...RAIL_TABS];
export const isTabId = (v: unknown): v is TabId => ALL_TABS.some((t) => t.id === v);
export const tabDef = (id: TabId) => ALL_TABS.find((t) => t.id === id)!;

/** Nova's gradient — defined in components/nova/tokens.ts, re-exported so the rail's imports stay put. */
export { NOVA_GRADIENT } from "@/components/nova/tokens";
