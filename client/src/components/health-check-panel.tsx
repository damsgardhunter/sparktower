import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useEntitlements } from "@/hooks/use-entitlements";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { useNovaHandoff } from "@/components/nova-handoff";
import {
  Loader2, Stethoscope, AlertTriangle, TrendingUp, Info, Wand2, ThumbsDown,
  Check, X, MessageSquareX, ChevronDown,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { CREDIT_COSTS } from "@shared/plans";
import type { ProjectHealthCheck, HealthFindingFeedback } from "@shared/schema";

interface HealthChecksResponse {
  checks: ProjectHealthCheck[];
  feedback: HealthFindingFeedback[];
  canRun: boolean;
}

interface Finding {
  area?: string;
  severity?: "low" | "medium" | "high";
  finding?: string;
  recommendation?: string;
  /** Nova's own read on whether it could carry the fix out itself. */
  fixable?: boolean;
}

interface AppliedChange {
  entity: string;
  action: string;
  description: string;
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  "on-track": { label: "On track", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
  "at-risk": { label: "At risk", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" },
  stalled: { label: "Stalled", className: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30" },
};

const SEVERITY_ICON = {
  high: { icon: AlertTriangle, className: "text-rose-500" },
  medium: { icon: Info, className: "text-amber-500" },
  low: { icon: TrendingUp, className: "text-muted-foreground" },
} as const;

const SCORE_BAR: Record<string, string> = { "on-track": "bg-emerald-500", "at-risk": "bg-amber-500", stalled: "bg-rose-500" };
const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const SEVERITY_BADGE: Record<string, string> = {
  high: "border-rose-500/40 text-rose-600",
  medium: "border-amber-500/40 text-amber-600",
  low: "text-muted-foreground",
};
/** How many issues show before "Show all". */
const TOP_ISSUES = 3;

const STANCE_LABEL: Record<string, string> = {
  disagree: "I disagree",
  "already-handled": "Already handled",
  "not-a-priority": "Not a priority right now",
};

/** Findings are matched to pushback by area, the one part that survives a re-run. */
const areaKey = (area?: string) => (area || "").trim().toLowerCase();

export function HealthCheckPanel({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const { can, creditsRemaining, isUnlimited } = useEntitlements();

  /** Which finding the pushback dialog is open for, by index. */
  const [disputing, setDisputing] = useState<number | null>(null);
  const [stance, setStance] = useState("disagree");
  const [reason, setReason] = useState("");
  /** Index currently being fixed, so only that row shows a spinner. */
  const [fixing, setFixing] = useState<number | null>(null);
  const [applied, setApplied] = useState<{ index: number; changes: AppliedChange[]; note: string } | null>(null);
  /** Findings with their details expanded, by index. */
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const toggleOpen = (i: number) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  const { data, isLoading } = useQuery<HealthChecksResponse>({
    queryKey: ["/api/projects", projectId, "health-checks"],
    enabled: !!projectId,
    // A check run from elsewhere (the dashboard, a teammate) shows up while this is open.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  /** Pulls the server's 402/403/422 body, which explains what went wrong. */
  const describeError = (err: any, fallback: string) => {
    const raw = err?.message || "";
    const jsonStart = raw.indexOf("{");
    if (jsonStart >= 0) {
      try { return JSON.parse(raw.slice(jsonStart)).message || fallback; } catch { /* keep */ }
    }
    return fallback;
  };

  const invalidateChecks = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "health-checks"] });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/health-check`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Health check complete" });
      setApplied(null);
      setOpen(new Set());
      invalidateChecks();
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't run the check", description: describeError(err, "Health check failed."), variant: "destructive" });
    },
  });

  // Handed over from the Nova dashboard's "Run a health check".
  useNovaHandoff("analytics.healthCheck", () => runMutation.mutate(), can("projectHealthChecks"));

  /**
   * Hands a finding back to Nova to carry out. Everything Nova can touch may
   * have moved, so this invalidates the whole project's working data rather
   * than guessing from the change list.
   */
  const fixMutation = useMutation({
    mutationFn: async (findingIndex: number) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/health-check/apply`, {
        checkId: latest?.id,
        findingIndex,
      });
      return { ...(await res.json()), findingIndex };
    },
    onSuccess: (result: any) => {
      setApplied({ index: result.findingIndex, changes: result.changes || [], note: result.note || "" });
      toast({
        title: `Nova made ${result.changes?.length || 0} change${result.changes?.length === 1 ? "" : "s"}`,
        description: result.note || undefined,
      });
      for (const key of ["milestones", "kanban", "roadmap", "activity"]) {
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, key] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
    },
    onError: (err: any) => {
      toast({ title: "Nova couldn't apply that", description: describeError(err, "Applying the fix failed."), variant: "destructive" });
    },
    onSettled: () => setFixing(null),
  });

  const disputeMutation = useMutation({
    mutationFn: async ({ finding, index }: { finding: Finding; index: number }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/health-findings/feedback`, {
        checkId: latest?.id,
        area: finding.area || `finding-${index}`,
        finding: finding.finding,
        stance,
        reason,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Noted", description: "Nova will take that into account on the next check." });
      setDisputing(null);
      setReason("");
      setStance("disagree");
      invalidateChecks();
    },
    onError: (err: any) => {
      toast({ title: "Couldn't save that", description: describeError(err, "Saving your response failed."), variant: "destructive" });
    },
  });

  const retractMutation = useMutation({
    mutationFn: async (feedbackId: string) => {
      await apiRequest("DELETE", `/api/health-findings/feedback/${feedbackId}`);
    },
    onSuccess: invalidateChecks,
    onError: (err: any) => {
      toast({ title: "Couldn't remove that", description: describeError(err, "Try again."), variant: "destructive" });
    },
  });

  if (!can("projectHealthChecks")) {
    return (
      <UpgradePrompt
        variant="inline"
        feature="projectHealthChecks"
        title="Health checks"
        description="Nova scores the project and fixes what it can."
      />
    );
  }

  const latest = data?.checks?.[0];
  const findings = ((latest?.findings as Finding[]) || []);
  const feedback = data?.feedback || [];
  const notEnoughCredits = !isUnlimited && creditsRemaining < CREDIT_COSTS.healthCheck;
  const cantAffordFix = !isUnlimited && creditsRemaining < CREDIT_COSTS.healthFix;
  const disputedFinding = disputing === null ? null : findings[disputing];
  // Worst first; each keeps its original index, which the fix and pushback calls use.
  const ranked = findings.map((f, i) => ({ f, i })).sort((a, b) => SEVERITY_RANK[a.f.severity || "low"] - SEVERITY_RANK[b.f.severity || "low"]);
  const shown = showAll ? ranked : ranked.slice(0, TOP_ISSUES);

  const runButton = (
    <Button
      size="sm"
      variant={latest ? "outline" : "default"}
      className="gap-1.5 shrink-0"
      disabled={runMutation.isPending || notEnoughCredits}
      onClick={() => runMutation.mutate()}
      title={notEnoughCredits ? `Needs ${CREDIT_COSTS.healthCheck} credits` : `${CREDIT_COSTS.healthCheck} credits`}
      data-testid="button-run-health-check"
    >
      {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />}
      {runMutation.isPending ? "Checking…" : latest ? "Re-run" : "Run a health check"}
      <span className="text-xs opacity-70">({CREDIT_COSTS.healthCheck})</span>
    </Button>
  );

  return (
    <div className="space-y-4" data-testid="card-health-check">
      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : !latest ? (
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-md border border-dashed border-border px-4 py-3">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Stethoscope className="h-4 w-4" /> No check yet
          </span>
          {runButton}
        </div>
      ) : (
        <>
          {/* Score row */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-baseline gap-0.5 shrink-0">
              <span className="text-3xl font-bold tabular-nums" data-testid="text-health-score">{latest.score}</span>
              <span className="text-xs text-muted-foreground">/100</span>
            </div>
            <div className="flex-1 min-w-[10rem] space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={STATUS_STYLES[latest.status]?.className || ""} data-testid="badge-health-status">
                  {STATUS_STYLES[latest.status]?.label || latest.status}
                </Badge>
                <span className="text-xs text-muted-foreground" title={new Date(latest.createdAt).toLocaleString()}>
                  {formatDistanceToNow(new Date(latest.createdAt), { addSuffix: true })}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className={`h-full transition-all ${SCORE_BAR[latest.status] || "bg-primary"}`} style={{ width: `${Math.max(0, Math.min(100, latest.score))}%` }} /></div>
            </div>
            {runButton}
          </div>

          {latest.summary && (
            <div className="flex items-start gap-2 text-sm">
              <p className={`text-muted-foreground flex-1 min-w-0 ${showSummary ? "" : "line-clamp-1"}`} data-testid="text-health-summary">{latest.summary}</p>
              <button type="button" className="text-xs text-primary hover:underline shrink-0 mt-0.5" onClick={() => setShowSummary(!showSummary)} data-testid="button-toggle-health-summary">
                {showSummary ? "Less" : "Details"}
              </button>
            </div>
          )}

          {findings.length > 0 && (
            <div className="border-t border-border/60 pt-4 space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Top issues</p>
                {cantAffordFix && <span className="text-[11px] text-destructive">Fixes need {CREDIT_COSTS.healthFix} credits</span>}
              </div>
              <ul className="divide-y divide-border/60">
                {shown.map(({ f, i }) => {
                  const sev = SEVERITY_ICON[f.severity || "low"] || SEVERITY_ICON.low;
                  const SevIcon = sev.icon;
                  // Pushback is remembered by area, so it stays attached to the
                  // point across re-runs even as the wording changes.
                  const pushback = feedback.find((fb) => fb.area === areaKey(f.area));
                  const isFixing = fixing === i && fixMutation.isPending;
                  const result = applied?.index === i ? applied : null;
                  const isOpen = open.has(i);

                  return (
                    <li key={i} className="py-2.5 space-y-2" data-testid={`finding-${i}`}>
                      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                        <button
                          type="button"
                          className="flex items-center gap-2 min-w-0 flex-1 text-left group"
                          onClick={() => toggleOpen(i)}
                          aria-expanded={isOpen}
                          data-testid={`button-finding-details-${i}`}
                        >
                          <SevIcon className={`h-4 w-4 shrink-0 ${sev.className}`} />
                          <span className="text-sm font-medium truncate">{f.area || "Finding"}</span>
                          {f.severity && (
                            <Badge variant="outline" className={`text-[10px] font-normal capitalize shrink-0 ${SEVERITY_BADGE[f.severity] || ""}`}>{f.severity}</Badge>
                          )}
                          {result && <Badge variant="outline" className="text-[10px] font-normal shrink-0 border-emerald-500/40 text-emerald-600">Fixed</Badge>}
                          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                        </button>
                        <div className="flex items-center gap-1 ml-auto shrink-0">
                          {f.fixable !== false && !result && (
                            <Button
                              size="sm"
                              className="h-7 gap-1.5 text-xs border-0 text-white bg-gradient-to-r from-green-400 via-emerald-500 to-purple-500 hover:opacity-90"
                              disabled={isFixing || fixMutation.isPending || cantAffordFix}
                              onClick={() => { setFixing(i); fixMutation.mutate(i); }}
                              title={`${CREDIT_COSTS.healthFix} credits`}
                              data-testid={`button-fix-finding-${i}`}
                            >
                              {isFixing
                                ? <><Loader2 className="h-3 w-3 animate-spin" /> Nova is working…</>
                                : <><Wand2 className="h-3 w-3" /><span className="hidden sm:inline">Have Nova fix this</span><span className="sm:hidden">Nova fix</span></>}
                            </Button>
                          )}
                          {!pushback && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground"
                                  aria-label="I disagree"
                                  onClick={() => { setDisputing(i); setStance("disagree"); setReason(""); }}
                                  data-testid={`button-dispute-finding-${i}`}
                                >
                                  <ThumbsDown className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent className="text-xs">I disagree</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </div>

                      {isOpen && (f.finding || f.recommendation) && (
                        <div className="pl-6 space-y-1 text-sm" data-testid={`finding-details-${i}`}>
                          {f.finding && <p className="text-muted-foreground">{f.finding}</p>}
                          {f.recommendation && <p><span className="font-medium">Do this:</span> {f.recommendation}</p>}
                        </div>
                      )}

                      {/* What the builder already said about this point. */}
                      {pushback && (
                        <div className="ml-6 flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1" data-testid={`pushback-${i}`}>
                          <MessageSquareX className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <p className="text-xs min-w-0 flex-1 truncate" title={pushback.reason}>
                            <span className="font-medium">{STANCE_LABEL[pushback.stance] || pushback.stance}</span>
                            <span className="text-muted-foreground"> · {pushback.reason}</span>
                          </p>
                          <Button
                            variant="ghost" size="sm" className="h-6 px-1.5 shrink-0"
                            aria-label="Remove your note"
                            onClick={() => retractMutation.mutate(pushback.id)}
                            data-testid={`button-retract-pushback-${i}`}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      )}

                      {/* What Nova actually changed, right where the advice was. */}
                      {result && (
                        <div className="ml-6 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-2 space-y-1" data-testid={`applied-${i}`}>
                          <ul className="space-y-0.5">
                            {result.changes.map((c, j) => (
                              <li key={j} className="flex items-start gap-1.5 text-xs">
                                <Check className="h-3 w-3 mt-0.5 shrink-0 text-emerald-500" />
                                <span>{c.description}</span>
                              </li>
                            ))}
                          </ul>
                          {result.note && <p className="text-xs text-muted-foreground">{result.note}</p>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {ranked.length > TOP_ISSUES && (
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => setShowAll(!showAll)} data-testid="button-toggle-all-findings">
                  {showAll ? "Show top issues" : `Show all ${ranked.length}`}
                </button>
              )}
            </div>
          )}

          {((data?.checks?.length || 0) > 1 || feedback.length > 0) && (
            <p className="text-[11px] text-muted-foreground">
              {(data?.checks?.length || 0) > 1 && `${data!.checks.length} checks`}
              {(data?.checks?.length || 0) > 1 && feedback.length > 0 && " · "}
              {feedback.length > 0 && `${feedback.length} note${feedback.length === 1 ? "" : "s"} carried forward`}
            </p>
          )}
        </>
      )}

      <Dialog open={disputing !== null} onOpenChange={(open) => !open && setDisputing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ThumbsDown className="h-4 w-4 text-primary" /> Push back
            </DialogTitle>
            <DialogDescription>Nova factors this into every future check.</DialogDescription>
          </DialogHeader>
          {disputedFinding && (
            <div className="space-y-4 py-1">
              <div className="rounded-md bg-muted/50 px-3 py-2">
                <p className="text-sm font-medium">{disputedFinding.area || "Finding"}</p>
                {disputedFinding.finding && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{disputedFinding.finding}</p>}
              </div>
              <div className="space-y-2">
                <Label>Your position</Label>
                <Select value={stance} onValueChange={setStance}>
                  <SelectTrigger data-testid="select-dispute-stance"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="disagree">I disagree</SelectItem>
                    <SelectItem value="already-handled">Already handled</SelectItem>
                    <SelectItem value="not-a-priority">Not a priority right now</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Why?</Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="What Nova can't see"
                  className="min-h-[80px]"
                  data-testid="textarea-dispute-reason"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisputing(null)}>Cancel</Button>
            <Button
              disabled={!reason.trim() || disputeMutation.isPending}
              onClick={() => disputing !== null && disputedFinding &&
                disputeMutation.mutate({ finding: disputedFinding, index: disputing })}
              data-testid="button-save-dispute"
            >
              {disputeMutation.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving…</>
                : "Tell Nova"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
