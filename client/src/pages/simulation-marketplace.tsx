/**
 * The marketplace: every simulation somebody has published, in a grid.
 *
 * Built to be the same page as Discover in everything but what it lists —
 * same card, same ring, same search-then-grid shape — because the gesture is
 * the same one. Somebody arriving here has just come from browsing projects
 * and should not have to learn a second way to browse.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SimulationListingCard, type ListingCard } from "@/components/simulation-listing-card";
import { Search, Store, Plus } from "lucide-react";

type Sort = "newest" | "popular" | "priceLow" | "priceHigh";

const SORTS: { value: Sort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "popular", label: "Most played" },
  { value: "priceLow", label: "Cheapest" },
  { value: "priceHigh", label: "Dearest" },
];

export default function SimulationMarketplacePage() {
  const [, setLocation] = useLocation();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [freeOnly, setFreeOnly] = useState(false);

  const { data, isLoading } = useQuery<{ listings: ListingCard[]; rules: { platformSharePercent: number } }>({
    queryKey: ["/api/sim-market/listings", q, sort, freeOnly],
    queryFn: async () => {
      const params = new URLSearchParams({ sort });
      if (q.trim()) params.set("q", q.trim());
      if (freeOnly) params.set("free", "1");
      const res = await fetch(`/api/sim-market/listings?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Couldn't load the marketplace");
      return res.json();
    },
  });

  const listings = data?.listings ?? [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <Store className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Simulation marketplace</h1>
        </div>
        <p className="mt-2 max-w-2xl text-secondary">
          Business simulations other people have written. Play one with your team, or publish your own and sell seats.
        </p>
      </header>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search simulations"
            className="pl-9"
            data-testid="input-search-simulations"
          />
        </div>
        <div className="flex items-center gap-2">
          {/*
            * Free as a toggle rather than a price slider. The only price
            * question most people have on arriving is whether anything here
            * costs nothing, and a slider makes them answer a harder one.
            */}
          <Button
            variant={freeOnly ? "default" : "outline"}
            onClick={() => setFreeOnly((v) => !v)}
            data-testid="button-free-only"
          >
            Free only
          </Button>
          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger className="w-[150px]" data-testid="select-sort"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => setLocation("/simulations/market/new")} data-testid="button-publish-simulation">
            <Plus className="mr-1 h-4 w-4" /> Publish
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
        </div>
      ) : listings.length === 0 ? (
        /*
          * Two different empty states, because they mean different things. A
          * search with no hits is a search to change; an empty marketplace is
          * an invitation to be the first person in it.
          */
        <Card className="nova-ring-soft border-0">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <Store className="h-8 w-8 text-tertiary" />
            {q.trim() || freeOnly ? (
              <>
                <p className="font-medium">Nothing matches that</p>
                <p className="max-w-sm text-sm text-secondary">Try a different search, or clear the filters.</p>
                <Button variant="outline" onClick={() => { setQ(""); setFreeOnly(false); }}>Clear filters</Button>
              </>
            ) : (
              <>
                <p className="font-medium">No simulations listed yet</p>
                <p className="max-w-sm text-sm text-secondary">
                  Build a market for your own business, then publish it here for other people to play.
                </p>
                <Button onClick={() => setLocation("/simulations/market/new")}>Publish the first one</Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing) => (
              <SimulationListingCard key={listing.id} listing={listing} />
            ))}
          </div>
          {data?.rules && (
            /*
              * The platform's share, said on the page rather than buried in
              * terms. Somebody deciding whether to sell here is entitled to
              * know what it costs them without going looking.
              */
            <p className="mt-6 text-center text-xs text-tertiary">
              Authors keep {100 - data.rules.platformSharePercent}% of every sale.
              <Badge variant="outline" className="ml-2 text-xs font-normal">Refunds within 14 days on unplayed seats</Badge>
            </p>
          )}
        </>
      )}
    </div>
  );
}
