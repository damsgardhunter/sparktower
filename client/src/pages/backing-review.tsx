import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import NotFound from "@/pages/not-found";
import {
  Loader2, ShieldCheck, CheckCircle2, XCircle, AlertTriangle, Banknote,
  ExternalLink, Clock,
} from "lucide-react";
import { PLATFORM_FEE_PERCENT, creatorPayoutCents } from "@shared/backing";

interface QueueRow {
  projectId: string;
  projectTitle: string;
  ownerId: string;
  reviewStatus: "pending" | "approved" | "rejected" | "not_submitted";
  submittedForReviewAt: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  heldCents: number;
  heldBackers: number;
  believerCount: number;
}

interface Signals {
  project: { id: string; title: string; createdAt: string };
  owner: { id: string; email: string | null; createdAt: string } | null;
  codeAudit: { completionPercent: number | null; stage: string | null; source: string; createdAt: string } | null;
  completedTasks: number;
  profileCompleteness: number;
  hasRepoUrl: boolean;
  hasLiveUrl: boolean;
  memberCount: number;
  stripeAccount: { detailsSubmitted: boolean; chargesEnabled: boolean; payoutsEnabled: boolean } | null;
  backers: number;
  heldCents: number;
  releasedCents: number;
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2,
  })}`;

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  approved: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  rejected: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
};

/**
 * The payout console.
 *
 * Deliberately shows the evidence next to the button rather than a score next
 * to a button — nothing here computes a verdict, because the whole point of
 * choosing manual review is that a person weighs a thin-looking early project
 * differently from a thin-looking fake one.
 *
 * Approving and releasing are two separate actions. Approving says "this
 * project is real"; releasing says "send this specific money". One misread
 * should not be able to do both.
 */
export default function BackingReview() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const isReviewer = user
    && ((user as any).platformRole === "reviewer" || (user as any).platformRole === "admin");

  const { data: queue, isLoading } = useQuery<QueueRow[]>({
    queryKey: ["/api/admin/backing/queue"],
    enabled: !!isReviewer,
  });

  const { data: signals, isLoading: signalsLoading } = useQuery<Signals>({
    queryKey: ["/api/admin/backing", selected, "signals"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/backing/${selected}/signals`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: !!selected && !!isReviewer,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/backing/queue"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/backing", selected, "signals"] });
  };

  const describeError = (err: any, fallback: string) => {
    const raw = err?.message || "";
    const start = raw.indexOf("{");
    if (start >= 0) {
      try { return JSON.parse(raw.slice(start)).message || fallback; } catch { /* keep */ }
    }
    return fallback;
  };

  const decide = useMutation({
    mutationFn: async (decision: "approved" | "rejected") => {
      const res = await apiRequest("POST", `/api/admin/backing/${selected}/decision`, {
        decision, notes,
      });
      return res.json();
    },
    onSuccess: (result: any) => {
      toast({
        title: "Decision recorded",
        description: result?.merchWaiting
          ? `${result.merchWaiting} merch order(s) now clear to ship.`
          : undefined,
      });
      setNotes("");
      refresh();
    },
    onError: (err) => toast({
      title: "Couldn't record that",
      description: describeError(err, "Try again."),
      variant: "destructive",
    }),
  });

  const release = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/backing/${selected}/release`);
      return res.json();
    },
    onSuccess: (result: any) => {
      toast({
        title: `Released ${result.released} pledge(s)`,
        description: `${money(result.totalCents)} sent.${
          result.failed?.length ? ` ${result.failed.length} failed — check the logs.` : ""
        }`,
        variant: result.failed?.length ? "destructive" : "default",
      });
      refresh();
    },
    onError: (err) => toast({
      title: "Couldn't release funds",
      description: describeError(err, "Try again."),
      variant: "destructive",
    }),
  });

  if (authLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  // Same answer the API gives a non-reviewer: this page does not exist.
  if (!isReviewer) return <NotFound />;

  const current = queue?.find((q) => q.projectId === selected);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6" data-testid="backing-review">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" /> Payout review
        </h1>
        <p className="text-sm text-muted-foreground">
          Backer money sits with SparkTower until you approve the project behind it.
          SparkTower keeps {PLATFORM_FEE_PERCENT}% of every released pledge.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Queue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin mx-auto my-6 text-primary" />
            ) : !queue?.length ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Nothing submitted yet.
              </p>
            ) : (
              queue.map((row) => (
                <button
                  key={row.projectId}
                  type="button"
                  onClick={() => { setSelected(row.projectId); setNotes(""); }}
                  className={`w-full text-left rounded-lg border p-2.5 transition-colors ${
                    selected === row.projectId ? "border-primary" : "border-border/60 hover:border-primary/50"
                  }`}
                  data-testid={`queue-${row.projectId}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium min-w-0 break-words">{row.projectTitle}</span>
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${STATUS_STYLE[row.reviewStatus] || ""}`}>
                      {row.reviewStatus}
                    </Badge>
                  </div>
                  {row.heldCents > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {money(row.heldCents)} held · {row.heldBackers} backer(s)
                    </p>
                  )}
                </button>
              ))
            )}
          </CardContent>
        </Card>

        {!selected ? (
          <Card>
            <CardContent className="py-20 text-center text-muted-foreground">
              Pick a project to review.
            </CardContent>
          </Card>
        ) : signalsLoading || !signals ? (
          <Card>
            <CardContent className="py-20 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <CardTitle className="text-lg">{signals.project.title}</CardTitle>
                  <Button
                    variant="outline" size="sm" className="gap-1.5"
                    onClick={() => window.open(`/projects/${signals.project.id}`, "_blank")}
                    data-testid="button-open-project"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Open project
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: "Backers", value: String(signals.backers) },
                    { label: "Held", value: money(signals.heldCents) },
                    { label: "Released", value: money(signals.releasedCents) },
                    { label: "Team", value: String(signals.memberCount) },
                  ].map((s) => (
                    <div key={s.label} className="rounded-lg border border-border/60 p-2.5">
                      <p className="text-[11px] text-muted-foreground">{s.label}</p>
                      <p className="text-base font-semibold">{s.value}</p>
                    </div>
                  ))}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Evidence</Label>
                  {[
                    {
                      label: "Codebase audit",
                      ok: (signals.codeAudit?.completionPercent ?? 0) > 0,
                      detail: signals.codeAudit
                        ? `${signals.codeAudit.completionPercent ?? "?"}% · ${signals.codeAudit.stage || "no stage"} · ${signals.codeAudit.source}`
                        : "Never run",
                    },
                    {
                      label: "Tasks finished",
                      ok: signals.completedTasks > 0,
                      detail: `${signals.completedTasks} completed`,
                    },
                    {
                      label: "Owner profile",
                      ok: signals.profileCompleteness >= 80,
                      detail: `${signals.profileCompleteness}% filled in`,
                    },
                    {
                      label: "Something to show",
                      ok: signals.hasRepoUrl || signals.hasLiveUrl,
                      detail: [signals.hasRepoUrl && "repo", signals.hasLiveUrl && "live URL"]
                        .filter(Boolean).join(" + ") || "neither",
                    },
                    {
                      label: "Stripe identity",
                      ok: Boolean(signals.stripeAccount?.payoutsEnabled),
                      detail: signals.stripeAccount
                        ? [
                            signals.stripeAccount.detailsSubmitted && "details submitted",
                            signals.stripeAccount.chargesEnabled && "charges on",
                            signals.stripeAccount.payoutsEnabled && "payouts on",
                          ].filter(Boolean).join(", ") || "onboarding incomplete"
                        : "no connected account",
                    },
                    {
                      label: "Account age",
                      ok: true,
                      detail: signals.owner?.createdAt
                        ? `owner joined ${new Date(signals.owner.createdAt).toLocaleDateString()}`
                        : "unknown",
                    },
                  ].map((s) => (
                    <div key={s.label} className="flex items-start gap-2 text-sm">
                      {s.ok
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                        : <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />}
                      <span className="font-medium">{s.label}</span>
                      <span className="text-muted-foreground text-xs mt-0.5">· {s.detail}</span>
                    </div>
                  ))}
                  <p className="text-[11px] text-muted-foreground pt-1">
                    Signals only. A three-week-old project failing four of these can be
                    completely legitimate — read the project, not the checkmarks.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Decision</CardTitle>
                {current?.reviewNotes && (
                  <p className="text-xs text-muted-foreground">
                    Last note: {current.reviewNotes}
                  </p>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="What you want the creator to read. If you're rejecting, say what would change your mind."
                  className="min-h-[70px]"
                  maxLength={2000}
                  data-testid="textarea-review-notes"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm" className="gap-1.5"
                    disabled={decide.isPending || current?.reviewStatus === "approved"}
                    onClick={() => decide.mutate("approved")}
                    data-testid="button-approve"
                  >
                    {decide.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Approve for payouts
                  </Button>
                  <Button
                    size="sm" variant="outline" className="gap-1.5"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate("rejected")}
                    data-testid="button-reject"
                  >
                    <XCircle className="h-4 w-4" /> Reject
                  </Button>
                </div>

                {current?.reviewStatus === "approved" && (
                  <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <Banknote className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Releases {money(signals.heldCents)} held across {signals.backers} pledge(s).
                        The creator receives {money(creatorPayoutCents(signals.heldCents))} after the
                        {" "}{PLATFORM_FEE_PERCENT}% fee. Each pledge transfers separately, so one
                        failure doesn't take the batch with it.
                      </p>
                    </div>
                    <Button
                      size="sm" className="gap-1.5"
                      disabled={release.isPending || signals.heldCents === 0}
                      onClick={() => release.mutate()}
                      data-testid="button-release"
                    >
                      {release.isPending
                        ? <><Loader2 className="h-4 w-4 animate-spin" /> Releasing…</>
                        : <><Banknote className="h-4 w-4" /> Release {money(signals.heldCents)}</>}
                    </Button>
                  </div>
                )}

                {current?.submittedForReviewAt && (
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Submitted {new Date(current.submittedForReviewAt).toLocaleString()}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
