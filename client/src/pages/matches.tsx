import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { UserCard } from "@/components/user-card";
import { Button } from "@/components/ui/button";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { UserMatch, UserProfile, User } from "@shared/schema";
import { Loader2, Sparkles, UserPlus, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Matches() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: matches, isLoading } = useQuery<(UserMatch & { matchedUser: User; matchedProfile: UserProfile })[]>({
    queryKey: ["/api/matches"],
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/matches/generate");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/matches"] });
      toast({
        title: "Matches generated!",
        description: "We've found some potential collaborators for you.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to generate matches",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">AI Matches</h1>
            <p className="text-secondary mt-1">
              Collaborators hand-picked for you based on your skills and interests.
            </p>
          </div>
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="shrink-0"
            data-testid="button-generate-matches"
          >
            {generateMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Generate Matches
          </Button>
        </div>

        {matches && matches.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {matches.map((match) => (
              <div key={match.id} className="flex flex-col">
                <UserCard
                  profile={match.matchedProfile}
                  userName={(match.matchedUser.firstName || match.matchedUser.email || "Anonymous") as string}
                  matchScore={match.score}
                  matchReasons={match.reasons || []}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => setLocation(`/sprints/new?partnerId=${match.matchedUserId}`)}
                  data-testid={`button-start-sprint-${match.matchedUserId}`}
                >
                  <Users className="h-3.5 w-3.5 mr-1.5" />
                  Start Trial Sprint
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed rounded-lg bg-card/50">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <UserPlus className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">No matches yet</h3>
            <p className="text-secondary max-w-sm mt-2 mb-6">
              Click the button above to let our AI find the best collaborators for your next big project.
            </p>
            <Button
              variant="outline"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              data-testid="button-generate-matches-empty"
            >
              {generateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Find My First Match
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
