import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Rocket, ExternalLink, CheckCircle2, AlertTriangle, XCircle, Database, Server, GitCommit,
} from "lucide-react";

/**
 * Did the deploy come up right?
 *
 * One card, read top to bottom: the address the server thinks it has, the
 * build it is running, whether it can reach its database, and which
 * environment variables are set. Presence only — this never shows a secret's
 * value, and there is nothing here to redact because the server never sends
 * one.
 *
 * What it is not: an uptime monitor. Everything on it is the running process
 * describing itself, so "ready" means "the database answered the server", not
 * "the site is up for the public". The footer says so, and the wording
 * everywhere else avoids implying otherwise.
 */
interface EnvRow { name: string; required: boolean; what: string; set: boolean }
interface Deployment {
  checkedAt: string;
  nodeEnv: string;
  uptimeSeconds: number;
  startedAt: string;
  publicUrl: {
    url: string;
    source: "PUBLIC_URL" | "SERVER_BASE_URL" | "REPLIT_DOMAINS" | "request";
    absolute: boolean; https: boolean; localhost: boolean; ok: boolean;
    problem: string | null;
  };
  build: {
    platform: string | null; commit: string | null; commitShort: string | null;
    branch: string | null; service: string | null; externalUrl: string | null; instance: string | null;
  };
  health: { ok: boolean; note: string };
  ready: { ready: boolean; database: string; ms: number; detail: string | null };
  env: EnvRow[];
  missingRequired: string[];
  scope: string;
}

const SOURCE_LABEL: Record<Deployment["publicUrl"]["source"], string> = {
  PUBLIC_URL: "from PUBLIC_URL",
  SERVER_BASE_URL: "from SERVER_BASE_URL",
  REPLIT_DOMAINS: "from REPLIT_DOMAINS",
  request: "not configured — guessed from the request",
};

/** Uptime, in the largest unit that still says something useful. */
function since(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function State({ tone, label, testId }: { tone: "good" | "warn" | "bad"; label: string; testId: string }) {
  const Icon = tone === "good" ? CheckCircle2 : tone === "warn" ? AlertTriangle : XCircle;
  const className =
    tone === "good" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    : tone === "warn" ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
    : "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400";
  return (
    <Badge variant="outline" className={`gap-1 text-[11px] ${className}`} data-testid={testId}>
      <Icon className="h-3 w-3 shrink-0" /> {label}
    </Badge>
  );
}

export function DeploymentCard() {
  /*
   * This page is open to reviewers; the route behind this card is the owner's
   * alone and answers everyone else with a 404. So the card asks first and
   * renders nothing rather than showing a reviewer an error about a console
   * they were never meant to see (the same question admin-analytics asks).
   */
  const { data: access, isLoading: accessLoading } = useQuery<{ owner: boolean }>({
    queryKey: ["/api/admin/analytics/access"],
    queryFn: async () => {
      const res = await fetch("/api/admin/analytics/access", { credentials: "include" });
      if (!res.ok) return { owner: false };
      return res.json();
    },
    retry: false,
  });
  const isOwner = !!access?.owner;

  const { data, isLoading, isError } = useQuery<Deployment>({
    queryKey: ["/api/admin/deployment"],
    enabled: isOwner,
    // The point of the card is the state now, not the state when the tab opened.
    refetchInterval: 60_000,
  });

  if (!accessLoading && !isOwner) return null;

  if (isLoading || accessLoading) {
    return (
      <Card data-testid="deployment-card">
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading this deployment…
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card className="border-rose-500/40" data-testid="deployment-card">
        <CardContent className="py-6 text-sm text-muted-foreground" data-testid="deployment-error">
          Couldn't read this deployment's state. The server answered with an error — which is itself
          worth knowing: everything on this card comes from the process that just failed to describe itself.
        </CardContent>
      </Card>
    );
  }

  const { publicUrl, build, ready, env, missingRequired } = data;
  const urlOk = publicUrl.ok;
  const dbOk = ready.ready;
  const worst = !dbOk || !urlOk || missingRequired.length > 0;

  return (
    <Card className={worst ? "border-rose-500/40" : "border-primary/40"} data-testid="deployment-card">
      <CardHeader className="pb-3 space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <Rocket className="h-4 w-4 text-primary" /> Deployment
          </CardTitle>
          <div className="flex items-center gap-1.5 flex-wrap">
            <State tone={data.health.ok ? "good" : "bad"} label={data.health.ok ? "Process answering" : "Process not answering"} testId="deployment-health" />
            <State
              tone={dbOk ? "good" : "bad"}
              label={dbOk ? `Database ok (${ready.ms}ms)` : "Database unreachable"}
              testId="deployment-ready"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {data.nodeEnv === "production" ? "Production" : `NODE_ENV=${data.nodeEnv}`} · running {since(data.uptimeSeconds)} · read {new Date(data.checkedAt).toLocaleTimeString()}
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {!dbOk && ready.detail && (
          <p className="rounded-md border border-rose-500/40 bg-rose-500/5 p-2.5 text-xs leading-relaxed text-rose-600 dark:text-rose-400" data-testid="deployment-db-detail">
            <span className="font-medium">The database refused:</span> {ready.detail}
            <span className="block mt-1 text-muted-foreground">A localhost address here means this deployment is carrying a development connection string.</span>
          </p>
        )}

        {/* The address. Wrong here is silent everywhere else, so wrong here is loud. */}
        <div
          className={`rounded-md border p-2.5 space-y-1 ${urlOk ? "border-border/60" : "border-rose-500/40 bg-rose-500/5"}`}
          data-testid="deployment-public-url"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground">Public address</span>
            <State tone={urlOk ? "good" : "bad"} label={SOURCE_LABEL[publicUrl.source]} testId="deployment-url-source" />
          </div>
          <a
            href={publicUrl.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 break-all text-sm font-medium text-primary hover:underline"
            data-testid="deployment-url-link"
          >
            {publicUrl.url} <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
          {publicUrl.problem && (
            <p className="text-xs leading-relaxed text-rose-600 dark:text-rose-400" data-testid="deployment-url-problem">
              {publicUrl.problem}
            </p>
          )}
          {build.externalUrl && build.externalUrl.replace(/\/$/, "") !== publicUrl.url.replace(/\/$/, "") && (
            <p className="text-[11px] text-muted-foreground break-all" data-testid="deployment-url-mismatch">
              The host serves this at {build.externalUrl}, which isn't the address links are built from.
            </p>
          )}
        </div>

        {/* What is running. Absent on a laptop, and that is an answer rather than a gap. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" data-testid="deployment-build">
          <span className="inline-flex items-center gap-1.5">
            <GitCommit className="h-3.5 w-3.5 shrink-0" />
            {build.commitShort
              ? <span className="font-mono text-foreground" data-testid="deployment-commit">{build.commitShort}{build.branch ? ` · ${build.branch}` : ""}</span>
              : <span data-testid="deployment-commit">No commit reported — this host doesn't say what it built</span>}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Server className="h-3.5 w-3.5 shrink-0" />
            <span data-testid="deployment-service">{build.service ?? "no service name"}{build.platform ? ` · ${build.platform}` : ""}</span>
          </span>
        </div>

        {/* Presence, never values. */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground">Environment</span>
            {missingRequired.length > 0
              ? <State tone="bad" label={`${missingRequired.length} required missing`} testId="deployment-env-state" />
              : <State tone="good" label="Everything required is set" testId="deployment-env-state" />}
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2" data-testid="deployment-env">
            {env.map((row) => (
              <div
                key={row.name}
                className={`flex items-start justify-between gap-2 rounded-md border p-2 ${
                  row.set ? "border-border/60"
                  : row.required ? "border-rose-500/40 bg-rose-500/5"
                  : "border-amber-500/40 bg-amber-500/5"
                }`}
                data-testid={`env-${row.name}`}
              >
                <div className="min-w-0 space-y-0.5">
                  <span className="block font-mono text-[11px] break-all">{row.name}</span>
                  {!row.set && <span className="block text-[11px] leading-relaxed text-muted-foreground">{row.what}</span>}
                </div>
                <span
                  className={`shrink-0 text-[11px] font-medium ${
                    row.set ? "text-emerald-600 dark:text-emerald-400"
                    : row.required ? "text-rose-600 dark:text-rose-400"
                    : "text-amber-600 dark:text-amber-400"
                  }`}
                  data-testid={`env-state-${row.name}`}
                >
                  {row.set ? "set" : "missing"}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Set or missing only. No value, length or prefix of any of these ever leaves the server — including to this page.
          </p>
        </div>

        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground border-t border-border/60 pt-3">
          <Database className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          Everything here is this one process describing itself: it answered, and its database answered
          it. That is not the same as the site being reachable from the internet, and nothing on this
          page is watching it — the numbers refresh while this tab is open and nowhere else.
        </p>
      </CardContent>
    </Card>
  );
}
