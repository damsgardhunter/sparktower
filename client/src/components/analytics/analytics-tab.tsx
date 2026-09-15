import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ProjectGoal } from "@shared/goals";
import type { AnalyticsEvent, ProjectHealthCheck } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { sectionDef } from "@/lib/sections";
import { useToast } from "@/hooks/use-toast";
import { useEntitlements } from "@/hooks/use-entitlements";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { HealthCheckPanel } from "@/components/health-check-panel";
import { NovaActionButton } from "@/components/nova-action-button";
import { useRequestNovaHandoff } from "@/components/nova-handoff";
import { Loader2, Plus, X, Stethoscope, Globe2, BarChart3 } from "lucide-react";
import { SectionStats } from "./section-stats";
import { CATEGORY_DOT, METRIC_CATEGORIES, STARTER_METRICS, type StarterMetric } from "./starter-metrics";

/** While the tab is open, events and health checks re-read this often (the path polls on its own). */
const ANALYTICS_LIVE_MS = 30_000;

type EventForm = { eventName: string; category: string; description: string; shared: boolean };
const EMPTY_FORM: EventForm = { eventName: "", category: "activation", description: "", shared: false };

/** A block of the tab: a small heading row, then its content, separated from the one above by a thin line. */
function Block({ title, meta, action, children, testId }: { title: string; meta?: ReactNode; action?: ReactNode; children: ReactNode; testId: string }) {
  return (
    <section className="py-6 first:pt-0 space-y-4" data-testid={testId}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2 min-w-0">
          <h4 className="text-sm font-semibold">{title}</h4>
          {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Events for one section (plus shared ones), or every event without a section. */
function useAnalyticsEvents(projectId: string, goal: ProjectGoal | undefined, enabled: boolean) {
  return useQuery<AnalyticsEvent[]>({
    // Keeps the ["/api/projects", id, "analytics-events"] prefix so every invalidation reaches all tracks.
    queryKey: goal ? ["/api/projects", projectId, "analytics-events", "track", goal] : ["/api/projects", projectId, "analytics-events"],
    enabled: enabled && !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/analytics-events${goal ? `?track=${goal}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()) || res.statusText}`);
      return res.json();
    },
    refetchInterval: ANALYTICS_LIVE_MS,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

export function AnalyticsTab({ projectId, goal }: { projectId: string; goal?: ProjectGoal }) {
  const { toast } = useToast();
  const { entitlements, can } = useEntitlements();
  const level = entitlements.projectAnalytics;
  const canMeasure = level !== "none";
  const canHealth = can("projectHealthChecks");
  const section = goal ? sectionDef(goal) : null;
  const requestHandoff = useRequestNovaHandoff();

  const { data: events, isLoading } = useAnalyticsEvents(projectId, goal, canMeasure);
  const { data: health } = useQuery<{ checks: ProjectHealthCheck[] }>({
    queryKey: ["/api/projects", projectId, "health-checks"],
    enabled: canHealth && !!projectId,
    refetchInterval: ANALYTICS_LIVE_MS,
    refetchOnWindowFocus: true,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<EventForm>(EMPTY_FORM);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "analytics-events"] });

  const createMutation = useMutation({
    mutationFn: async (data: { eventName: string; category: string; description?: string; track: ProjectGoal | null }) =>
      (await apiRequest("POST", `/api/projects/${projectId}/analytics-events`, data)).json(),
    onSuccess: invalidate,
    onError: () => toast({ title: "Couldn't add that metric", variant: "destructive" }),
  });
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<AnalyticsEvent> }) =>
      (await apiRequest("PATCH", `/api/projects/${projectId}/analytics-events/${id}`, data)).json(),
    onSuccess: invalidate,
    onError: () => toast({ title: "Couldn't update that metric", variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/projects/${projectId}/analytics-events/${id}`); },
    onSuccess: invalidate,
    onError: () => toast({ title: "Couldn't remove that metric", variant: "destructive" }),
  });

  const openDialog = () => { setForm(EMPTY_FORM); setDialogOpen(true); };
  const handleCreate = () => {
    createMutation.mutate(
      { eventName: form.eventName.trim(), category: form.category, description: form.description.trim() || undefined, track: goal && !form.shared ? goal : null },
      { onSuccess: () => { setDialogOpen(false); setForm(EMPTY_FORM); } },
    );
  };
  const addStarter = (s: StarterMetric) =>
    createMutation.mutate({ eventName: s.eventName, category: s.category, description: s.description, track: goal ?? null });

  const list = [...(events ?? [])].sort((a, b) =>
    METRIC_CATEGORIES.indexOf((a.category ?? "activation") as any) - METRIC_CATEGORIES.indexOf((b.category ?? "activation") as any));
  const names = new Set(list.map((e) => e.eventName));
  const starters = STARTER_METRICS[goal ?? "all"].filter((s) => !names.has(s.eventName));
  const live = list.filter((e) => e.trackingStatus === "implemented" || e.trackingStatus === "verified").length;
  const empty = canMeasure && !isLoading && list.length === 0;
  const noCheck = canHealth && health && health.checks.length === 0;

  // The one thing to do first, when there's an obvious one.
  const primary = empty
    ? <Button size="sm" onClick={openDialog} data-testid="btn-add-first-metric"><Plus className="h-4 w-4 mr-1" /> Add your first metric</Button>
    : noCheck
      ? <Button size="sm" onClick={() => requestHandoff("analytics.healthCheck")} data-testid="btn-first-health-check"><Stethoscope className="h-4 w-4 mr-1" /> Run a health check</Button>
      : null;

  const gated = !canMeasure || level === "basic" || !canHealth;

  return (
    <div className="divide-y divide-border" data-testid="analytics-tab">
      {/* Header: what this is, and the one place to start. */}
      <div className="pb-5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <BarChart3 className="h-4 w-4 text-primary shrink-0" />
          <h3 className="text-base font-semibold">Analytics</h3>
          {canMeasure && <Badge variant="secondary" className="text-[10px] capitalize">{level}</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <NovaActionButton projectId={projectId} surface="analytics" variant="outline" />
          {primary}
        </div>
      </div>

      {goal && (
        <Block title="Section progress" testId="block-section-progress">
          <SectionStats projectId={projectId} goal={goal} />
        </Block>
      )}

      {canMeasure && (
        <Block
          title="What you're measuring"
          testId="block-metrics"
          meta={list.length > 0 ? `${list.length} metric${list.length === 1 ? "" : "s"} · ${live} live` : undefined}
          action={!empty && <Button size="sm" variant="outline" onClick={openDialog} data-testid="btn-add-event"><Plus className="h-4 w-4 mr-1" /> Add metric</Button>}
        >
          {isLoading ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : empty ? (
            <div className="space-y-3" data-testid="metrics-empty">
              <p className="text-xs text-muted-foreground">Start with one:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {starters.map((s) => (
                  <button
                    key={s.eventName}
                    type="button"
                    disabled={createMutation.isPending}
                    onClick={() => addStarter(s)}
                    className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2.5 text-left hover:border-primary/60 hover:bg-primary/5 transition-colors disabled:opacity-60"
                    data-testid={`starter-${s.eventName}`}
                  >
                    <Plus className="h-4 w-4 text-primary shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">{s.label}</span>
                      <span className="block text-xs text-muted-foreground truncate">{s.description}</span>
                    </span>
                  </button>
                ))}
              </div>
              <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={openDialog} data-testid="btn-add-event">
                <Plus className="h-3.5 w-3.5 mr-1" /> Custom metric
              </Button>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-border/60 rounded-md border border-border/60">
                {list.map((ev) => (
                  <li key={ev.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-3 py-2.5" data-testid={`analytics-event-${ev.id}`}>
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className={`h-2 w-2 rounded-full shrink-0 ${CATEGORY_DOT[ev.category ?? "activation"] ?? "bg-muted-foreground"}`} />
                        </TooltipTrigger>
                        <TooltipContent className="text-xs capitalize">{ev.category ?? "activation"}</TooltipContent>
                      </Tooltip>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" title={ev.eventName}>{ev.eventName}</p>
                        {ev.description && <p className="text-xs text-muted-foreground truncate" title={ev.description}>{ev.description}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pl-[18px] sm:pl-0 shrink-0">
                      <ScopeBadge ev={ev} goal={goal} disabled={updateMutation.isPending} onChange={(track) => updateMutation.mutate({ id: ev.id, data: { track } })} />
                      <Select value={ev.trackingStatus ?? "planned"} onValueChange={(v) => updateMutation.mutate({ id: ev.id, data: { trackingStatus: v } })}>
                        <SelectTrigger className="h-7 w-28 text-xs" data-testid={`select-event-status-${ev.id}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="planned">Planned</SelectItem>
                          <SelectItem value="implemented">Implemented</SelectItem>
                          <SelectItem value="verified">Verified</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" aria-label="Remove metric" onClick={() => deleteMutation.mutate(ev.id)} data-testid={`btn-delete-event-${ev.id}`}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              {starters.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap" data-testid="metrics-suggested">
                  <span className="text-xs text-muted-foreground mr-1">Suggested</span>
                  {starters.map((s) => (
                    <Tooltip key={s.eventName}>
                      <TooltipTrigger asChild>
                        <Button size="sm" variant="outline" className="h-7 text-xs rounded-full" disabled={createMutation.isPending} onClick={() => addStarter(s)} data-testid={`starter-${s.eventName}`}>
                          <Plus className="h-3 w-3 mr-1" />{s.label}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">{s.description}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              )}
            </>
          )}
        </Block>
      )}

      {canHealth && (
        <Block title="Health check" meta="Whole project" testId="block-health">
          <HealthCheckPanel projectId={projectId} />
        </Block>
      )}

      {gated && (
        <Block title="Upgrade" testId="block-upgrade">
          <div className="space-y-2">
            {!canMeasure && (
              <UpgradePrompt variant="inline" requiredTier="starter" title="Track what matters" description="Signups, retention, revenue — per section." />
            )}
            {level === "basic" && (
              <UpgradePrompt variant="inline" requiredTier="builder" title="Advanced analytics" description="Roadmap-linked progress and deeper breakdowns." />
            )}
            {!canHealth && (
              <UpgradePrompt variant="inline" feature="projectHealthChecks" title="Health checks" description="Nova scores the project and fixes what it can." />
            )}
          </div>
        </Block>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New metric</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Event name</Label>
              <Input value={form.eventName} onChange={(e) => setForm({ ...form, eventName: e.target.value })} placeholder="e.g. user_signed_up" data-testid="input-event-name" />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger data-testid="select-event-category"><SelectValue /></SelectTrigger>
                <SelectContent>{METRIC_CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Note <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What counts" data-testid="input-event-desc" />
            </div>
            {section && (
              <label className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-sm cursor-pointer">
                <span>Share with every section</span>
                <Switch checked={form.shared} onCheckedChange={(v) => setForm({ ...form, shared: v })} data-testid="switch-event-shared" />
              </label>
            )}
          </div>
          <DialogFooter>
            <Button onClick={handleCreate} disabled={!form.eventName.trim() || createMutation.isPending} data-testid="btn-save-event">
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Which sections a metric shows in. Inside a section it toggles between "this section" and shared. */
function ScopeBadge({ ev, goal, disabled, onChange }: { ev: AnalyticsEvent; goal?: ProjectGoal; disabled: boolean; onChange: (track: ProjectGoal | null) => void }) {
  const shared = !ev.track;
  const label = shared ? "Shared" : goal ? "This section" : sectionDef(ev.track as ProjectGoal)?.short ?? ev.track;
  const badge = (
    <Badge variant="outline" className={`text-[10px] font-normal gap-1 whitespace-nowrap ${shared ? "text-muted-foreground" : "border-primary/40 text-primary"}`}>
      {shared && <Globe2 className="h-3 w-3" />}{label}
    </Badge>
  );
  if (!goal) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" disabled={disabled} onClick={() => onChange(shared ? goal : null)} className="disabled:opacity-60" data-testid={`btn-event-scope-${ev.id}`}>
          {badge}
        </button>
      </TooltipTrigger>
      <TooltipContent className="text-xs">{shared ? "Shows in every section — click to keep it here" : "Click to share with every section"}</TooltipContent>
    </Tooltip>
  );
}
