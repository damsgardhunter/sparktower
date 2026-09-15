/**
 * The project manager's three sections — Ship an MVP, Systemize the business,
 * Raise funds — each its own path on the same project, worked side by side.
 *
 * Restated from client/src/lib/sections.ts (and shared/goals.ts,
 * client/src/lib/audit-status.ts, client/src/components/analytics/starter-metrics.ts)
 * because the app doesn't import the repo's shared or client folders. Keep in
 * step with those: which section a board task belongs to must match the
 * server's `trackOfTask`, or a card shows in the wrong section.
 *
 * Query keys all start ["manage", projectId, …] like the rest of the manager,
 * and a section's path keeps the "path" prefix, so every existing refresh of
 * the path reaches every section.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { api } from "./api/client";
import { PROJECT_GOALS, PROJECT_SUBCATEGORIES, type ProjectGoal } from "./projectData";

export type { ProjectGoal } from "./projectData";

type IoniconName =
  | "rocket-outline" | "git-network-outline" | "cash-outline";

export interface SectionDef {
  goal: ProjectGoal;
  label: string;
  short: string;
  /** One line under the section's name. Short on purpose. */
  blurb: string;
  icon: IoniconName;
  /** The question the start sheet asks. */
  kindQuestion: string;
}

const BLURB: Record<ProjectGoal, string> = {
  ship_mvp: "Build it and get it in front of people",
  systemize_business: "Make it run without you",
  raise_funding: "Get the money behind it",
};
const ICON: Record<ProjectGoal, IoniconName> = { ship_mvp: "rocket-outline", systemize_business: "git-network-outline", raise_funding: "cash-outline" };
const KIND_QUESTION: Record<ProjectGoal, string> = {
  ship_mvp: "What kind of thing are you shipping?",
  systemize_business: "What kind of business is it?",
  raise_funding: "What kind of raise is it?",
};

export const SECTIONS: SectionDef[] = PROJECT_GOALS.map((g) => ({
  goal: g.id, label: g.label, short: g.short, blurb: BLURB[g.id], icon: ICON[g.id], kindQuestion: KIND_QUESTION[g.id],
}));
export const sectionDef = (goal: ProjectGoal) => SECTIONS.find((s) => s.goal === goal)!;
export const isProjectGoal = (v: unknown): v is ProjectGoal => typeof v === "string" && PROJECT_GOALS.some((g) => g.id === v);
export const subcategoriesFor = (goal: ProjectGoal) => PROJECT_SUBCATEGORIES[goal];

/** A milestone id's section, from its prefix (shared/goals.ts goalOfBackboneId). */
export function goalOfBackboneId(id: string | null | undefined): ProjectGoal | null {
  if (!id) return null;
  if (id.startsWith("SHIP.")) return "ship_mvp";
  if (id.startsWith("SYS.")) return "systemize_business";
  if (id.startsWith("FUND.")) return "raise_funding";
  return null;
}

/** How often the manager re-reads the sections and the open path while it's on screen. */
export const LIVE_INTERVAL_MS = 15_000;

export interface SectionSummary {
  goal: ProjectGoal; label: string; short: string;
  started: boolean; primary: boolean;
  subcategory?: string; done?: number; total?: number; next?: string | null;
}
export interface SectionsResponse { primary: ProjectGoal; tracks: SectionSummary[] }

export const tracksKey = (projectId: string) => ["manage", projectId, "tracks"];
export const sectionPathKey = (projectId: string, goal: ProjectGoal) => ["manage", projectId, "path", "section", goal];

/** Whether the screen this runs in is the one in front. Polling stops behind another screen. */
export function useScreenFocused() {
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  return focused;
}

/** GET /api/projects/:id/tracks, kept live while the screen is in front, and re-read when it comes back. */
export function useSections(projectId: string | undefined, focused = true) {
  const query = useQuery({
    queryKey: tracksKey(projectId ?? ""),
    queryFn: () => api<SectionsResponse>(`/api/projects/${projectId}/tracks`),
    enabled: !!projectId,
    refetchInterval: focused ? LIVE_INTERVAL_MS : false,
    staleTime: 5_000,
  });
  const wasFocused = useRef(focused);
  useEffect(() => {
    if (focused && !wasFocused.current && projectId) void query.refetch();
    wasFocused.current = focused;
  }, [focused]); // eslint-disable-line react-hooks/exhaustive-deps
  return query;
}

/** GET /api/projects/:id/path?goal=… — one section's path, kept live. */
export function useSectionPath<T = any>(projectId: string, goal: ProjectGoal, opts: { enabled?: boolean; live?: boolean } = {}) {
  return useQuery({
    queryKey: sectionPathKey(projectId, goal),
    queryFn: () => api<T>(`/api/projects/${projectId}/path?goal=${goal}`),
    enabled: !!projectId && opts.enabled !== false,
    refetchInterval: opts.live === false ? false : LIVE_INTERVAL_MS,
    staleTime: 5_000,
  });
}

// --- Board tasks -------------------------------------------------------------

const tagValue = (tags: string[] | null | undefined, prefix: string) => tags?.find((t) => t.startsWith(prefix))?.slice(prefix.length) ?? null;

/**
 * The section a board task belongs to: its `track:` tag, else its milestone's
 * prefix (its own or its parent's), else an injected task is the primary's.
 * A task on no path returns null: it shows in every section.
 */
export function sectionOfTask(tags: string[] | null | undefined, primary: ProjectGoal): ProjectGoal | null {
  const tagged = tagValue(tags, "track:");
  if (isProjectGoal(tagged)) return tagged;
  const id = tagValue(tags, "backbone:") ?? tagValue(tags, "parent:");
  if (id) return goalOfBackboneId(id) ?? primary;
  if (tagValue(tags, "injected:")) return primary;
  return null;
}

/** Whether a board task shows in a section: its own, or on no section. Archived ones are hidden. */
export const taskInSection = (tags: string[] | null | undefined, goal: ProjectGoal, primary: ProjectGoal) =>
  !tags?.some((t) => t.startsWith("archived:")) && (sectionOfTask(tags, primary) ?? goal) === goal;

/** The tag a task created inside a section carries. */
export const sectionTag = (goal: ProjectGoal) => `track:${goal}`;

/** Tags the path writes for itself are bookkeeping: cards and forms hide them, saving keeps them. */
const SYSTEM_TAG = /^(actor|tier|backbone|track|parent|loop|loop-type|kind|shared|expands|injected|artifact|carried|verified|archived|round|posted):/;
export const isSystemTag = (tag: string) => SYSTEM_TAG.test(tag);
export const visibleTags = (tags: string[] | null | undefined) => (tags ?? []).filter((t) => !isSystemTag(t));

// --- Analytics starters -------------------------------------------------------

export type MetricCategory = "activation" | "retention" | "revenue" | "referral";
export interface StarterMetric { eventName: string; label: string; category: MetricCategory; description: string }

/** One-tap suggestions for each section's "What you're measuring". */
export const STARTER_METRICS: Record<ProjectGoal, StarterMetric[]> = {
  ship_mvp: [
    { eventName: "user_signed_up", label: "Signups", category: "activation", description: "Someone creates an account" },
    { eventName: "user_activated", label: "Activation", category: "activation", description: "A new user does the core thing once" },
    { eventName: "user_returned_week_1", label: "Week-1 retention", category: "retention", description: "They come back within 7 days" },
    { eventName: "first_payment", label: "First payment", category: "revenue", description: "A user pays for the first time" },
  ],
  systemize_business: [
    { eventName: "order_handled_without_you", label: "Orders handled without you", category: "activation", description: "An order goes start to finish with no founder touch" },
    { eventName: "hours_saved_weekly", label: "Hours saved / week", category: "retention", description: "Founder hours a system took over" },
    { eventName: "repeat_customer", label: "Repeat customers", category: "retention", description: "A customer buys a second time" },
    { eventName: "referral_received", label: "Referrals", category: "referral", description: "A new customer came from an existing one" },
  ],
  raise_funding: [
    { eventName: "investor_intro", label: "Investor intros", category: "referral", description: "A warm intro to an investor" },
    { eventName: "investor_meeting", label: "Meetings", category: "activation", description: "A first meeting with an investor" },
    { eventName: "investor_follow_up", label: "Follow-ups", category: "retention", description: "An investor asks for a second meeting or data" },
    { eventName: "commitment", label: "Commitments", category: "revenue", description: "A soft or signed commitment" },
  ],
};

// --- Code audit status ---------------------------------------------------------

export interface AuditStatus {
  running: { id?: string; source: string; stage: string; startedAt: string; startedBy: { id: string; firstName: string | null } | null; elapsedSeconds: number } | null;
  last: { id?: string; source?: string; finishedAt: string | null; auditId: string | null; error: string | null } | null;
}

export const AUDIT_STAGE_LABEL: Record<string, string> = {
  fetching: "Fetching the code",
  reading: "Reading the code",
  saving: "Saving what it found",
};
export const auditStageLabel = (stage: string | null | undefined) => AUDIT_STAGE_LABEL[stage ?? ""] ?? "Nova is reading it";

/** "1:05", "42s". */
export function formatElapsed(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Whether Nova is reading the project's code right now (from this phone, the
 * web, the editor bridge or a teammate). Polls every 4s while a read runs and
 * every 20s otherwise; when one finishes, the audits, the path, the sections
 * and the board are re-read.
 */
export function useAuditStatus(projectId: string, opts: { expectRunning?: boolean } = {}) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["manage", projectId, "code-audit", "status"],
    queryFn: () => api<AuditStatus>(`/api/projects/${projectId}/code-audit/status`),
    enabled: !!projectId,
    refetchInterval: (q) => (opts.expectRunning || (q.state.data as AuditStatus | undefined)?.running ? 4_000 : 20_000),
    staleTime: 2_000,
  });
  const data = query.data;
  const prev = useRef<{ running: boolean; finishedAt: string | null } | null>(null);
  useEffect(() => {
    if (!data) return;
    const next = { running: !!data.running, finishedAt: data.last?.finishedAt ?? null };
    const before = prev.current;
    prev.current = next;
    if (!before) return;
    if ((before.running && !next.running) || before.finishedAt !== next.finishedAt) {
      for (const key of ["code-audits", "code-audit", "path", "tracks", "kanban", "milestones", "roadmap", "briefing"]) {
        void qc.invalidateQueries({ queryKey: ["manage", projectId, key] });
      }
      void qc.invalidateQueries({ queryKey: ["subscription"] });
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...query, running: data?.running ?? null, last: data?.last ?? null };
}
