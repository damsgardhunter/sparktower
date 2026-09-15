/**
 * The manager's tabs, in the three places they live: the row under the
 * sections (each section's own view of it), the More menu, and the rail on
 * the right that belongs to the whole project.
 */
import {
  Sparkles, Map, ListChecks, FolderOpen, BarChart3, Eye, Flag, Activity, Target,
  Beaker, Crosshair, HandCoins, Rocket, Headphones, LayoutDashboard, ScanSearch, Users, MessageSquare,
  type LucideIcon,
} from "lucide-react";

export type TabId =
  | "nova" | "roadmap" | "kanban" | "files" | "analytics"
  | "public" | "milestones" | "activity" | "personas" | "research" | "strategy" | "investors" | "launch" | "support"
  | "setup" | "codebase" | "team" | "chat";

export interface TabDef { id: TabId; label: string; icon: LucideIcon; ownerOnly?: boolean }

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
  { id: "personas", label: "Personas", icon: Target },
  { id: "research", label: "Research", icon: Beaker },
  { id: "strategy", label: "Strategy", icon: Crosshair },
  { id: "investors", label: "Investors", icon: HandCoins, ownerOnly: true },
  { id: "launch", label: "Launch", icon: Rocket },
  { id: "support", label: "Support", icon: Headphones },
];

/** The project-wide tabs, always on the right. */
export const RAIL_TABS: TabDef[] = [
  { id: "setup", label: "Setup", icon: LayoutDashboard },
  { id: "codebase", label: "Codebase", icon: ScanSearch },
  { id: "team", label: "Team", icon: Users },
  { id: "chat", label: "Chat", icon: MessageSquare },
];

export const ALL_TABS: TabDef[] = [...SECTION_TABS, ...MORE_TABS, ...RAIL_TABS];
export const isTabId = (v: unknown): v is TabId => ALL_TABS.some((t) => t.id === v);
export const tabDef = (id: TabId) => ALL_TABS.find((t) => t.id === id)!;

export const NOVA_GRADIENT = "bg-gradient-to-r from-green-400 via-emerald-500 to-purple-500";
