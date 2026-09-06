import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useEntitlements } from "@/hooks/use-entitlements";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import {
  Loader2, Users, Bot, Timer, Zap, XCircle, ArrowRight, FolderKanban, Shuffle,
} from "lucide-react";
import { CREDIT_COSTS } from "@shared/plans";
import type { Project } from "@shared/schema";

type Duration = "24h" | "72h";

interface QueueStatus {
  inQueue: boolean;
  matched?: boolean;
  sprint?: { id: string };
  entry?: { duration: string; productStyle: string | null };
  position?: number | null;
  waiting?: number;
  waitingSeconds?: number;
}

/**
 * Start a sprint from the Teams page: either queue for a live partner or
 * practise against Nova.
 *
 * Sprints normally invent a throwaway product, so this also lets you bring one
 * of your own projects — that way the sprint doubles as real work on something
 * you already care about.
 */
export function SprintLauncher() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { can } = useEntitlements();

  const [duration, setDuration] = useState<Duration>("24h");
  const [projectId, setProjectId] = useState<string>("none");

  const { data: myProjects } = useQuery<Project[]>({ queryKey: ["/api/user/projects"] });

  const { data: queueStatus } = useQuery<QueueStatus>({
    queryKey: ["/api/sprints/queue/status"],
    refetchInterval: 5000,
  });

  const chosenProject = myProjects?.find((p) => p.id === projectId);

  const surfaceError = (err: any, fallback: string) => {
    const raw = err?.message || "";
    const start = raw.indexOf("{");
    let description = fallback;
    if (start >= 0) {
      try { description = JSON.parse(raw.slice(start)).message || description; } catch { /* keep */ }
    }
    toast({ title: "Couldn't start", description, variant: "destructive" });
  };

  const queueMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sprints/queue", {
        duration,
        // Bringing a project seeds the sprint's product from its brief.
        projectId: projectId === "none" ? undefined : projectId,
      });
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sprints/queue/status"] });
      if (result.matched && result.sprint) {
        toast({ title: "Matched!", description: "You've been paired with a partner." });
        setLocation(`/sprints/${result.sprint.id}`);
      } else {
        toast({ title: "You're in the queue", description: `Waiting for another builder who wants a ${duration} sprint.` });
      }
    },
    onError: (err) => surfaceError(err, "Couldn't join the queue."),
  });

  const leaveMutation = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", "/api/sprints/queue"); },
    onSuccess: () => {
      toast({ title: "Left the queue" });
      queryClient.invalidateQueries({ queryKey: ["/api/sprints/queue/status"] });
    },
  });

  if (!can("createSprints")) {
    return (
      <UpgradePrompt
        requiredTier="starter"
        title="Run a sprint with someone"
        description="Get matched with another builder for a 24 or 72-hour co-founder trial, or practise the whole thing against Nova first."
      />
    );
  }

  // Already waiting — show the live queue state instead of the form.
  if (queueStatus?.inQueue) {
    return (
      <Card className="border-primary/30 bg-primary/5" data-testid="card-launcher-queued">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold">Looking for a partner…</p>
                <p className="text-sm text-muted-foreground">
                  You're #{queueStatus.position ?? "—"} in line · {queueStatus.waiting ?? 0} waiting
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline">{queueStatus.entry?.duration}</Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => leaveMutation.mutate()}
                disabled={leaveMutation.isPending}
                data-testid="button-launcher-leave-queue"
              >
                <XCircle className="h-4 w-4 mr-1" /> Leave
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md bg-background/60 border border-border/60 p-3">
            <p className="text-sm text-muted-foreground">
              Don't want to wait? Practise against Nova — you keep your place in line.
            </p>
            <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={() => setLocation("/sprints/practice")} data-testid="button-launcher-practice-waiting">
              <Bot className="h-3.5 w-3.5" /> Practice
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-sprint-launcher">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Timer className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold">Start a Sprint</p>
            <p className="text-sm text-muted-foreground">
              Build something with a stranger in 24 or 72 hours — or rehearse against Nova first.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">How long?</Label>
            <Select value={duration} onValueChange={(v) => setDuration(v as Duration)}>
              <SelectTrigger data-testid="select-launcher-duration"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">24 hours — quick validation</SelectItem>
                <SelectItem value="72h">72 hours — includes validation phase</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Build what?</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger data-testid="select-launcher-project"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  <span className="flex items-center gap-1.5"><Shuffle className="h-3.5 w-3.5" /> A fresh idea from Nova</span>
                </SelectItem>
                {(myProjects || []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-1.5"><FolderKanban className="h-3.5 w-3.5" /> {p.title}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {chosenProject && (
          <p className="text-xs text-muted-foreground">
            Your partner will see <strong>{chosenProject.title}</strong>'s brief, and the sprint will work on it directly.
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <Button
            className="flex-1 gap-2"
            disabled={queueMutation.isPending}
            onClick={() => queueMutation.mutate()}
            data-testid="button-launcher-find-partner"
          >
            {queueMutation.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Users className="h-4 w-4" />}
            Find a partner
          </Button>
          <Button
            variant="outline"
            className="flex-1 gap-2"
            onClick={() => setLocation("/sprints/practice")}
            data-testid="button-launcher-practice"
          >
            <Bot className="h-4 w-4" />
            Practice with Nova
            <Badge variant="secondary" className="ml-0.5 text-[10px]">{CREDIT_COSTS.practiceSprint}</Badge>
          </Button>
        </div>

        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Zap className="h-3 w-3" />
          Matching is free. Nova's ideas and practice partner use credits.
          <button className="text-primary hover:underline ml-auto flex items-center gap-0.5" onClick={() => setLocation("/sprints")} data-testid="link-launcher-all-sprints">
            All sprints <ArrowRight className="h-3 w-3" />
          </button>
        </p>
      </CardContent>
    </Card>
  );
}
