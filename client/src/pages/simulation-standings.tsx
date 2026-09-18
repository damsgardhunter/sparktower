/**
 * Where everyone stands.
 *
 * Until this screen existed the simulation was a multiplayer game you played
 * alone: five people could run a company for a fortnight with no way to see
 * any of the others. Every number on the desk answers "what did we do"; none
 * of them answers "was that any good", and that second question is the one
 * that decides whether somebody opens the app tomorrow.
 *
 * ## The incumbents are in the table
 *
 * They hold most of the market, and a league table that quietly listed only
 * the player teams would tell everybody they were doing better than they are.
 * Fourth of nine is the honest position, and being honest about it is what
 * makes third of nine worth reaching for.
 *
 * ## And your own season, year by year
 *
 * A single ranking is a snapshot, and a snapshot cannot tell you whether you
 * are climbing. The history underneath is what turns fourteen separate days
 * into one story — the year the marketing landed, the year the incumbents came
 * back at you — which is the thing people actually recount to each other.
 */
import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NOVA_GRADIENT_CSS } from "@shared/backing";
import { Loader2, ArrowLeft, Trophy, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface Row {
  id: string; name: string; kind: "player" | "incumbent";
  customers: number; share: number; revenue: number; reputation: number; price: number;
  isYou: boolean; distress: string | null; rank: number;
}
interface Standings {
  year: number; totalYears: number; status: string;
  rows: Row[];
  history: { year: number; share: number; customers: number; profit: number; rank: number }[];
}

const compact = (n: number) =>
  n >= 1_000_000 ? `£${(n / 1_000_000).toFixed(1)}m` : n >= 1_000 ? `£${Math.round(n / 1_000)}k` : `£${Math.round(n)}`;

export default function SimulationStandingsPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();

  const { data, isLoading } = useQuery<Standings>({
    queryKey: [`/api/sim/ventures/${id}/standings`],
    refetchInterval: 30_000,
  });

  if (isLoading || !data) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const you = data.rows.find((r) => r.isYou);
  const peak = Math.max(...data.history.map((h) => h.share), 0.01);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-4">
      <div className="rounded-2xl p-[2px]" style={{ backgroundImage: NOVA_GRADIENT_CSS }}>
        <div className="rounded-[calc(1rem-1px)] bg-background p-6">
          <button onClick={() => navigate(`/simulation/${id}`)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2" data-testid="button-back-desk">
            <ArrowLeft className="h-3 w-3" /> Back to your desk
          </button>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" /> The market
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data.status === "finished"
              ? `The season is over. Fourteen years, and this is where it ended.`
              : `Year ${data.year} of ${data.totalYears}. Everyone in this market, including the companies that were here first.`}
          </p>
          {you && (
            <p className="text-sm mt-3" data-testid="text-your-rank">
              <span className="text-muted-foreground">You are </span>
              <span className="font-semibold">#{you.rank} of {data.rows.length}</span>
              <span className="text-muted-foreground">, holding {(you.share * 100).toFixed(1)}% of the market.</span>
            </p>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {data.rows.map((row) => (
              <div
                key={row.id}
                className={`flex items-center gap-3 p-4 ${row.isYou ? "bg-primary/5" : ""}`}
                data-testid={`row-standing-${row.rank}`}
              >
                <span className={`w-7 text-sm font-semibold tabular-nums ${row.rank <= 3 ? "text-primary" : "text-muted-foreground"}`}>
                  {row.rank}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium truncate">{row.name}</p>
                    {row.isYou && <Badge className="text-[10px]">You</Badge>}
                    {row.kind === "incumbent" && <Badge variant="outline" className="text-[10px]">was here first</Badge>}
                    {row.distress && row.distress !== "healthy" && (
                      <Badge variant="secondary" className="text-[10px]">
                        {row.distress === "insolvent" ? "insolvent" : row.distress === "distressed" ? "in trouble" : "stretched"}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {row.customers.toLocaleString()} customers at {compact(row.price)} · reputation {row.reputation}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <p className="font-semibold tabular-nums">{(row.share * 100).toFixed(1)}%</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{compact(row.revenue)}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {data.history.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold">Your season so far</h2>
            <p className="text-xs text-muted-foreground mt-0.5 mb-4">
              A ranking is a snapshot. This is whether you are climbing.
            </p>

            <div className="space-y-2">
              {data.history.map((h, i) => {
                const previous = data.history[i - 1];
                const up = previous && h.share > previous.share;
                const down = previous && h.share < previous.share;
                return (
                  <div key={h.year} className="flex items-center gap-3" data-testid={`row-history-${h.year}`}>
                    <span className="w-14 text-xs text-muted-foreground shrink-0">Year {h.year}</span>
                    <div className="flex-1 h-5 rounded bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary/70"
                        style={{ width: `${Math.max(1.5, (h.share / peak) * 100)}%` }}
                      />
                    </div>
                    <span className="w-14 text-right text-xs tabular-nums shrink-0">{(h.share * 100).toFixed(1)}%</span>
                    <span className="w-6 shrink-0">
                      {up ? <TrendingUp className="h-3.5 w-3.5 text-primary" />
                        : down ? <TrendingDown className="h-3.5 w-3.5 text-destructive" />
                        : <Minus className="h-3.5 w-3.5 text-muted-foreground" />}
                    </span>
                    <span className="w-10 text-right text-xs text-muted-foreground tabular-nums shrink-0">#{h.rank}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
