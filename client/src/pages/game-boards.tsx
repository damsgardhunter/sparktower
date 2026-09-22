/**
 * The leaderboards.
 *
 * Six of them — an overall, plus one per dimension — and the reason there are
 * six rather than one is the whole point: a pair who built something reckless
 * and enormous and a pair who built something small and certain should each be
 * able to find a board they are near the top of. One ranking would tell most
 * people they came 40th and give them nothing to come back for.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { money } from "@shared/sprints/budget";
import { ordinal } from "@/components/game/verdict";

export default function GameBoardsPage() {
  const [, navigate] = useLocation();
  const [board, setBoard] = useState("overall");

  const { data, isLoading } = useQuery<any>({
    /* Two parts, so ["/api/games"] and ["/api/games", "leaderboard"] both
       prefix-match it — a single template string matches neither, which is why
       finishing a game never refreshed the board it had just changed. The
       default query function joins the key with "/", so this is still
       /api/games/leaderboard?board=… */
    queryKey: ["/api/games", `leaderboard?board=${board}`],
  });

  const boards = data?.boards ?? [];
  const standings = data?.standings ?? [];
  const current = boards.find((b: any) => b.id === board);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Leaderboards</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every company anyone has built, scored out of a thousand.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {boards.map((b: any) => (
          <Button
            key={b.id}
            size="sm"
            variant={b.id === board ? "default" : "outline"}
            onClick={() => setBoard(b.id)}
            data-testid={`board-${b.id}`}
          >
            {b.title}
          </Button>
        ))}
      </div>

      {current?.blurb && <p className="mt-3 text-sm text-muted-foreground">{current.blurb}</p>}

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : standings.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          <p>Nobody has finished a game yet.</p>
          <Button className="mt-4" onClick={() => navigate("/sprints")}>Be the first</Button>
        </div>
      ) : (
        <ol className="mt-5 space-y-2" data-testid="standings">
          {standings.map((s: any) => (
            <li
              key={`${s.rank}-${s.name}`}
              className={cn(
                "flex items-center gap-3 rounded-xl border p-3.5 transition-colors",
                // Your own game, found without scrolling for it.
                s.isYours ? "border-primary bg-primary/5" : "border-border bg-card",
              )}
            >
              <span className={cn(
                "w-10 shrink-0 text-center text-sm font-semibold tabular-nums",
                s.rank <= 3 ? "text-primary" : "text-muted-foreground",
              )}>
                {ordinal(s.rank)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{s.name}</span>
                  {s.isYours && <Badge variant="secondary" className="shrink-0 text-[10px]">Yours</Badge>}
                </div>
                {/* A bot says so here too. A row reading "Dana & Ada Fournier"
                    with no further word implies two people beat you. */}
                <p className="truncate text-xs text-muted-foreground">
                  {s.players.map((p: any, i: number) => (
                    <span key={i}>
                      {i > 0 && " & "}
                      {p.name}
                      {p.isBot && <span className="ml-1 rounded border border-border px-1 text-[10px]">Bot</span>}
                    </span>
                  ))}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-semibold tabular-nums">{s.score}</div>
                <div className="text-xs text-muted-foreground tabular-nums">{money(s.tenYear)}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
