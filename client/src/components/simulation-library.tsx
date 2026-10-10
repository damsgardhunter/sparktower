/**
 * What somebody owns, and the way back into it.
 *
 * This exists because the marketplace sold things nobody could reach again.
 * Pressing play spent a seat, made a season and showed its join link once;
 * leaving the page lost it, because starting a season does not seat you in one
 * and nothing recorded which seasons came from which purchase. The fix on the
 * server was a row per start; this is the screen that reads it.
 *
 * Two questions, in the order people have them. "Where is the game I was in"
 * comes first and gets buttons. "What can I still start" comes second, because
 * a seat is a thing you might use, not a thing you are in the middle of.
 *
 * Renders nothing at all for somebody who owns nothing. A browse page is for
 * finding something, and an empty "yours" shelf above the grid is a worse first
 * impression than no shelf.
 */
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Play, Ticket, ArrowRight, CheckCircle2 } from "lucide-react";

/** One season somebody started from a listing. */
export interface StartedSeason {
  seasonId: string;
  listingId: string;
  purchaseId: string | null;
  name: string | null;
  /** Null when the season row is gone — swept, or never finished being made. */
  status: "forming" | "running" | "finished" | "abandoned" | null;
  year: number | null;
  totalYears: number | null;
  inviteCode: string | null;
  joinUrl: string | null;
  startedAt: string;
}

export interface OwnedPurchase {
  id: string;
  listingId: string | null;
  title: string | null;
  seats: number;
  seatsLeft: number;
  paidCents: number;
  at: string;
  seasons: StartedSeason[];
}

export interface LibraryData {
  listings: { id: string; title: string; seasons: StartedSeason[] }[];
  purchases: OwnedPurchase[];
  totals: { seatsLeft: number; running: number };
}

/** A season still worth going back to, as opposed to one that is over. */
export const isLive = (s: StartedSeason) => s.status === "forming" || s.status === "running";

/**
 * Where a season's title comes from.
 *
 * The season's own name, which the person typed when they started it, then the
 * listing's, then a last resort. A row reading "null" is worse than a row
 * reading "A simulation".
 */
function titleFor(season: StartedSeason, fallback: string | null) {
  return season.name?.trim() || fallback?.trim() || "A simulation";
}

export function SimulationLibrary({ heading = "Yours" }: { heading?: string }) {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useQuery<LibraryData>({ queryKey: ["/api/sim-market/me"] });

  if (isLoading) return <Skeleton className="mb-6 h-28 rounded-xl" />;
  if (!data) return null;

  /*
   * Every season this person started, whether they bought it or wrote it.
   * An author's own run of their own listing is as much "theirs" as a bought
   * one, and it is the same question being asked.
   */
  const titleOf = new Map<string, string | null>();
  for (const l of data.listings) titleOf.set(l.id, l.title);
  for (const p of data.purchases) if (p.listingId) titleOf.set(p.listingId, p.title);

  const seasons = [
    ...data.purchases.flatMap((p) => p.seasons),
    ...data.listings.flatMap((l) => l.seasons),
  ];
  /* One row per season — a start recorded against both sides would show twice. */
  const bySeason = new Map(seasons.map((s) => [s.seasonId, s]));
  const live = [...bySeason.values()].filter(isLive);
  const ready = data.purchases.filter((p) => p.seatsLeft > 0 && p.listingId);

  if (!live.length && !ready.length) return null;

  return (
    <section className="mb-6" data-testid="section-simulation-library">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-semibold">{heading}</h2>
        {live.length > 0 && (
          <Badge variant="secondary" data-testid="badge-library-live">
            {live.length} to continue
          </Badge>
        )}
        {data.totals.seatsLeft > 0 && (
          <Badge variant="outline" className="font-normal" data-testid="badge-library-seats">
            {data.totals.seatsLeft} seat{data.totals.seatsLeft === 1 ? "" : "s"} unused
          </Badge>
        )}
      </div>

      <Card className="nova-ring-soft border-0 overflow-hidden">
        <CardContent className="divide-y divide-border p-0">
          {live.map((season) => (
            <div key={season.seasonId} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" data-testid={`text-season-${season.seasonId}`}>
                  {titleFor(season, titleOf.get(season.listingId) ?? null)}
                </p>
                <p className="text-xs text-tertiary">
                  {season.status === "forming"
                    /*
                     * A forming season is a waiting room, and saying "year 1 of
                     * 14" about one that has not started yet reads as progress
                     * that has not happened.
                     */
                    ? "Waiting for the table to fill"
                    : `Year ${season.year ?? 1} of ${season.totalYears ?? 14}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {/*
                  * The join link, which is the only way back in until somebody
                  * has taken a seat. Once they have, the room is also in their
                  * ordinary list of games — but this is what gets them there
                  * the first time, and what they send their team.
                  */}
                {season.joinUrl && (
                  <Button size="sm" onClick={() => setLocation(season.joinUrl!)} data-testid={`button-resume-${season.seasonId}`}>
                    <Play className="mr-1 h-3.5 w-3.5" />
                    {season.status === "forming" ? "Open the room" : "Resume"}
                  </Button>
                )}
              </div>
            </div>
          ))}

          {ready.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{p.title ?? "A simulation"}</p>
                <p className="flex items-center gap-1 text-xs text-tertiary">
                  <Ticket className="h-3 w-3" />
                  {p.seatsLeft} of {p.seats} seat{p.seats === 1 ? "" : "s"} left
                  {p.seasons.length > 0 && !p.seasons.some(isLive) && (
                    <span className="ml-1 inline-flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> {p.seasons.length} played
                    </span>
                  )}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => setLocation(`/simulations/market/${p.listingId}`)}
                data-testid={`button-open-listing-${p.listingId}`}
              >
                Start a season <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
