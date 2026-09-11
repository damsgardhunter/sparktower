import { errorText } from "@/lib/api-error";
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Keyboard,
  Trophy,
  Users,
  Zap,
  Target,
  Clock,
  Plus,
  Play,
  Crown,
} from "lucide-react";

interface RacePlayer {
  id: string;
  userId: string;
  username: string;
  wpm: number;
  accuracy: number;
  progress: number;
  finished: boolean;
  rank?: number;
  score?: number;
  finishTimeMs?: number;
}

interface Race {
  id: string;
  status: "waiting" | "active" | "finished";
  prompt: string;
  promptCategory?: string;
  players: RacePlayer[];
  startedAt?: string;
  createdBy?: string;
}

interface LobbyRace {
  id: string;
  promptCategory?: string;
  playerCount: number;
  players: { username: string }[];
}

interface LeaderboardEntry {
  userId: string;
  username: string;
  wpm: number;
  accuracy: number;
  score: number;
  rank: number;
}

function LobbyView() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: lobbyRaces, isLoading } = useQuery<LobbyRace[]>({
    queryKey: ["/api/games/typing/lobby"],
    refetchInterval: 5000,
  });

  const createRaceMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/games/typing/create");
      return res.json();
    },
    onSuccess: (data: { id: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/games/typing/lobby"] });
      navigate(`/games/typing/${data.id}`);
    },
    onError: (err: Error) => {
      toast({ title: "Error creating race", description: errorText(err), variant: "destructive" });
    },
  });

  const joinRaceMutation = useMutation({
    mutationFn: async (raceId: string) => {
      const res = await apiRequest("POST", `/api/games/typing/${raceId}/join`);
      return res.json();
    },
    onSuccess: (_: unknown, raceId: string) => {
      queryClient.invalidateQueries({ queryKey: ["/api/games/typing/lobby"] });
      navigate(`/games/typing/${raceId}`);
    },
    onError: (err: Error) => {
      toast({ title: "Error joining race", description: errorText(err), variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-semibold" data-testid="text-lobby-title">Open Races</h2>
          <p className="text-sm text-muted-foreground">Join a race or create your own</p>
        </div>
        <Button
          onClick={() => createRaceMutation.mutate()}
          disabled={createRaceMutation.isPending}
          data-testid="button-create-race"
        >
          <Plus className="mr-2 h-4 w-4" />
          Create Race
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : !lobbyRaces || lobbyRaces.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
            <Keyboard className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground" data-testid="text-no-races">No races available. Create one to get started!</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {lobbyRaces.map((race) => (
            <Card key={race.id} data-testid={`card-race-${race.id}`}>
              <CardContent className="flex items-center justify-between flex-wrap gap-4 py-4">
                <div className="flex items-center gap-3">
                  <Keyboard className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{race.promptCategory || "Random"}</p>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      <span data-testid={`text-player-count-${race.id}`}>{race.playerCount} player{race.playerCount !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={() => joinRaceMutation.mutate(race.id)}
                  disabled={joinRaceMutation.isPending}
                  data-testid={`button-join-race-${race.id}`}
                >
                  Join
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function RaceView({ raceId }: { raceId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [countdown, setCountdown] = useState<number | null>(null);
  const [typedText, setTypedText] = useState("");
  const [errors, setErrors] = useState(0);
  const [correctChars, setCorrectChars] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [hasFinished, setHasFinished] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTriggeredRef = useRef(false);

  const { data: race, isLoading } = useQuery<Race>({
    queryKey: ["/api/games/typing", raceId],
    refetchInterval: 1500,
  });

  const startRaceMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/games/typing/${raceId}/start`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games/typing", raceId] });
    },
    onError: (err: Error) => {
      toast({ title: "Error starting race", description: errorText(err), variant: "destructive" });
    },
  });

  const progressMutation = useMutation({
    mutationFn: async (data: { wpm: number; accuracy: number; progress: number; charsTyped: number; errors: number }) => {
      await apiRequest("POST", `/api/games/typing/${raceId}/progress`, data);
    },
  });

  const finishMutation = useMutation({
    mutationFn: async (data: { wpm: number; accuracy: number; finishTimeMs: number; charsTyped: number }) => {
      await apiRequest("POST", `/api/games/typing/${raceId}/finish`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games/typing", raceId] });
    },
  });

  const calculateWpm = useCallback(() => {
    if (!startTime || typedText.length === 0) return 0;
    const elapsedMs = Date.now() - startTime;
    if (elapsedMs === 0) return 0;
    return Math.round((typedText.length / 5) / (elapsedMs / 60000));
  }, [startTime, typedText.length]);

  const calculateAccuracy = useCallback(() => {
    const total = correctChars + errors;
    if (total === 0) return 100;
    return Math.round((correctChars / total) * 100);
  }, [correctChars, errors]);

  useEffect(() => {
    if (race?.status === "active" && !countdownTriggeredRef.current) {
      countdownTriggeredRef.current = true;
      setCountdown(3);
    }
  }, [race?.status]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      setStartTime(Date.now());
      textareaRef.current?.focus();
      return;
    }
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    if (!startTime || hasFinished || race?.status !== "active") return;

    progressIntervalRef.current = setInterval(() => {
      if (!race?.prompt) return;
      const wpm = calculateWpm();
      const accuracy = calculateAccuracy();
      const progress = Math.round((typedText.length / race.prompt.length) * 100);
      progressMutation.mutate({
        wpm,
        accuracy,
        progress,
        charsTyped: typedText.length,
        errors,
      });
    }, 2000);

    return () => {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, [startTime, hasFinished, race?.status, race?.prompt, typedText.length, errors, calculateWpm, calculateAccuracy]);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (!race?.prompt || !startTime || hasFinished || countdown !== null) return;

      const newValue = e.target.value;
      const prompt = race.prompt;

      if (newValue.length > prompt.length) return;

      let newErrors = 0;
      let newCorrect = 0;
      for (let i = 0; i < newValue.length; i++) {
        if (newValue[i] === prompt[i]) {
          newCorrect++;
        } else {
          newErrors++;
        }
      }

      setTypedText(newValue);
      setErrors(newErrors);
      setCorrectChars(newCorrect);

      if (newValue.length === prompt.length && newErrors === 0) {
        setHasFinished(true);
        const finishTimeMs = Date.now() - startTime;
        const wpm = Math.round((newValue.length / 5) / (finishTimeMs / 60000));
        const accuracy = Math.round((newCorrect / (newCorrect + newErrors || 1)) * 100);
        finishMutation.mutate({
          wpm,
          accuracy,
          finishTimeMs,
          charsTyped: newValue.length,
        });
      }
    },
    [race?.prompt, startTime, hasFinished, countdown, finishMutation]
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (!race) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
          <p className="text-muted-foreground" data-testid="text-race-not-found">Race not found</p>
          <Button variant="outline" onClick={() => navigate("/games/typing")} data-testid="button-back-to-lobby">
            Back to Lobby
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (race.status === "waiting") {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <h2 className="text-xl font-semibold" data-testid="text-waiting-title">Waiting for Players</h2>
          <Button
            onClick={() => startRaceMutation.mutate()}
            disabled={startRaceMutation.isPending}
            data-testid="button-start-race"
          >
            <Play className="mr-2 h-4 w-4" />
            Start Race
          </Button>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Players ({race.players.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {race.players.map((player) => (
              <div
                key={player.id}
                className="flex items-center gap-3 py-2"
                data-testid={`player-waiting-${player.userId}`}
              >
                <Badge variant="secondary">{player.username || "Player"}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <Button variant="outline" onClick={() => navigate("/games/typing")} data-testid="button-back-lobby">
          Back to Lobby
        </Button>
      </div>
    );
  }

  if (race.status === "finished") {
    const sortedPlayers = [...race.players].sort((a, b) => (a.rank || 99) - (b.rank || 99));
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold flex items-center gap-2" data-testid="text-results-title">
          <Trophy className="h-5 w-5 text-yellow-500" />
          Race Results
        </h2>
        <div className="space-y-3">
          {sortedPlayers.map((player, idx) => (
            <Card key={player.id} data-testid={`card-result-${player.userId}`}>
              <CardContent className="flex items-center justify-between flex-wrap gap-4 py-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-bold text-muted-foreground w-8 text-center">
                    {idx === 0 ? <Crown className="h-6 w-6 text-yellow-500 inline" /> : `#${idx + 1}`}
                  </span>
                  <div>
                    <p className="font-medium" data-testid={`text-result-name-${player.userId}`}>{player.username || "Player"}</p>
                    {player.finishTimeMs && (
                      <p className="text-xs text-muted-foreground">
                        {(player.finishTimeMs / 1000).toFixed(1)}s
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="text-center">
                    <p className="text-lg font-bold" data-testid={`text-result-wpm-${player.userId}`}>{player.wpm}</p>
                    <p className="text-xs text-muted-foreground">WPM</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold" data-testid={`text-result-accuracy-${player.userId}`}>{player.accuracy}%</p>
                    <p className="text-xs text-muted-foreground">Accuracy</p>
                  </div>
                  {player.score !== undefined && (
                    <div className="text-center">
                      <p className="text-lg font-bold" data-testid={`text-result-score-${player.userId}`}>{player.score}</p>
                      <p className="text-xs text-muted-foreground">Score</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Button variant="outline" onClick={() => navigate("/games/typing")} data-testid="button-back-lobby-results">
          Back to Lobby
        </Button>
      </div>
    );
  }

  const prompt = race.prompt || "";
  const wpm = calculateWpm();
  const accuracy = calculateAccuracy();
  const progressPct = prompt.length > 0 ? Math.round((typedText.length / prompt.length) * 100) : 0;
  const isTypingActive = startTime !== null && countdown === null && !hasFinished;

  return (
    <div className="space-y-6 relative">
      {countdown !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          data-testid="overlay-countdown"
        >
          <div className="text-center">
            <p className="text-8xl font-bold animate-pulse" data-testid="text-countdown">
              {countdown === 0 ? "GO!" : countdown}
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            <span className="text-lg font-bold" data-testid="text-live-wpm">{wpm}</span>
            <span className="text-sm text-muted-foreground">WPM</span>
          </div>
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            <span className="text-lg font-bold" data-testid="text-live-accuracy">{accuracy}%</span>
            <span className="text-sm text-muted-foreground">Accuracy</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            <span className="text-sm text-muted-foreground" data-testid="text-progress-pct">{progressPct}%</span>
          </div>
        </div>
      </div>

      <Progress value={progressPct} className="h-2" data-testid="progress-self" />

      <Card>
        <CardContent className="py-6 relative">
          <div
            className="font-mono text-lg leading-relaxed whitespace-pre-wrap select-none"
            data-testid="text-prompt-display"
            onClick={() => textareaRef.current?.focus()}
          >
            {prompt.split("").map((char: string, i: number) => {
              let className = "text-muted-foreground";
              if (i < typedText.length) {
                if (typedText[i] === char) {
                  className = "text-green-600 dark:text-green-400";
                } else {
                  className = "bg-red-200 dark:bg-red-900 text-red-700 dark:text-red-300";
                }
              } else if (i === typedText.length && isTypingActive) {
                className = "underline decoration-2 text-foreground bg-muted";
              }
              return (
                <span key={i} className={className}>
                  {char}
                </span>
              );
            })}
          </div>
          <textarea
            ref={textareaRef}
            value={typedText}
            onChange={handleInput}
            className="absolute opacity-0 top-0 left-0 w-full h-full"
            autoFocus
            disabled={!isTypingActive}
            data-testid="input-typing"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
          />
        </CardContent>
      </Card>

      {race.players.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Racers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {race.players.map((player) => (
              <div key={player.id} className="space-y-1" data-testid={`racer-progress-${player.userId}`}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-sm font-medium">{player.username || "Player"}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{player.wpm} WPM</span>
                    {player.finished && <Badge variant="secondary">Finished</Badge>}
                  </div>
                </div>
                <Progress value={player.progress || 0} className="h-1.5" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LeaderboardView() {
  const { data: leaderboard, isLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ["/api/games/leaderboard/typing"],
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!leaderboard || leaderboard.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
          <Trophy className="h-10 w-10 text-muted-foreground" />
          <p className="text-muted-foreground" data-testid="text-no-leaderboard">No leaderboard data yet. Play a race!</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {leaderboard.map((entry, idx) => (
        <Card key={entry.userId} data-testid={`card-leaderboard-${entry.userId}`}>
          <CardContent className="flex items-center justify-between flex-wrap gap-4 py-4">
            <div className="flex items-center gap-3">
              <span className="text-xl font-bold text-muted-foreground w-8 text-center">
                {idx === 0 ? <Crown className="h-5 w-5 text-yellow-500 inline" /> : `#${idx + 1}`}
              </span>
               <span className="font-medium" data-testid={`text-lb-name-${entry.userId}`}>{entry.username || "Player"}</span>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="text-center">
                <p className="font-bold" data-testid={`text-lb-wpm-${entry.userId}`}>{entry.wpm || 0}</p>
                <p className="text-xs text-muted-foreground">WPM</p>
              </div>
              <div className="text-center">
                <p className="font-bold" data-testid={`text-lb-accuracy-${entry.userId}`}>{entry.accuracy || 0}%</p>
                <p className="text-xs text-muted-foreground">Accuracy</p>
              </div>
              <div className="text-center">
                <p className="font-bold" data-testid={`text-lb-score-${entry.userId}`}>{entry.score}</p>
                <p className="text-xs text-muted-foreground">Score</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function TypingArena() {
  const [, params] = useRoute("/games/typing/:id");
  const raceId = params?.id;

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4">
      <div className="flex items-center gap-3 mb-6">
        <Keyboard className="h-7 w-7" />
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Velocity Type Arena</h1>
      </div>

      {raceId ? (
        <RaceView raceId={raceId} />
      ) : (
        <Tabs defaultValue="play" className="space-y-6">
          <TabsList data-testid="tabs-typing-arena">
            <TabsTrigger value="play" data-testid="tab-play">Play</TabsTrigger>
            <TabsTrigger value="leaderboard" data-testid="tab-leaderboard">Leaderboard</TabsTrigger>
          </TabsList>
          <TabsContent value="play">
            <LobbyView />
          </TabsContent>
          <TabsContent value="leaderboard">
            <LeaderboardView />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
