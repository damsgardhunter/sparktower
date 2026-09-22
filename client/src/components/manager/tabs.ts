/**
 * The manager's tabs, in the three places they live: the row under the
 * sections (each section's own view of it), the More menu, and the rail on
 * the right that belongs to the whole project.
 */
import {
  Sparkles, Map, ListChecks, FolderOpen, BarChart3, Eye, Flag, Activity, Target,
  Beaker, Crosshair, HandCoins, Rocket, Headphones, LayoutDashboard, ScanSearch, Users, MessageSquare, Gamepad2,
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
  { id: "public", label: "Public Page", icon: Eye },
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
 * Simulations sits directly under Team because it is a thing you do *with*
 * the team on this project: a company's people take the five seats of one
 * company in a market and run it for a fortnight. It shows for every project
 * — a project no company owns says so, and points at the public market
 * instead of pretending the panel is broken.
 */
export const RAIL_TABS: TabDef[] = [
  { id: "setup", label: "Setup", icon: LayoutDashboard },
  { id: "codebase", label: "Codebase", icon: ScanSearch, surface: "codeAudit" },
  { id: "team", label: "Team", icon: Users },
  { id: "simulations", label: "Simulations", icon: Gamepad2, surface: "sprints" },
  { id: "chat", label: "Chat", icon: MessageSquare, surface: "liveChat" },
];

export const ALL_TABS: TabDef[] = [...SECTION_TABS, ...MORE_TABS, ...RAIL_TABS];
export const isTabId = (v: unknown): v is TabId => ALL_TABS.some((t) => t.id === v);
export const tabDef = (id: TabId) => ALL_TABS.find((t) => t.id === id)!;

export const NOVA_GRADIENT = "bg-gradient-to-r from-green-400 via-emerald-500 to-purple-500";
