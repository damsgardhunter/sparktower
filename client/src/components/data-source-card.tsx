import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Database, Loader2, RefreshCw } from "lucide-react";
import { DataMap } from "@/components/data-map";
import type { DataShape } from "@shared/data-shape";

/**
 * Where the project's data lives, and the map of it. Saving a source reads
 * the database right then and draws the star; nothing waits for an audit.
 * The connection string is sealed on the server and never shown again.
 */
export function DataSourceCard({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const status = useQuery<{ configured: boolean; kind: "self" | "connection" | null }>({ queryKey: ["/api/projects", projectId, "data-source"], enabled: isOwner });
  const shapeQ = useQuery<{ shape: DataShape | null }>({ queryKey: ["/api/projects", projectId, "data-shape"] });
  const fail = (e: any) => {
    const raw = String(e?.message ?? "").replace(/^\d+:\s*/, "");
    let message = raw; try { message = JSON.parse(raw).message ?? raw; } catch { /* plain */ }
    toast({ title: message, variant: "destructive" });
  };
  const done = (r: any) => {
    setUrl("");
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "data-source"] });
    queryClient.setQueryData(["/api/projects", projectId, "data-shape"], { shape: r.shape ?? null });
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "data-shape"] });
    if (r.shape?.error) toast({ title: "Saved, but the read failed", description: r.shape.error, variant: "destructive" });
    else if (r.shape) toast({ title: `Read ${r.shape.totals.tables} tables, ${r.shape.totals.rows.toLocaleString()} rows` });
    else if (!r.configured) toast({ title: "Data source removed" });
  };
  const save = useMutation({ mutationFn: (value: string | null) => apiRequest("PUT", `/api/projects/${projectId}/data-source`, { url: value }).then((r) => r.json()), onSuccess: done, onError: fail });
  const refresh = useMutation({ mutationFn: () => apiRequest("POST", `/api/projects/${projectId}/data-shape/refresh`).then((r) => r.json()), onSuccess: (r: any) => done({ ...r, configured: true }), onError: fail });

  const busy = save.isPending || refresh.isPending;
  const shape = shapeQ.data?.shape ?? null;
  const configured = status.data?.configured ?? !!shape;

  const statusText = status.data?.configured
    ? (status.data.kind === "self" ? "This app's own database" : "Connected database")
    : shape ? "Connected database" : "Not connected";

  return (
    <div className="space-y-3" data-testid="data-source-card">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className={`h-2 w-2 rounded-full shrink-0 ${configured ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
          <span className="font-medium" data-testid="data-source-status">{statusText}</span>
          {shape && !shape.error && (
            <span className="text-xs text-muted-foreground tabular-nums">{shape.totals.tables} tables · {shape.totals.rows.toLocaleString()} rows</span>
          )}
        </div>
        {isOwner && (
          <div className="flex items-center gap-1.5">
            {configured && (
              <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => refresh.mutate()} data-testid="button-refresh-data-shape">
                {refresh.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}Re-read
              </Button>
            )}
            {status.data?.configured && <Button size="sm" variant="ghost" className="h-8" disabled={busy} onClick={() => save.mutate(null)} data-testid="button-remove-data-source">Remove</Button>}
          </div>
        )}
      </div>

      {isOwner && !status.data?.configured && (
        <div className="space-y-2">
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => save.mutate("self")} data-testid="button-data-source-self">
              {save.isPending && save.variables === "self" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Database className="h-3.5 w-3.5 mr-1.5" />}
              {save.isPending && save.variables === "self" ? "Reading…" : "Use this app's database"}
            </Button>
          </div>
          <div className="flex gap-2">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Read-only postgres URL" className="h-8 text-sm" data-testid="input-data-source" />
            <Button size="sm" className="h-8" disabled={busy || !url.trim()} onClick={() => save.mutate(url.trim())} data-testid="button-save-data-source">
              {save.isPending && save.variables !== "self" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Connect"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Use a read-only user. The URL is sealed and never shown again.</p>
        </div>
      )}

      {busy && !shape && <div className="flex items-center gap-2 text-sm text-muted-foreground py-3"><Loader2 className="h-4 w-4 animate-spin text-primary" />Reading tables…</div>}
      {shape && <DataMap shape={shape} />}
      {!shape && !busy && !isOwner && <p className="text-xs text-muted-foreground">The owner hasn't connected a database.</p>}
    </div>
  );
}
