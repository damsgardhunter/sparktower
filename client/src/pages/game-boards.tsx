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
import { Loading } from "@/components/nova";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { money } from "@shared/sprints/budget";
import { ordinal } from "@/components/game/verdict";
import { Trophy, Medal, Award } from "lucide-react";

/**
 * The top three, on a podium.
 *
 * A leaderboard is a list, and a list makes first place a row — the same
 * shape as fourteenth, one line higher up. Everything about coming first is
 * carried by a small number in the left margin. So the top three come out of
 * the list and stand on a podium: first in the middle and tallest, second to
 * its left, third smaller again to its right, all three sitting on one base
 * line the way they do on an actual podium.
 *
 * Reading order is deliberately not rank order here. Centre-and-tallest is
 * read first whatever sits beside it, which is the one thing this page is for
 * saying, and the left-right split is how a podium is drawn everywhere else.
 *
 * Fewer than three finishers still get the middle column, so first place is
 * never off to one side waiting for company.
 *
 * The heights are fixed rather than minimums. With a minimum, a long company
 * name or a "Yours" badge grew second place to exactly first place's height,
 * and a podium whose middle step isn't the tallest is just three boxes.
 */
const PLACES = [
  {
    rank: 2,
    icon: Medal,
    ring: "nova-ring-soft",
    box: "h-[11.5rem] px-2.5 pt-5 pb-4 sm:px-3",
    name: "text-sm",
    score: "text-xl",
    badge: "h-8 w-8",
    iconSize: "h-4 w-4",
  },
  {
    rank: 1,
    icon: Trophy,
    // The loud ring, on the one thing on this screen that should draw the eye.
    ring: "nova-ring nova-glow",
    box: "h-[13.5rem] px-3 pt-7 pb-5 sm:px-4",
    name: "text-base",
    score: "text-3xl",
    badge: "h-11 w-11",
    iconSize: "h-5 w-5",
  },
  {
    rank: 3,
    icon: Award,
    ring: "nova-ring-soft",
    box: "h-[10.75rem] px-2.5 pt-4 pb-3.5 sm:px-3",
    name: "text-sm",
    score: "text-lg",
    badge: "h-7 w-7",
    iconSize: "h-3.5 w-3.5",
  },
] as const;

function Podium({ top }: { top: any[] }) {
  return (
    /*
     * `items-end` is what makes it a podium rather than three cards of
     * different heights: the boxes grow upwards from a shared base line.
     */
    <div className="mt-5 grid grid-cols-3 items-end gap-2 sm:gap-3" data-testid="podium">
      {PLACES.map((place) => {
        const entry = top[place.rank - 1];
        if (!entry) return <div key={place.rank} aria-hidden />;
        const Icon = place.icon;
        return (
          <div
            key={place.rank}
            className={cn(
              "flex flex-col items-center overflow-hidden rounded-2xl text-center",
              place.ring,
              place.box,
              entry.isYours && "ring-2 ring-primary ring-offset-2 ring-offset-background",
            )}
            data-testid={`podium-${place.rank}`}
          >
            <span className={cn("nova-chip flex shrink-0 items-center justify-center rounded-full", place.badge)}>
              <Icon className={place.iconSize} />
            </span>
            <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {ordinal(entry.rank)}
              {entry.isYours && <span className="rounded bg-primary/15 px-1 text-primary">yours</span>}
            </p>
            {/*
              * The height is fixed, so this block takes the slack: `flex-1`
              * with `min-h-0` lets it shrink, and the clamps cut the text
              * rather than the box. Without it a two-line company name pushed
              * the score out through the bottom edge.
              */}
            <div className="mt-1 w-full flex-1 min-h-0 overflow-hidden">
              <p className={cn("break-words font-semibold leading-tight line-clamp-2", place.name)}>
                {entry.name}
              </p>
              {/* Who built it, small — a bot still says so. */}
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {entry.players.map((pl: any, i: number) => (
                  <span key={i}>
                    {i > 0 && " & "}
                    {pl.name}
                    {pl.isBot && <span className="ml-0.5">(bot)</span>}
                  </span>
                ))}
              </p>
            </div>
            <p className={cn("font-semibold tabular-nums", place.score)}>{entry.score}</p>
            <p className="text-[11px] text-muted-foreground tabular-nums">{money(entry.tenYear)}</p>
          </div>
        );
      })}
    </div>
  );
}

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
        <Loading what="Counting the boards" />
      ) : standings.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          <p>Nobody has finished a game yet.</p>
          <Button className="mt-4" onClick={() => navigate("/sprints")}>Be the first</Button>
        </div>
      ) : (
        <>
        <Podium top={standings.slice(0, 3)} />

        {/* Fourth down, as a list. The podium has said what it came to say. */}
        <ol className="mt-3 space-y-2" data-testid="standings">
          {standings.slice(3).map((s: any) => (
            <li
              key={`${s.rank}-${s.name}`}
              className={cn(
                "flex items-center gap-3 rounded-xl border p-3.5 transition-colors",
                // Your own game, found without scrolling for it.
                s.isYours ? "border-primary bg-primary/5" : "border-border bg-card",
              )}
            >
              {/* Always muted: the list starts at fourth, so nothing in it is a medal. */}
              <span className="w-10 shrink-0 text-center text-sm font-semibold tabular-nums text-muted-foreground">
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
        </>
      )}
    </div>
  );
}
