/**
 * Discover: one screen where Projects, Matches and the Leaderboard used to be.
 *
 * Three destinations meant three answers to "who or what should I look at",
 * and people had to guess which one held the thing they wanted. This page asks
 * once. Top to bottom it is: the search, the wall of top projects, the people
 * we think fit you, and then everything that matched — which, with an empty
 * box, is the project list the site used to have at /projects.
 *
 * The editorial sections step aside once someone actually searches. A search
 * is a question, and burying its answer two screens below a leaderboard nobody
 * asked about is how the old Projects page felt.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ReturnBanner } from "@/components/return-banner";
import { useExploreUpdates } from "@/hooks/use-explore-updates";
import { openDiscover } from "@/lib/explore";
import { DiscoverSearchBar } from "@/components/discover/discover-search-bar";
import { TopProjects } from "@/components/discover/top-projects";
import { MatchStrip } from "@/components/discover/match-strip";
import {
  DiscoverResults,
  type PersonWithProfile,
  type ProjectWithDetails,
} from "@/components/discover/discover-results";
import {
  discoverSearchUrl,
  isBrowsing,
  useDiscoverFilters,
  type DiscoverFilterState,
} from "@/components/discover/use-discover-filters";

interface DiscoverSearchResponse {
  query: DiscoverFilterState;
  counts: { projects: number; people: number };
  projects: ProjectWithDetails[];
  people: PersonWithProfile[];
  goals: string[];
}

export default function Discover() {
  const { filters, setFilters } = useDiscoverFilters();
  const [metric, setMetric] = useState<"donations" | "views">("donations");
  const browsing = isBrowsing(filters);

  // The Explore loop starts here — see lib/explore.ts.
  useEffect(() => { openDiscover("discover"); }, []);
  const { updates, byKey } = useExploreUpdates();
  const updateFor = (kind: "project" | "builder", id: string) => byKey.get(`${kind}:${id}`);

  /*
   * Who the strip above is already showing. The same key as MatchStrip's own
   * query, so this reads its cache rather than asking twice — and everyone in
   * it is dropped from the people below. Before that, browsing Discover showed
   * the same three faces in "People who may interest you" and again in
   * "People" a scroll later, which reads as a bug.
   */
  const { data: matches } = useQuery<{ matchedUserId: string }[]>({ queryKey: ["/api/matches"], enabled: browsing });
  const alreadyShown = new Set(browsing ? (matches ?? []).map((m) => m.matchedUserId) : []);

  const { data, isLoading, isFetching, isError } = useQuery<DiscoverSearchResponse>({
    // The URL is the key: one search per address, so the back button replays
    // results out of the cache instead of re-asking the server.
    queryKey: [discoverSearchUrl(filters)],
    placeholderData: (previous) => previous,
  });

  return (
    /*
     * The top padding belongs to the header, not to this wrapper: a sticky
     * element can't rise above its containing block's content box, so padding
     * here pinned the search bar 24px down and left a strip of cards scrolling
     * through the gap above it. `!pt-0` cancels the layout's own `[&>*]:pt-6`
     * (client/src/App.tsx) for the same reason.
     */
    <div className="h-full overflow-y-auto !pt-0">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pb-20 space-y-10">
        <header className="space-y-1 pt-6">
          <h1 className="text-3xl font-bold tracking-tight">Discover</h1>
          <p className="text-muted-foreground">
            Projects to back or join, builders to work with, and what the tower is rewarding right now.
          </p>
        </header>

        <ReturnBanner updates={updates} />

        {/* Sticky so narrowing a search never means scrolling back up for the box.
            Opaque rather than translucent: a blurred backdrop over a grid of
            white cards read as smudges behind the filters. */}
        <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-background border-b border-border">
          <DiscoverSearchBar
            filters={filters}
            setFilters={setFilters}
            counts={data?.counts}
            isFetching={isFetching}
          />
        </div>

        {browsing && <TopProjects metric={metric} onMetric={setMetric} />}

        {browsing && <MatchStrip updateFor={(userId) => updateFor("builder", userId)} />}

        <DiscoverResults
          filters={filters}
          projects={data?.projects ?? []}
          people={(data?.people ?? []).filter((p) => !alreadyShown.has(p.id))}
          counts={data?.counts}
          isLoading={isLoading}
          isError={isError}
          updateFor={updateFor}
        />
      </div>
    </div>
  );
}
