import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import NotFound from "@/pages/not-found";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, ShieldCheck, AlertTriangle, AlertOctagon, Info, Flag, Gauge, Activity, ToggleLeft,
  ArrowDown, ArrowUp, Minus, CheckCircle2,
} from "lucide-react";
import { SAFETY_CHECKLIST, IMPACT_WINDOW_HOURS, type SafetyAlert } from "@shared/safety";
import { moderationReasonLabel, reportReasonLabel } from "@shared/moderation";

interface Metric {
  key: string; label: string; goodWhen: "down" | "up" | "either";
  before: number; after: number; afterHours: number; afterPace: number;
  changePercent: number | null; direction: "up" | "down" | "flat";
}
interface ActionImpact {
  logId: string; action: string; targetType: string | null; targetId: string | null;
  reasonCode: string | null; actorName: string | null; createdAt: string; hoursSince: number;
  status: "early" | "watching" | "settled"; metrics: Metric[]; headline: string | null;
}
interface Review {
  windowHours: number;
  lastReview: { at: string; by: string | null; hoursAgo: number; note: string | null } | null;
  reviewDue: boolean;
  alerts: SafetyAlert[];
  reports: { open: number; oldestOpenHours: number | null; newInWindow: number; newBefore: number; byReason: { reason: string; count: number }[] };
  limits: { action: string; refused: number; refusedBefore: number; spike: boolean; allowedLast24h: number | null; rule: string | null }[];
  content: { inWindow: number; before: number };
  surfacesOff: { id: string; label: string }[];
  actions: ActionImpact[];
}

/** How a log entry's action reads. */
const ACTION_WORDS: Record<string, string> = {
  comment_remove: "Removed a comment",
  comment_shadow_hide: "Shadow-hid a comment",
  comment_ban: "Banned an author",
  comment_dismiss: "Dismissed a report",
  content_hidden: "Took content down",
  content_restored: "Restored content",
  suspend: "Suspended an account",
  reinstate: "Reinstated an account",
  surface_toggled: "Switched a surface",
};

const ALERT_STYLE = {
  urgent: { icon: AlertOctagon, className: "border-rose-500/40 bg-rose-500/5 text-rose-600 dark:text-rose-400" },
  warn: { icon: AlertTriangle, className: "border-amber-500/40 bg-amber-500/5 text-amber-600 dark:text-amber-400" },
  info: { icon: Info, className: "border-border bg-muted/30 text-muted-foreground" },
} as const;

const hoursLabel = (h: number | null) => (h == null ? "—" : h < 1 ? "<1h" : h < 48 ? `${Math.floor(h)}h` : `${Math.floor(h / 24)}d`);

function Delta({ now, before, goodWhen = "down" }: { now: number; before: number; goodWhen?: "down" | "up" | "either" }) {
  const diff = now - before;
  if (Math.abs(diff) < 0.5) return <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"><Minus className="h-3 w-3" /> flat</span>;
  const up = diff > 0;
  const good = goodWhen === "either" ? null : (goodWhen === "down") !== up;
  const tone = good == null ? "text-muted-foreground" : good ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
  const Icon = up ? ArrowUp : ArrowDown;
  return <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${tone}`}><Icon className="h-3 w-3" /> {up ? "+" : ""}{Math.round(diff * 10) / 10}</span>;
}

function Section({ icon: Icon, title, action, children, testId }: {
  icon: typeof Flag; title: string; action?: React.ReactNode; children: React.ReactNode; testId: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base flex items-center gap-2"><Icon className="h-4 w-4 text-primary" /> {title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

/** One moderation action: what it touched, before → after. */
export function ImpactCard({ impact }: { impact: ActionImpact }) {
  const statusLabel = impact.status === "early" ? "Too early" : impact.status === "watching" ? `Watching · ${hoursLabel(impact.hoursSince)} in` : "Settled";
  return (
    <div id={`action-${impact.logId}`} className="rounded-lg border border-border/60 p-3 space-y-2 scroll-mt-24" data-testid={`impact-${impact.logId}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {ACTION_WORDS[impact.action] ?? impact.action}
            {impact.targetType === "surface" && impact.targetId ? ` · ${impact.targetId}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {impact.actorName ?? "Someone"} · {hoursLabel(impact.hoursSince)} ago
            {impact.reasonCode ? ` · ${moderationReasonLabel(impact.reasonCode)}` : ""}
          </p>
        </div>
        <Badge variant={impact.status === "settled" ? "secondary" : "outline"} className="text-[10px]">{statusLabel}</Badge>
      </div>
      {impact.headline && <p className="text-sm" data-testid={`impact-headline-${impact.logId}`}>{impact.headline}</p>}
      {impact.status !== "early" && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="font-normal py-1 pr-2">Metric</th>
                <th className="font-normal py-1 px-2 text-right">{IMPACT_WINDOW_HOURS}h before</th>
                <th className="font-normal py-1 px-2 text-right">After (per {IMPACT_WINDOW_HOURS}h)</th>
                <th className="font-normal py-1 pl-2 text-right">Moved</th>
              </tr>
            </thead>
            <tbody>
              {impact.metrics.map((m) => (
                <tr key={m.key} className="border-t border-border/40" data-testid={`metric-${impact.logId}-${m.key}`}>
                  <td className="py-1 pr-2">{m.label}</td>
                  <td className="py-1 px-2 text-right tabular-nums">{m.before}</td>
                  <td className="py-1 px-2 text-right tabular-nums">{m.afterPace}{m.afterHours < IMPACT_WINDOW_HOURS && <span className="text-muted-foreground"> ({m.after} so far)</span>}</td>
                  <td className="py-1 pl-2 text-right"><Delta now={m.afterPace} before={m.before} goodWhen={m.goodWhen} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * The daily safety review: every signal on one page, what recent actions did,
 * and a checklist that records the pass — so the next one starts from here.
 */
export default function AdminSafety() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");

  const isReviewer = !!user && ["reviewer", "admin"].includes((user as any).platformRole);
  const isAdmin = !!user && (user as any).platformRole === "admin";

  const { data, isLoading, isError } = useQuery<Review>({
    queryKey: ["/api/admin/safety/review"],
    enabled: isReviewer,
    // The review is a snapshot of right now; opening it always re-reads.
    refetchOnMount: "always",
  });

  // Arriving from "See impact" on the reports queue: scroll to that action once it has loaded.
  useEffect(() => {
    if (!data || !window.location.hash.startsWith("#action-")) return;
    const el = document.getElementById(window.location.hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("ring-2", "ring-primary");
    const t = setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 2500);
    return () => clearTimeout(t);
  }, [data]);

  const complete = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/safety/review", { checked: Array.from(checked), note: note.trim() || undefined })).json(),
    onSuccess: () => {
      toast({ title: "Review recorded", description: "The next one picks up from here." });
      setChecked(new Set());
      setNote("");
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/safety/review"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/safety/status"] });
    },
    onError: (e) => toast({ title: "Couldn't record the review", description: errorText(e), variant: "destructive" }),
  });

  if (authLoading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!isReviewer) return <NotFound />;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-5" data-testid="admin-safety">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" /> Daily safety review
        </h1>
        <p className="text-sm text-muted-foreground">
          Reports, rate limits and loop health together, what your recent actions did, and a checklist
          that records the pass.
          {data && (data.lastReview
            ? ` Covering the last ${hoursLabel(data.windowHours)} — since ${data.lastReview.by ?? "someone"}'s review ${hoursLabel(data.lastReview.hoursAgo)} ago.`
            : ` Covering the last ${hoursLabel(data.windowHours)}. No review has been recorded yet.`)}
        </p>
        <div className="flex flex-wrap gap-2 pt-1 text-xs">
          <Link href="/admin/reports" className="text-primary hover:underline">Reports queue</Link>
          <span className="text-muted-foreground">·</span>
          <Link href="/admin/surfaces" className="text-primary hover:underline">Surfaces</Link>
          <span className="text-muted-foreground">·</span>
          <Link href="/admin/analytics" className="text-primary hover:underline">Analytics</Link>
          <span className="text-muted-foreground">·</span>
          <Link href="/admin/backing" className="text-primary hover:underline">Backing review</Link>
          {/* Admins only: the promotions endpoints refuse a reviewer, so the link would lead nowhere useful. */}
          {isAdmin && (
            <>
              <span className="text-muted-foreground">·</span>
              <Link href="/admin/promotions" className="text-primary hover:underline">Featured tools</Link>
            </>
          )}
        </div>
      </header>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : isError || !data ? (
        <Card className="border-dashed"><CardContent className="py-10 text-center text-sm text-muted-foreground">Couldn't load the review. Try again.</CardContent></Card>
      ) : (
        <>
          {/* ------------------------------------------------------------ alerts */}
          <div className="space-y-2" data-testid="safety-alerts">
            {data.alerts.length === 0 ? (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" /> Nothing needs attention.
              </div>
            ) : data.alerts.map((a) => {
              const style = ALERT_STYLE[a.level];
              return (
                <div key={a.id} className={`rounded-lg border p-3 flex items-start gap-2 ${style.className}`} data-testid={`alert-${a.id}`}>
                  <style.icon className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{a.title}</p>
                    <p className="text-xs text-muted-foreground">{a.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* ----------------------------------------------------------- reports */}
            <Section icon={Flag} title="Reports" testId="safety-reports"
              action={<Button asChild size="sm" variant="outline" className="h-7 text-xs"><Link href="/admin/reports">Open queue</Link></Button>}>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Open" value={data.reports.open} />
                <Stat label="Oldest open" value={hoursLabel(data.reports.oldestOpenHours)} />
                <Stat label="New" value={data.reports.newInWindow} delta={<Delta now={data.reports.newInWindow} before={data.reports.newBefore} />} />
              </div>
              {data.reports.byReason.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Open by reason: {data.reports.byReason.map((r) => `${reportReasonLabel(r.reason)} ${r.count}`).join(" · ")}
                </p>
              )}
            </Section>

            {/* ----------------------------------------------------------- content */}
            <Section icon={Activity} title="Activity" testId="safety-activity">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Posts, comments, messages" value={data.content.inWindow} delta={<Delta now={data.content.inWindow} before={data.content.before} goodWhen="up" />} />
              </div>
            </Section>
          </div>

          {/* ---------------------------------------------------------------- limits */}
          <Section icon={Gauge} title="Rate limits" testId="safety-limits">
            {data.limits.length === 0 ? (
              <p className="text-sm text-muted-foreground">No one has been refused in this window or the one before.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground text-left">
                      <th className="font-normal py-1 pr-2">Limit</th>
                      <th className="font-normal py-1 px-2 text-right">Refused</th>
                      <th className="font-normal py-1 px-2 text-right">Window before</th>
                      <th className="font-normal py-1 px-2 text-right">Allowed (24h)</th>
                      <th className="font-normal py-1 pl-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.limits.map((l) => (
                      <tr key={l.action} className="border-t border-border/40" data-testid={`limit-${l.action}`}>
                        <td className="py-1.5 pr-2">
                          <span className="font-medium">{l.action}</span>
                          {l.rule && <span className="block text-[11px] text-muted-foreground">{l.rule}</span>}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{l.refused}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{l.refusedBefore}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{l.allowedLast24h ?? "—"}</td>
                        <td className="py-1.5 pl-2 text-right">{l.spike && <Badge variant="destructive" className="text-[10px]">Spike</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* --------------------------------------------------------------- impact */}
          <Section icon={Activity} title="What recent actions did" testId="safety-impact">
            {data.actions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No moderation actions in the last 7 days.</p>
            ) : (
              <div className="space-y-2">{data.actions.map((a) => <ImpactCard key={a.logId} impact={a} />)}</div>
            )}
          </Section>

          {data.surfacesOff.length > 0 && (
            <Section icon={ToggleLeft} title="Switched off" testId="safety-surfaces"
              action={<Button asChild size="sm" variant="outline" className="h-7 text-xs"><Link href="/admin/surfaces">Surfaces</Link></Button>}>
              <div className="flex flex-wrap gap-1.5">
                {data.surfacesOff.map((s) => <Badge key={s.id} variant="secondary">{s.label}</Badge>)}
              </div>
            </Section>
          )}

          {/* ------------------------------------------------------------ checklist */}
          <Card className="border-primary/40" data-testid="safety-checklist">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> Complete today's review</CardTitle>
              {data.lastReview && (
                <p className="text-xs text-muted-foreground">
                  Last: {data.lastReview.by ?? "Someone"}, {hoursLabel(data.lastReview.hoursAgo)} ago{data.lastReview.note ? ` — "${data.lastReview.note}"` : ""}
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {SAFETY_CHECKLIST.map((item) => (
                <label key={item.id} className="flex items-start gap-2.5 text-sm cursor-pointer">
                  <Checkbox
                    className="mt-0.5"
                    checked={checked.has(item.id)}
                    onCheckedChange={(v) => setChecked((prev) => {
                      const next = new Set(prev);
                      if (v) next.add(item.id); else next.delete(item.id);
                      return next;
                    })}
                    data-testid={`check-${item.id}`}
                  />
                  <span>
                    <span className="font-medium">{item.label}</span>
                    <span className="block text-xs text-muted-foreground">{item.detail}</span>
                  </span>
                </label>
              ))}
              <Textarea
                value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="Anything the next reviewer should know (optional)"
                className="min-h-[56px] text-sm"
                data-testid="input-review-note"
              />
              <Button
                disabled={checked.size < SAFETY_CHECKLIST.length || complete.isPending}
                onClick={() => complete.mutate()}
                data-testid="button-complete-review"
              >
                {complete.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Complete review
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, delta }: { label: string; value: React.ReactNode; delta?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/60 p-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums flex items-baseline gap-1.5">{value}{delta}</p>
    </div>
  );
}
