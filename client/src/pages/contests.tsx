import { errorText } from "@/lib/api-error";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  Trophy,
  Users,
  Calendar,
  Clock,
  Award,
  Star,
  Flame,
  ChevronRight,
  ExternalLink,
  Sparkles,
  Target,
  Rocket,
  Medal,
  Zap,
} from "lucide-react";
import type { Contest, Badge as BadgeType } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

type ContestWithDetails = Contest & { badge?: BadgeType; participantCount: number; isParticipant?: boolean };

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
  upcoming: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  judging: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
  completed: "bg-muted text-muted-foreground border-border",
};

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  intermediate: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  advanced: "bg-red-500/10 text-red-600 dark:text-red-400",
};

const DIFFICULTY_ICONS: Record<string, typeof Star> = {
  beginner: Star,
  intermediate: Flame,
  advanced: Zap,
};

const RARITY_COLORS: Record<string, string> = {
  common: "border-gray-400 text-gray-500",
  rare: "border-blue-400 text-blue-500",
  epic: "border-purple-400 text-purple-500",
  legendary: "border-yellow-400 text-yellow-500",
};

function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysLeft(endDate: string | Date) {
  const diff = new Date(endDate).getTime() - Date.now();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  return days;
}

export default function Contests() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedContest, setSelectedContest] = useState<ContestWithDetails | null>(null);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [submissionUrl, setSubmissionUrl] = useState("");
  const [submissionNote, setSubmissionNote] = useState("");

  const { data: contests, isLoading } = useQuery<ContestWithDetails[]>({
    queryKey: ["/api/contests", statusFilter !== "all" ? statusFilter : undefined].filter(Boolean),
    queryFn: async () => {
      const url = statusFilter !== "all" ? `/api/contests?status=${statusFilter}` : "/api/contests";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch contests");
      return res.json();
    },
  });

  const joinMutation = useMutation({
    mutationFn: async (contestId: string) => {
      await apiRequest("POST", `/api/contests/${contestId}/join`);
    },
    onSuccess: () => {
      toast({ title: "Joined contest!", description: "You're now a participant." });
      queryClient.invalidateQueries({ queryKey: ["/api/contests"] });
    },
    onError: (err: any) => {
      toast({ title: "Could not join", description: errorText(err, "Something went wrong."), variant: "destructive" });
    },
  });

  const submitMutation = useMutation({
    mutationFn: async ({ contestId, url, note }: { contestId: string; url: string; note: string }) => {
      await apiRequest("POST", `/api/contests/${contestId}/submit`, { submissionUrl: url, submissionNote: note });
    },
    onSuccess: () => {
      toast({ title: "Submission received!", description: "Your entry has been submitted." });
      setSubmitDialogOpen(false);
      setSubmissionUrl("");
      setSubmissionNote("");
      queryClient.invalidateQueries({ queryKey: ["/api/contests"] });
    },
    onError: () => {
      toast({ title: "Submission failed", variant: "destructive" });
    },
  });

  const promoted = contests?.filter((c) => c.promoted && c.status !== "completed") || [];
  const regular = contests?.filter((c) => !c.promoted || c.status === "completed") || [];

  return (
    <div className="h-full overflow-y-auto pb-20">
      <div className="relative min-h-[10rem] bg-gradient-to-br from-primary/10 via-background to-purple-500/5 border-b border-border flex items-end">
        <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent opacity-60" />
        <div className="relative p-6 w-full max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Trophy className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight" data-testid="text-contests-title">Contests</h1>
              <p className="text-muted-foreground text-sm">Compete, build, and earn badges</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6 space-y-8">
        <section className="space-y-4" data-testid="section-games-arena">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold">Games Arena</h2>
          </div>
          {/* Two games now — Team Tactics Arena was removed. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="cursor-pointer hover:border-primary/50 transition-colors group" onClick={() => setLocation("/games/typing")} data-testid="card-game-typing">
              <CardHeader className="pb-2">
                <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center mb-2">
                  <Rocket className="h-5 w-5 text-green-500" />
                </div>
                <CardTitle className="text-base group-hover:text-primary transition-colors">Velocity Type Arena</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">Race against others typing builder-focused prompts. Speed, accuracy, and execution under pressure.</p>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">Multiplayer</Badge>
                  <Badge variant="outline" className="text-xs">Speed</Badge>
                </div>
              </CardContent>
            </Card>
            <Card className="cursor-pointer hover:border-primary/50 transition-colors group" onClick={() => setLocation("/games/signal-noise")} data-testid="card-game-signal">
              <CardHeader className="pb-2">
                <div className="h-10 w-10 rounded-lg bg-purple-500/10 flex items-center justify-center mb-2">
                  <Sparkles className="h-5 w-5 text-purple-500" />
                </div>
                <CardTitle className="text-base group-hover:text-primary transition-colors">Signal vs. Noise</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">Sort cards into signal or noise under time pressure. Train your prioritization and product thinking skills.</p>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">Solo</Badge>
                  <Badge variant="outline" className="text-xs">Decision-Making</Badge>
                </div>
              </CardContent>
            </Card>
            <Card className="hover:border-primary/50 transition-colors group" data-testid="card-game-sprint">
              <CardHeader className="pb-2">
                <div className="h-10 w-10 rounded-lg bg-orange-500/10 flex items-center justify-center mb-2">
                  <Users className="h-5 w-5 text-orange-500" />
                </div>
                <CardTitle className="text-base group-hover:text-primary transition-colors">Co-Founder Sprint</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">24h or 72h trial collaboration with a potential co-founder. Build, validate, and discover compatibility.</p>
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="outline" className="text-xs">2-Player</Badge>
                  <Badge variant="outline" className="text-xs">Collaboration</Badge>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setLocation("/sprints/practice")} data-testid="button-practice-sprint-contest">Practice</Button>
                  <Button size="sm" onClick={() => setLocation("/sprints/new")} data-testid="button-real-sprint-contest">Real Sprint</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <div className="flex items-center gap-2 flex-wrap">
          {["all", "active", "upcoming", "judging", "completed"].map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s)}
              data-testid={`button-filter-${s}`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Button>
          ))}
        </div>

        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-64 rounded-lg" />
            ))}
          </div>
        )}

        {promoted.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-semibold">Featured Contests</h2>
            </div>
            <div className="grid grid-cols-1 gap-6">
              {promoted.map((contest) => (
                <FeaturedContestCard
                  key={contest.id}
                  contest={contest}
                  onJoin={() => joinMutation.mutate(contest.id)}
                  onSubmit={() => {
                    setSelectedContest(contest);
                    setSubmitDialogOpen(true);
                  }}
                  isJoining={joinMutation.isPending}
                />
              ))}
            </div>
          </section>
        )}

        {regular.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">{promoted.length > 0 ? "More Contests" : "All Contests"}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {regular.map((contest) => (
                <ContestCard
                  key={contest.id}
                  contest={contest}
                  onJoin={() => joinMutation.mutate(contest.id)}
                  onSubmit={() => {
                    setSelectedContest(contest);
                    setSubmitDialogOpen(true);
                  }}
                  isJoining={joinMutation.isPending}
                />
              ))}
            </div>
          </section>
        )}

        {!isLoading && contests?.length === 0 && (
          <div className="text-center py-16">
            <Trophy className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No contests found</h3>
            <p className="text-muted-foreground">Check back soon for new challenges!</p>
          </div>
        )}
      </div>

      <Dialog open={submitDialogOpen} onOpenChange={setSubmitDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Submit to {selectedContest?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Project / Submission URL</label>
              <Input
                value={submissionUrl}
                onChange={(e) => setSubmissionUrl(e.target.value)}
                placeholder="https://replit.com/@you/project"
                data-testid="input-submission-url"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Notes (optional)</label>
              <Textarea
                value={submissionNote}
                onChange={(e) => setSubmissionNote(e.target.value)}
                placeholder="Describe your submission..."
                className="min-h-[80px]"
                data-testid="textarea-submission-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => selectedContest && submitMutation.mutate({ contestId: selectedContest.id, url: submissionUrl, note: submissionNote })}
              disabled={submitMutation.isPending || !submissionUrl.trim()}
              data-testid="button-submit-entry"
            >
              {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Submit Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FeaturedContestCard({
  contest,
  onJoin,
  onSubmit,
  isJoining,
}: {
  contest: ContestWithDetails;
  onJoin: () => void;
  onSubmit: () => void;
  isJoining: boolean;
}) {
  const DiffIcon = DIFFICULTY_ICONS[contest.difficulty] || Star;
  const remaining = daysLeft(contest.endDate);

  return (
    <Card className="overflow-hidden border-primary/20" data-testid={`card-contest-featured-${contest.id}`}>
      <div className="flex flex-col md:flex-row">
        <div className="flex-1 p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-xl font-bold" data-testid={`text-contest-title-${contest.id}`}>{contest.title}</h3>
                <Badge variant="outline" className={STATUS_COLORS[contest.status]}>{contest.status}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{contest.category}</p>
            </div>
          </div>

          <p className="text-secondary leading-relaxed" data-testid={`text-contest-desc-${contest.id}`}>{contest.description}</p>

          <div className="flex items-center gap-4 flex-wrap text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <DiffIcon className="h-3.5 w-3.5" />
              <span className="capitalize">{contest.difficulty}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              <span>{contest.participantCount}{contest.maxParticipants ? ` / ${contest.maxParticipants}` : ""} joined</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              <span>{formatDate(contest.startDate)} - {formatDate(contest.endDate)}</span>
            </div>
            {remaining > 0 && contest.status === "active" && (
              <div className="flex items-center gap-1.5 text-primary font-medium">
                <Clock className="h-3.5 w-3.5" />
                <span>{remaining} days left</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {contest.prize && (
              <div className="flex items-center gap-1.5 text-sm bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 px-3 py-1 rounded-full">
                <Trophy className="h-3.5 w-3.5" />
                {contest.prize}
              </div>
            )}
            {contest.badge && (
              <div className={`flex items-center gap-1.5 text-sm border px-3 py-1 rounded-full ${RARITY_COLORS[contest.badge.rarity]}`}>
                <Award className="h-3.5 w-3.5" />
                {contest.badge.name} Badge
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {contest.status === "active" && !contest.isParticipant && (
              <Button size="sm" onClick={onJoin} disabled={isJoining} data-testid={`button-join-contest-${contest.id}`}>
                <Rocket className="h-4 w-4 mr-1" />
                Join Contest
              </Button>
            )}
            {contest.status === "active" && contest.isParticipant && (
              <Button size="sm" variant="outline" onClick={onSubmit} data-testid={`button-submit-contest-${contest.id}`}>
                <ExternalLink className="h-4 w-4 mr-1" />
                Submit Entry
              </Button>
            )}
            {contest.isParticipant && (
              <Badge variant="secondary" className="text-xs">Joined</Badge>
            )}
            {contest.status === "upcoming" && !contest.isParticipant && (
              <Button size="sm" onClick={onJoin} disabled={isJoining} data-testid={`button-join-contest-${contest.id}`}>
                <Target className="h-4 w-4 mr-1" />
                Register Early
              </Button>
            )}
          </div>
        </div>

        <div className="hidden md:flex w-48 bg-gradient-to-br from-primary/5 to-purple-500/10 items-center justify-center border-l border-border">
          <div className="text-center p-4">
            <Trophy className="h-12 w-12 text-primary/40 mx-auto mb-2" />
            <Badge variant="outline" className={`${DIFFICULTY_COLORS[contest.difficulty]} text-xs`}>
              <DiffIcon className="h-3 w-3 mr-1" />
              {contest.difficulty}
            </Badge>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ContestCard({
  contest,
  onJoin,
  onSubmit,
  isJoining,
}: {
  contest: ContestWithDetails;
  onJoin: () => void;
  onSubmit: () => void;
  isJoining: boolean;
}) {
  const DiffIcon = DIFFICULTY_ICONS[contest.difficulty] || Star;
  const remaining = daysLeft(contest.endDate);

  return (
    <Card className="flex flex-col" data-testid={`card-contest-${contest.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 min-w-0">
            <CardTitle className="text-base leading-tight" data-testid={`text-contest-title-${contest.id}`}>{contest.title}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={`${STATUS_COLORS[contest.status]} text-xs`}>{contest.status}</Badge>
              <Badge variant="outline" className={`${DIFFICULTY_COLORS[contest.difficulty]} text-xs`}>
                <DiffIcon className="h-3 w-3 mr-0.5" />
                {contest.difficulty}
              </Badge>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-4">
        <p className="text-sm text-secondary line-clamp-3">{contest.description}</p>

        <div className="space-y-2 text-xs text-muted-foreground mt-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Users className="h-3 w-3" />
              <span>{contest.participantCount} participants</span>
            </div>
            {remaining > 0 && contest.status === "active" && (
              <div className="flex items-center gap-1 text-primary font-medium">
                <Clock className="h-3 w-3" />
                {remaining}d left
              </div>
            )}
          </div>
          {contest.prize && (
            <div className="flex items-center gap-1.5">
              <Trophy className="h-3 w-3 text-yellow-500" />
              <span>{contest.prize}</span>
            </div>
          )}
          {contest.badge && (
            <div className={`flex items-center gap-1.5 ${RARITY_COLORS[contest.badge.rarity]}`}>
              <Medal className="h-3 w-3" />
              <span>{contest.badge.name} badge ({contest.badge.rarity})</span>
            </div>
          )}
        </div>

        {(contest.status === "active" || contest.status === "upcoming") && (
          <div className="flex items-center gap-2 pt-2">
            {contest.isParticipant ? (
              <>
                <Badge variant="secondary" className="text-xs">Joined</Badge>
                {contest.status === "active" && (
                  <Button size="sm" variant="outline" className="flex-1" onClick={onSubmit} data-testid={`button-submit-contest-${contest.id}`}>
                    Submit
                  </Button>
                )}
              </>
            ) : (
              <Button size="sm" className="flex-1" onClick={onJoin} disabled={isJoining} data-testid={`button-join-contest-${contest.id}`}>
                {contest.status === "active" ? "Join" : "Register"}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
