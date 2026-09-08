import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
  Check, X, MessageSquareX,
} from "lucide-react";
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

  const { data, isLoading } = useQuery<HealthChecksResponse>({
    queryKey: ["/api/projects", projectId, "health-checks"],
    enabled: !!projectId,
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
        feature="projectHealthChecks"
        title="Know if your project is actually on track"
        description="Nova reviews your scope, momentum, team, and roadmap, then tells you honestly where things stand — and fixes what it can for you."
      />
    );
  }

  const latest = data?.checks?.[0];
  const findings = ((latest?.findings as Finding[]) || []);
  const feedback = data?.feedback || [];
  const notEnoughCredits = !isUnlimited && creditsRemaining < CREDIT_COSTS.healthCheck;
  const cantAffordFix = !isUnlimited && creditsRemaining < CREDIT_COSTS.healthFix;
  const disputedFinding = disputing === null ? null : findings[disputing];

  return (
    <Card data-testid="card-health-check">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-4">
        <div className="space-y-1">
          <CardTitle className="text-lg flex items-center gap-2">
            <Stethoscope className="h-4 w-4 text-primary" /> Project health
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Nova's honest read on where this project stands — and it can act on its own advice.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-2 shrink-0"
          disabled={runMutation.isPending || notEnoughCredits}
          onClick={() => runMutation.mutate()}
          data-testid="button-run-health-check"
        >
          {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />}
          {latest ? "Re-run" : "Run check"} ({CREDIT_COSTS.healthCheck})
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : !latest ? (
          <p className="text-sm text-muted-foreground py-2">
            No health check yet. Run one to see where this project actually stands.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <div className="shrink-0">
                <p className="text-3xl font-bold" data-testid="text-health-score">{latest.score}</p>
                <p className="text-xs text-muted-foreground">out of 100</p>
              </div>
              <div className="flex-1 space-y-2 min-w-0">
                <Badge
                  variant="outline"
                  className={STATUS_STYLES[latest.status]?.className || ""}
                  data-testid="badge-health-status"
                >
                  {STATUS_STYLES[latest.status]?.label || latest.status}
                </Badge>
                <Progress value={latest.score} className="h-2" />
                <p className="text-sm text-secondary leading-relaxed" data-testid="text-health-summary">{latest.summary}</p>
              </div>
            </div>

            {findings.length > 0 && (
              <div className="space-y-2.5 pt-1 border-t border-border/50">
                {findings.map((f, i) => {
                  const sev = SEVERITY_ICON[f.severity || "low"] || SEVERITY_ICON.low;
                  const SevIcon = sev.icon;
                  // Pushback is remembered by area, so it stays attached to the
                  // point across re-runs even as the wording changes.
                  const pushback = feedback.find((fb) => fb.area === areaKey(f.area));
                  const isFixing = fixing === i && fixMutation.isPending;
                  const result = applied?.index === i ? applied : null;

                  return (
                    <div key={i} className="flex items-start gap-2.5 pt-2.5" data-testid={`finding-${i}`}>
                      <SevIcon className={`h-4 w-4 mt-0.5 shrink-0 ${sev.className}`} />
                      <div className="space-y-1.5 min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {f.area || "Finding"}
                          {f.severity && (
                            <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">{f.severity}</span>
                          )}
                        </p>
                        {f.finding && <p className="text-sm text-muted-foreground">{f.finding}</p>}
                        {f.recommendation && (
                          <p className="text-sm"><span className="text-muted-foreground">Do this:</span> {f.recommendation}</p>
                        )}

                        {/* What the builder already said about this point. */}
                        {pushback && (
                          <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 p-2" data-testid={`pushback-${i}`}>
                            <MessageSquareX className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium">{STANCE_LABEL[pushback.stance] || pushback.stance}</p>
                              <p className="text-xs text-muted-foreground">{pushback.reason}</p>
                            </div>
                            <Button
                              variant="ghost" size="sm" className="h-6 px-1.5 shrink-0"
                              onClick={() => retractMutation.mutate(pushback.id)}
                              data-testid={`button-retract-pushback-${i}`}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        )}

                        {/* What Nova actually changed, right where the advice was. */}
                        {result && (
                          <div className="rounded-md border border-primary/40 bg-primary/5 p-2 space-y-1" data-testid={`applied-${i}`}>
                            <p className="text-xs font-semibold">Nova applied this</p>
                            <ul className="space-y-0.5">
                              {result.changes.map((c, j) => (
                                <li key={j} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                  <Check className="h-3 w-3 mt-0.5 shrink-0 text-emerald-500" />
                                  <span>{c.description}</span>
                                </li>
                              ))}
                            </ul>
                            {result.note && <p className="text-xs text-secondary">{result.note}</p>}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          {f.fixable !== false && !result && (
                            <Button
                              variant="outline" size="sm" className="h-7 gap-1.5 text-xs"
                              disabled={isFixing || fixMutation.isPending || cantAffordFix}
                              onClick={() => { setFixing(i); fixMutation.mutate(i); }}
                              data-testid={`button-fix-finding-${i}`}
                            >
                              {isFixing
                                ? <><Loader2 className="h-3 w-3 animate-spin" /> Nova is working…</>
                                : <><Wand2 className="h-3 w-3" /> Have Nova fix this ({CREDIT_COSTS.healthFix})</>}
                            </Button>
                          )}
                          {!pushback && (
                            <Button
                              variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground"
                              onClick={() => { setDisputing(i); setStance("disagree"); setReason(""); }}
                              data-testid={`button-dispute-finding-${i}`}
                            >
                              <ThumbsDown className="h-3 w-3" /> I disagree
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {cantAffordFix && (
              <p className="text-xs text-destructive">
                Having Nova apply a fix costs {CREDIT_COSTS.healthFix} credits and you have {creditsRemaining}.
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              Checked {new Date(latest.createdAt).toLocaleString()}
              {(data?.checks?.length || 0) > 1 && ` · ${data!.checks.length} checks on record`}
              {feedback.length > 0 && ` · ${feedback.length} of your notes carried into the next check`}
            </p>
          </>
        )}
      </CardContent>

      <Dialog open={disputing !== null} onOpenChange={(open) => !open && setDisputing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ThumbsDown className="h-4 w-4 text-primary" /> Push back on this finding
            </DialogTitle>
            <DialogDescription>
              Nova only sees what's in the project. Tell it what it's missing and it'll factor
              that into every future check instead of raising this again.
            </DialogDescription>
          </DialogHeader>
          {disputedFinding && (
            <div className="space-y-4 py-1">
              <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {disputedFinding.area || "Finding"}
                </p>
                <p className="text-sm mt-1">{disputedFinding.finding}</p>
              </div>
              <div className="space-y-2">
                <Label>What's your position?</Label>
                <Select value={stance} onValueChange={setStance}>
                  <SelectTrigger data-testid="select-dispute-stance"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="disagree">I disagree — this isn't right</SelectItem>
                    <SelectItem value="already-handled">Already handled — Nova can't see it</SelectItem>
                    <SelectItem value="not-a-priority">Fair, but not a priority right now</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Why? *</Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. The MVP looks big because I'm reusing a codebase I already have — most of that list is a week of wiring, not months."
                  className="min-h-[100px]"
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
    </Card>
  );
}
