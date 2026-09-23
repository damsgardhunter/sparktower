/**
 * The way into Ten Years From Now.
 *
 * Written as its own card rather than another button in the header, for the
 * reason the simulation entry beside it exists: the last two things built into
 * this page were finished and unreachable, because the only route to them was
 * knowing the address and typing it. A feature nobody can find is a feature
 * nobody has.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

  const qc = useQueryClient();

  /*
   * A game you walked away from is the first thing this card should offer.
   *
   * Two-part key on purpose: everything here is `staleTime: Infinity`, so this
   * answer is kept forever unless something invalidates it, and a single
   * template string `"/api/games/active"` cannot be reached by a prefix
   * invalidation from the game screen. That is the whole of the bug where the
   * card kept saying "Back to your game" about a game that had ended.
   */
  const { data: active } = useQuery<any>({ queryKey: ["/api/games", "active"] });
  const inProgress = active?.games?.[0];

  /*
   * And the ones already finished.
   *
   * A verdict used to be reachable from exactly one URL — the one you still
   * had open — because the active-game route deliberately returns only
   * playable rounds. Half an hour of play with an AI's judgement at the end of
   * it, lost by pressing back. The list is small and only shown when there is
   * something in it.
   */
  const { data: past } = useQuery<any>({ queryKey: ["/api/games", "history"] });
  const finished: PastGame[] = past?.games ?? [];

  const start = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/games/solo", {})).json(),
    onSuccess: (data: any) => {
      // The card is now looking at a stale "no active game".
      void qc.invalidateQueries({ queryKey: ["/api/games", "active"] });
      navigate(`/sprints/game/${data.id}`);
    },
    onError: (err: any) => {
      const raw = err?.message ?? "";
      const at = raw.indexOf("{");
      if (at >= 0) {
        try {
          const body = JSON.parse(raw.slice(at));
          // Already playing: take them there rather than refusing.
          if (body.gameId) {
            void qc.invalidateQueries({ queryKey: ["/api/games", "active"] });
            return navigate(`/sprints/game/${body.gameId}`);
          }
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

        {finished.length > 0 && (
          <div className="mt-4 w-full border-t border-border/60 pt-3" data-testid="game-history">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Your past games
            </p>
            <ul className="space-y-0.5">
              {finished.slice(0, 5).map((game) => (
                <li key={game.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/sprints/game/${game.id}`)}
                    className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60"
                    data-testid={`button-past-game-${game.id}`}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{game.name || "Unnamed startup"}</span>
                    {game.outcome === "abandoned" ? (
                      /* Named rather than scored: an abandoned game has no
                         verdict and never will, and showing a blank where the
                         number goes reads as a loading state that never ends. */
                      <span className="text-xs text-muted-foreground">
                        {game.youLeft ? "You left" : "Your partner left"}
                      </span>
                    ) : game.verdict ? (
                      <span className="text-xs text-muted-foreground" data-testid={`text-past-score-${game.id}`}>
                        {game.verdict.overall}/1000
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Being scored…</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** One row of `GET /api/games/history`. */
interface PastGame {
  id: string;
  name: string | null;
  outcome: "verdict" | "abandoned";
  youLeft: boolean;
  endedAt: string | null;
  verdict: { overall: number; tenYear: number | null; peak: number | null; fromModel: boolean } | null;
}
