/**
 * Somebody's simulations on their profile: what they wrote, sold and bought.
 *
 * Three readings of the same marketplace, in the order a person cares about
 * them. What they published is the thing they would show somebody — it sits
 * where projects sit, because it is the same kind of claim about what they
 * have made. Sales and purchases are records rather than work, so they are
 * numbers and a list rather than cards.
 *
 * The held figure is given its own line because it is the number sellers ask
 * about: money earned is not money arrived, and a seller who finds that out by
 * looking at a balance that does not match has been told nothing.
 */
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SimulationListingCard, type ListingCard } from "@/components/simulation-listing-card";
import { SimulationLibrary, isLive, type StartedSeason } from "@/components/simulation-library";
import { Store, Clock, Plus, Play, CheckCircle2, XCircle, Hourglass } from "lucide-react";

interface Mine {
  listings: (ListingCard & { status: "draft" | "listed" | "unlisted"; seasons: StartedSeason[] })[];
  purchases: { id: string; listingId: string | null; title: string | null; seats: number; seatsLeft: number; paidCents: number; at: string; seasons: StartedSeason[] }[];
  sales: { id: string; listingId: string | null; title: string | null; seats: number; earnedCents: number; at: string }[];
  totals: { earnedCents: number; spentCents: number; seatsLeft: number; running: number };
}

/**
 * How a season reads once it is no longer somewhere to go back to.
 *
 * "Abandoned" is kept as its own word rather than folded into finished,
 * because a season that was walked away from and one that was played to its
 * last year are different things to have done, and the list is a record.
 */
const STATUS_LOOK: Record<string, { label: string; Icon: typeof Play }> = {
  forming: { label: "Waiting to start", Icon: Hourglass },
  running: { label: "Running", Icon: Play },
  finished: { label: "Finished", Icon: CheckCircle2 },
  abandoned: { label: "Abandoned", Icon: XCircle },
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function SimulationPortfolio({ isOwnProfile }: { isOwnProfile: boolean }) {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useQuery<Mine>({
    queryKey: ["/api/sim-market/me"],
    /* Only their own: sales and purchases are nobody else's business. */
    enabled: isOwnProfile,
  });
  const { data: earnings } = useQuery<{ held: { cents: number; days: number } }>({
    queryKey: ["/api/sim-market/earnings"],
    enabled: isOwnProfile,
  });

  if (!isOwnProfile) return null;
  if (isLoading) return <Skeleton className="h-40 rounded-xl" />;

  const listings = data?.listings ?? [];
  const sales = data?.sales ?? [];
  const purchases = data?.purchases ?? [];
  /*
   * Every season started from a listing, deduplicated.
   *
   * A start is recorded against both the purchase and the listing, so an
   * author who bought seats on their own listing would otherwise see each of
   * their seasons twice.
   */
  const titleOf = new Map<string, string | null>();
  for (const l of listings) titleOf.set(l.id, l.title);
  for (const p of purchases) if (p.listingId) titleOf.set(p.listingId, p.title);
  const played = [...new Map(
    [...purchases.flatMap((p) => p.seasons), ...listings.flatMap((l) => l.seasons)]
      .map((s) => [s.seasonId, s]),
  ).values()].sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt));

  const nothingYet = !listings.length && !sales.length && !purchases.length;

  if (nothingYet) {
    return (
      <Card className="nova-ring-soft border-0">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Store className="h-7 w-7 text-tertiary" />
          <p className="font-medium">No simulations yet</p>
          <p className="max-w-sm text-sm text-secondary">
            Build a market around one of your projects, then publish it for other people to play.
          </p>
          <Button variant="outline" onClick={() => setLocation("/simulations/market")}>Browse the marketplace</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/*
        * The way back into anything running, before any of the accounting.
        * Somebody opening this tab is more likely to be looking for a game
        * than for a figure.
        */}
      <SimulationLibrary heading="Playing now" />

      {/* The money, first and small. Three figures, each answering one question. */}
      {(sales.length > 0 || purchases.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="nova-ring-soft border-0">
            <CardContent className="p-4">
              <p className="text-xs text-tertiary">Earned</p>
              <p className="mt-0.5 text-xl font-bold" data-testid="text-earned">{money(data?.totals.earnedCents ?? 0)}</p>
              {!!earnings?.held.cents && (
                <p className="mt-1 flex items-center gap-1 text-xs text-tertiary">
                  <Clock className="h-3 w-3" />
                  {money(earnings.held.cents)} held for {earnings.held.days} days
                </p>
              )}
            </CardContent>
          </Card>
          <Card className="nova-ring-soft border-0">
            <CardContent className="p-4">
              <p className="text-xs text-tertiary">Spent</p>
              <p className="mt-0.5 text-xl font-bold">{money(data?.totals.spentCents ?? 0)}</p>
            </CardContent>
          </Card>
          <Card className="nova-ring-soft border-0">
            <CardContent className="p-4">
              <p className="text-xs text-tertiary">Seats left</p>
              <p className="mt-0.5 text-xl font-bold">{data?.totals.seatsLeft ?? 0}</p>
              <p className="mt-1 text-xs text-tertiary">across everything you've bought</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* What they published, as cards — the same object a stranger would see. */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Published</h3>
          <Button variant="ghost" size="sm" onClick={() => setLocation("/simulations/market/new")}>
            <Plus className="mr-1 h-4 w-4" /> Publish
          </Button>
        </div>
        {listings.length === 0 ? (
          <p className="text-sm text-secondary">Nothing published yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {listings.map((listing) => (
              <div key={listing.id} className="relative">
                {/*
                  * A draft is still shown, with its state on it. Hiding drafts
                  * from their own author is how somebody loses track of a thing
                  * they half-made and never finishes it.
                  */}
                {listing.status !== "listed" && (
                  <Badge variant="secondary" className="absolute right-3 top-3 z-10 capitalize">{listing.status}</Badge>
                )}
                <SimulationListingCard listing={listing} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/*
        * Every season this person has started from the marketplace, finished
        * ones included.
        *
        * The shelf at the top only shows what is still worth going back to,
        * which is the right thing for a shelf and the wrong thing for a
        * record: "what have I actually played" is a question about history,
        * and until this section existed nothing could answer it. Ordinary
        * catalogue seasons are not here — they are in the games list, which
        * has always had them. This is the marketplace's own history.
        */}
      {played.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <h3 className="font-semibold">Seasons you've played</h3>
            <Badge variant="outline" className="font-normal">{played.length}</Badge>
          </div>
          <Card className="nova-ring-soft border-0">
            <CardContent className="divide-y divide-border p-0">
              {played.map((season) => {
                const look = STATUS_LOOK[season.status ?? ""] ?? { label: "No longer there", Icon: XCircle };
                return (
                  <div key={season.seasonId} className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {season.name?.trim() || titleOf.get(season.listingId) || "A simulation"}
                      </p>
                      <p className="flex items-center gap-1 text-xs text-tertiary">
                        <look.Icon className="h-3 w-3 shrink-0" />
                        {look.label}
                        {season.status === "running" && season.year != null && (
                          <> · year {season.year} of {season.totalYears ?? 14}</>
                        )}
                        {" · "}{new Date(season.startedAt).toLocaleDateString()}
                      </p>
                    </div>
                    {/*
                      * A way in only while there is one. A finished season's
                      * room is read-only and a button into it would promise a
                      * game; its result lives on the company's own screen.
                      */}
                    {isLive(season) && season.joinUrl && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => setLocation(season.joinUrl!)}
                        data-testid={`button-open-season-${season.seasonId}`}
                      >
                        Open
                      </Button>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </section>
      )}

      {sales.length > 0 && (
        <section>
          <h3 className="mb-3 font-semibold">Sales</h3>
          <Card className="nova-ring-soft border-0">
            <CardContent className="divide-y divide-border p-0">
              {sales.map((sale) => (
                <button
                  key={sale.id}
                  className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-muted/40"
                  onClick={() => sale.listingId && setLocation(`/simulations/market/${sale.listingId}`)}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{sale.title ?? "A simulation"}</p>
                    <p className="text-xs text-tertiary">
                      {sale.seats} seat{sale.seats === 1 ? "" : "s"} · {new Date(sale.at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-medium">{money(sale.earnedCents)}</span>
                </button>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      {purchases.length > 0 && (
        <section>
          <h3 className="mb-3 font-semibold">Bought</h3>
          <Card className="nova-ring-soft border-0">
            <CardContent className="divide-y divide-border p-0">
              {purchases.map((p) => (
                <button
                  key={p.id}
                  className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-muted/40"
                  onClick={() => p.listingId && setLocation(`/simulations/market/${p.listingId}`)}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.title ?? "A simulation"}</p>
                    <p className="text-xs text-tertiary">
                      {/* Seats left is the useful half — it is what they can still do. */}
                      {p.seatsLeft} of {p.seats} seat{p.seats === 1 ? "" : "s"} left · {new Date(p.at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm text-tertiary">{p.paidCents === 0 ? "Free" : money(p.paidCents)}</span>
                </button>
              ))}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
