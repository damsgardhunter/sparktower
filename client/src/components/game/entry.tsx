/**
 * The way into Ten Years From Now.
 *
 * ## One button, and it always says what will actually happen
 *
 * There are four states this card can be in — a game in progress, a game
 * available, the day's game already used, and the feature unreachable — and
 * the whole design of it is that the button never lies about which one you are
 * in. A "Play now" that the server refuses is worse than a disabled button
 * saying why, because the person has already decided to spend half an hour by
 * the time they find out.
 *
 * So the allowance rides along with the active game on one request
 * (`/api/games/active`), and the button, the badge and the line underneath are
 * all written from the same answer.
 *
 * ## The limit is stated up front, not on refusal
 *
 * "One game a day" appears on the card before anyone has played, whether or
 * not it currently applies. A limit somebody meets for the first time as an
 * error reads as the product breaking; the same limit read in advance is a
 * rule, and it makes the score at the end mean more rather than less — which
 * is the actual reason for it (see GAME_COOLDOWN_MS).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Play, Trophy, Clock, CalendarCheck } from "lucide-react";
import { TOTAL_SECONDS } from "@shared/sprints/game";
import { PastGames, type PastGame } from "./past-games";
import { YourIdeaStaysYours } from "./your-idea";

/** What `/api/games/active` says about your allowance. */
interface Daily {
  perDay: number;
  startedToday: number;
  canStart: boolean;
  unlocksAt: string | null;
  /** "in about 9 hours", or null when one is available now. */
  opensIn: string | null;
}

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
  const { data: active } = useQuery<{ games: { id: string }[]; daily: Daily }>({ queryKey: ["/api/games", "active"] });
  const inProgress = active?.games?.[0];
  const daily = active?.daily;

  /*
   * And the ones already finished.
   *
   * A verdict used to be reachable from exactly one URL — the one you still
   * had open — because the active-game route deliberately returns only
   * playable rounds. Half an hour of play with an AI's judgement at the end of
   * it, lost by pressing back.
   */
  const { data: past } = useQuery<{ games: PastGame[] }>({ queryKey: ["/api/games", "history"] });
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
          /*
           * The day's game is gone — most likely because it was used on
           * another device since this card was drawn. Refetch so the button
           * stops offering something that will be refused again.
           */
          if (body.code === "played_today") {
            void qc.invalidateQueries({ queryKey: ["/api/games", "active"] });
          }
          return toast({ title: body.message ?? "Couldn't start", variant: "destructive" });
        } catch { /* fall through */ }
      }
      toast({ title: "Couldn't start a game", variant: "destructive" });
    },
  });

  const minutes = Math.round(TOTAL_SECONDS / 60);
  /* A game in progress is never a refusal: it is yours to go back to. */
  const locked = !inProgress && daily ? !daily.canStart : false;

  return (
    /*
      * The soft ring rather than the full one: this and the market card are a
      * pair of equals, and the loud gradient is for the one thing on a screen
      * that should draw the eye.
      */
    <Card className="nova-ring-soft overflow-hidden">
      <CardContent className="space-y-4 p-4 sm:p-5">
        {/*
          * The copy gets the whole width and the buttons go underneath.
          *
          * They used to sit in the same row, `shrink-0`, so on a two-column
          * grid they claimed most of the card and left the paragraph a
          * hundred-pixel gutter running twelve lines down beside an empty
          * half. Nothing about the sentence fixed that; the row did.
          */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="nova-chip flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
              <Play className="h-4 w-4" />
            </span>
            <h3 className="text-lg font-semibold">Ten Years From Now</h3>
            <Badge variant="secondary">~{minutes} min</Badge>
            {/* Stated before it bites, not as an error afterwards. */}
            <Badge variant="outline" className="gap-1 font-normal" data-testid="badge-once-a-day">
              <CalendarCheck className="h-3 w-3" /> One a day
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Five rounds with a stranger to invent a startup. An AI says what it's worth in ten years.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          {inProgress ? (
            <Button className="w-full sm:w-auto" onClick={() => navigate(`/sprints/game/${inProgress.id}`)} data-testid="button-resume-game">
              Back to your game
            </Button>
          ) : (
            <Button
              className="w-full sm:w-auto"
              onClick={() => start.mutate()}
              disabled={start.isPending || locked}
              data-testid="button-start-game"
            >
              {start.isPending
                ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                : locked ? <Clock className="mr-1.5 h-4 w-4" /> : <Play className="mr-1.5 h-4 w-4" />}
              {locked ? "Played today" : "Play now"}
            </Button>
          )}
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => navigate("/sprints/boards")} data-testid="button-game-boards">
            <Trophy className="mr-1.5 h-4 w-4" /> Leaderboards
          </Button>
        </div>

        {/*
          * Before the button, not after it. The question "what happens to what
          * I write" is one somebody has while deciding whether to start, and an
          * answer they find afterwards is an answer that arrived too late.
          */}
        <YourIdeaStaysYours />

        {/*
          * When it opens again, exactly. A limit whose end nobody can see reads
          * as the product being broken rather than as a rule.
          */}
        {locked && (
          <p className="flex items-start gap-2 rounded-lg border border-border bg-background/60 p-3 text-sm" data-testid="text-play-again">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>
              Today's game is played. The next opens{" "}
              <span className="font-medium">{daily?.opensIn ?? "shortly"}</span>.{" "}
              <span className="text-muted-foreground">One a day keeps the boards worth topping.</span>
            </span>
          </p>
        )}

        {finished.length > 0 && (
          <div className="border-t border-border/60 pt-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Your past games
            </p>
            <PastGames games={finished.slice(0, 5)} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
