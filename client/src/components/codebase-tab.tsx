import { areaLabel, capabilityCounts, CAPABILITY_STATUS_LABEL, type CapabilityEntry } from "@shared/capabilities";
import { EDITOR_BRIDGE_READY, COMING_SOON } from "@shared/not-ready";
import { describeProvenance, type AuditProvenance } from "@shared/audit-provenance";
import type { AuditDelta } from "@shared/audit-delta";
import { DataSourceCard } from "@/components/data-source-card";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useConfirmPurchase } from "@/components/payment-dialog";
import { useEntitlements } from "@/hooks/use-entitlements";
import { useUpload } from "@/hooks/use-upload";
import {
  Loader2, Github, Upload, ScanSearch, CheckCircle2, AlertTriangle, XCircle,
  CircleDot, FileCode, Lock, ChevronDown, ChevronRight, Wand2, ShieldAlert,
  Route as RouteIcon, Database, FlaskConical, Check, Terminal, ArrowRight, History,
  HelpCircle,
} from "lucide-react";
import { OUTCOME_PRICE_CENTS, formatMoney } from "@shared/plans";
import { LOOP_TYPE_INFO, type LoopClosureRead } from "@shared/phase-trees";
import { AuditCatchUp, PathChanges, refreshAfterCatchUp } from "@/components/audit-catchup";
import { SecurityReportPanel } from "@/components/security-report";
import type { ProjectCodeAudit } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { useAuditStatus, quietAuditErrors, auditStageLabel, auditSourceLabel, formatElapsed, auditStatusKey } from "@/lib/audit-status";
import { LiveDot, NOVA_GRADIENT, Working } from "@/components/nova";

interface AuditListItem {
  id: string;
  source: string;
  sourceKind: "github" | "upload" | "worktree";
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

/** How often the tab re-reads the audit list while it's open, so reads from the editor bridge or a teammate show up. */
const IDLE_POLL_MS = 30_000;
/** …and while a read is running. */
const RUNNING_POLL_MS = 4_000;
/** The three stages a run reports, in order, with the words the panel shows for each. */
const AUDIT_STAGES = ["fetching", "reading", "saving"].map((id) => ({ id, label: auditStageLabel(id) }));

const STAGE_STYLE: Record<string, { label: string; className: string }> = {
  empty: { label: "Empty", className: "bg-slate-500/10 text-slate-600 border-slate-500/30" },
  scaffold: { label: "Scaffold", className: "bg-slate-500/10 text-slate-600 border-slate-500/30" },
  prototype: { label: "Prototype", className: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
  mvp: { label: "MVP", className: "bg-blue-500/10 text-blue-700 border-blue-500/30" },
  beta: { label: "Beta", className: "bg-violet-500/10 text-violet-700 border-violet-500/30" },
  production: { label: "Production", className: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" },
};

const SEVERITY_BADGE: Record<string, string> = {
  high: "bg-rose-500/10 text-rose-700 border-rose-500/30",
  medium: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  low: "bg-muted text-muted-foreground border-black/[0.08] dark:border-white/10",
};

const STATUS_BADGE: Record<string, string> = {
  built: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  complete: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  closed: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  partial: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  "in-progress": "bg-blue-500/10 text-blue-700 border-blue-500/30",
  open: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  missing: "bg-rose-500/10 text-rose-700 border-rose-500/30",
  /*
   * Not a gap, and it must not look like one. "unknown" means the audit never
   * read the files that would answer — a question for the builder, not work —
   * so it gets its own quiet, dashed treatment rather than the red of missing.
   */
  unknown: "bg-sky-500/10 text-sky-700 border-sky-500/40 border-dashed",
  "not-started": "bg-muted text-muted-foreground border-black/[0.08] dark:border-white/10",
  "not built": "bg-muted text-muted-foreground border-black/[0.08] dark:border-white/10",
};

// --- Small pieces ------------------------------------------------------------

/** Re-renders every `ms`, for relative times that stay true while the tab is open. */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function ago(when: string | number | Date | null | undefined, now: number): string {
  if (!when) return "Never";
  const s = Math.max(0, Math.round((now - new Date(when).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(when).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "github:owner/repo@main" → { kind, name }. */
function parseSource(source: string | null | undefined, kind?: string | null) {
  const raw = String(source ?? "");
  const body = raw.includes(":") ? raw.slice(raw.indexOf(":") + 1) : raw;
  const k = kind ?? raw.split(":")[0];
  if (k === "github") return { kind: "github" as const, label: "GitHub", name: body.split("@")[0] || body, ref: body.split("@")[1] ?? null };
  if (k === "worktree") return { kind: "worktree" as const, label: "Editor bridge", name: body, ref: null };
  return { kind: "upload" as const, label: "Zip upload", name: body, ref: null };
}

const Pill = ({ className = "", children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`} {...rest}>{children}</span>
);

/** A block of the tab, separated from the next by a line. */
function Block({ title, count, action, children, testId, innerRef }: {
  title: string; count?: ReactNode; action?: ReactNode; children: ReactNode; testId?: string; innerRef?: React.Ref<HTMLElement>;
}) {
  return (
    <section ref={innerRef} className="px-4 sm:px-6 py-5 space-y-3 scroll-mt-4" data-testid={testId}>
      <div className="flex items-center gap-2 min-h-[1.75rem]">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        {count !== undefined && <span className="text-[11px] tabular-nums text-muted-foreground/80">{count}</span>}
        {action && <div className="ml-auto flex items-center gap-1.5">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** One line; the rest behind a chevron. */
function Row({ lead, title, meta, children, testId, defaultOpen = false }: {
  lead?: ReactNode; title: ReactNode; meta?: ReactNode; children?: ReactNode; testId?: string; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const expandable = !!children;
  return (
    <li className="py-2" data-testid={testId}>
      <button
        type="button"
        className={`w-full flex items-center gap-2 text-left text-sm ${expandable ? "cursor-pointer" : "cursor-default"}`}
        onClick={() => expandable && setOpen((o) => !o)}
        aria-expanded={expandable ? open : undefined}
      >
        {lead}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {meta}
        {expandable ? (open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />) : <span className="w-3.5" />}
      </button>
      {expandable && open && <div className="mt-1.5 ml-1 pl-3 border-l border-black/[0.08] dark:border-white/10 space-y-1 text-xs text-muted-foreground">{children}</div>}
    </li>
  );
}

/** A group of findings: a header with its count, closed until asked for. */
function Group({ title, icon: Icon, count, tone, children, defaultOpen = false, testId }: {
  title: string; icon: any; count: ReactNode; tone?: string; children: ReactNode; defaultOpen?: boolean; testId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div data-testid={testId}>
      <button
        type="button"
        className="w-full flex items-center gap-2 py-2.5 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid={`section-${title.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <Icon className={`h-4 w-4 shrink-0 ${tone ?? "text-muted-foreground"}`} />
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5 ml-auto text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 ml-auto text-muted-foreground" />}
      </button>
      {open && <ul className="pb-2 pl-6 divide-y divide-black/[0.08] dark:divide-white/10">{children}</ul>}
    </div>
  );
}

const Evidence = ({ paths }: { paths?: string[] }) =>
  paths?.length ? <p className="font-mono text-[10px] break-all">{paths.slice(0, 3).join(" · ")}</p> : null;

const Stat = ({ icon: Icon, label, value, testId }: { icon: any; label: string; value: ReactNode; testId?: string }) => (
  <div className="min-w-0">
    <p className="text-lg font-semibold tabular-nums leading-tight" data-testid={testId}>{value}</p>
    <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Icon className="h-3 w-3" />{label}</p>
  </div>
);

const change = (before: number | null | undefined, after: number | null | undefined) => {
  const d = (after ?? 0) - (before ?? 0);
  return d === 0 ? null : <span className={d > 0 ? "text-emerald-600" : "text-rose-600"}>{d > 0 ? `+${d.toLocaleString()}` : d.toLocaleString()}</span>;
};

// --- The tab -----------------------------------------------------------------

export function CodebaseTab({ projectId, repoUrl, isOwner = false }: { projectId: string; repoUrl?: string | null; isOwner?: boolean }) {
  const { toast } = useToast();
  const confirmPurchase = useConfirmPurchase();
  const { can } = useEntitlements();
  const { uploadFile, isUploading } = useUpload();

  const [url, setUrl] = useState(repoUrl || "");
  const [token, setToken] = useState("");
  const [tokenOpen, setTokenOpen] = useState(false);
  const [check, setCheck] = useState<RepoCheck | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  /** The newest audit id this tab has seen; a different one on a poll is a read from elsewhere. */
  const seenNewest = useRef<string | null | undefined>(undefined);
  const connectionRef = useRef<HTMLElement>(null);
  const pathRef = useRef<HTMLElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const repoInput = useRef<HTMLInputElement>(null);

  const isBuilder = can("aiMilestones");
  /*
   * An audit is not paid for in credits, and never was in this pricing.
   *
   * `CHARGE_FOR.codeAudit` is a priced outcome: five dollars off the balance,
   * taken by `requireCredits` at the route. It does not touch the month's free
   * Nova actions at all. This gate compared those free actions against
   * `CREDIT_COSTS.codeAudit` (8) from the retired subscription model, so the
   * button went dead once somebody had spent eighteen of their twenty-five
   * free actions on anything — a different budget entirely — however much
   * money was on the account. Reported as "I have credits and funds and cannot
   * audit", which is exactly what it did.
   *
   * Nothing replaces it. A priced outcome that cannot be afforded answers 402
   * and the payment dialog opens on it, with the price, the balance and a way
   * to pay in one tap. Disabling the button instead tells somebody they cannot
   * do it, does not say why, and offers no way to fix it.
   */
  const auditPrice = formatMoney(OUTCOME_PRICE_CENTS.codeAudit);

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

  const auditMutation = useMutation({
    mutationFn: async (payload: { repoUrl?: string; token?: string; objectPath?: string; fileName?: string }) => {
      // Priced: asked before it spends, never after. See payment-dialog.
      if (!(await confirmPurchase("codeAudit", { projectId }))) return null;
      const res = await apiRequest("POST", `/api/projects/${projectId}/code-audit`, payload);
      return res.json() as Promise<{ audit: ProjectCodeAudit; creditsCharged: number; autoApplied: { changes: string[]; skipped: string[] } | null }>;
    },
    onMutate: () => {
      // The run is recorded as the request starts: look for it straight away, and leave a failure's toast to this screen.
      quietAuditErrors(projectId, 15 * 60_000);
      setTimeout(() => queryClient.invalidateQueries({ queryKey: auditStatusKey(projectId) }), 800);
    },
    onSuccess: (result) => {
      if (!result) return;  // They cancelled at the price.
      seenNewest.current = result.audit.id;
      setSelectedId(null);
      setEditingSource(false);
      queryClient.setQueryData(["/api/code-audits", result.audit.id], result.audit);
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
      // The read moves the path even when nothing was auto-applied: path status reads the audit's waiting changes.
      refreshAfterCatchUp(projectId, result.audit.id);
      const n = result.autoApplied?.changes.length ?? 0;
      /*
       * `creditsCharged` is always 0 now and the audit is paid for in dollars
       * (`chargedCents`), so this printed "72% built · 0 credits" after taking
       * $5. The server sends both precisely so a client can stop saying
       * credits; this one had not.
       */
      toast({
        title: "Code read",
        description: `${result.audit.completionPercent}% built${n ? ` · Nova updated ${n}` : ""}`,
      });
    },
    onError: (err: any) => {
      const { message, upgrade } = describeError(err, "The audit failed.");
      toast({ title: upgrade ? "Builder plan needed" : "Audit failed", description: message, variant: upgrade ? "default" : "destructive" });
    },
    onSettled: () => {
      quietAuditErrors(projectId, 30_000);
      queryClient.invalidateQueries({ queryKey: auditStatusKey(projectId) });
    },
  });
  const { user } = useAuth();
  /** The run on the server — started here, from the editor bridge or by a teammate. */
  const status = useAuditStatus(projectId, { expectRunning: auditMutation.isPending });
  const serverRun = status.running;
  const running = auditMutation.isPending || isUploading || !!serverRun;

  // Live: fast while a read runs, a slow heartbeat otherwise, and on focus.
  const auditsQuery = useQuery<AuditListItem[]>({
    queryKey: ["/api/projects", projectId, "code-audits"],
    enabled: !!projectId,
    refetchInterval: running ? RUNNING_POLL_MS : IDLE_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
  const audits = auditsQuery.data;
  const newest = audits?.[0] ?? null;
  const latestId = selectedId || newest?.id || null;
  const viewingOlder = !!selectedId && selectedId !== newest?.id;

  const { data: audit, isLoading: auditLoading } = useQuery<ProjectCodeAudit>({
    queryKey: ["/api/code-audits", latestId],
    queryFn: async () => {
      const res = await fetch(`/api/code-audits/${latestId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Couldn't load that audit");
      return res.json();
    },
    enabled: !!latestId,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });

  const { data: tokenData } = useQuery<{ tokens: { projectId: string | null }[] }>({ queryKey: ["/api/mcp-tokens"], staleTime: 60_000 });
  const editorTokens = (tokenData?.tokens ?? []).filter((t) => !t.projectId || t.projectId === projectId).length;

  /*
   * A read that lands from somewhere else — the editor bridge, MCP, a
   * teammate — shows up on the next poll. Jump to it and move the path.
   */
  useEffect(() => {
    if (audits === undefined) return;
    const id = newest?.id ?? null;
    if (seenNewest.current === undefined) { seenNewest.current = id; return; }
    if (id && id !== seenNewest.current) {
      seenNewest.current = id;
      setSelectedId(null);
      refreshAfterCatchUp(projectId, id);
      if (!auditMutation.isPending) {
        const src = parseSource(newest?.source, newest?.sourceKind);
        toast({ title: "New code read", description: `${src.label} · ${newest?.completionPercent ?? "?"}% built. Your path is updated.` });
      }
    }
  }, [newest?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Changes applied elsewhere (a teammate, auto-apply) re-read the open audit and the path.
  const appliedSig = audits?.find((a) => a.id === latestId)?.appliedAt ?? null;
  const lastApplied = useRef(appliedSig);
  useEffect(() => {
    if (appliedSig !== lastApplied.current) {
      lastApplied.current = appliedSig;
      if (latestId) refreshAfterCatchUp(projectId, latestId);
    }
  }, [appliedSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // A repo read before is the one to read again.
  useEffect(() => {
    if (url || !audits) return;
    const gh = audits.find((a) => a.sourceKind === "github");
    const name = gh ? parseSource(gh.source, gh.sourceKind).name : null;
    if (name) setUrl(`https://github.com/${name}`);
  }, [audits]); // eslint-disable-line react-hooks/exhaustive-deps

  const now = useNow(running ? 1_000 : 20_000);

  /** Validates the repo before any credits are spent on it. */
  const checkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/code-audit/check-repo`, { repoUrl: url, token: token.trim() || undefined });
      return res.json() as Promise<RepoCheck>;
    },
    onSuccess: (result) => setCheck(result),
    onError: (err: any) => {
      setCheck(null);
      toast({ title: "Can't reach that repository", description: describeError(err, "Check the URL.").message, variant: "destructive" });
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
        description: result.skipped.length ? `${result.skipped.length} skipped.` : undefined,
      });
      refreshAfterCatchUp(projectId, latestId);
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

  const runRepo = () => auditMutation.mutate({ repoUrl: url, token: token.trim() || undefined });
  const openConnection = () => {
    setEditingSource(true);
    requestAnimationFrame(() => {
      connectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      repoInput.current?.focus();
    });
  };

  const findings = (audit?.findings as any) || {};
  const scan = findings.scan || {};
  type Probe = { url: string; ok: boolean; status: number | null; ms: number; error?: string } | null;
  const runtime = ((audit as any)?.runtime ?? null) as { liveUrl: Probe; health: Probe; surfaces: { loaded: boolean; enabled: number; off: string[] } | null; env: { referenced: number; setThere: string[] | null; missingThere: string[] | null; note: string } } | null;
  const delta = ((audit as any)?.delta ?? null) as AuditDelta | null;
  const ops = (Array.isArray(audit?.operations) ? audit!.operations : []) as any[];
  const waiting = !viewingOlder ? ops.filter((o) => !o?._status || o._status === "pending").length : 0;

  const source = newest ? parseSource(newest.source, newest.sourceKind) : null;
  const connected = !!newest || !!check;
  const showForm = !connected || editingSource;

  // --- The one thing to do now ---
  let primary: ReactNode;
  if (running) {
    primary = <Button className="w-full sm:w-auto gap-2" disabled><Loader2 className="h-4 w-4 animate-spin" />Reading…</Button>;
  } else if (!connected && !url.trim()) {
    primary = <Button className="w-full sm:w-auto gap-2" onClick={openConnection} data-testid="button-primary-connect"><Github className="h-4 w-4" />Connect repo</Button>;
  } else if (waiting > 0) {
    primary = (
      <Button className="w-full sm:w-auto gap-2" onClick={() => pathRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} data-testid="button-primary-review">
        <Wand2 className="h-4 w-4" />Review {waiting} waiting change{waiting === 1 ? "" : "s"}
      </Button>
    );
  } else if (url.trim()) {
    primary = (
      <Button className="w-full sm:w-auto gap-2" onClick={runRepo} data-testid="button-primary-audit">
        <ScanSearch className="h-4 w-4" />{newest ? "Read the code again" : "Run an audit"}
        <span className="text-[11px] opacity-80">· {auditPrice}</span>
      </Button>
    );
  } else {
    primary = (
      <Button className="w-full sm:w-auto gap-2" onClick={() => zipInput.current?.click()} data-testid="button-primary-zip">
        <Upload className="h-4 w-4" />Upload a new zip
        <span className="text-[11px] opacity-80">· {auditPrice}</span>
      </Button>
    );
  }

  // Elapsed as the server counted it, ticking on between polls.
  const elapsed = serverRun ? serverRun.elapsedSeconds + Math.max(0, Math.round((now - status.dataUpdatedAt) / 1000)) : 0;
  const runFrom = serverRun ? auditSourceLabel(serverRun.source) : null;
  const runBy = serverRun?.startedBy
    ? serverRun.startedBy.id === user?.id ? "You" : serverRun.startedBy.firstName || "A teammate"
    : null;
  const runWho = serverRun
    ? [runBy ? `${runBy} started it` : "Started", runFrom ? `from ${runFrom}` : null].filter(Boolean).join(" ")
    : null;

  const loops = (findings.loops ?? []) as LoopClosureRead[];
  const closedLoops = loops.filter((l) => l.closure === "closed").length;
  const capabilities = (findings.capabilities ?? []) as CapabilityEntry[];
  const capCounts = capabilityCounts(capabilities);
  /*
   * What the audit actually read. Shown in the header rather than buried in
   * "Details", because everything below it is only as true as this line: an
   * audit of last Tuesday's zip and an audit of today's tree look identical
   * once they're a percentage and a list of gaps.
   */
  const provenance = (scan.provenance ?? null) as AuditProvenance | null;
  const risks = (findings.risks ?? []) as any[];
  const highRisks = risks.filter((r) => r.severity === "high").length;
  const looksDone = findings.taskReconciliation?.looksDone ?? [];
  const notStarted = findings.taskReconciliation?.notStarted ?? [];
  const milestoneVerdicts = findings.milestones ?? [];
  const hasFindings = risks.length || loops.length || capabilities.length || looksDone.length || milestoneVerdicts.length
    || findings.built?.length || findings.partial?.length || findings.missing?.length || findings.undocumented?.length
    || scan.routes?.length || scan.dataModels?.length || findings.nextThreeThings?.length;

  return (
    <div className="max-w-4xl rounded-xl border border-black/10 dark:border-white/10 bg-background shadow-sm divide-y divide-black/[0.08] dark:divide-white/10" data-testid="codebase-tab">
      {/* hidden file input shared by every zip button */}
      <input
        ref={zipInput} type="file" accept=".zip" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleZip(f); e.target.value = ""; }}
        data-testid="input-audit-zip"
      />

      {/* --- At a glance: connected? last read? what now? --- */}
      <div className="px-4 sm:px-6 py-5 space-y-4" data-testid="codebase-glance">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-4 sm:gap-0 sm:divide-x divide-black/[0.08] dark:divide-white/10">
          <div className="min-w-0 sm:pr-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Code</p>
            <div className="mt-1 flex items-center gap-2 min-w-0" data-testid="glance-connection">
              {source ? (
                <>
                  {source.kind === "github" ? <Github className="h-4 w-4 shrink-0" /> : source.kind === "worktree" ? <Terminal className="h-4 w-4 shrink-0" /> : <Upload className="h-4 w-4 shrink-0" />}
                  <span className="text-sm font-medium truncate" title={newest?.source}>{source.name || source.label}</span>
                </>
              ) : check ? (
                <><Github className="h-4 w-4 shrink-0" /><span className="text-sm font-medium truncate">{check.fullName}</span></>
              ) : (
                <><span className="h-2 w-2 rounded-full bg-muted-foreground/40" /><span className="text-sm font-medium">Not connected</span></>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground truncate">
              {source ? source.label : check ? "Checked, not read yet" : "Repo, zip or editor"}
              {editorTokens > 0 && " · editor linked"}
            </p>
          </div>

          <div className="min-w-0 sm:px-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Last read</p>
            <p className="mt-1 text-sm font-medium" data-testid="glance-last-read">{running ? "Reading now" : newest ? ago(newest.createdAt, now) : "Never"}</p>
            <p className="mt-0.5 text-xs text-muted-foreground flex items-center gap-1.5" title="Checks for new reads every 30 seconds and when you come back to this tab">
              <LiveDot active={!auditsQuery.isError} />
              {auditsQuery.isError ? "Offline" : `Live · synced ${ago(auditsQuery.dataUpdatedAt, now)}`}
            </p>
          </div>

          <div className="sm:pl-5 flex flex-col justify-center gap-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:hidden">Do now</p>
            {primary}
          </div>
        </div>

        {running && (
          <Working
            testId="audit-running"
            stages={AUDIT_STAGES}
            current={serverRun?.stage ?? null}
            /*
             * The upload happens in this browser before a run row exists, so
             * the server has no stage for it and the panel would otherwise
             * claim the fetch had started.
             */
            saying={isUploading ? "Uploading the zip" : serverRun ? null : "Starting the read"}
            meta={serverRun && (
              <>
                <span className="truncate" data-testid="audit-running-who">{runWho}</span>
                <span className="tabular-nums" data-testid="audit-running-elapsed">· {formatElapsed(elapsed)}</span>
              </>
            )}
          />
        )}

        {!isBuilder && (
          <p className="flex items-center gap-1.5 text-xs text-amber-700"><Lock className="h-3.5 w-3.5" />Audits are on the Builder plan.</p>
        )}
      </div>

      {/* --- Connection --- */}
      <Block
        title="Connection" testId="codebase-connection" innerRef={connectionRef}
        action={connected && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingSource((v) => !v)} data-testid="button-change-source">
            {editingSource ? "Done" : "Change"}
          </Button>
        )}
      >
        {!showForm ? (
          <ul className="divide-y divide-black/[0.08] dark:divide-white/10 text-sm">
            <li className="flex items-center gap-2 py-2">
              {source?.kind === "worktree" ? <Terminal className="h-4 w-4 text-muted-foreground" /> : source?.kind === "upload" ? <Upload className="h-4 w-4 text-muted-foreground" /> : <Github className="h-4 w-4 text-muted-foreground" />}
              <span className="font-medium truncate">{source?.name || check?.fullName}</span>
              {source?.ref && <span className="text-xs text-muted-foreground">@ {source.ref}</span>}
              <Pill className="ml-auto border-emerald-500/30 bg-emerald-500/10 text-emerald-700"><Check className="h-3 w-3" />{source?.label ?? "GitHub"}</Pill>
            </li>
            <EditorRow count={editorTokens} />
          </ul>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Github className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  ref={repoInput}
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setCheck(null); }}
                  placeholder="https://github.com/you/your-repo"
                  className="pl-8"
                  data-testid="input-repo-url"
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="gap-1.5 flex-1 sm:flex-none" disabled={!url.trim() || checkMutation.isPending} onClick={() => checkMutation.mutate()} data-testid="button-check-repo">
                  {checkMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Check
                </Button>
                <Button className="gap-1.5 flex-1 sm:flex-none" disabled={!url.trim() || running} onClick={runRepo} data-testid="button-audit-repo">
                  {auditMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
                  Audit <span className="text-[11px] opacity-80">· {auditPrice}</span>
                </Button>
              </div>
            </div>

            {check && (
              <div className="flex items-center gap-2 text-sm" data-testid="repo-check-ok">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                <span className="font-medium truncate">{check.fullName}</span>
                <span className="text-xs text-muted-foreground truncate">@ {check.ref} · {[check.language, check.isPrivate ? "private" : "public", `${check.stars}★`].filter(Boolean).join(" · ")}</span>
              </div>
            )}

            <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs">
              {/* Private repos need a token. It's used for the request and never stored, so it's re-entered each time — deliberately. */}
              <button type="button" className="text-muted-foreground hover:text-foreground underline decoration-dotted underline-offset-2" onClick={() => setTokenOpen((o) => !o)} data-testid="button-toggle-token">
                {tokenOpen ? "Hide token" : "Private repo?"}
              </button>
              <button type="button" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1" disabled={running} onClick={() => zipInput.current?.click()} data-testid="button-upload-zip">
                {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}Upload a .zip instead
              </button>
            </div>

            {tokenOpen && (
              <div className="space-y-1.5">
                <Input type="password" value={token} onChange={(e) => { setToken(e.target.value); setCheck(null); }} placeholder="GitHub token (read-only Contents) · ghp_…" data-testid="input-github-token" />
                <p className="text-[11px] text-muted-foreground">Used once, never saved. Revoke it when you're done.</p>
              </div>
            )}

            <ul className="divide-y divide-black/[0.08] dark:divide-white/10 border-t border-black/[0.08] dark:border-white/10 text-sm"><EditorRow count={editorTokens} /></ul>
          </div>
        )}
      </Block>

      {/* --- Latest read --- */}
      {auditLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : !audit ? (
        <div className="px-4 sm:px-6 py-8 text-center" data-testid="audit-empty">
          <FileCode className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
          <p className="text-sm font-medium">No read yet</p>
          <p className="text-xs text-muted-foreground mt-0.5">Connect your code to see what's really built.</p>
        </div>
      ) : (
        <>
          <Block
            title={viewingOlder ? "Earlier read" : "Latest read"}
            count={new Date(audit.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            testId="card-audit-result"
            action={viewingOlder ? (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedId(null)} data-testid="button-back-to-latest">Back to latest</Button>
            ) : audit.appliedAt ? (
              <Pill className="border-black/[0.08] dark:border-white/10 text-muted-foreground"><Check className="h-3 w-3" />Applied {new Date(audit.appliedAt).toLocaleDateString()}</Pill>
            ) : null}
          >
            <div className="grid grid-cols-4 sm:grid-cols-[auto_repeat(4,minmax(0,1fr))] gap-x-4 gap-y-3 items-end">
              <div className="col-span-4 sm:col-span-1 flex items-end gap-3 sm:pr-4">
                <div>
                  <p className="text-3xl font-bold leading-none tabular-nums" data-testid="text-audit-completion">{audit.completionPercent}%</p>
                  <p className="text-[11px] text-muted-foreground mt-1">built</p>
                </div>
                <Pill className={`mb-4 ${STAGE_STYLE[audit.stage || ""]?.className || "border-black/[0.08] dark:border-white/10"}`} data-testid="badge-audit-stage">
                  {STAGE_STYLE[audit.stage || ""]?.label || audit.stage}
                </Pill>
              </div>
              <Stat icon={FileCode} label="lines" value={(scan.linesOfCode || 0).toLocaleString()} />
              <Stat icon={RouteIcon} label="routes" value={scan.routeCount ?? 0} />
              <Stat icon={Database} label="models" value={scan.modelCount ?? scan.dataModels?.length ?? 0} />
              <Stat icon={FlaskConical} label="test files" value={scan.testFiles ?? 0} />
            </div>
            <p
              className={`text-[11px] leading-snug break-words ${provenance?.partial ? "text-amber-700" : "text-muted-foreground"}`}
              data-testid="text-audit-provenance"
            >
              {provenance ? describeProvenance(provenance) : `${audit.source} · this audit predates provenance being recorded`}
            </p>

            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${audit.completionPercent || 0}%` }} />
            </div>

            {audit.summary && (
              <div>
                <p className={`text-sm text-foreground/80 ${summaryOpen ? "" : "line-clamp-2"}`} data-testid="text-audit-summary">{audit.summary}</p>
                <button type="button" className="mt-0.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => setSummaryOpen((v) => !v)} data-testid="button-summary-details">
                  {summaryOpen ? "Less" : "Details"}
                </button>
                {summaryOpen && (
                  <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {findings.stackSummary && <p>{findings.stackSummary}</p>}
                    <p className="font-mono text-[10px] break-all">{audit.source}{scan.truncated ? " · partial scan (over the size budget)" : ""}</p>
                  </div>
                )}
              </div>
            )}

            {/* A committed credential is the one finding that can't wait. */}
            {scan.suspectedSecrets?.length > 0 && (
              <details className="rounded-lg border border-rose-500/40 bg-rose-500/5 px-3 py-2" data-testid="alert-secrets">
                <summary className="cursor-pointer text-sm font-medium flex items-center gap-2 text-rose-700">
                  <ShieldAlert className="h-4 w-4 shrink-0" />{scan.suspectedSecrets.length} possible credential{scan.suspectedSecrets.length === 1 ? "" : "s"} in the repo — rotate them
                </summary>
                <ul className="mt-1.5 text-xs text-muted-foreground space-y-0.5">
                  {scan.suspectedSecrets.slice(0, 5).map((s: any, i: number) => <li key={i}><span className="font-mono break-all">{s.file}</span> — {s.hint}</li>)}
                  <li>Remove them from the file and from git history.</li>
                </ul>
              </details>
            )}

            {(runtime || delta) && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {runtime && (
                  <span className="contents" data-testid="audit-runtime">
                    {([["Live URL", runtime.liveUrl], ["Health", runtime.health]] as [string, Probe][]).map(([label, r]) => (
                      <Pill key={label} className="border-black/[0.08] dark:border-white/10 text-foreground/80" title={!r ? "No public URL to probe" : r.ok ? `${r.status} in ${r.ms}ms` : `Not answering (${r.status ?? r.error ?? "no response"})`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${!r ? "bg-muted-foreground/40" : r.ok ? "bg-emerald-500" : "bg-rose-500"}`} />
                        {label} {!r ? "—" : r.ok ? `${r.ms}ms` : "down"}
                      </Pill>
                    ))}
                    {/*
                      * "3/12 set" used to be counted in SparkTower's own
                      * process, which is not where this project runs — so the
                      * number was about our server and read as though it were
                      * about theirs. Unanswered now says unanswered.
                      */}
                    <Pill className="border-black/[0.08] dark:border-white/10 text-foreground/80" title={runtime.env.note}>
                      {runtime.env.setThere
                        ? <>Env {runtime.env.setThere.length}/{runtime.env.referenced}</>
                        : <>Env {runtime.env.referenced} referenced</>}
                    </Pill>
                    {runtime.surfaces && (
                      <Pill className="border-black/[0.08] dark:border-white/10 text-foreground/80" title={runtime.surfaces.off?.length ? `Off: ${runtime.surfaces.off.join(", ")}` : undefined}>
                        Switches {runtime.surfaces.loaded ? `${runtime.surfaces.enabled} on` : "not loaded"}
                      </Pill>
                    )}
                  </span>
                )}
                {delta && (
                  <span className="contents" data-testid="audit-delta">
                    {delta.previousAuditId ? (
                      <>
                        <span className="text-muted-foreground ml-1">Since {delta.daysSince}d ago:</span>
                        {!delta.changed && <Pill className="border-black/[0.08] dark:border-white/10 text-muted-foreground">No change</Pill>}
                        {delta.changed && (
                          <>
                            <Pill className="border-black/[0.08] dark:border-white/10" title={delta.routes.added.join(", ")}>Routes {delta.routes.after} {change(delta.routes.before, delta.routes.after)}</Pill>
                            <Pill className="border-black/[0.08] dark:border-white/10" title={delta.tables.added.join(", ")}>Tables {delta.tables.after} {change(delta.tables.before, delta.tables.after)}</Pill>
                            <Pill className="border-black/[0.08] dark:border-white/10">Tests {delta.tests.after} {change(delta.tests.before, delta.tests.after)}</Pill>
                            <Pill className="border-black/[0.08] dark:border-white/10">Built {delta.completionPercent.after ?? "?"}% {change(delta.completionPercent.before, delta.completionPercent.after)}</Pill>
                            {delta.areas.length > 0 && <Pill className="border-black/[0.08] dark:border-white/10" title={delta.areas.map((a) => `${areaLabel(a.area)} ${a.from}→${a.to}`).join("; ")}>{delta.areas.length} area{delta.areas.length === 1 ? "" : "s"} moved</Pill>}
                            {delta.coverage && <Pill className="border-black/[0.08] dark:border-white/10" title={`Costly metered ${delta.coverage.costlyMetered[0]}→${delta.coverage.costlyMetered[1]}`}>Rate-limited {delta.coverage.writesRateLimited[1]}/{delta.coverage.writes[1]}</Pill>}
                          </>
                        )}
                      </>
                    ) : <span className="text-muted-foreground ml-1">First read — the next one shows what moved.</span>}
                  </span>
                )}
              </div>
            )}
          </Block>

          {/* --- What changed on your path --- */}
          <Block title="What changed on your path" count={waiting ? `${waiting} waiting` : undefined} testId="codebase-path-changes" innerRef={pathRef}>
            <PathChanges projectId={projectId} audit={audit} />
            {findings.catchUp ? (
              <AuditCatchUp projectId={projectId} audit={audit as any} />
            ) : ops.length > 0 && !audit.appliedAt ? (
              <Button size="sm" className="gap-1.5" disabled={applyMutation.isPending} onClick={() => applyMutation.mutate()} data-testid="button-apply-audit">
                {applyMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                Make my board match the code ({ops.length})
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-600" />Your path matches the code.</p>
            )}
          </Block>

          {/* --- Findings --- */}
          {hasFindings ? (
            <Block
              title="Findings"
              testId="codebase-findings"
              action={
                <div className="flex items-center gap-1.5">
                  {highRisks > 0 && <Pill className={SEVERITY_BADGE.high}>{highRisks} high</Pill>}
                  {findings.missing?.length > 0 && <Pill className={STATUS_BADGE.missing}>{findings.missing.length} missing</Pill>}
                  {loops.length > 0 && <Pill className="border-black/[0.08] dark:border-white/10 text-muted-foreground">{closedLoops}/{loops.length} loops</Pill>}
                </div>
              }
            >
              {/*
                * How often this audit contradicted itself, said where a reader
                * will meet it. The count was recorded and shown nowhere, so the
                * one number that tells you how much of this page to trust was
                * visible only in a server log.
                */}
              {((findings.scan?.claimsContradicted ?? 0) > 0 || (findings.scan?.claimsUnread ?? 0) > 0) && (
                <p className="text-xs text-amber-600 dark:text-amber-500" data-testid="audit-claims-contradicted">
                  {findings.scan.claimsContradicted > 0 && `${findings.scan.claimsContradicted} claim${findings.scan.claimsContradicted === 1 ? "" : "s"} here said something was missing that is in the repository. `}
                  {findings.scan.claimsUnread > 0 && `${findings.scan.claimsUnread} judge${findings.scan.claimsUnread === 1 ? "s" : ""} a file this audit didn't read. `}
                  Each one is marked in place — read this audit with that in mind.
                </p>
              )}

              {findings.nextThreeThings?.length > 0 && (
                <ol className="space-y-1.5" data-testid="audit-next">
                  {findings.nextThreeThings.map((thing: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className={`h-5 w-5 rounded-full ${i === 0 ? NOVA_GRADIENT + " text-white" : "bg-muted text-muted-foreground"} flex items-center justify-center text-[10px] font-bold shrink-0`}>{i + 1}</span>
                      <span className="line-clamp-2" title={thing}>{thing}</span>
                    </li>
                  ))}
                </ol>
              )}

              <div className="pt-4 mt-1 border-t border-black/[0.08] dark:border-white/10">
                <SecurityReportPanel projectId={projectId} report={findings.security} />
              </div>

              <div className="divide-y divide-black/[0.08] dark:divide-white/10 border-t border-black/[0.08] dark:border-white/10">
                {risks.length > 0 && (
                  <Group title="Risks" icon={AlertTriangle} tone={highRisks ? "text-rose-500" : "text-amber-500"} count={risks.length} defaultOpen={highRisks > 0}>
                    {risks.map((r, i) => (
                      <Row key={i} testId={`audit-risk-${i}`} title={<><span className="font-medium">{r.area}</span> <span className="text-muted-foreground">· {r.finding}</span></>}
                        lead={<Pill className={`uppercase text-[9px] ${SEVERITY_BADGE[r.severity] ?? SEVERITY_BADGE.medium}`}>{r.severity}</Pill>}>
                        <p className="text-foreground/80">{r.finding}</p>
                        {r.recommendation && <p><span className="font-medium text-foreground/80">Fix:</span> {r.recommendation}</p>}
                        <Evidence paths={r.evidence} />
                      </Row>
                    ))}
                  </Group>
                )}

                {loops.length > 0 && (
                  <Group title="Loops" icon={CircleDot} count={`${closedLoops}/${loops.length} closed`} testId="audit-loops">
                    {loops.map((l) => {
                      const state = l.closure === "closed" ? "closed" : l.closure === "open" ? "open" : "not built";
                      return (
                        <Row key={l.loopTaskId} testId={`audit-loop-${l.loopTaskId}`}
                          lead={l.closure === "closed" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> : l.closure === "open" ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" /> : <XCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                          title={<><span className="font-medium">{l.title}</span> <span className="text-muted-foreground text-xs">· {LOOP_TYPE_INFO[l.type]?.label ?? l.type}</span></>}
                          meta={<Pill className={STATUS_BADGE[state]}>{state}</Pill>}>
                          {l.stages.length > 0 && (
                            <ol className="space-y-0.5 pl-4 list-decimal">
                              {l.stages.map((st, i) => (
                                <li key={i} className={st.status === "built" ? "text-foreground/80" : st.status === "partial" ? "text-amber-700" : ""}>
                                  {st.step} <span className="text-muted-foreground">— {st.status}</span>
                                </li>
                              ))}
                            </ol>
                          )}
                          {l.returnPath && <p><span className="font-medium text-foreground/80">Back to step one:</span> {l.returnPath.mechanism}</p>}
                          {l.breaksAt && <p><span className="font-medium text-foreground/80">Breaks at:</span> {l.breaksAt}</p>}
                          {l.fix && <p><span className="font-medium text-foreground/80">To close it:</span> {l.fix}</p>}
                          {l.note && <p className="italic">{l.note}</p>}
                        </Row>
                      );
                    })}
                  </Group>
                )}

                {(looksDone.length > 0 || notStarted.length > 0 || milestoneVerdicts.length > 0) && (
                  <Group title="Plan vs code" icon={RouteIcon} count={looksDone.length + notStarted.length + milestoneVerdicts.length}>
                    {looksDone.map((t: any, i: number) => (
                      <Row key={`d${i}`} lead={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />} title={t.title} meta={<Pill className={STATUS_BADGE.built}>looks done</Pill>}>
                        {t.evidence?.length ? <Evidence paths={t.evidence} /> : null}
                      </Row>
                    ))}
                    {notStarted.map((t: any, i: number) => (
                      <Row key={`n${i}`} lead={<XCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />} title={t.title} meta={<Pill className={STATUS_BADGE["not-started"]}>no code</Pill>}>
                        {t.why ? <p>{t.why}</p> : null}
                      </Row>
                    ))}
                    {milestoneVerdicts.map((m: any, i: number) => (
                      <Row key={`m${i}`} title={<span className="font-medium">{m.title}</span>} meta={<Pill className={STATUS_BADGE[m.verdict] ?? STATUS_BADGE["not-started"]}>{m.verdict}</Pill>}>
                        {m.why ? <p>{m.why}</p> : null}
                      </Row>
                    ))}
                  </Group>
                )}

                {capabilities.length > 0 && (
                  <Group title="What the code has" icon={CheckCircle2} tone="text-emerald-500"
                    // Unknown areas are excluded from anything that reads as work outstanding.
                    count={`${capCounts.built}/${capCounts.total} built${capCounts.unknown ? ` · ${capCounts.unknown} not read` : ""}`}
                    testId="capability-inventory">
                    {capabilities.map((c) => (
                      <Row key={c.area} testId={`capability-${c.area}`}
                        title={<><span className="font-medium">{areaLabel(c.area)}</span>{c.summary && <span className="text-muted-foreground"> · {c.summary}</span>}</>}
                        meta={<>
                          {/* An unknown area has no gaps to count: the audit never read it. */}
                          {c.status !== "unknown" && c.detail?.gaps?.length ? <span className="text-[11px] text-muted-foreground tabular-nums">{c.detail.gaps.length} gap{c.detail.gaps.length === 1 ? "" : "s"}</span> : null}
                          <Pill className={STATUS_BADGE[c.status] ?? "border-black/[0.08] dark:border-white/10 text-muted-foreground"} data-testid={`capability-status-${c.area}`}>
                            {c.status === "unknown" && <HelpCircle className="h-3 w-3" />}
                            {CAPABILITY_STATUS_LABEL[c.status] ?? c.status}
                          </Pill>
                        </>}>
                        {c.summary && <p className="text-foreground/80">{c.summary}</p>}
                        {c.missing && <p>Missing: {c.missing}</p>}
                        {c.detail?.coverage && <p data-testid={`coverage-${c.area}`}>{c.detail.coverage}</p>}
                        {c.detail?.gaps?.length ? (
                          <ul className="space-y-0.5" data-testid={`gaps-${c.area}`}>
                            {c.detail.gaps.map((g, i) => (
                              <li key={i} className="flex items-start gap-1.5">
                                <span className={`shrink-0 mt-1 h-1.5 w-1.5 rounded-full ${g.severity === "high" ? "bg-rose-500" : g.severity === "medium" ? "bg-amber-500" : "bg-muted-foreground/50"}`} />
                                <span>{g.item}{g.file && <code className="ml-1 text-[10px]">{g.file}</code>}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {c.evidence.length > 0 && <p className="font-mono text-[10px] break-all">{c.evidence.map((e) => e.route ? `${e.route} · ${e.file}` : e.file).join(" · ")}</p>}
                        {c.note && <p className={c.status === "unknown" ? "text-sky-700" : "text-amber-700"}>{c.note}</p>}
                      </Row>
                    ))}
                  </Group>
                )}

                {findings.partial?.length > 0 && (
                  <Group title="Partly built" icon={CircleDot} tone="text-amber-500" count={findings.partial.length}>
                    {findings.partial.map((b: any, i: number) => (
                      <Row key={i} title={<><span className="font-medium">{b.item}</span>{b.missing && <span className="text-muted-foreground"> · needs {b.missing}</span>}</>}>
                        <p>Has: {b.exists}</p>
                        <p>Needs: {b.missing}</p>
                        <Evidence paths={b.evidence} />
                      </Row>
                    ))}
                  </Group>
                )}

                {findings.missing?.length > 0 && (
                  <Group title="Missing" icon={XCircle} tone="text-rose-500" count={findings.missing.length}>
                    {findings.missing.map((b: any, i: number) => (
                      <Row key={i} title={<span className="font-medium">{b.item}</span>}>
                        {b.matters ? <p>{b.matters}</p> : null}
                        {/* Where it looked before calling this missing — absent when it didn't say. */}
                        {b.searched?.length > 0 && <p className="text-muted-foreground">Looked in: {b.searched.join(", ")}</p>}
                      </Row>
                    ))}
                  </Group>
                )}

                {findings.built?.length > 0 && (
                  <Group title="Built" icon={Check} tone="text-emerald-500" count={findings.built.length}>
                    {findings.built.map((b: any, i: number) => (
                      <Row key={i} title={b.item}>{b.evidence?.length ? <Evidence paths={b.evidence} /> : null}</Row>
                    ))}
                  </Group>
                )}

                {findings.undocumented?.length > 0 && (
                  <Group title="Not in the plan" icon={FileCode} count={findings.undocumented.length}>
                    {findings.undocumented.map((b: any, i: number) => (
                      <Row key={i} title={b.item}>{b.evidence?.length ? <Evidence paths={b.evidence} /> : null}</Row>
                    ))}
                  </Group>
                )}

                {scan.routes?.length > 0 && (
                  <Group title="Routes" icon={RouteIcon} count={scan.routeCount}>
                    <li className="py-2 flex flex-wrap gap-1">
                      {scan.routes.slice(0, 60).map((r: any, i: number) => <Pill key={i} className="border-black/[0.08] dark:border-white/10 font-mono font-normal text-[10px]">{r.label}</Pill>)}
                    </li>
                  </Group>
                )}

                {scan.dataModels?.length > 0 && (
                  <Group title="Data models" icon={Database} count={scan.modelCount ?? scan.dataModels.length}>
                    <li className="py-2 flex flex-wrap gap-1">
                      {scan.dataModels.map((m: any, i: number) => <Pill key={i} className="border-black/[0.08] dark:border-white/10 font-mono font-normal text-[10px]">{m.name}</Pill>)}
                    </li>
                  </Group>
                )}
              </div>
            </Block>
          ) : null}
        </>
      )}

      {/* --- Data: the live database, read on demand. --- */}
      <Block title="Data" testId="card-your-data">
        <DataSourceCard projectId={projectId} isOwner={isOwner} />
      </Block>

      {/* --- History --- */}
      {(audits?.length || 0) > 1 && (
        <Block title="History" count={audits!.length} testId="codebase-history">
          <ul className="divide-y divide-black/[0.08] dark:divide-white/10">
            {audits!.map((a) => {
              const s = parseSource(a.source, a.sourceKind);
              const active = a.id === latestId;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    className={`w-full flex items-center gap-2.5 py-2 text-left text-sm rounded-md transition-colors ${active ? "text-primary" : "hover:text-primary"}`}
                    onClick={() => setSelectedId(a.id === newest?.id ? null : a.id)}
                    data-testid={`audit-history-${a.id}`}
                  >
                    {s.kind === "github" ? <Github className="h-3.5 w-3.5 shrink-0" /> : s.kind === "worktree" ? <Terminal className="h-3.5 w-3.5 shrink-0" /> : <Upload className="h-3.5 w-3.5 shrink-0" />}
                    <span className="font-medium tabular-nums w-10 shrink-0">{a.completionPercent}%</span>
                    <span className="text-muted-foreground truncate flex-1">{STAGE_STYLE[a.stage || ""]?.label ?? a.stage} · {s.name}</span>
                    {a.id === newest?.id && <Pill className="border-primary/30 bg-primary/5 text-primary">latest</Pill>}
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{ago(a.createdAt, now)}</span>
                    {active ? <History className="h-3.5 w-3.5 shrink-0" /> : <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </Block>
      )}
    </div>
  );
}

/** Whether an editor is linked (VS Code, Claude Code, Cursor) — reads from there land in this tab on their own. */
function EditorRow({ count }: { count: number }) {
  return (
    <li className="flex items-center gap-2 py-2" data-testid="codebase-editor-row">
      <Terminal className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="font-medium">Editor bridge</span>
      <span className="text-xs text-muted-foreground truncate hidden sm:inline">VS Code · Claude Code · Cursor</span>
      {/*
        * Not ready (shared/not-ready.ts). Anyone who already linked an editor
        * still gets the way in to manage — and revoke — what they linked; what
        * goes is the invitation to link a new one.
        */}
      {count > 0 ? (
        <a href="/profile#editor" className="ml-auto text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1.5" data-testid="link-editor-manage">
          <LiveDot />{count} linked · Manage
        </a>
      ) : EDITOR_BRIDGE_READY ? (
        <a href="/profile#editor" className="ml-auto text-xs font-medium text-primary hover:underline" data-testid="link-editor-connect">Connect</a>
      ) : (
        <span className="ml-auto text-xs text-muted-foreground" data-testid="editor-row-soon">{COMING_SOON}</span>
      )}
    </li>
  );
}
