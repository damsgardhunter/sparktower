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
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CompanyProfile } from "@/components/sim/company-profile";
import { NOVA_GRADIENT_CSS } from "@shared/backing";
import { Loader2, ArrowLeft, Trophy, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface Row {
  id: string; name: string; kind: "player" | "incumbent";
  customers: number; share: number; revenue: number; reputation: number; price: number;
  isYou: boolean; distress: string | null; rank: number;
  /** What this side's owners actually hold. The table is ordered by it. */
  founderValue: number;
  founderShare: number;
}
interface Standings {
  year: number; totalYears: number; status: string;
  niche: { id: string; name: string; voice: Record<string, string> } | null;
  rows: Row[];
  history: { year: number; share: number; customers: number; profit: number; rank: number; founderValue: number | null }[];
}

const compact = (n: number) =>
  n >= 1_000_000 ? `£${(n / 1_000_000).toFixed(1)}m` : n >= 1_000 ? `£${Math.round(n / 1_000)}k` : `£${Math.round(n)}`;

export default function SimulationStandingsPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState<string | null>(null);

  const { data, isLoading } = useQuery<Standings>({
    queryKey: [`/api/sim/ventures/${id}/standings`],
    refetchInterval: 30_000,
  });

  if (isLoading || !data) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const you = data.rows.find((r) => r.isYou);
  /*
   * Draw the trajectory in the same currency as the ranking when every year
   * has one. A share-shaped chart beside a value-shaped rank means a year that
   * gained share and lost a place looks like a mistake.
   */
  const byValue = data.history.length > 0 && data.history.every((h) => typeof h.founderValue === "number");
  const seriesOf = (h: Standings["history"][number]) => (byValue ? (h.founderValue ?? 0) : h.share);
  const peak = Math.max(...data.history.map(seriesOf), byValue ? 1 : 0.01);

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
            <>
              <p className="text-sm mt-3" data-testid="text-your-rank">
                <span className="text-muted-foreground">You are </span>
                <span className="font-semibold">#{you.rank} of {data.rows.length}</span>
                <span className="text-muted-foreground">, holding {(you.share * 100).toFixed(1)}% of the market.</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                The table is ordered by what each side's owners hold — {compact(you.founderValue)} of yours.
                A bigger company you own less of can be worth less than a smaller one you own all of.
              </p>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {data.rows.map((row) => (
              /*
               * The whole row opens the company. A league table is the place
               * somebody is most likely to want to know who a name belongs to
               * — they are looking at it precisely because somebody above them
               * is a stranger.
               */
              <button
                key={row.id}
                type="button"
                onClick={() => setOpen(row.id)}
                className={`w-full text-left flex items-center gap-3 p-4 hover-elevate active-elevate-2 ${row.isYou ? "bg-primary/5" : ""}`}
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
                    {row.customers.toLocaleString()} {data.niche?.voice.customers ?? "customers"} at {compact(row.price)}
                    {data.niche ? ` ${data.niche.voice.per}` : ""} · reputation {row.reputation}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  {/*
                    * The figure the table is ordered by, leading.
                    *
                    * The ranking moved to what each side's owners actually hold
                    * and this column did not, so the list was sorted by a number
                    * it never showed — which reads as the order being arbitrary,
                    * or worse, wrong.
                    */}
                  <p className="font-semibold tabular-nums" data-testid={`text-value-${row.rank}`}>{compact(row.founderValue)}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {(row.share * 100).toFixed(1)}% share
                    {row.founderShare < 1 && ` · owns ${Math.round(row.founderShare * 100)}%`}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {data.history.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold">Your season so far</h2>
            <p className="text-xs text-muted-foreground mt-0.5 mb-4">
              A ranking is a snapshot. This is whether you are climbing — {byValue ? "measured in what you own" : "measured in share"}.
            </p>

            <div className="space-y-2">
              {data.history.map((h, i) => {
                const previous = data.history[i - 1];
                const up = previous && seriesOf(h) > seriesOf(previous);
                const down = previous && seriesOf(h) < seriesOf(previous);
                return (
                  <div key={h.year} className="flex items-center gap-3" data-testid={`row-history-${h.year}`}>
                    <span className="w-14 text-xs text-muted-foreground shrink-0">Year {h.year}</span>
                    <div className="flex-1 h-5 rounded bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary/70"
                        style={{ width: `${Math.max(1.5, (seriesOf(h) / peak) * 100)}%` }}
                      />
                    </div>
                    <span className="w-16 text-right text-xs tabular-nums shrink-0">
                      {byValue ? compact(h.founderValue ?? 0) : `${(h.share * 100).toFixed(1)}%`}
                    </span>
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

      <CompanyProfile ventureId={id!} companyId={open} onClose={() => setOpen(null)} />
    </div>
  );
}
