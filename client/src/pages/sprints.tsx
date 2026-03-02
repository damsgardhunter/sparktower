import { useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { UserAvatar } from "@/components/user-avatar";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { CofounderSprint, User } from "@shared/schema";
import {
  Loader2, Plus, Users, Timer, Sparkles,
  CheckCircle2, Clock, ArrowRight, XCircle,
} from "lucide-react";

type SprintWithUsers = CofounderSprint & { user1?: User; user2?: User };

const STATUS_STYLES: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  setup: { label: "Setup", variant: "outline" },
  ideation: { label: "Ideation", variant: "secondary" },
  alignment: { label: "Alignment", variant: "secondary" },
  building: { label: "Building", variant: "default" },
  validation: { label: "Validation", variant: "default" },
  review: { label: "Review", variant: "secondary" },
  completed: { label: "Completed", variant: "outline" },
};

export default function Sprints() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: sprints, isLoading } = useQuery<SprintWithUsers[]>({
    queryKey: ["/api/sprints"],
  });

  const { data: queueStatus } = useQuery<{
    inQueue: boolean;
    matched?: boolean;
    sprint?: SprintWithUsers;
    entry?: { duration: string; productStyle: string; createdAt: string };
  }>({
    queryKey: ["/api/sprints/queue/status"],
    refetchInterval: 5000,
  });

  const leaveQueueMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/sprints/queue");
    },
    onSuccess: () => {
      toast({ title: "Left queue", description: "You've been removed from the matchmaking queue." });
      queryClient.invalidateQueries({ queryKey: ["/api/sprints/queue/status"] });
    },
  });

  const matchHandled = useRef(false);
  useEffect(() => {
    if (queueStatus?.matched && queueStatus.sprint && !matchHandled.current) {
      matchHandled.current = true;
      queryClient.invalidateQueries({ queryKey: ["/api/sprints"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sprints/queue/status"] });
      toast({ title: "Match found!", description: "You've been paired with a partner." });
      setLocation(`/sprints/${queueStatus.sprint.id}`);
    }
  }, [queueStatus?.matched, queueStatus?.sprint]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="loading-sprints">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const activeSprints = sprints?.filter(s => s.status !== "completed") || [];
  const completedSprints = sprints?.filter(s => s.status === "completed") || [];

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-sprints-title">Co-Founder Sprints</h1>
            <p className="text-muted-foreground mt-1">Trial collaborations to find your perfect co-founder</p>
          </div>
          <Button onClick={() => setLocation("/sprints/new")} data-testid="button-new-sprint">
            <Plus className="h-4 w-4 mr-2" />
            New Sprint
          </Button>
        </div>

        {queueStatus?.inQueue && queueStatus.entry && (
          <section className="mb-8">
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold" data-testid="text-queue-status">Waiting for a partner...</h3>
                      <p className="text-sm text-muted-foreground">
                        You're in the matchmaking queue for a {queueStatus.entry.duration} sprint.
                        We'll match you as soon as another builder joins.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Badge variant="outline">{queueStatus.entry.duration}</Badge>
                    {queueStatus.entry.productStyle && (
                      <Badge variant="outline">{queueStatus.entry.productStyle}</Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => leaveQueueMutation.mutate()}
                      disabled={leaveQueueMutation.isPending}
                      data-testid="button-leave-queue"
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Cancel
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {activeSprints.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Active Sprints ({activeSprints.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeSprints.map(sprint => {
                const partner = sprint.user1Id === user?.id ? sprint.user2 : sprint.user1;
                const style = STATUS_STYLES[sprint.status] || STATUS_STYLES.setup;
                return (
                  <Card
                    key={sprint.id}
                    className="cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => setLocation(`/sprints/${sprint.id}`)}
                    data-testid={`sprint-card-${sprint.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold truncate" data-testid={`text-sprint-name-${sprint.id}`}>
                            {sprint.productName || "Untitled Sprint"}
                          </h3>
                          {sprint.productDescription && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{sprint.productDescription}</p>
                          )}
                        </div>
                        <Badge variant={style.variant} data-testid={`badge-sprint-status-${sprint.id}`}>{style.label}</Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-3">
                        <div className="flex items-center gap-2">
                          <UserAvatar src={partner?.profileImageUrl} name={partner?.firstName || "Partner"} className="h-6 w-6" />
                          <span className="text-sm text-muted-foreground">{partner?.firstName || "Partner"}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Timer className="h-3.5 w-3.5" />
                          {sprint.duration}
                        </div>
                        {sprint.productStyle && (
                          <Badge variant="outline" className="text-xs">{sprint.productStyle}</Badge>
                        )}
                      </div>
                      <div className="flex items-center justify-end mt-3">
                        <span className="text-xs text-primary flex items-center gap-1">
                          Continue <ArrowRight className="h-3 w-3" />
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {completedSprints.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              Completed ({completedSprints.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {completedSprints.map(sprint => {
                const partner = sprint.user1Id === user?.id ? sprint.user2 : sprint.user1;
                return (
                  <Card
                    key={sprint.id}
                    className="cursor-pointer hover:border-primary/50 transition-colors opacity-80"
                    onClick={() => setLocation(`/sprints/${sprint.id}`)}
                    data-testid={`sprint-card-completed-${sprint.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-semibold truncate flex-1">{sprint.productName || "Untitled Sprint"}</h3>
                        <Badge variant="outline">Completed</Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-3">
                        <div className="flex items-center gap-2">
                          <UserAvatar src={partner?.profileImageUrl} name={partner?.firstName || "Partner"} className="h-6 w-6" />
                          <span className="text-sm text-muted-foreground">{partner?.firstName || "Partner"}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Timer className="h-3.5 w-3.5" />
                          {sprint.duration}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {(!sprints || sprints.length === 0) && !queueStatus?.inQueue && (
          <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed rounded-lg bg-card/50">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">No sprints yet</h3>
            <p className="text-muted-foreground max-w-sm mt-2 mb-6">
              Start a trial collaboration with a potential co-founder. You can find partners from your matches or get randomly paired.
            </p>
            <Button onClick={() => setLocation("/sprints/new")} data-testid="button-new-sprint-empty">
              <Sparkles className="h-4 w-4 mr-2" />
              Start Your First Sprint
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
