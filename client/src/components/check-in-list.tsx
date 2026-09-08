import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { useToast } from "@/hooks/use-toast";
import { trackLoopEvent, LOOP_EVENTS } from "@/lib/loop-events";
import { CheckInComposer } from "@/components/check-in-composer";
import { useNovaHandoff } from "@/components/nova-handoff";
import {
  Plus, Target, Link2, Globe, ArrowRight, Copy, ExternalLink,
  MessageSquare, AlertTriangle, Check, Pencil, Trash2, Loader2,
} from "lucide-react";
import { weekLabel, checkInPath, shareText, type CheckInVisibility } from "@shared/check-in";

interface CheckIn {
  id: string;
  userId: string;
  weekStart: string;
  goal: string;
  proof: string;
  blocker: string | null;
  nextStep: string;
  visibility: CheckInVisibility;
  needsFeedback: boolean;
  createdAt: string;
  author: { name: string; avatarUrl: string | null };
}

/**
 * A project's check-ins, and the button that starts a new one.
 *
 * Each card carries its own Copy link — step 4 of the loop. The share text is
 * pre-written rather than leaving someone to compose a post, because the point
 * at which they have to write something from scratch is the point they don't
 * share at all.
 */
export function CheckInList({
  projectId, projectTitle,
}: {
  projectId: string;
  projectTitle: string;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<CheckIn | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "check-ins"] });
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "check-ins", "context"] });
  };

  const describeError = (err: any, fallback: string) => {
    const raw = err?.message || "";
    const start = raw.indexOf("{");
    if (start >= 0) {
      try { return JSON.parse(raw.slice(start)).message || fallback; } catch { /* keep */ }
    }
    return fallback;
  };

  /** Changing your mind about who can see it, after the fact. */
  const setVisibility = useMutation({
    mutationFn: async ({ id, visibility }: { id: string; visibility: CheckInVisibility }) => {
      const res = await apiRequest("PATCH", `/api/check-ins/${id}`, { visibility });
      return res.json();
    },
    onSuccess: (c: CheckIn) => {
      toast({
        title: c.visibility === "public" ? "Now public" : "Now unlisted",
        description: c.visibility === "public"
          ? "It can appear in the feedback queue."
          : "Still reachable by link, listed nowhere.",
      });
      refresh();
    },
    onError: (err) => toast({
      title: "Couldn't change that", description: describeError(err, "Try again."), variant: "destructive",
    }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/check-ins/${id}`); },
    onSuccess: () => { toast({ title: "Check-in deleted" }); refresh(); },
    onError: (err) => toast({
      title: "Couldn't delete that", description: describeError(err, "Try again."), variant: "destructive",
    }),
  });

  // Arriving from the dashboard's "You haven't checked in this week" opens the
  // composer directly rather than dropping the person on a list.
  useNovaHandoff("activity.checkIn", () => setComposing(true));

  const { data: checkIns, isLoading } = useQuery<CheckIn[]>({
    queryKey: ["/api/projects", projectId, "check-ins"],
    enabled: !!projectId,
  });

  const copyLink = async (checkIn: CheckIn) => {
    const url = `${window.location.origin}${checkInPath(checkIn.id)}`;
    const text = shareText({
      projectTitle, goal: checkIn.goal, nextStep: checkIn.nextStep, url,
    });
    try {
      await navigator.clipboard.writeText(text);
      // The share artifact exists the moment it's on the clipboard.
      trackLoopEvent(LOOP_EVENTS.shareInitiated, { projectId, checkInId: checkIn.id });
      setCopied(checkIn.id);
      setTimeout(() => setCopied(null), 2000);
      toast({ title: "Copied", description: "Link and share text are on your clipboard." });
    } catch {
      // Clipboard is blocked in some contexts; show the URL so it's still usable.
      toast({ title: "Copy failed", description: url, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" /> Weekly check-ins
          </h3>
          <p className="text-xs text-muted-foreground">
            Goal, proof, blocker, next step. Under two minutes.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setComposing(true)} data-testid="button-new-checkin">
          <Plus className="h-4 w-4" /> New check-in
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !checkIns?.length ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center space-y-2">
            <Target className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm font-medium">No check-ins yet</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              One a week: what you aimed for, what shipped, what's in the way, and the single
              next thing. It gets a link you can send to anyone.
            </p>
            <Button size="sm" variant="outline" onClick={() => setComposing(true)}>
              Write the first one
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {checkIns.map((c) => (
            <Card key={c.id} data-testid={`checkin-${c.id}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <UserAvatar src={c.author.avatarUrl} name={c.author.name} className="h-7 w-7" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-tight">{c.author.name}</p>
                      <p className="text-[11px] text-muted-foreground">{weekLabel(c.weekStart)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className="text-[10px] gap-1">
                      {c.visibility === "public"
                        ? <><Globe className="h-2.5 w-2.5" /> Public</>
                        : <><Link2 className="h-2.5 w-2.5" /> Unlisted</>}
                    </Badge>
                    {c.needsFeedback && (
                      <Badge className="text-[10px] gap-1">
                        <MessageSquare className="h-2.5 w-2.5" /> Wants feedback
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium leading-snug">{c.goal}</p>
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{c.proof}</p>
                  {c.blocker && (
                    <p className="text-sm flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span className="leading-relaxed">{c.blocker}</span>
                    </p>
                  )}
                  <p className="text-sm flex items-start gap-1.5">
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" />
                    <span className="leading-relaxed">{c.nextStep}</span>
                  </p>
                </div>

                <div className="flex items-center gap-1 pt-1 border-t border-border/50 flex-wrap">
                  <Button
                    variant="ghost" size="sm" className="h-7 gap-1.5 text-xs"
                    onClick={() => copyLink(c)}
                    data-testid={`button-copy-checkin-${c.id}`}
                  >
                    {copied === c.id
                      ? <><Check className="h-3.5 w-3.5 text-emerald-500" /> Copied</>
                      : <><Copy className="h-3.5 w-3.5" /> Copy link</>}
                  </Button>
                  <Button
                    variant="ghost" size="sm" className="h-7 gap-1.5 text-xs"
                    onClick={() => window.open(checkInPath(c.id), "_blank")}
                    data-testid={`button-open-checkin-${c.id}`}
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Open page
                  </Button>

                  {/* Your own check-in stays editable — a typo in something
                      you've already shared shouldn't be permanent, and the
                      permalink survives the edit. */}
                  {user?.id === c.userId && (
                    <>
                      <Button
                        variant="ghost" size="sm" className="h-7 gap-1.5 text-xs"
                        onClick={() => setEditing(c)}
                        data-testid={`button-edit-checkin-${c.id}`}
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button
                        variant="ghost" size="sm" className="h-7 gap-1.5 text-xs"
                        disabled={setVisibility.isPending}
                        onClick={() => setVisibility.mutate({
                          id: c.id,
                          visibility: c.visibility === "public" ? "unlisted" : "public",
                        })}
                        data-testid={`button-visibility-${c.id}`}
                      >
                        {setVisibility.isPending && setVisibility.variables?.id === c.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : c.visibility === "public"
                            ? <><Link2 className="h-3.5 w-3.5" /> Make unlisted</>
                            : <><Globe className="h-3.5 w-3.5" /> Make public</>}
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-destructive ml-auto"
                        onClick={() => remove.mutate(c.id)}
                        data-testid={`button-delete-checkin-${c.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CheckInComposer projectId={projectId} open={composing} onClose={() => setComposing(false)} />
      <CheckInComposer
        projectId={projectId}
        open={!!editing}
        editing={editing}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
