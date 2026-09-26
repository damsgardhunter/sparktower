/**
 * What keeps a section's screens live: the polled path, what changed on it
 * since the last read (flashed on the nodes, and a toast once per change no
 * matter how many screens are watching), a ticking "Synced · 2m ago", and the
 * request to open a milestone that the always-on path strip sends to the
 * dashboard.
 */
import { useEffect, useRef, useState } from "react";
import { LiveDot } from "@/components/nova";
import { useToast } from "@/hooks/use-toast";
import { usePath } from "@/lib/sections";
import type { ProjectGoal } from "@shared/goals";
import type { PathSurface } from "@shared/phase-trees";
import type { PathResponse, PathStatus } from "./path-types";

/** What each project section's path looked like when last seen, shared by every screen showing it — so a change toasts once. */
const seen = new Map<string, { done: Set<string>; auditId: string | null }>();

const doneIds = (d: PathStatus) => new Set(d.phases.flatMap((p) => p.milestones.filter((m) => m.done).map((m) => m.id)));

export function useLivePath(projectId: string, goal: ProjectGoal) {
  const q = usePath<PathResponse>(projectId, goal);
  const { toast } = useToast();
  const prev = useRef<Set<string> | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());

  useEffect(() => {
    const d = q.data;
    if (!d || !d.adopted) return;
    const done = doneIds(d);
    // Flash: this screen's own before/after.
    if (prev.current) {
      const added = [...done].filter((id) => !prev.current!.has(id));
      if (added.length) {
        setFlash(new Set(added));
        const t = setTimeout(() => setFlash(new Set()), 4000);
        prev.current = done;
        return () => clearTimeout(t);
      }
    }
    prev.current = done;
  }, [q.data]);

  useEffect(() => {
    const d = q.data;
    if (!d || !d.adopted) return;
    const key = `${projectId}:${goal}`;
    const done = doneIds(d);
    const auditId = d.auditUpdate?.auditId ?? null;
    const before = seen.get(key);
    seen.set(key, { done, auditId });
    if (!before) return;
    const titles = new Map(d.phases.flatMap((p) => p.milestones.map((m) => [m.id, m.title] as const)));
    const added = [...done].filter((id) => !before.done.has(id));
    const fromAudit = auditId && auditId !== before.auditId;
    if (fromAudit) {
      toast({ title: "Path updated from your code", description: d.auditUpdate!.applied.slice(0, 2).join(" · ") || undefined });
    } else if (added.length) {
      toast({ title: added.length === 1 ? "Milestone done" : `${added.length} milestones done`, description: added.map((id) => titles.get(id)).filter(Boolean).slice(0, 3).join(" · ") });
    }
  }, [q.data, projectId, goal, toast]);

  return { ...q, flash };
}

/** Re-renders every `ms` so relative times stay true. */
export function useNow(ms = 20_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function agoShort(at: number, now: number) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

/** "● Synced · 2m ago" — the dot breathes while a read is in flight. */
export function SyncDot({ updatedAt, fetching, error, compact }: { updatedAt: number; fetching: boolean; error?: boolean; compact?: boolean }) {
  const now = useNow();
  const label = error ? "Offline — retrying" : fetching ? "Syncing…" : updatedAt ? `Synced · ${agoShort(updatedAt, now)}` : "Syncing…";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground whitespace-nowrap" title="This screen re-reads your path every 15 seconds — the board, audits and your editor show up here on their own." data-testid="sync-indicator">
      <LiveDot active={fetching} tone={error ? "warn" : "nova"} />
      <span className={compact ? "hidden sm:inline" : ""}>{label}</span>
    </span>
  );
}

const OPEN_EVENT = "sparktower:open-milestone";
let pendingOpen: { id: string; at: number } | null = null;

/**
 * Ask the section dashboard to open a milestone (the path strip calls this).
 * If the dashboard isn't mounted yet — the shell is switching to it — the
 * request waits for it.
 */
export function requestOpenMilestone(backboneId: string) {
  pendingOpen = { id: backboneId, at: Date.now() };
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: backboneId }));
}

/*
 * The same shape again, for the surfaces that finish a step by being used —
 * the roadmap, the jobs list, the quarter's goals (BackboneMilestone.doneOn).
 * The step's card asks, and whichever card owns that surface scrolls itself
 * into view and says so. Kept separate from the milestone request because the
 * two answer different questions: "open this step" and "take me to where this
 * step is actually done".
 */
const SURFACE_EVENT = "sparktower:open-surface";
let pendingSurface: { surface: string; at: number } | null = null;

export function requestOpenSurface(surface: PathSurface) {
  pendingSurface = { surface, at: Date.now() };
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SURFACE_EVENT, { detail: surface }));
}

/**
 * A card's side. Returns a ref to put on the element to scroll to, and a flag
 * that is true for a few seconds after it is asked for, so the card can say
 * "here" rather than leaving somebody staring at a page that moved.
 */
export function useOpenSurface(surface: PathSurface) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    const show = () => {
      setAsked(true);
      // After paint, or the element may not be where it is about to be.
      requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
      window.setTimeout(() => setAsked(false), 4000);
    };
    /*
     * `?surface=` in the URL, so the way here can be a link rather than only a
     * button on the same screen. That is what the home card and the phone
     * need: they are somewhere else entirely, and "open the roadmap" from
     * there has to survive a navigation.
     */
    const fromUrl = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("surface") : null;
    if (fromUrl === surface) {
      // Taken out of the address bar once acted on, so a refresh doesn't do it again.
      const params = new URLSearchParams(window.location.search);
      params.delete("surface");
      const rest = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
      setTimeout(show, 0);
    }
    // A request made while the dashboard was mounting still counts.
    if (pendingSurface && pendingSurface.surface === surface && Date.now() - pendingSurface.at < 5000) {
      pendingSurface = null;
      setTimeout(show, 0);
    }
    const listener = (e: Event) => { if ((e as CustomEvent<string>).detail === surface) show(); };
    window.addEventListener(SURFACE_EVENT, listener);
    return () => window.removeEventListener(SURFACE_EVENT, listener);
  }, [surface]);

  return { ref, asked };
}

/** The dashboard's side: a pending request on mount, `?milestone=` in the URL, and any request after. */
export function useOpenMilestoneRequests(onOpen: (backboneId: string) => void) {
  const cb = useRef(onOpen);
  cb.current = onOpen;
  useEffect(() => {
    const fromUrl = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("milestone") : null;
    const first = (pendingOpen && Date.now() - pendingOpen.at < 5000 ? pendingOpen.id : null) ?? fromUrl;
    pendingOpen = null;
    if (first) setTimeout(() => cb.current(first), 0);
    // The request stays pending a few seconds: the screen hearing it may be the one the shell is about to unmount.
    const listener = (e: Event) => cb.current((e as CustomEvent<string>).detail);
    window.addEventListener(OPEN_EVENT, listener);
    return () => window.removeEventListener(OPEN_EVENT, listener);
  }, []);
}
