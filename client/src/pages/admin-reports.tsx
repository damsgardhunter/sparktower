import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import NotFound from "@/pages/not-found";
import {
  Loader2, Flag, ShieldAlert, Check, X, UserX, UserCheck, ExternalLink,
} from "lucide-react";
import {
  REPORT_TARGET_LABEL, reportReasonLabel, type ReportTarget, type ReportStatus,
} from "@shared/moderation";

interface Report {
  /** Null when this kind of target can't be taken down. */
  targetHidden?: boolean | null;
  id: string;
  targetType: ReportTarget;
  targetId: string;
  targetOwnerId: string | null;
  projectId: string | null;
  reason: string;
  note: string | null;
  snapshot: string | null;
  status: ReportStatus;
  createdAt: string;
  reporterName: string;
  ownerName: string | null;
  ownerId: string | null;
  ownerSuspended: boolean;
}

const TABS: { id: ReportStatus; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "actioned", label: "Actioned" },
  { id: "dismissed", label: "Dismissed" },
];

/** Where a reported thing lives, so a moderator can go and look at it. */
function targetLink(r: Report): string | null {
  if (r.targetType === "check_in") return `/c/${r.targetId}`;
  if (r.targetType === "project") return `/projects/${r.targetId}`;
  if (r.targetType === "user") return `/profile/${r.targetId}`;
  if (r.projectId) return `/projects/${r.projectId}`;
  return null;
}

/**
 * The moderation queue.
 *
 * Every report carries a snapshot of what was reported, taken when the report
 * was filed — so deleting the content doesn't destroy the evidence, which is
 * the first thing someone does when they realise they've been caught.
 *
 * Suspending is deliberately separate from resolving: one report rarely
 * justifies a suspension and a suspension usually covers several, so neither
 * is a side effect of the other.
 */
export default function AdminReports() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ReportStatus>("open");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const isReviewer = user
    && ((user as any).platformRole === "reviewer" || (user as any).platformRole === "admin");

  const { data: reports, isLoading } = useQuery<Report[]>({
    queryKey: ["/api/admin/reports", tab],
    queryFn: async () => {
      const res = await fetch(`/api/admin/reports?status=${tab}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: !!isReviewer,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/reports"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/reports/count"] });
  };

  const resolve = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "actioned" | "dismissed" }) => {
      const res = await apiRequest("PATCH", `/api/admin/reports/${id}`, { status, note });
      return res.json();
    },
    onSuccess: (_r, v) => {
      toast({ title: v.status === "actioned" ? "Marked actioned" : "Dismissed" });
      setNoteFor(null); setNote("");
      refresh();
    },
    onError: () => toast({ title: "Couldn't update that", variant: "destructive" }),
  });

  const takedown = useMutation({
    mutationFn: async ({ type, id, hide }: { type: string; id: string; hide: boolean }) => {
      const res = await apiRequest("POST", `/api/admin/content/${type}/${id}/${hide ? "hide" : "restore"}`, { reason: note || undefined });
      return res.json();
    },
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/reports"] });
      toast({ title: r.hidden ? "Taken down — hidden from everyone but its author" : "Restored" });
    },
    onError: (e: any) => { const raw = String(e?.message ?? "").replace(/^\d+:\s*/, ""); let m = raw; try { m = JSON.parse(raw).message ?? raw; } catch { /* plain */ } toast({ title: m, variant: "destructive" }); },
  });
  const suspend = useMutation({
    mutationFn: async ({ userId, suspended }: { userId: string; suspended: boolean }) => {
      const res = await apiRequest("POST", `/api/admin/users/${userId}/suspend`, {
        suspended, reason: note || undefined,
      });
      return res.json();
    },
    onSuccess: (r: any) => {
      toast({ title: r.suspended ? "Account suspended" : "Account reinstated" });
      refresh();
    },
    onError: (err: any) => {
      const raw = err?.message || "";
      const start = raw.indexOf("{");
      let description = "Try again.";
      if (start >= 0) {
        try { description = JSON.parse(raw.slice(start)).message || description; } catch { /* keep */ }
      }
      toast({ title: "Couldn't change that account", description, variant: "destructive" });
    },
  });

  if (authLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  if (!isReviewer) return <NotFound />;

  const list = reports ?? [];

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-5" data-testid="admin-reports">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-primary" /> Reports
        </h1>
        <p className="text-sm text-muted-foreground">
          Everything people have flagged. Nothing is removed automatically — this queue is the only
          thing that acts.
        </p>
      </header>

      <div className="flex gap-1">
        {TABS.map((t) => (
          <Button
            key={t.id} size="sm" variant={tab === t.id ? "default" : "outline"}
            onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : list.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-14 text-center space-y-2">
            <Flag className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="font-medium">Nothing {tab}</p>
            <p className="text-sm text-muted-foreground">
              {tab === "open" ? "No reports waiting." : `No ${tab} reports.`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((r) => {
            const link = targetLink(r);
            return (
              <Card key={r.id} data-testid={`report-${r.id}`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className="text-[10px]">
                          {REPORT_TARGET_LABEL[r.targetType]}
                        </Badge>
                        <Badge className="text-[10px]">{reportReasonLabel(r.reason)}</Badge>
                        {r.ownerSuspended && (
                          <Badge variant="destructive" className="text-[10px] gap-1">
                            <UserX className="h-2.5 w-2.5" /> author suspended
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Reported by {r.reporterName}
                        {r.ownerName && <> · author {r.ownerName}</>}
                        {" · "}{new Date(r.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {link && (
                      <Button
                        variant="outline" size="sm" className="h-7 gap-1.5 text-xs shrink-0"
                        onClick={() => window.open(link, "_blank")}
                        data-testid={`open-target-${r.id}`}
                      >
                        <ExternalLink className="h-3 w-3" /> Open
                      </Button>
                    )}
                  </div>

                  {r.note && (
                    <p className="text-sm">
                      <span className="text-muted-foreground">They said: </span>{r.note}
                    </p>
                  )}

                  {/* Kept at report time, so a deletion can't erase the evidence. */}
                  {r.snapshot && (
                    <div className="rounded-md border border-border/60 bg-muted/40 p-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                        What was reported
                      </p>
                      <p className="text-xs whitespace-pre-wrap leading-relaxed line-clamp-6">
                        {r.snapshot}
                      </p>
                    </div>
                  )}

                  {r.status === "open" && (
                    <div className="space-y-2 pt-1 border-t border-border/50">
                      {noteFor === r.id && (
                        <Textarea
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="Note for the record — and the reason shown to the author if you suspend."
                          className="min-h-[54px] text-sm"
                          data-testid={`review-note-${r.id}`}
                        />
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          size="sm" className="h-7 gap-1.5 text-xs"
                          disabled={resolve.isPending}
                          onClick={() => { setNoteFor(r.id); resolve.mutate({ id: r.id, status: "actioned" }); }}
                          data-testid={`action-${r.id}`}
                        >
                          <Check className="h-3 w-3" /> Actioned
                        </Button>
                        <Button
                          size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
                          disabled={resolve.isPending}
                          onClick={() => resolve.mutate({ id: r.id, status: "dismissed" })}
                          data-testid={`dismiss-${r.id}`}
                        >
                          <X className="h-3 w-3" /> Dismiss
                        </Button>
                        {noteFor !== r.id && (
                          <Button
                            size="sm" variant="ghost" className="h-7 text-xs"
                            onClick={() => setNoteFor(r.id)}
                          >
                            Add a note
                          </Button>
                        )}
                        {r.targetHidden !== null && r.targetHidden !== undefined && (
                          <Button
                            size="sm" variant={r.targetHidden ? "outline" : "destructive"} className="h-7 text-xs"
                            disabled={takedown.isPending || (!r.targetHidden && !note.trim())}
                            title={r.targetHidden ? "Put it back" : "Hide it from everyone but its author (needs a note)"}
                            onClick={() => takedown.mutate({ type: r.targetType, id: r.targetId, hide: !r.targetHidden })}
                            data-testid={`button-${r.targetHidden ? "restore" : "takedown"}-${r.id}`}
                          >
                            {r.targetHidden ? "Restore content" : "Take down"}
                          </Button>
                        )}
                        {r.ownerId && (
                          <Button
                            size="sm"
                            variant={r.ownerSuspended ? "outline" : "ghost"}
                            className={`h-7 gap-1.5 text-xs ml-auto ${r.ownerSuspended ? "" : "text-destructive hover:text-destructive"}`}
                            disabled={suspend.isPending}
                            onClick={() => suspend.mutate({ userId: r.ownerId!, suspended: !r.ownerSuspended })}
                            data-testid={`suspend-${r.id}`}
                          >
                            {r.ownerSuspended
                              ? <><UserCheck className="h-3 w-3" /> Reinstate author</>
                              : <><UserX className="h-3 w-3" /> Suspend author</>}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
