/**
 * "People who may interest you" — the old Matches page, folded in.
 *
 * `/api/matches` regenerates itself when what it has is stale, so arriving on
 * Discover is the refresh; the button stays for the case where someone just
 * changed their profile and wants to see the effect without waiting for the
 * staleness window.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { UserCard } from "@/components/user-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, RefreshCw, Sparkles, UserPlus } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/api-error";
import { useConnectionStates } from "@/components/discover-actions";
import type { ExploreUpdate } from "@/hooks/use-explore-updates";
import type { User, UserMatch, UserProfile } from "@shared/schema";

type Match = UserMatch & { matchedUser: User; matchedProfile: UserProfile };

/** Six is what fits two rows on a laptop; the rest is what the search below is for. */
const SHOWN = 6;

export function MatchStrip({ updateFor }: { updateFor: (userId: string) => ExploreUpdate | undefined }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: matches, isLoading, isError } = useQuery<Match[]>({
    queryKey: ["/api/matches"],
    // The endpoint refreshes itself on a stale read, so the page must actually
    // ask on arrival — the app's default of never-stale would serve a cache
    // from an hour ago and the regeneration would never be triggered.
    staleTime: 0,
    refetchOnMount: "always",
  });

  const regenerate = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/matches/generate")).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/matches"] });
      toast({ title: "Matches refreshed", description: "We took another look at who fits what you're building." });
    },
    onError: (error: Error) =>
      toast({ title: "Couldn't refresh matches", description: errorText(error), variant: "destructive" }),
  });

  const shown = (matches ?? []).slice(0, SHOWN);
  const { data: connections } = useConnectionStates(shown.map((m) => m.matchedUserId));

  return (
    <section className="space-y-4" data-testid="discover-matches">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> People who may interest you
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Picked from what you've said you're building and what they can do.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => regenerate.mutate()}
          disabled={regenerate.isPending}
          data-testid="discover-refresh-matches"
        >
          {regenerate.isPending
            ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
          Refresh matches
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-border p-5" data-testid={`match-skeleton-${i}`}>
              <div className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>
              <Skeleton className="mt-4 h-3 w-full" />
              <Skeleton className="mt-2 h-3 w-5/6" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <EmptyPanel
          icon={<UserPlus className="h-5 w-5 text-primary" />}
          title="Matches didn't load"
          body="Refresh the page, or ask for a new set with the button above."
          testId="matches-error"
        />
      ) : shown.length === 0 ? (
        <EmptyPanel
          icon={<UserPlus className="h-5 w-5 text-primary" />}
          title="No matches yet"
          body="Matching reads your profile — your skills, what you're building, what you're looking for. Fill that in and the first set arrives on your next visit."
          testId="matches-empty"
          action={
            <Button variant="outline" size="sm" onClick={() => setLocation("/profile")} data-testid="matches-empty-profile">
              Finish my profile
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {shown.map((match, i) => (
            /*
             * Just the card.
             *
             * Under it there used to be a "Start trial sprint" button pointing
             * at /sprints/new?partnerId=… — a route App.tsx redirects straight
             * to /sprints, dropping the partner on the floor. Co-founder
             * sprints are retired (see the note at the top of pages/sprints.tsx)
             * and nothing replaced them that takes a partner: Ten Years From
             * Now has no "play with this person" entry, on purpose, because
             * conscripting somebody into a running clock was exactly the
             * mistake that route made. So the honest set of things you can do
             * with a match is the one the card already offers — open their
             * profile, connect, message — and a fourth button promising a
             * feature that redirects away is worse than no button.
             */
            <div key={match.id} className="flex flex-col">
              <UserCard
                profile={match.matchedProfile}
                userName={(match.matchedUser?.firstName || match.matchedUser?.email || "Anonymous") as string}
                matchScore={match.score}
                matchReasons={match.reasons ?? []}
                explore={{ source: "matches", rankPosition: i + 1 }}
                connection={connections?.[match.matchedUserId]}
                update={updateFor(match.matchedUserId)}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyPanel({ icon, title, body, testId, action }: {
  icon: React.ReactNode; title: string; body: string; testId: string; action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center" data-testid={testId}>
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">{icon}</div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
