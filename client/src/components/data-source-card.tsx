import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Database, Loader2 } from "lucide-react";

/**
 * Where the project's data lives, so the audit can read row counts. The
 * connection string is sealed on the server and never shown again; this
 * card only ever knows whether one is set.
 */
export function DataSourceCard({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const { data } = useQuery<{ configured: boolean; kind: "self" | "connection" | null }>({ queryKey: ["/api/projects", projectId, "data-source"] });
  const save = useMutation({
    mutationFn: (value: string | null) => apiRequest("PUT", `/api/projects/${projectId}/data-source`, { url: value }).then((r) => r.json()),
    onSuccess: (r: any) => {
      setUrl("");
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "data-source"] });
      toast({ title: r.configured ? "Data source saved. The next audit reads your tables and row counts." : "Data source removed" });
    },
    onError: (e: any) => {
      const raw = String(e?.message ?? "").replace(/^\d+:\s*/, "");
      let message = raw; try { message = JSON.parse(raw).message ?? raw; } catch { /* plain */ }
      toast({ title: message, variant: "destructive" });
    },
  });
  return (
    <Card data-testid="data-source-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2"><Database className="h-4 w-4" /> Data source</CardTitle>
        <p className="text-sm text-muted-foreground">
          Point the audit at your database and it reads tables, keys and row counts, so Nova can tell "built" from "built but nobody uses it" and draw your data map. Use a read-only user. The string is sealed and never shown again.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm" data-testid="data-source-status">
          {data?.configured ? (data.kind === "self" ? "Reading this application's own database." : "A connection is configured.") : "No data source yet."}
        </p>
        <div className="flex gap-2">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="postgresql://readonly_user:…@host:5432/db" data-testid="input-data-source" />
          <Button disabled={save.isPending || !url.trim()} onClick={() => save.mutate(url.trim())} data-testid="button-save-data-source">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="ghost" className="text-xs" disabled={save.isPending} onClick={() => save.mutate("self")} data-testid="button-data-source-self">Use this application's own database</Button>
          {data?.configured && <Button size="sm" variant="ghost" className="text-xs" disabled={save.isPending} onClick={() => save.mutate(null)} data-testid="button-remove-data-source">Remove</Button>}
        </div>
      </CardContent>
    </Card>
  );
}
