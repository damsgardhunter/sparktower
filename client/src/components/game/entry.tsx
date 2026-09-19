/**
 * The way into Ten Years From Now.
 *
 * Written as its own card rather than another button in the header, for the
 * reason the simulation entry beside it exists: the last two things built into
 * this page were finished and unreachable, because the only route to them was
 * knowing the address and typing it. A feature nobody can find is a feature
 * nobody has.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Play, Trophy } from "lucide-react";
import { TOTAL_SECONDS } from "@shared/sprints/game";

export function GameEntry() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  /* A game you walked away from is the first thing this card should offer. */
  const { data: active } = useQuery<any>({ queryKey: ["/api/games/active"] });
  const inProgress = active?.games?.[0];

  const start = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/games/solo", {})).json(),
    onSuccess: (data: any) => navigate(`/sprints/game/${data.id}`),
    onError: (err: any) => {
      const raw = err?.message ?? "";
      const at = raw.indexOf("{");
      if (at >= 0) {
        try {
          const body = JSON.parse(raw.slice(at));
          // Already playing: take them there rather than refusing.
          if (body.gameId) return navigate(`/sprints/game/${body.gameId}`);
          return toast({ title: body.message ?? "Couldn't start", variant: "destructive" });
        } catch { /* fall through */ }
      }
      toast({ title: "Couldn't start a game", variant: "destructive" });
    },
  });

  const minutes = Math.round(TOTAL_SECONDS / 60);

  return (
    <Card className="mb-8 overflow-hidden border-primary/25 bg-gradient-to-br from-primary/5 to-transparent">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold">Ten Years From Now</h3>
            <Badge variant="secondary">~{minutes} min</Badge>
          </div>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Invent a startup with someone in five rounds — the idea, the customer, the money, the
            product, and how you spend your first million. Then find out what an AI thinks it's
            worth in a decade.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => navigate("/sprints/boards")} data-testid="button-game-boards">
            <Trophy className="mr-1.5 h-4 w-4" /> Leaderboards
          </Button>
          {inProgress ? (
            <Button onClick={() => navigate(`/sprints/game/${inProgress.id}`)} data-testid="button-resume-game">
              Back to your game
            </Button>
          ) : (
            <Button onClick={() => start.mutate()} disabled={start.isPending} data-testid="button-start-game">
              {start.isPending
                ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                : <Play className="mr-1.5 h-4 w-4" />}
              Play now
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
