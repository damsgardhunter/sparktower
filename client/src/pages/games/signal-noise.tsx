import { errorText } from "@/lib/api-error";
import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Trophy, Target, Zap, Clock, RotateCcw, CheckCircle, XCircle } from "lucide-react";

interface Scenario {
  scenario: string;
  difficulty: string;
  description: string;
  cardCount: number;
}

interface GameCard {
  id: string;
  text: string;
  isSignal: boolean;
}

interface Game {
  id: string;
  cards: GameCard[];
}

interface DecideResponse {
  correct: boolean;
  score: number;
}

interface GameResult {
  score: number;
  accuracy: number;
  streak: number;
  avgReactionMs: number;
}

interface LeaderboardEntry {
  username: string;
  scenario: string;
  score: number;
  accuracy: number;
  streak: number;
}

interface CardDecision {
  cardId: string;
  text: string;
  choice: "keep" | "discard";
  correct: boolean;
  timeMs: number;
}

const difficultyColor: Record<string, string> = {
  beginner: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  intermediate: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  advanced: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

function ScenarioSelection({ onStart }: { onStart: (game: Game) => void }) {
  const { toast } = useToast();

  const { data: scenarios, isLoading } = useQuery<Scenario[]>({
    queryKey: ["/api/games/signal-noise/scenarios"],
  });

  const startMutation = useMutation({
    mutationFn: async (scenario: string) => {
      const res = await apiRequest("POST", "/api/games/signal-noise/start", { scenario });
      return res.json() as Promise<Game>;
    },
    onSuccess: (game) => {
      onStart(game);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to start game", description: errorText(err), variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-48 mt-2" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {scenarios?.map((s) => (
        <Card key={s.scenario} className="hover-elevate" data-testid={`card-scenario-${s.scenario}`}>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-lg">{s.scenario}</CardTitle>
              <Badge className={difficultyColor[s.difficulty] || ""} data-testid={`badge-difficulty-${s.scenario}`}>
                {s.difficulty}
              </Badge>
            </div>
            <CardDescription>{s.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{s.cardCount} cards</p>
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              onClick={() => startMutation.mutate(s.scenario)}
              disabled={startMutation.isPending}
              data-testid={`button-start-${s.scenario}`}
            >
              {startMutation.isPending ? "Starting..." : "Play"}
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}

function GamePlay({
  game,
  onComplete,
}: {
  game: Game;
  onComplete: (result: GameResult, decisions: CardDecision[]) => void;
}) {
  const { toast } = useToast();
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [flashColor, setFlashColor] = useState<"green" | "red" | null>(null);
  const [cardStartTime, setCardStartTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [decisions, setDecisions] = useState<CardDecision[]>([]);
  const deciding = useRef(false);

  const totalCards = game.cards.length;
  const currentCard = game.cards[currentCardIndex];

  useEffect(() => {
    setCardStartTime(Date.now());
  }, [currentCardIndex]);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - cardStartTime);
    }, 100);
    return () => clearInterval(interval);
  }, [cardStartTime]);

  const decideMutation = useMutation({
    mutationFn: async (params: { cardId: string; choice: "keep" | "discard"; timeMs: number }) => {
      const res = await apiRequest("POST", `/api/games/signal-noise/${game.id}/decide`, params);
      return res.json() as Promise<DecideResponse>;
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/games/signal-noise/${game.id}/complete`);
      return res.json() as Promise<GameResult>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/games/leaderboard/signal"] });
      onComplete(result, decisions);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to complete game", description: errorText(err), variant: "destructive" });
    },
  });

  const handleDecision = useCallback(
    async (choice: "keep" | "discard") => {
      if (deciding.current || !currentCard) return;
      deciding.current = true;

      const timeMs = Date.now() - cardStartTime;

      try {
        const result = await decideMutation.mutateAsync({
          cardId: currentCard.id,
          choice,
          timeMs,
        });

        const decision: CardDecision = {
          cardId: currentCard.id,
          text: currentCard.text,
          choice,
          correct: result.correct,
          timeMs,
        };

        const newDecisions = [...decisions, decision];
        setDecisions(newDecisions);

        if (result.correct) {
          const newStreak = streak + 1;
          setStreak(newStreak);
          if (newStreak > bestStreak) setBestStreak(newStreak);
          setFlashColor("green");
          setScore((prev) => prev + 10);
        } else {
          setStreak(0);
          setFlashColor("red");
        }

        setTimeout(() => {
          setFlashColor(null);
          if (currentCardIndex + 1 >= totalCards) {
            completeMutation.mutate();
          } else {
            setCurrentCardIndex((i) => i + 1);
          }
          deciding.current = false;
        }, 400);
      } catch {
        toast({ title: "Decision failed", variant: "destructive" });
        deciding.current = false;
      }
    },
    [currentCard, cardStartTime, streak, bestStreak, decisions, currentCardIndex, totalCards, decideMutation, completeMutation, toast],
  );

  if (!currentCard) return null;

  const progressPercent = ((currentCardIndex + 1) / totalCards) * 100;
  const elapsedSeconds = (elapsed / 1000).toFixed(1);

  return (
    <div className="flex flex-col items-center gap-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between gap-4 w-full flex-wrap">
        <p className="text-sm text-muted-foreground" data-testid="text-card-progress">
          Card {currentCardIndex + 1} of {totalCards}
        </p>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1">
            <Trophy className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-medium" data-testid="text-score">{score}</span>
          </div>
          <div className="flex items-center gap-1">
            <Zap className="h-4 w-4 text-orange-500" />
            <span className="text-sm font-medium" data-testid="text-streak">{streak}</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium" data-testid="text-timer">{elapsedSeconds}s</span>
          </div>
        </div>
      </div>

      <Progress value={progressPercent} className="w-full" data-testid="progress-game" />

      <Card
        className={`w-full transition-colors duration-200 ${
          flashColor === "green"
            ? "ring-2 ring-green-500 bg-green-50 dark:bg-green-950"
            : flashColor === "red"
              ? "ring-2 ring-red-500 bg-red-50 dark:bg-red-950"
              : ""
        }`}
        data-testid="card-current"
      >
        <CardContent className="p-8 flex items-center justify-center min-h-[200px]">
          <p className="text-xl text-center leading-relaxed" data-testid="text-card-content">
            {currentCard.text}
          </p>
        </CardContent>
      </Card>

      <div className="flex gap-4 w-full">
        <Button
          className="flex-1 bg-red-600 hover:bg-red-700 text-white"
          size="lg"
          onClick={() => handleDecision("discard")}
          disabled={decideMutation.isPending || !!flashColor}
          data-testid="button-discard"
        >
          <XCircle className="h-5 w-5 mr-2" />
          Discard (Noise)
        </Button>
        <Button
          className="flex-1 bg-green-600 hover:bg-green-700 text-white"
          size="lg"
          onClick={() => handleDecision("keep")}
          disabled={decideMutation.isPending || !!flashColor}
          data-testid="button-keep"
        >
          <CheckCircle className="h-5 w-5 mr-2" />
          Keep (Signal)
        </Button>
      </div>
    </div>
  );
}

function ResultsScreen({
  result,
  decisions,
  onPlayAgain,
}: {
  result: GameResult;
  decisions: CardDecision[];
  onPlayAgain: () => void;
}) {
  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold text-center" data-testid="text-results-title">Results</h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex flex-col items-center gap-1">
            <Trophy className="h-6 w-6 text-amber-500" />
            <p className="text-2xl font-bold" data-testid="text-result-score">{result.score}</p>
            <p className="text-xs text-muted-foreground">Score</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col items-center gap-1">
            <Target className="h-6 w-6 text-blue-500" />
            <p className="text-2xl font-bold" data-testid="text-result-accuracy">{Math.round(result.accuracy)}%</p>
            <p className="text-xs text-muted-foreground">Accuracy</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col items-center gap-1">
            <Zap className="h-6 w-6 text-orange-500" />
            <p className="text-2xl font-bold" data-testid="text-result-streak">{result.streak}</p>
            <p className="text-xs text-muted-foreground">Best Streak</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col items-center gap-1">
            <Clock className="h-6 w-6 text-muted-foreground" />
            <p className="text-2xl font-bold" data-testid="text-result-reaction">{Math.round(result.avgReactionMs)}ms</p>
            <p className="text-xs text-muted-foreground">Avg Reaction</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Decision Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-decisions">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 pr-4">#</th>
                <th className="text-left py-2 pr-4">Card</th>
                <th className="text-left py-2 pr-4">Your Choice</th>
                <th className="text-left py-2 pr-4">Result</th>
                <th className="text-right py-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((d, i) => (
                <tr key={d.cardId} className="border-b last:border-0" data-testid={`row-decision-${i}`}>
                  <td className="py-2 pr-4 text-muted-foreground">{i + 1}</td>
                  <td className="py-2 pr-4 max-w-[200px] truncate">{d.text}</td>
                  <td className="py-2 pr-4">
                    <Badge className={d.choice === "keep" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"}>
                      {d.choice}
                    </Badge>
                  </td>
                  <td className="py-2 pr-4">
                    {d.correct ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                  </td>
                  <td className="py-2 text-right text-muted-foreground">{d.timeMs}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Button onClick={onPlayAgain} className="mx-auto" data-testid="button-play-again">
        <RotateCcw className="h-4 w-4 mr-2" />
        Play Again
      </Button>
    </div>
  );
}

function LeaderboardView() {
  const { data: entries, isLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ["/api/games/leaderboard/signal"],
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!entries?.length) {
    return <p className="text-center text-muted-foreground py-8">No leaderboard entries yet.</p>;
  }

  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm" data-testid="table-leaderboard">
          <thead>
            <tr className="border-b">
              <th className="text-left py-3 px-4">Rank</th>
              <th className="text-left py-3 px-4">Player</th>
              <th className="text-left py-3 px-4">Scenario</th>
              <th className="text-right py-3 px-4">Score</th>
              <th className="text-right py-3 px-4">Accuracy</th>
              <th className="text-right py-3 px-4">Streak</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => (
              <tr key={i} className="border-b last:border-0" data-testid={`row-leaderboard-${i}`}>
                <td className="py-3 px-4 font-medium">{i + 1}</td>
                <td className="py-3 px-4">{entry.username || "Player"}</td>
                <td className="py-3 px-4">{entry.scenario || "-"}</td>
                <td className="py-3 px-4 text-right font-medium">{entry.score}</td>
                <td className="py-3 px-4 text-right">{entry.accuracy || 0}%</td>
                <td className="py-3 px-4 text-right">{entry.streak || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

type GameView = "scenarios" | "playing" | "results";

export default function SignalNoise() {
  const [view, setView] = useState<GameView>("scenarios");
  const [game, setGame] = useState<Game | null>(null);
  const [result, setResult] = useState<GameResult | null>(null);
  const [decisions, setDecisions] = useState<CardDecision[]>([]);
  const [activeTab, setActiveTab] = useState("play");

  const handleStart = (g: Game) => {
    setGame(g);
    setView("playing");
  };

  const handleComplete = (r: GameResult, d: CardDecision[]) => {
    setResult(r);
    setDecisions(d);
    setView("results");
  };

  const handlePlayAgain = () => {
    setGame(null);
    setResult(null);
    setDecisions([]);
    setView("scenarios");
  };

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6" data-testid="text-page-title">Signal vs. Noise</h1>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
          <TabsList>
            <TabsTrigger value="play" data-testid="tab-play">Play</TabsTrigger>
            <TabsTrigger value="leaderboard" data-testid="tab-leaderboard">Leaderboard</TabsTrigger>
          </TabsList>

          <TabsContent value="play" className="mt-6">
            {view === "scenarios" && <ScenarioSelection onStart={handleStart} />}
            {view === "playing" && game && (
              <GamePlay game={game} onComplete={handleComplete} />
            )}
            {view === "results" && result && (
              <ResultsScreen result={result} decisions={decisions} onPlayAgain={handlePlayAgain} />
            )}
          </TabsContent>

          <TabsContent value="leaderboard" className="mt-6">
            <LeaderboardView />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
