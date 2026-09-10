import { areaLabel, type CapabilityEntry } from "@shared/capabilities";
import type { AuditDelta } from "@shared/audit-delta";
import type { DataShape } from "@shared/data-shape";
import { DataMap } from "@/components/data-map";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useEntitlements } from "@/hooks/use-entitlements";
import { useUpload } from "@/hooks/use-upload";
import {
  Loader2, Github, Upload, ScanSearch, CheckCircle2, AlertTriangle, XCircle,
  CircleDot, FileCode, Lock, ChevronDown, ChevronRight, Wand2, ShieldAlert,
  Boxes, Route as RouteIcon, Database, FlaskConical, Check,
} from "lucide-react";
import { CREDIT_COSTS } from "@shared/plans";
import type { ProjectCodeAudit } from "@shared/schema";

interface AuditListItem {
  id: string;
  source: string;
  sourceKind: "github" | "upload";
  stage: string | null;
  completionPercent: number | null;
  summary: string | null;
  appliedAt: string | null;
  createdAt: string;
  operationCount: number;
}

interface RepoCheck {
  ok: boolean;
  fullName: string;
  defaultBranch: string;
  description: string | null;
  language: string | null;
  isPrivate: boolean;
  stars: number;
  ref: string;
}

const STAGE_STYLE: Record<string, { label: string; className: string }> = {
  empty: { label: "Empty", className: "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30" },
  scaffold: { label: "Scaffold", className: "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30" },
  prototype: { label: "Prototype", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" },
  mvp: { label: "MVP", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30" },
  beta: { label: "Beta", className: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30" },
  production: { label: "Production", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
};

const SEVERITY_STYLE: Record<string, { icon: any; className: string }> = {
  high: { icon: AlertTriangle, className: "text-rose-500" },
  medium: { icon: CircleDot, className: "text-amber-500" },
  low: { icon: CircleDot, className: "text-muted-foreground" },
};

const VERDICT_STYLE: Record<string, { icon: any; className: string; label: string }> = {
  complete: { icon: CheckCircle2, className: "text-emerald-500", label: "Complete" },
  "in-progress": { icon: CircleDot, className: "text-blue-500", label: "In progress" },
  "not-started": { icon: XCircle, className: "text-muted-foreground", label: "Not started" },
};

function Section({ title, count, icon: Icon, children, defaultOpen = false }: {
  title: string; count?: number; icon: any; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-border/50 pt-3">
      <button
        type="button"
        className="flex items-center gap-2 w-full text-left"
        onClick={() => setOpen((o) => !o)}
        data-testid={`section-${title.toLowerCase().replace(/\s+/g, "-")}`}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">{title}</span>
        {count !== undefined && <Badge variant="secondary" className="text-[10px]">{count}</Badge>}
      </button>
      {open && <div className="pt-2 pl-6 space-y-2">{children}</div>}
    </div>
  );
}

const Evidence = ({ paths }: { paths?: string[] }) =>
  paths?.length ? (
    <span className="text-[10px] text-muted-foreground font-mono break-all">{paths.slice(0, 3).join(" · ")}</span>
  ) : null;

export function CodebaseTab({ projectId, repoUrl }: { projectId: string; repoUrl?: string | null }) {
  const { toast } = useToast();
  const { can, creditsRemaining, isUnlimited } = useEntitlements();
  const { uploadFile, isUploading } = useUpload();

  const [url, setUrl] = useState(repoUrl || "");
  const [token, setToken] = useState("");
  const [tokenOpen, setTokenOpen] = useState(false);
  const [check, setCheck] = useState<RepoCheck | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const isBuilder = can("aiMilestones");
  const notEnoughCredits = !isUnlimited && creditsRemaining < CREDIT_COSTS.codeAudit;

  const describeError = (err: any, fallback: string) => {
    const raw = err?.message || "";
    const jsonStart = raw.indexOf("{");
    if (jsonStart >= 0) {
      try {
        const body = JSON.parse(raw.slice(jsonStart));
        return { message: body.message || fallback, upgrade: body.code === "upgrade_required" };
      } catch { /* keep */ }
    }
    return { message: fallback, upgrade: false };
  };

  const { data: audits } = useQuery<AuditListItem[]>({
    queryKey: ["/api/projects", projectId, "code-audits"],
    enabled: !!projectId,
  });

  const latestId = selectedId || audits?.[0]?.id || null;

  const { data: audit, isLoading: auditLoading } = useQuery<ProjectCodeAudit>({
    queryKey: ["/api/code-audits", latestId],
    queryFn: async () => {
      const res = await fetch(`/api/code-audits/${latestId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Couldn't load that audit");
      return res.json();
    },
    enabled: !!latestId,
  });

  /** Validates the repo before any credits are spent on it. */
  const checkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/code-audit/check-repo`, {
        repoUrl: url, token: token.trim() || undefined,
      });
      return res.json() as Promise<RepoCheck>;
    },
    onSuccess: (result) => setCheck(result),
    onError: (err: any) => {
      setCheck(null);
      toast({ title: "Can't reach that repository", description: describeError(err, "Check the URL.").message, variant: "destructive" });
    },
  });

  const auditMutation = useMutation({
    mutationFn: async (payload: { repoUrl?: string; token?: string; objectPath?: string; fileName?: string }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/code-audit`, payload);
      return res.json() as Promise<{ audit: ProjectCodeAudit; creditsCharged: number }>;
    },
    onSuccess: (result) => {
      setSelectedId(result.audit.id);
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "code-audits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
      queryClient.setQueryData(["/api/code-audits", result.audit.id], result.audit);
      toast({
        title: "Audit complete",
        description: `${result.audit.stage} · ${result.audit.completionPercent}% built · ${result.creditsCharged} credits`,
      });
    },
    onError: (err: any) => {
      const { message, upgrade } = describeError(err, "The audit failed.");
      toast({
        title: upgrade ? "Builder plan needed" : "Audit failed",
        description: message,
        variant: upgrade ? "default" : "destructive",
      });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/code-audits/${latestId}/apply`);
      return res.json() as Promise<{ changes: { description: string }[]; skipped: string[] }>;
    },
    onSuccess: (result) => {
      toast({
        title: `Board updated — ${result.changes.length} change${result.changes.length === 1 ? "" : "s"}`,
        description: result.skipped.length ? `${result.skipped.length} skipped.` : "Your tasks and milestones now match the code.",
      });
      for (const key of ["kanban", "milestones", "code-audits", "task-history", "activity"]) {
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, key] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/code-audits", latestId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
    },
    onError: (err: any) => toast({ title: "Couldn't apply that", description: describeError(err, "Try again.").message, variant: "destructive" }),
  });

  /** A zip goes to object storage first, then the audit reads it from there. */
  const handleZip = async (file: File) => {
    if (!/\.zip$/i.test(file.name)) {
      toast({ title: "Zip files only", description: "Export your project as a .zip and upload that.", variant: "destructive" });
      return;
    }
    try {
      const result = await uploadFile(file);
      if (!result?.objectPath) throw new Error("The upload didn't return a storage path.");
      auditMutation.mutate({ objectPath: result.objectPath, fileName: file.name });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err?.message || "Try again.", variant: "destructive" });
    }
  };

  const findings = (audit?.findings as any) || {};
  const scan = findings.scan || {};
  type Probe = { url: string; ok: boolean; status: number | null; ms: number; error?: string } | null;
  const runtime = ((audit as any)?.runtime ?? null) as { liveUrl: Probe; health: Probe; surfaces: { loaded: boolean; enabled: number; off: string[] } | null; env: { referenced: number; setHere: string[]; missingHere: string[]; instance: string } } | null;
  const delta = ((audit as any)?.delta ?? null) as AuditDelta | null;
  const dataShape = ((audit as any)?.dataShape ?? null) as DataShape | null;
  const running = auditMutation.isPending || isUploading;

  return (
    <div className="space-y-5 max-w-4xl">
      {/* --- Source --- */}
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-lg flex items-center gap-2">
            <ScanSearch className="h-4 w-4 text-primary" /> Codebase audit
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Nova reads your actual code and reconciles it with your plan — what's really built,
            what's missing, and which tasks are further along than your board says.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isBuilder && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <Lock className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
              <div className="text-sm">
                <p className="font-medium">Codebase audits are on the Builder plan</p>
                <p className="text-muted-foreground text-xs">Running one will tell you what to upgrade to.</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs flex items-center gap-1.5"><Github className="h-3.5 w-3.5" /> GitHub repository</Label>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={url}
                onChange={(e) => { setUrl(e.target.value); setCheck(null); }}
                placeholder="https://github.com/you/your-repo"
                className="flex-1"
                data-testid="input-repo-url"
              />
              <Button
                variant="outline" className="gap-1.5 shrink-0"
                disabled={!url.trim() || checkMutation.isPending}
                onClick={() => checkMutation.mutate()}
                data-testid="button-check-repo"
              >
                {checkMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Check
              </Button>
            </div>

            {check && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-sm" data-testid="repo-check-ok">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{check.fullName} <span className="text-muted-foreground font-normal">@ {check.ref}</span></p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[check.language, check.isPrivate ? "private" : "public", `${check.stars} stars`].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>
            )}

            {/* Private repos need a token. It's used for the request and never
                stored, so it has to be re-entered each time — deliberately. */}
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground underline decoration-dotted underline-offset-2"
              onClick={() => setTokenOpen((o) => !o)}
              data-testid="button-toggle-token"
            >
              {tokenOpen ? "Hide" : "Private repository?"}
            </button>
            {tokenOpen && (
              <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/30 p-3">
                <Label className="text-xs">GitHub personal access token (read-only)</Label>
                <Input
                  type="password"
                  value={token}
                  onChange={(e) => { setToken(e.target.value); setCheck(null); }}
                  placeholder="ghp_…"
                  data-testid="input-github-token"
                />
                <p className="text-[10px] text-muted-foreground">
                  Used for this audit and never saved — you'll re-enter it next time. Create one with
                  read-only <code>Contents</code> access, and revoke it when you're done.
                </p>
              </div>
            )}

            <Button
              className="w-full gap-2"
              disabled={!url.trim() || running || notEnoughCredits}
              onClick={() => auditMutation.mutate({ repoUrl: url, token: token.trim() || undefined })}
              data-testid="button-audit-repo"
            >
              {auditMutation.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Nova is reading your code…</>
                : <><ScanSearch className="h-4 w-4" /> Audit this repository ({CREDIT_COSTS.codeAudit})</>}
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="space-y-1.5">
            <label className="block">
              <input
                type="file" accept=".zip" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleZip(f); }}
                data-testid="input-audit-zip"
              />
              <Button asChild variant="outline" className="w-full gap-2" disabled={running || notEnoughCredits}>
                <span>
                  {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Upload a .zip of your project ({CREDIT_COSTS.codeAudit})
                </span>
              </Button>
            </label>
            <p className="text-[10px] text-muted-foreground">
              node_modules, build output and lockfiles are ignored, so you can zip the whole folder.
            </p>
          </div>

          {notEnoughCredits && (
            <p className="text-xs text-destructive">
              An audit costs {CREDIT_COSTS.codeAudit} credits and you have {creditsRemaining}.
            </p>
          )}
        </CardContent>
      </Card>

      {/* --- Result --- */}
      {auditLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : !audit ? (
        <Card>
          <CardContent className="p-8 text-center">
            <FileCode className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-40" />
            <p className="text-sm font-medium">No audit yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Point Nova at your repository and it'll tell you where the project actually is —
              not where the board says it is.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card data-testid="card-audit-result">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start gap-4 flex-wrap">
              <div className="shrink-0">
                <p className="text-3xl font-bold" data-testid="text-audit-completion">{audit.completionPercent}%</p>
                <p className="text-xs text-muted-foreground">built</p>
              </div>
              <div className="flex-1 min-w-[14rem] space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={STAGE_STYLE[audit.stage || ""]?.className || ""} data-testid="badge-audit-stage">
                    {STAGE_STYLE[audit.stage || ""]?.label || audit.stage}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground font-mono truncate">{audit.source}</span>
                </div>
                <Progress value={audit.completionPercent || 0} className="h-2" />
                {findings.stackSummary && (
                  <p className="text-xs text-muted-foreground">{findings.stackSummary}</p>
                )}
              </div>
            </div>

            <p className="text-sm text-secondary leading-relaxed" data-testid="text-audit-summary">{audit.summary}</p>

            {/* Runtime: is it running, not just written. */}
            {runtime && (
              <div className="rounded-md border border-border/60 p-2.5 text-xs space-y-1" data-testid="audit-runtime">
                <p className="font-medium text-sm">Running?</p>
                {[
                  ["Live URL", runtime.liveUrl], ["Health", runtime.health],
                ].map(([label, r]: any) => (
                  <p key={label} className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${!r ? "bg-muted-foreground/40" : r.ok ? "bg-emerald-500" : "bg-rose-500"}`} />
                    <span className="font-medium">{label}:</span>
                    <span className="text-muted-foreground">{!r ? "no public URL to probe" : r.ok ? `${r.status} in ${r.ms}ms` : `not answering (${r.status ?? r.error ?? "no response"})`}</span>
                  </p>
                ))}
                {runtime.surfaces && <p className="text-muted-foreground">Kill switches: {runtime.surfaces.loaded ? "loaded" : "not loaded"}, {runtime.surfaces.enabled} on{runtime.surfaces.off?.length ? `, off: ${runtime.surfaces.off.join(", ")}` : ""}</p>}
                <p className="text-muted-foreground">Env: {runtime.env.setHere.length}/{runtime.env.referenced} referenced variables set on the {runtime.env.instance} instance{runtime.env.missingHere?.length ? ` · not set: ${runtime.env.missingHere.slice(0, 8).join(", ")}${runtime.env.missingHere.length > 8 ? " …" : ""}` : ""}</p>
              </div>
            )}

            {/* The data map: the live database as a star, sized by rows. */}
            {dataShape && (
              <div className="rounded-md border border-border/60 p-2.5 space-y-2" data-testid="audit-data">
                <p className="font-medium text-sm">Your data</p>
                <DataMap shape={dataShape} />
              </div>
            )}

            {/* Velocity: what moved since the last audit. */}
            {delta && (
              <div className="rounded-md border border-border/60 p-2.5 text-xs space-y-1" data-testid="audit-delta">
                <p className="font-medium text-sm">{delta.previousAuditId ? `Since the last audit (${delta.daysSince} days ago)` : "First audit"}</p>
                {delta.previousAuditId ? (
                  <>
                    <p className="text-muted-foreground">{delta.changed ? "The code moved." : "No meaningful change in the code."}</p>
                    <p>Routes {delta.routes.before}→{delta.routes.after}{delta.routes.added.length ? ` · added ${delta.routes.added.slice(0, 6).join(", ")}${delta.routes.added.length > 6 ? ` +${delta.routes.added.length - 6}` : ""}` : ""}</p>
                    <p>Tables {delta.tables.before}→{delta.tables.after}{delta.tables.added.length ? ` · added ${delta.tables.added.join(", ")}` : ""}</p>
                    <p>Tests {delta.tests.before}→{delta.tests.after} files · lines {delta.linesOfCode.before.toLocaleString()}→{delta.linesOfCode.after.toLocaleString()} · completion {delta.completionPercent.before ?? "?"}%→{delta.completionPercent.after ?? "?"}%</p>
                    {delta.areas.length > 0 && <p>Areas moved: {delta.areas.map((a: any) => `${areaLabel(a.area)} ${a.from}→${a.to}`).join("; ")}</p>}
                    {delta.coverage && <p>Writes rate-limited {delta.coverage.writesRateLimited[0]}→{delta.coverage.writesRateLimited[1]} of {delta.coverage.writes[1]} · costly metered {delta.coverage.costlyMetered[0]}→{delta.coverage.costlyMetered[1]}</p>}
                  </>
                ) : <p className="text-muted-foreground">Run another audit later and this shows what moved.</p>}
              </div>
            )}

            {/* Deterministic scan facts — measured, not inferred. */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { icon: FileCode, label: "lines of code", value: (scan.linesOfCode || 0).toLocaleString() },
                { icon: RouteIcon, label: "routes found", value: scan.routeCount ?? 0 },
                { icon: Database, label: "data models", value: scan.dataModels?.length ?? 0 },
                { icon: FlaskConical, label: "test files", value: scan.testFiles ?? 0 },
              ].map((stat) => (
                <div key={stat.label} className="rounded-md border border-border/60 bg-muted/30 p-2.5">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <stat.icon className="h-3 w-3" />
                    <span className="text-[10px]">{stat.label}</span>
                  </div>
                  <p className="text-lg font-semibold tabular-nums">{stat.value}</p>
                </div>
              ))}
            </div>

            {/* A committed credential is the one finding that can't wait. */}
            {scan.suspectedSecrets?.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-rose-500/50 bg-rose-500/10 p-3" data-testid="alert-secrets">
                <ShieldAlert className="h-4 w-4 text-rose-500 mt-0.5 shrink-0" />
                <div className="text-sm min-w-0">
                  <p className="font-medium">Possible credentials committed to the repository</p>
                  <ul className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
                    {scan.suspectedSecrets.slice(0, 5).map((s: any, i: number) => (
                      <li key={i}><span className="font-mono break-all">{s.file}</span> — {s.hint}</li>
                    ))}
                  </ul>
                  <p className="text-xs mt-1">Rotate them, then remove them from the file and from git history.</p>
                </div>
              </div>
            )}

            {findings.nextThreeThings?.length > 0 && (
              <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">Do these next</p>
                {findings.nextThreeThings.map((thing: string, i: number) => (
                  <p key={i} className="text-sm flex items-start gap-2">
                    <span className="h-4 w-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5">{i + 1}</span>
                    <span>{thing}</span>
                  </p>
                ))}
              </div>
            )}

            {/* --- Reconciliation: the reason this exists --- */}
            {(findings.taskReconciliation?.looksDone?.length > 0 || findings.milestones?.length > 0) && (
              <Section title="Plan vs code" icon={Boxes} defaultOpen
                count={(findings.taskReconciliation?.looksDone?.length || 0) + (findings.milestones?.length || 0)}>
                {findings.taskReconciliation?.looksDone?.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium">Open tasks the code says are finished</p>
                    {findings.taskReconciliation.looksDone.map((t: any, i: number) => (
                      <div key={i} className="flex items-start gap-1.5 text-xs">
                        <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0 text-emerald-500" />
                        <span className="min-w-0"><span>{t.title}</span> <Evidence paths={t.evidence} /></span>
                      </div>
                    ))}
                  </div>
                )}
                {findings.taskReconciliation?.notStarted?.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium">No supporting code found</p>
                    {findings.taskReconciliation.notStarted.map((t: any, i: number) => (
                      <div key={i} className="flex items-start gap-1.5 text-xs">
                        <XCircle className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">{t.title}{t.why ? <span className="text-muted-foreground"> — {t.why}</span> : null}</span>
                      </div>
                    ))}
                  </div>
                )}
                {findings.milestones?.length > 0 && (
                  <div className="space-y-1 pt-1">
                    <p className="text-xs font-medium">Milestones, judged from the code</p>
                    {findings.milestones.map((m: any, i: number) => {
                      const v = VERDICT_STYLE[m.verdict] || VERDICT_STYLE["not-started"];
                      return (
                        <div key={i} className="flex items-start gap-1.5 text-xs">
                          <v.icon className={`h-3 w-3 mt-0.5 shrink-0 ${v.className}`} />
                          <span className="min-w-0"><strong>{m.title}</strong> — {v.label}. <span className="text-muted-foreground">{m.why}</span></span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Section>
            )}

            {findings.capabilities?.length > 0 && (
              <Section title="What the code already has" count={findings.capabilities.filter((c: CapabilityEntry) => c.status === "built").length} icon={CheckCircle2} defaultOpen>
                <div className="space-y-1.5" data-testid="capability-inventory">
                  {(findings.capabilities as CapabilityEntry[]).map((c) => (
                    <div key={c.area} className="flex items-start gap-2 text-sm" data-testid={`capability-${c.area}`}>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 mt-0.5 ${
                        c.status === "built" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                        : c.status === "partial" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                        : c.status === "missing" ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
                        : "bg-muted text-muted-foreground"}`}>{c.status}</span>
                      <div className="min-w-0">
                        <p className="font-medium">{areaLabel(c.area)}</p>
                        {c.summary && <p className="text-muted-foreground">{c.summary}</p>}
                        {c.missing && <p className="text-muted-foreground">Missing: {c.missing}</p>}
                        {c.detail?.coverage && <p className="text-sm" data-testid={`coverage-${c.area}`}>{c.detail.coverage}</p>}
                        {c.detail?.gaps?.length ? (
                          <ul className="text-xs space-y-0.5 mt-1" data-testid={`gaps-${c.area}`}>
                            {c.detail.gaps.map((g, i) => (
                              <li key={i} className="flex items-start gap-1.5">
                                <span className={`shrink-0 mt-1 h-1.5 w-1.5 rounded-full ${g.severity === "high" ? "bg-rose-500" : g.severity === "medium" ? "bg-amber-500" : "bg-muted-foreground/50"}`} />
                                <span>{g.item}{g.file && <code className="ml-1 text-[10px] text-muted-foreground">{g.file}</code>}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {c.evidence.length > 0 && <p className="text-xs text-muted-foreground truncate">{c.evidence.map((e) => e.route ? `${e.route} · ${e.file}` : e.file).join(" · ")}</p>}
                        {c.note && <p className="text-xs text-amber-700 dark:text-amber-400">{c.note}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}
            {findings.risks?.length > 0 && (
              <Section title="Risks" count={findings.risks.length} icon={AlertTriangle} defaultOpen>
                {findings.risks.map((r: any, i: number) => {
                  const sev = SEVERITY_STYLE[r.severity] || SEVERITY_STYLE.medium;
                  return (
                    <div key={i} className="space-y-0.5" data-testid={`audit-risk-${i}`}>
                      <p className="text-xs font-medium flex items-center gap-1.5">
                        <sev.icon className={`h-3 w-3 shrink-0 ${sev.className}`} />
                        {r.area}
                        <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{r.severity}</span>
                      </p>
                      <p className="text-xs text-muted-foreground pl-4.5">{r.finding}</p>
                      {r.recommendation && <p className="text-xs pl-4.5"><span className="text-muted-foreground">Fix:</span> {r.recommendation}</p>}
                      <div className="pl-4.5"><Evidence paths={r.evidence} /></div>
                    </div>
                  );
                })}
              </Section>
            )}

            {findings.built?.length > 0 && (
              <Section title="Built" count={findings.built.length} icon={CheckCircle2}>
                {findings.built.map((b: any, i: number) => (
                  <div key={i} className="text-xs">
                    <span className="text-emerald-600 dark:text-emerald-400">✓</span> {b.item} <Evidence paths={b.evidence} />
                  </div>
                ))}
              </Section>
            )}

            {findings.partial?.length > 0 && (
              <Section title="Partly built" count={findings.partial.length} icon={CircleDot}>
                {findings.partial.map((b: any, i: number) => (
                  <div key={i} className="text-xs space-y-0.5">
                    <p className="font-medium">{b.item}</p>
                    <p className="text-muted-foreground">Has: {b.exists}</p>
                    <p>Needs: {b.missing}</p>
                    <Evidence paths={b.evidence} />
                  </div>
                ))}
              </Section>
            )}

            {findings.missing?.length > 0 && (
              <Section title="Missing" count={findings.missing.length} icon={XCircle}>
                {findings.missing.map((b: any, i: number) => (
                  <div key={i} className="text-xs">
                    <p className="font-medium">{b.item}</p>
                    <p className="text-muted-foreground">{b.matters}</p>
                  </div>
                ))}
              </Section>
            )}

            {findings.undocumented?.length > 0 && (
              <Section title="In the code but not in the plan" count={findings.undocumented.length} icon={Boxes}>
                {findings.undocumented.map((b: any, i: number) => (
                  <div key={i} className="text-xs">{b.item} <Evidence paths={b.evidence} /></div>
                ))}
              </Section>
            )}

            {scan.routes?.length > 0 && (
              <Section title="Routes found in the code" count={scan.routeCount} icon={RouteIcon}>
                <div className="flex flex-wrap gap-1">
                  {scan.routes.slice(0, 60).map((r: any, i: number) => (
                    <Badge key={i} variant="outline" className="text-[9px] font-mono font-normal">{r.label}</Badge>
                  ))}
                </div>
              </Section>
            )}

            {scan.dataModels?.length > 0 && (
              <Section title="Data models" count={scan.dataModels.length} icon={Database}>
                <div className="flex flex-wrap gap-1">
                  {scan.dataModels.map((m: any, i: number) => (
                    <Badge key={i} variant="outline" className="text-[9px] font-mono font-normal">{m.name}</Badge>
                  ))}
                </div>
              </Section>
            )}

            {/* --- Apply --- */}
            <div className="border-t border-border/50 pt-3 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-muted-foreground">
                Audited {new Date(audit.createdAt).toLocaleString()}
                {scan.truncated && " · partial scan (repository over the size budget)"}
              </p>
              {audit.appliedAt ? (
                <Badge variant="secondary" className="gap-1 text-[10px]">
                  <Check className="h-3 w-3" /> Applied {new Date(audit.appliedAt).toLocaleDateString()}
                </Badge>
              ) : (Array.isArray(audit.operations) && audit.operations.length > 0) ? (
                <Button
                  size="sm" className="gap-1.5"
                  disabled={applyMutation.isPending}
                  onClick={() => applyMutation.mutate()}
                  data-testid="button-apply-audit"
                >
                  {applyMutation.isPending
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating…</>
                    : <><Wand2 className="h-3.5 w-3.5" /> Make my board match the code ({(audit.operations as unknown[]).length})</>}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}

      {/* --- History --- */}
      {(audits?.length || 0) > 1 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Earlier audits</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {audits!.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`w-full text-left rounded-md p-2 text-xs transition-colors ${
                  a.id === latestId ? "bg-primary/10 border border-primary/40" : "hover:bg-muted border border-transparent"
                }`}
                onClick={() => setSelectedId(a.id)}
                data-testid={`audit-history-${a.id}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {a.sourceKind === "github" ? <Github className="h-3 w-3 shrink-0" /> : <Upload className="h-3 w-3 shrink-0" />}
                  <span className="font-medium">{a.completionPercent}% · {a.stage}</span>
                  <span className="text-muted-foreground truncate">{a.source}</span>
                  <span className="text-muted-foreground ml-auto shrink-0">{new Date(a.createdAt).toLocaleDateString()}</span>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
