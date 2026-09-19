/**
 * The Run section's rhythm: this week's check-in, the weeks before it, the
 * team's recurring jobs, and the monthly report.
 *
 * The path's four setup weeks end by handing over to this, and this is what a
 * company keeps coming back to — so it opens on the one thing due now (this
 * week's numbers) and keeps everything else a scroll away. The reply to a
 * check-in is shown straight after saving, because the point of filing the
 * numbers is hearing what changed; a form that only says "saved" teaches
 * people to stop filing.
 *
 * Below the weekly work sit the quarter's goals, measured against the same
 * check-in numbers, and the rhythm's settings — the day the check-in is due
 * and who is reminded — because a rhythm nobody is reminded of stops.
 *
 * All the arithmetic is shared/company-rhythm.ts; this file only lays it out.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, CalendarCheck, Sparkles, Plus, X, Check, AlertTriangle, ChevronLeft, ChevronRight, Repeat, FileBarChart,
  TrendingUp, TrendingDown, Minus, History, Target, Settings2, Pencil, Trash2,
} from "lucide-react";
import {
  formatValue, customMetricId, metricFor, addMonthsToMonth, JOB_INTERVALS, JOB_INTERVAL_LABEL, daysOverdue, CHECKIN_DAYS,
  type RhythmMetric, type JobInterval, type MonthlyReport, type GoalProgress,
} from "@shared/company-rhythm";

interface Checkin {
  id: string; weekOf: string; numbers: Record<string, number | null>;
  wentRight: string | null; wentWrong: string | null; reply: string | null; updatedAt: string;
}
interface Job {
  id: string; title: string; notes: string | null; every: JobInterval; ownerId: string | null; backupId: string | null; nextDue: string; active: boolean;
}
interface Member { id: string; name: string }
export interface RhythmSettings { checkinDay: number; remindUserIds: string[] }
export interface RhythmSummary {
  today: string; weekOf: string; subcategory: string; metrics: RhythmMetric[];
  current: Checkin | null; checkins: Checkin[]; jobs: Job[]; overdue: Job[]; members: Member[];
  settings: RhythmSettings; quarter: string;
}
export interface QuarterGoal {
  id: string; quarter: string; title: string; metricId: string | null; target: number | null; direction: "up" | "down" | null;
  ownerId: string | null; status: "active" | "done" | "dropped"; progress: GoalProgress;
}
export interface GoalsPayload {
  quarter: string; start: string; end: string; today: string; previousQuarter: string; nextQuarter: string;
  metrics: RhythmMetric[]; goals: QuarterGoal[];
}

const rhythmKey = (projectId: string) => ["/api/projects", projectId, "rhythm"];

/*
 * Everything a check-in or a finished job can change: the summary, the month's
 * report, and the quarter's goals (their progress is read off the check-ins).
 * The report and goals keys start with the rhythm key, so the prefix match
 * already reaches them; they are named here as well so a later change to
 * either key can't quietly leave the report showing last week's numbers.
 */
function refreshRhythm(projectId: string) {
  queryClient.invalidateQueries({ queryKey: rhythmKey(projectId) });
  queryClient.invalidateQueries({ queryKey: [...rhythmKey(projectId), "report"] });
  queryClient.invalidateQueries({ predicate: (q) => q.queryKey[1] === projectId && String(q.queryKey[3] ?? "").startsWith("goals") });
}

/** "14 Sep" from "2026-09-14", read as a UTC date so it never slips a day. */
export function shortDate(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export function useRhythm(projectId: string | null | undefined) {
  return useQuery<RhythmSummary>({ queryKey: rhythmKey(projectId ?? ""), enabled: !!projectId });
}

/** The goals of a quarter. Keyed under the rhythm so saving a check-in (which moves their progress) refreshes them too. */
export function useGoals(projectId: string | null | undefined, quarter: string | null | undefined) {
  return useQuery<GoalsPayload>({
    queryKey: [...rhythmKey(projectId ?? ""), `goals?quarter=${quarter ?? ""}`],
    enabled: !!projectId && !!quarter,
  });
}

/** "2026-Q3" as people say it: "July–September 2026". */
export function quarterName(quarter: string): string {
  const [y, q] = quarter.split("-Q");
  const names = ["January–March", "April–June", "July–September", "October–December"];
  return `${names[Number(q) - 1] ?? quarter} ${y}`;
}

const GOAL_STATE_LABEL: Record<GoalProgress["state"], string> = {
  reached: "Reached", "on track": "On track", behind: "Behind", "no numbers yet": "No numbers yet", "not measured": "Ticked by hand",
};

/** Where a goal stands, as a bar and a badge. Shared with the company page. */
export function GoalProgressView({ goal, metrics }: { goal: QuarterGoal; metrics: RhythmMetric[] }) {
  const p = goal.progress;
  const metric = goal.metricId ? metrics.find((m) => m.id === goal.metricId) ?? metricFor(goal.metricId) : null;
  const tone = goal.status !== "active" ? "secondary" : p.state === "behind" ? "destructive" : p.state === "reached" || p.state === "on track" ? "secondary" : "outline";
  const label = goal.status === "done" ? "Done" : goal.status === "dropped" ? "Dropped" : GOAL_STATE_LABEL[p.state];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
        {metric && goal.target != null && (
          <span data-testid={`goal-measure-${goal.id}`}>
            {metric.label}: {formatValue(p.latest, metric.unit)} {p.first != null && p.first !== p.latest ? `(from ${formatValue(p.first, metric.unit)}) ` : ""}→ {goal.direction === "down" ? "at most" : "at least"} {formatValue(goal.target, metric.unit)}
          </span>
        )}
        <Badge variant={tone as any} className="ml-auto" data-testid={`goal-state-${goal.id}`}>{label}</Badge>
      </div>
      {p.fraction != null && (
        <div className="relative h-2 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.fraction * 100)}
          aria-label={`${goal.title}: ${Math.round(p.fraction * 100)}% of the way`} data-testid={`goal-bar-${goal.id}`}>
          <div className={`h-full rounded-full ${p.state === "behind" ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Math.round(p.fraction * 100)}%` }} />
          {/* Where the goal should be by now, if it is to land by the quarter's end. */}
          {p.state !== "reached" && <div className="absolute top-0 h-full w-0.5 bg-foreground/40" style={{ left: `${Math.round(p.elapsed * 100)}%` }} title="Where it should be by now" />}
        </div>
      )}
    </div>
  );
}

export function CompanyRhythm({ projectId }: { projectId: string }) {
  const { data, isLoading, isError, error } = useRhythm(projectId);

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  if (isError || !data) return <p className="text-sm text-muted-foreground py-6" data-testid="rhythm-error">{errorText(error, "The weekly rhythm couldn't load.")}</p>;

  return (
    <div className="space-y-4 mt-6" data-testid="company-rhythm">
      <div className="flex items-center gap-2">
        <CalendarCheck className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-semibold tracking-tight">The weekly rhythm</h2>
      </div>
      <CheckinCard projectId={projectId} data={data} />
      <HistoryCard data={data} />
      <JobsCard projectId={projectId} data={data} />
      <GoalsCard projectId={projectId} data={data} />
      <ReportCard projectId={projectId} today={data.today} />
      <SettingsCard projectId={projectId} data={data} />
    </div>
  );
}

// ─── This week ───────────────────────────────────────────────────────────────

function CheckinCard({ projectId, data }: { projectId: string; data: RhythmSummary }) {
  const { toast } = useToast();
  const [metrics, setMetrics] = useState<RhythmMetric[]>(data.metrics);
  const [values, setValues] = useState<Record<string, string>>({});
  const [wentRight, setWentRight] = useState("");
  const [wentWrong, setWentWrong] = useState("");
  const [newMetric, setNewMetric] = useState("");
  const [reply, setReply] = useState<string | null>(data.current?.reply ?? null);
  const [editing, setEditing] = useState(!data.current);

  // Fill the form from this week's check-in when there is one, so re-filing edits rather than starts again.
  useEffect(() => {
    const c = data.current;
    setMetrics(data.metrics);
    setValues(Object.fromEntries(data.metrics.map((m) => [m.id, c?.numbers?.[m.id] != null ? String(c.numbers[m.id]) : ""])));
    setWentRight(c?.wentRight ?? "");
    setWentWrong(c?.wentWrong ?? "");
    setReply(c?.reply ?? null);
  }, [data.current?.id, data.current?.updatedAt, data.metrics.map((m) => m.id).join("|")]);

  const save = useMutation({
    mutationFn: async () => {
      const numbers = Object.fromEntries(metrics.map((m) => [m.id, values[m.id]?.trim() ? values[m.id].trim() : null]));
      const res = await apiRequest("PUT", `/api/projects/${projectId}/rhythm/checkins/${data.weekOf}`, { numbers, wentRight, wentWrong });
      return res.json() as Promise<{ checkin: Checkin }>;
    },
    onSuccess: (r) => {
      setReply(r.checkin.reply);
      setEditing(false);
      refreshRhythm(projectId);
    },
    onError: (e) => toast({ title: "Couldn't save the check-in", description: errorText(e), variant: "destructive" }),
  });

  const nova = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/projects/${projectId}/rhythm/checkins/${data.weekOf}/nova`)).json() as Promise<{ checkin: Checkin; ai: boolean; message?: string }>,
    onSuccess: (r) => {
      setReply(r.checkin.reply);
      if (!r.ai && r.message) toast({ title: "Kept the reply from your numbers", description: r.message });
      queryClient.invalidateQueries({ queryKey: rhythmKey(projectId) });
    },
    onError: (e) => toast({ title: "Nova couldn't answer", description: errorText(e), variant: "destructive" }),
  });

  const addMetric = () => {
    const label = newMetric.trim();
    if (!label) return;
    const id = customMetricId(label);
    if (!metrics.some((m) => m.id === id)) setMetrics([...metrics, metricFor(id)]);
    setNewMetric("");
  };

  const filed = !!data.current;

  return (
    <Card data-testid="rhythm-checkin">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold">Week of {shortDate(data.weekOf)}</p>
          {filed
            ? <Badge variant="secondary" className="gap-1" data-testid="badge-checkin-filed"><Check className="h-3 w-3" />Checked in</Badge>
            : <Badge variant="outline" data-testid="badge-checkin-due">Due {CHECKIN_DAYS[data.settings?.checkinDay ?? 0]}</Badge>}
          {filed && !editing && (
            <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={() => setEditing(true)} data-testid="button-edit-checkin">Change this week's numbers</Button>
          )}
        </div>

        {editing && (
          <div className="space-y-4" data-testid="form-checkin">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {metrics.map((m) => (
                <label key={m.id} className="space-y-1 block">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className="truncate">{m.label}</span>
                    <button type="button" className="ml-auto hover:text-foreground" title="Stop tracking this number" aria-label={`Stop tracking ${m.label}`}
                      onClick={() => setMetrics(metrics.filter((x) => x.id !== m.id))} data-testid={`button-remove-metric-${m.id}`}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                  <Input inputMode="decimal" value={values[m.id] ?? ""} placeholder={m.unit === "percent" ? "e.g. 32" : m.unit === "money" ? "e.g. 12,500" : "e.g. 40"}
                    onChange={(e) => setValues({ ...values, [m.id]: e.target.value })} data-testid={`input-metric-${m.id}`} />
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={newMetric} onChange={(e) => setNewMetric(e.target.value)} placeholder="Track another number, e.g. Deliveries out"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMetric(); } }} data-testid="input-new-metric" />
              <Button type="button" variant="outline" size="sm" onClick={addMetric} disabled={!newMetric.trim()} data-testid="button-add-metric"><Plus className="h-3.5 w-3.5 mr-1" />Add</Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1 block">
                <span className="text-xs text-muted-foreground">What went right</span>
                <Textarea rows={3} value={wentRight} onChange={(e) => setWentRight(e.target.value)} data-testid="input-went-right" />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs text-muted-foreground">What went wrong</span>
                <Textarea rows={3} value={wentWrong} onChange={(e) => setWentWrong(e.target.value)} data-testid="input-went-wrong" />
              </label>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => save.mutate()} disabled={save.isPending || metrics.length === 0} data-testid="button-save-checkin">
                {save.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}{filed ? "Save changes" : "Save this week"}
              </Button>
              {filed && <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
            </div>
          </div>
        )}

        {reply && !editing && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2" data-testid="checkin-reply">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">What changed</p>
            {reply.split("\n").filter(Boolean).map((line, i) => (
              <p key={i} className={`text-sm leading-relaxed ${line.startsWith("The one thing") ? "font-medium" : ""}`}>{line}</p>
            ))}
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 -ml-2" onClick={() => nova.mutate()} disabled={nova.isPending} data-testid="button-nova-reply">
              {nova.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}Ask Nova to write it up
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Recent weeks ────────────────────────────────────────────────────────────

/** One number's recent weeks as a small line: oldest on the left, this week's dot on the right. */
function Sparkline({ points, label }: { points: { week: string; value: number }[]; label: string }) {
  const W = 96, H = 24, P = 3;
  if (points.length < 2) return <span className="text-[11px] text-muted-foreground">—</span>;
  const vs = points.map((p) => p.value);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const x = (i: number) => P + (i * (W - 2 * P)) / (points.length - 1);
  const y = (v: number) => (hi === lo ? H / 2 : H - P - ((v - lo) * (H - 2 * P)) / (hi - lo));
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="text-primary overflow-visible" role="img" aria-label={`${label} over the last ${points.length} check-ins`}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={p.week} cx={x(i)} cy={y(p.value)} r={6} fill="transparent"><title>{`${shortDate(p.week)}: ${p.value}`}</title></circle>
      ))}
      <circle cx={x(points.length - 1)} cy={y(last.value)} r={3} fill="currentColor" stroke="hsl(var(--card))" strokeWidth={2} />
    </svg>
  );
}

function HistoryCard({ data }: { data: RhythmSummary }) {
  const weeks = [...data.checkins].reverse(); // oldest first
  if (weeks.length === 0) return null;
  const recent = data.checkins.slice(0, 6);
  return (
    <Card data-testid="rhythm-history">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center gap-2"><History className="h-3.5 w-3.5 text-muted-foreground" /><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recent weeks</p></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground text-left">
                <th className="font-normal py-1.5 pr-3">Number</th>
                <th className="font-normal py-1.5 pr-3">Trend</th>
                {recent.map((c) => <th key={c.weekOf} className="font-normal py-1.5 pr-3 text-right whitespace-nowrap">{shortDate(c.weekOf)}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.metrics.map((m) => {
                const pts = weeks.flatMap((c) => (typeof c.numbers?.[m.id] === "number" ? [{ week: c.weekOf, value: c.numbers[m.id] as number }] : []));
                return (
                  <tr key={m.id} data-testid={`history-row-${m.id}`}>
                    <td className="py-2 pr-3">{m.label}</td>
                    <td className="py-2 pr-3"><Sparkline points={pts} label={m.label} /></td>
                    {recent.map((c) => <td key={c.weekOf} className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">{formatValue(c.numbers?.[m.id] ?? null, m.unit)}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Recurring jobs ──────────────────────────────────────────────────────────

const selectClass = "h-9 rounded-md border border-input bg-background px-2 text-sm";

function JobsCard({ projectId, data }: { projectId: string; data: RhythmSummary }) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [every, setEvery] = useState<JobInterval>("week");
  const [nextDue, setNextDue] = useState(data.today);
  const [ownerId, setOwnerId] = useState("");
  const [backupId, setBackupId] = useState("");
  const name = (id: string | null) => (id ? data.members.find((m) => m.id === id)?.name ?? "Someone who left" : null);
  const overdue = new Set(data.overdue.map((j) => j.id));
  const refresh = () => refreshRhythm(projectId);

  const add = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${projectId}/rhythm/jobs`, { title, every, nextDue, ownerId: ownerId || null, backupId: backupId || null }),
    onSuccess: () => { setTitle(""); setOwnerId(""); setBackupId(""); setAdding(false); refresh(); },
    onError: (e) => toast({ title: "Couldn't add the job", description: errorText(e), variant: "destructive" }),
  });
  const done = useMutation({
    // The due date on screen goes with it, so a tick from a stale screen is refused instead of skipping the next occurrence.
    mutationFn: (job: Job) => apiRequest("POST", `/api/projects/${projectId}/rhythm/jobs/${job.id}/done`, { dueOn: job.nextDue }).then((r) => r.json()),
    onSuccess: (r: { run: { onTime: boolean }; job: Job }) => {
      toast({ title: r.run.onTime ? "Done, on time" : "Done, late", description: `Next due ${shortDate(r.job.nextDue)}.` });
      refresh();
    },
    onError: (e) => { toast({ title: "Couldn't mark it done", description: errorText(e), variant: "destructive" }); refresh(); },
  });
  const remove = useMutation({
    mutationFn: (jobId: string) => apiRequest("DELETE", `/api/projects/${projectId}/rhythm/jobs/${jobId}`),
    onSuccess: refresh,
    onError: (e) => toast({ title: "Couldn't remove the job", description: errorText(e), variant: "destructive" }),
  });

  return (
    <Card data-testid="rhythm-jobs">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Repeat className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recurring jobs</p>
          {data.overdue.length > 0 && <Badge variant="destructive" className="gap-1" data-testid="badge-overdue-count"><AlertTriangle className="h-3 w-3" />{data.overdue.length} overdue</Badge>}
          <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={() => setAdding(!adding)} data-testid="button-toggle-add-job">
            {adding ? <X className="h-3.5 w-3.5 mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}{adding ? "Cancel" : "Add a job"}
          </Button>
        </div>

        {adding && (
          <div className="rounded-lg border border-border p-3 space-y-2" data-testid="form-add-job">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Payroll, stock take, chase unpaid invoices" data-testid="input-job-title" />
            <div className="flex flex-wrap gap-2 items-center">
              <select className={selectClass} value={every} onChange={(e) => setEvery(e.target.value as JobInterval)} data-testid="select-job-every">
                {JOB_INTERVALS.map((i) => <option key={i} value={i}>{JOB_INTERVAL_LABEL[i]}</option>)}
              </select>
              <label className="text-xs text-muted-foreground flex items-center gap-1">First due
                <Input type="date" className="h-9 w-auto" value={nextDue} onChange={(e) => setNextDue(e.target.value)} data-testid="input-job-due" />
              </label>
              <select className={selectClass} value={ownerId} onChange={(e) => setOwnerId(e.target.value)} data-testid="select-job-owner">
                <option value="">Owner: nobody yet</option>
                {data.members.map((m) => <option key={m.id} value={m.id}>Owner: {m.name}</option>)}
              </select>
              <select className={selectClass} value={backupId} onChange={(e) => setBackupId(e.target.value)} data-testid="select-job-backup">
                <option value="">Backup: nobody yet</option>
                {data.members.map((m) => <option key={m.id} value={m.id}>Backup: {m.name}</option>)}
              </select>
            </div>
            <Button size="sm" onClick={() => add.mutate()} disabled={!title.trim() || !nextDue || add.isPending} data-testid="button-save-job">
              {add.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}Add job
            </Button>
          </div>
        )}

        {data.jobs.length === 0 && !adding ? (
          <p className="text-sm text-muted-foreground">No recurring jobs yet. Add the ones that come round every week or month — payroll, invoicing, stock — and give each an owner.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.jobs.map((j) => {
              const late = overdue.has(j.id);
              return (
                <li key={j.id} className={`flex items-center gap-3 px-3 py-2.5 ${late ? "bg-destructive/5" : ""}`} data-testid={`job-${j.id}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{j.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {JOB_INTERVAL_LABEL[j.every]} · {name(j.ownerId) ?? "No owner"}{j.backupId ? `, backup ${name(j.backupId)}` : ""}
                    </p>
                  </div>
                  {late
                    ? <Badge variant="destructive" data-testid={`badge-job-overdue-${j.id}`}>{daysOverdue(j.nextDue, data.today)}d overdue</Badge>
                    : <span className="text-xs text-muted-foreground whitespace-nowrap">Due {shortDate(j.nextDue)}</span>}
                  <Button size="sm" variant={late ? "default" : "outline"} className="h-7 text-xs gap-1" onClick={() => done.mutate(j)} disabled={done.isPending} data-testid={`button-job-done-${j.id}`}>
                    <Check className="h-3 w-3" />Done
                  </Button>
                  <button className="text-muted-foreground hover:text-foreground" title="Stop this job coming round" aria-label={`Remove ${j.title}`}
                    onClick={() => remove.mutate(j.id)} data-testid={`button-job-remove-${j.id}`}><X className="h-3.5 w-3.5" /></button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── The quarter's goals ─────────────────────────────────────────────────────

interface GoalDraft { title: string; metricId: string; target: string; direction: "up" | "down" | ""; ownerId: string }
const emptyDraft: GoalDraft = { title: "", metricId: "", target: "", direction: "", ownerId: "" };

function GoalsCard({ projectId, data }: { projectId: string; data: RhythmSummary }) {
  const { toast } = useToast();
  const [quarter, setQuarter] = useState(data.quarter);
  const { data: goals, isLoading } = useGoals(projectId, quarter);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<GoalDraft>(emptyDraft);
  const refresh = () => refreshRhythm(projectId);
  const metrics = goals?.metrics ?? data.metrics;
  const name = (id: string | null) => (id ? data.members.find((m) => m.id === id)?.name ?? "Someone who left" : null);
  const active = goals?.goals.filter((g) => g.status === "active").length ?? 0;

  const body = (d: GoalDraft) => ({
    title: d.title, metricId: d.metricId || null, target: d.metricId && d.target.trim() ? d.target.trim() : null,
    direction: d.metricId ? d.direction || null : null, ownerId: d.ownerId || null,
  });
  const save = useMutation({
    mutationFn: () => editing === "new"
      ? apiRequest("POST", `/api/projects/${projectId}/rhythm/goals`, { quarter, ...body(draft) })
      : apiRequest("PATCH", `/api/projects/${projectId}/rhythm/goals/${editing}`, body(draft)),
    onSuccess: () => { setEditing(null); setDraft(emptyDraft); refresh(); },
    onError: (e) => toast({ title: "Couldn't save the goal", description: errorText(e), variant: "destructive" }),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: QuarterGoal["status"] }) => apiRequest("PATCH", `/api/projects/${projectId}/rhythm/goals/${id}`, { status }),
    onSuccess: refresh,
    onError: (e) => toast({ title: "Couldn't update the goal", description: errorText(e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/projects/${projectId}/rhythm/goals/${id}`),
    onSuccess: refresh,
    onError: (e) => toast({ title: "Couldn't remove the goal", description: errorText(e), variant: "destructive" }),
  });

  const startEdit = (g: QuarterGoal) => {
    setEditing(g.id);
    setDraft({ title: g.title, metricId: g.metricId ?? "", target: g.target != null ? String(g.target) : "", direction: g.direction ?? "", ownerId: g.ownerId ?? "" });
  };

  const form = (
    <div className="rounded-lg border border-border p-3 space-y-2" data-testid="form-goal">
      <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. 600 covers a week by the end of the quarter" data-testid="input-goal-title" />
      <div className="flex flex-wrap gap-2 items-center">
        <select className={selectClass} value={draft.metricId} onChange={(e) => setDraft({ ...draft, metricId: e.target.value, direction: "" })} data-testid="select-goal-metric">
          <option value="">Ticked by hand</option>
          {metrics.map((m) => <option key={m.id} value={m.id}>Measured by: {m.label}</option>)}
        </select>
        {draft.metricId && (
          <>
            <select className={selectClass} value={draft.direction || metricFor(draft.metricId).better} onChange={(e) => setDraft({ ...draft, direction: e.target.value as "up" | "down" })} data-testid="select-goal-direction">
              <option value="up">at least</option>
              <option value="down">at most</option>
            </select>
            <Input inputMode="decimal" className="h-9 w-32" value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} placeholder="Target" data-testid="input-goal-target" />
          </>
        )}
        <select className={selectClass} value={draft.ownerId} onChange={(e) => setDraft({ ...draft, ownerId: e.target.value })} data-testid="select-goal-owner">
          <option value="">Owner: nobody yet</option>
          {data.members.map((m) => <option key={m.id} value={m.id}>Owner: {m.name}</option>)}
        </select>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => save.mutate()} disabled={!draft.title.trim() || save.isPending} data-testid="button-save-goal">
          {save.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}{editing === "new" ? "Add goal" : "Save goal"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setDraft(emptyDraft); }}>Cancel</Button>
      </div>
    </div>
  );

  return (
    <Card data-testid="rhythm-goals">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Target className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">The quarter's goals</p>
          <div className="ml-auto flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => goals && setQuarter(goals.previousQuarter)} disabled={!goals} aria-label="Previous quarter" data-testid="button-goals-prev"><ChevronLeft className="h-4 w-4" /></Button>
            <span className="text-sm whitespace-nowrap" data-testid="text-goals-quarter">{quarterName(quarter)}</span>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => goals && setQuarter(goals.nextQuarter)} disabled={!goals || quarter >= data.quarter} aria-label="Next quarter" data-testid="button-goals-next"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>

        {isLoading || !goals ? (
          <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>
        ) : (
          <>
            {goals.goals.length === 0 && editing !== "new" && (
              <p className="text-sm text-muted-foreground">No goals for this quarter yet. Pick up to three, each measured by one of your weekly numbers where you can, so the check-ins show whether it's happening.</p>
            )}
            <ul className="space-y-3">
              {goals.goals.map((g) => editing === g.id ? <li key={g.id}>{form}</li> : (
                <li key={g.id} className={`rounded-lg border border-border p-3 space-y-2 ${g.status !== "active" ? "opacity-70" : ""}`} data-testid={`goal-${g.id}`}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium ${g.status === "dropped" ? "line-through" : ""}`}>{g.title}</p>
                      {g.ownerId && <p className="text-xs text-muted-foreground">Owner: {name(g.ownerId)}</p>}
                    </div>
                    {g.status === "active" ? (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setStatus.mutate({ id: g.id, status: "done" })} data-testid={`button-goal-done-${g.id}`}><Check className="h-3 w-3" />Done</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setStatus.mutate({ id: g.id, status: "dropped" })} data-testid={`button-goal-drop-${g.id}`}>Drop</Button>
                      </>
                    ) : (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setStatus.mutate({ id: g.id, status: "active" })} data-testid={`button-goal-reopen-${g.id}`}>Reopen</Button>
                    )}
                    <button className="text-muted-foreground hover:text-foreground p-1" aria-label={`Edit ${g.title}`} onClick={() => startEdit(g)} data-testid={`button-goal-edit-${g.id}`}><Pencil className="h-3.5 w-3.5" /></button>
                    <button className="text-muted-foreground hover:text-foreground p-1" aria-label={`Remove ${g.title}`} onClick={() => remove.mutate(g.id)} data-testid={`button-goal-remove-${g.id}`}><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                  <GoalProgressView goal={g} metrics={metrics} />
                </li>
              ))}
            </ul>
            {editing === "new" ? form : (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setDraft(emptyDraft); setEditing("new"); }} data-testid="button-add-goal">
                <Plus className="h-3.5 w-3.5 mr-1" />{active >= 3 ? "Add another goal" : "Add a goal"}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Settings ────────────────────────────────────────────────────────────────

function SettingsCard({ projectId, data }: { projectId: string; data: RhythmSummary }) {
  const { toast } = useToast();
  const [day, setDay] = useState(data.settings.checkinDay);
  const [who, setWho] = useState<string[]>(data.settings.remindUserIds);
  useEffect(() => { setDay(data.settings.checkinDay); setWho(data.settings.remindUserIds); }, [data.settings.checkinDay, data.settings.remindUserIds.join("|")]);
  const changed = day !== data.settings.checkinDay || [...who].sort().join("|") !== [...data.settings.remindUserIds].sort().join("|");

  const save = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/projects/${projectId}/rhythm/settings`, { checkinDay: day, remindUserIds: who }),
    onSuccess: () => {
      toast({ title: "Rhythm saved", description: `The check-in is due every ${CHECKIN_DAYS[day]}.` });
      queryClient.invalidateQueries({ queryKey: rhythmKey(projectId) });
    },
    onError: (e) => toast({ title: "Couldn't save the rhythm", description: errorText(e), variant: "destructive" }),
  });
  const toggle = (id: string) => setWho(who.includes(id) ? who.filter((x) => x !== id) : [...who, id]);

  return (
    <Card data-testid="rhythm-settings">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">The rhythm</p>
        </div>
        <label className="flex items-center gap-2 text-sm flex-wrap">
          Check-in day
          <select className={selectClass} value={day} onChange={(e) => setDay(Number(e.target.value))} data-testid="select-checkin-day">
            {CHECKIN_DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </label>
        <div className="space-y-1.5">
          <p className="text-sm">Who's reminded <span className="text-xs text-muted-foreground">{who.length === 0 ? "— everyone on the project" : ""}</span></p>
          <div className="flex flex-wrap gap-2">
            {data.members.map((m) => (
              <label key={m.id} className="flex items-center gap-1.5 text-sm rounded-md border border-border px-2 py-1 cursor-pointer">
                <input type="checkbox" checked={who.includes(m.id)} onChange={() => toggle(m.id)} data-testid={`checkbox-remind-${m.id}`} />
                {m.name}
              </label>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">On the day, whoever is reminded hears about it if this week's check-in isn't in. Jobs remind their owner when they're due, and their backup two days after.</p>
        {/* Always saveable: agreeing to the defaults is still choosing the rhythm, which is what the path's last step asks. */}
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-settings">
          {save.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}{changed ? "Save the rhythm" : "Keep this rhythm"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── The monthly report ──────────────────────────────────────────────────────

function ReportCard({ projectId, today }: { projectId: string; today: string }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const { data, isLoading } = useQuery<MonthlyReport>({ queryKey: ["/api/projects", projectId, "rhythm", "report", month] });
  const thisMonth = today.slice(0, 7);
  const tracked = useMemo(() => data?.metrics.filter((m) => m.first != null) ?? [], [data]);

  return (
    <Card data-testid="rhythm-report">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <FileBarChart className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Monthly report</p>
          <div className="ml-auto flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setMonth(addMonthsToMonth(month, -1))} aria-label="Previous month" data-testid="button-report-prev"><ChevronLeft className="h-4 w-4" /></Button>
            <Input type="month" className="h-8 w-auto text-sm" value={month} max={thisMonth} onChange={(e) => e.target.value && setMonth(e.target.value)} data-testid="input-report-month" />
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setMonth(addMonthsToMonth(month, 1))} disabled={month >= thisMonth} aria-label="Next month" data-testid="button-report-next"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>

        {isLoading || !data ? (
          <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-4">
            <p className="font-semibold">{monthName(month)}</p>

            {data.fixNext && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3" data-testid="report-fix-next">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">What to fix next</p>
                <p className="text-sm leading-relaxed">{data.fixNext.text}</p>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 text-center">
              <Stat label="Check-ins filed" value={`${data.filed} of ${data.weeksSoFar || data.weeks.length}`} testid="report-filed" />
              <Stat label="Jobs on time" value={String(data.jobs.onTime)} testid="report-on-time" />
              <Stat label="Late or missed" value={String(data.jobs.late + data.jobs.missed)} testid="report-late" warn={data.jobs.late + data.jobs.missed > 0} />
            </div>

            {tracked.length > 0 ? (
              <table className="w-full text-sm" data-testid="report-metrics">
                <thead><tr className="text-xs text-muted-foreground text-left"><th className="font-normal py-1">Number</th><th className="font-normal py-1 text-right">First</th><th className="font-normal py-1 text-right">Last</th><th className="font-normal py-1 text-right">Change</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {tracked.map((m) => {
                    const Icon = m.verdict === "improved" ? TrendingUp : m.verdict === "worse" ? TrendingDown : Minus;
                    const tone = m.verdict === "improved" ? "text-emerald-600 dark:text-emerald-400" : m.verdict === "worse" ? "text-destructive" : "text-muted-foreground";
                    return (
                      <tr key={m.id} data-testid={`report-metric-${m.id}`}>
                        <td className="py-2">{m.label}</td>
                        <td className="py-2 text-right tabular-nums">{formatValue(m.first, m.unit)}</td>
                        <td className="py-2 text-right tabular-nums">{formatValue(m.last, m.unit)}</td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 ${tone}`}>
                            <Icon className="h-3.5 w-3.5" />
                            <span className="text-foreground tabular-nums">{m.pct != null ? `${m.pct > 0 ? "+" : ""}${Math.round(m.pct * 100)}%` : m.verdict === "not enough data" ? "one week" : formatValue(m.change, m.unit)}</span>
                            <span className="sr-only">{m.verdict}</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-muted-foreground">No check-ins this month yet.</p>
            )}

            {(data.bestWeek || data.worstWeek) && (
              <div className="flex flex-wrap gap-2 text-xs" data-testid="report-weeks">
                {data.bestWeek && <Badge variant="secondary">Best week: {shortDate(data.bestWeek.weekOf)} ({data.bestWeek.improved} up, {data.bestWeek.worsened} down)</Badge>}
                {data.worstWeek && <Badge variant="outline">Hardest week: {shortDate(data.worstWeek.weekOf)} ({data.worstWeek.improved} up, {data.worstWeek.worsened} down)</Badge>}
              </div>
            )}

            {data.jobs.byJob.length > 0 && (
              <ul className="text-sm space-y-1" data-testid="report-jobs">
                {data.jobs.byJob.map((j) => (
                  <li key={j.jobId} className="flex items-center gap-2">
                    <span className="flex-1 truncate">{j.title}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{j.onTime} on time · {j.late} late · {j.missed} missed</span>
                  </li>
                ))}
              </ul>
            )}

            {data.themes.length > 0 && (
              <div className="space-y-1" data-testid="report-themes">
                <p className="text-xs text-muted-foreground">What kept going wrong</p>
                <div className="flex flex-wrap gap-2">
                  {data.themes.map((t) => <Badge key={t.id} variant="outline">{t.label} · {t.weeks.length} weeks</Badge>)}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, testid, warn = false }: { label: string; value: string; testid: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-border p-3" data-testid={testid}>
      <p className={`text-lg font-semibold tabular-nums ${warn ? "text-destructive" : ""}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
