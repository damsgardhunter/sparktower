import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Crown, Sword, Brain, Eye, Wrench, Plus, Users, Trophy, Shield, Zap, Target, Move } from "lucide-react";

const ROLES = [
  { value: "commander", label: "Commander", icon: Crown, hp: 80, atk: 5, def: 15, desc: "Team Healer" },
  { value: "warrior", label: "Warrior", icon: Sword, hp: 120, atk: 25, def: 10, desc: "Damage Dealer" },
  { value: "strategist", label: "Strategist", icon: Brain, hp: 70, atk: 15, def: 5, desc: "Places Traps" },
  { value: "scout", label: "Scout", icon: Eye, hp: 60, atk: 10, def: 5, desc: "Reveals Area" },
  { value: "engineer", label: "Engineer", icon: Wrench, hp: 90, atk: 8, def: 20, desc: "Gathers Resources" },
] as const;

const ROLE_INITIALS: Record<string, string> = {
  commander: "C",
  warrior: "W",
  strategist: "S",
  scout: "Sc",
  engineer: "E",
};

const TERRAIN_COLORS: Record<string, string> = {
  plain: "bg-slate-100 dark:bg-slate-800",
  mountain: "bg-stone-400 dark:bg-stone-600",
  forest: "bg-emerald-300 dark:bg-emerald-700",
  water: "bg-blue-300 dark:bg-blue-700",
};

const ACTION_TYPES = [
  { value: "move", label: "Move", icon: Move },
  { value: "attack", label: "Attack", icon: Sword },
  { value: "ability", label: "Ability", icon: Zap },
  { value: "defend", label: "Defend", icon: Shield },
];

function getRoleIcon(role: string) {
  const found = ROLES.find((r) => r.value === role);
  return found ? found.icon : Shield;
}

function LobbyView() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState("warrior");
  const [selectedTeam, setSelectedTeam] = useState("1");
  const [joinGameId, setJoinGameId] = useState<string | null>(null);

  const { data: lobby, isLoading } = useQuery<any[]>({
    queryKey: ["/api/games/tactics/lobby"],
  });

  const createMutation = useMutation({
    mutationFn: async (role: string) => {
      const res = await apiRequest("POST", "/api/games/tactics/create", { role });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/games/tactics/lobby"] });
      setCreateOpen(false);
      toast({ title: "Game created" });
      if (data?.id) navigate(`/games/tactics/${data.id}`);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const joinMutation = useMutation({
    mutationFn: async ({ gameId, role, teamId }: { gameId: string; role: string; teamId: number }) => {
      const res = await apiRequest("POST", `/api/games/tactics/${gameId}/join`, { role, teamId });
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/games/tactics/lobby"] });
      setJoinOpen(false);
      toast({ title: "Joined game" });
      navigate(`/games/tactics/${variables.gameId}`);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-lobby-title">Team Tactics Arena</h1>
          <p className="text-muted-foreground">Create or join a tactical team battle</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-game">
              <Plus className="mr-2 h-4 w-4" />
              Create Game
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Game</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <label className="text-sm font-medium">Select Your Role</label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger data-testid="select-create-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((role) => (
                    <SelectItem key={role.value} value={role.value} data-testid={`option-role-${role.value}`}>
                      <span className="flex items-center gap-2">
                        <role.icon className="h-4 w-4" />
                        {role.label} - {role.desc}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {ROLES.map((role) =>
                role.value === selectedRole ? (
                  <Card key={role.value}>
                    <CardContent className="pt-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <role.icon className="h-5 w-5" />
                        <span className="font-semibold">{role.label}</span>
                        <Badge variant="secondary">{role.desc}</Badge>
                      </div>
                      <div className="flex gap-4 text-sm text-muted-foreground">
                        <span>HP: {role.hp}</span>
                        <span>ATK: {role.atk}</span>
                        <span>DEF: {role.def}</span>
                      </div>
                    </CardContent>
                  </Card>
                ) : null
              )}
            </div>
            <DialogFooter>
              <Button
                data-testid="button-confirm-create"
                onClick={() => createMutation.mutate(selectedRole)}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? "Creating..." : "Create Game"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : !lobby || lobby.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No games waiting. Create one to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {lobby.map((game: any) => (
            <Card key={game.id} data-testid={`card-game-${game.id}`}>
              <CardContent className="flex items-center justify-between gap-4 flex-wrap py-4">
                <div className="flex items-center gap-3">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium" data-testid={`text-game-id-${game.id}`}>
                      Game #{game.id}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {game.playerCount ?? game.players?.length ?? 0} players
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  data-testid={`button-join-game-${game.id}`}
                  onClick={() => {
                    setJoinGameId(game.id);
                    setJoinOpen(true);
                  }}
                >
                  Join
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Join Game #{joinGameId}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Select Team</label>
              <Select value={selectedTeam} onValueChange={setSelectedTeam}>
                <SelectTrigger data-testid="select-join-team">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Team 1</SelectItem>
                  <SelectItem value="2">Team 2</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Select Your Role</label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger data-testid="select-join-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((role) => (
                    <SelectItem key={role.value} value={role.value} data-testid={`option-join-role-${role.value}`}>
                      <span className="flex items-center gap-2">
                        <role.icon className="h-4 w-4" />
                        {role.label} - {role.desc}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              data-testid="button-confirm-join"
              onClick={() => {
                if (joinGameId) {
                  joinMutation.mutate({
                    gameId: joinGameId,
                    role: selectedRole,
                    teamId: parseInt(selectedTeam),
                  });
                }
              }}
              disabled={joinMutation.isPending}
            >
              {joinMutation.isPending ? "Joining..." : "Join Game"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GameBoard({ game }: { game: any }) {
  const mapData = game.mapData || [];
  const mapSize = game.mapSize || 8;
  const players = game.players || [];

  const getTerrainAt = (row: number, col: number) => {
    if (mapData && mapData[row] && mapData[row][col]) {
      return mapData[row][col];
    }
    return "plain";
  };

  const getPlayerAt = (row: number, col: number) => {
    return players.find(
      (p: any) => p.position && p.position.x === col && p.position.y === row && p.isAlive !== false
    );
  };

  return (
    <div className="grid grid-cols-8 gap-0.5 border border-border rounded-md overflow-hidden" data-testid="game-board">
      {Array.from({ length: mapSize }, (_, row) =>
        Array.from({ length: mapSize }, (_, col) => {
          const terrain = getTerrainAt(row, col);
          const player = getPlayerAt(row, col);
          const terrainClass = TERRAIN_COLORS[terrain] || TERRAIN_COLORS.plain;
          return (
            <div
              key={`${row}-${col}`}
              className={`aspect-square flex items-center justify-center ${terrainClass} relative cursor-pointer`}
              data-testid={`cell-${row}-${col}`}
              data-row={row}
              data-col={col}
            >
              {player && (
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                    player.teamId === 1 ? "bg-blue-500" : "bg-red-500"
                  }`}
                  data-testid={`token-player-${player.userId || player.id}`}
                  title={`${player.role} (Team ${player.teamId})`}
                >
                  {ROLE_INITIALS[player.role] || "?"}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function PlayerPanel({ players }: { players: any[] }) {
  const team1 = players.filter((p: any) => p.teamId === 1);
  const team2 = players.filter((p: any) => p.teamId === 2);

  const renderPlayer = (player: any) => {
    const RoleIcon = getRoleIcon(player.role);
    const roleInfo = ROLES.find((r) => r.value === player.role);
    const maxHp = roleInfo?.hp || 100;
    const currentHp = player.health ?? maxHp;
    const hpPercent = Math.max(0, (currentHp / maxHp) * 100);
    const isAlive = player.isAlive !== false;

    return (
      <div
        key={player.userId || player.id}
        className={`flex items-center gap-3 p-2 rounded-md ${!isAlive ? "opacity-40" : ""}`}
        data-testid={`panel-player-${player.userId || player.id}`}
      >
        <RoleIcon className="h-4 w-4 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{player.username || player.role}</span>
            <Badge variant="secondary">{player.role}</Badge>
            {!isAlive && <Badge variant="destructive">Dead</Badge>}
          </div>
          <div className="mt-1">
            <Progress value={hpPercent} className="h-2" />
            <span className="text-xs text-muted-foreground">
              {currentHp}/{maxHp} HP
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-blue-500" />
          Team 1
        </h3>
        <div className="space-y-1">
          {team1.length === 0 ? (
            <p className="text-xs text-muted-foreground">No players</p>
          ) : (
            team1.map(renderPlayer)
          )}
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          Team 2
        </h3>
        <div className="space-y-1">
          {team2.length === 0 ? (
            <p className="text-xs text-muted-foreground">No players</p>
          ) : (
            team2.map(renderPlayer)
          )}
        </div>
      </div>
    </div>
  );
}

function GameView({ gameId }: { gameId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [actionType, setActionType] = useState("move");
  const [targetPosition, setTargetPosition] = useState<{ x: number; y: number } | null>(null);
  const [targetPlayerId, setTargetPlayerId] = useState<string | null>(null);

  const { data: game, isLoading } = useQuery<any>({
    queryKey: ["/api/games/tactics", gameId],
    refetchInterval: 3000,
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/games/tactics/${gameId}/start`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games/tactics", gameId] });
      toast({ title: "Game started" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const moveMutation = useMutation({
    mutationFn: async (payload: { actionType: string; targetPosition?: { x: number; y: number } | null; targetPlayerId?: string | null }) => {
      await apiRequest("POST", `/api/games/tactics/${gameId}/move`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games/tactics", gameId] });
      toast({ title: "Move submitted" });
      setTargetPosition(null);
      setTargetPlayerId(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/games/tactics/${gameId}/resolve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games/tactics", gameId] });
      toast({ title: "Round resolved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-6xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="aspect-square col-span-2" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Game not found.
          </CardContent>
        </Card>
      </div>
    );
  }

  const players = game.players || [];
  const status = game.status || "waiting";
  const enemyPlayers = players.filter(
    (p: any) => {
      const currentPlayer = players.find((pl: any) => pl.userId === user?.id);
      return currentPlayer && p.teamId !== currentPlayer.teamId && p.isAlive !== false;
    }
  );

  const handleCellClick = (row: number, col: number) => {
    if (status !== "discussion") return;
    setTargetPosition({ x: col, y: row });
  };

  const handleSubmitMove = () => {
    moveMutation.mutate({
      actionType,
      targetPosition,
      targetPlayerId,
    });
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-game-title">Game #{gameId}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge
              variant={status === "completed" ? "default" : "secondary"}
              data-testid="badge-game-status"
            >
              {status}
            </Badge>
            {game.currentRound != null && (
              <span className="text-sm text-muted-foreground" data-testid="text-round">
                Round {game.currentRound} / {game.maxRounds || 10}
              </span>
            )}
          </div>
        </div>
      </div>

      {status === "completed" && (
        <Card data-testid="card-winner-banner">
          <CardContent className="py-6 text-center">
            <Trophy className="h-10 w-10 mx-auto mb-2 text-yellow-500" />
            <h2 className="text-xl font-bold" data-testid="text-winner">
              {game.winnerId ? `${game.winnerId === "team1" ? "Team 1" : "Team 2"} Wins!` : "Game Over"}
            </h2>
            {game.players && (
              <div className="flex justify-center gap-6 mt-3 text-sm text-muted-foreground">
                <span>Team 1 HP: {game.players.filter((p: any) => p.teamId === 1).reduce((s: number, p: any) => s + (p.health || 0), 0)}</span>
                <span>Team 2 HP: {game.players.filter((p: any) => p.teamId === 2).reduce((s: number, p: any) => s + (p.health || 0), 0)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div onClick={(e) => {
            const cell = (e.target as HTMLElement).closest("[data-row]");
            if (cell) {
              const row = parseInt(cell.getAttribute("data-row")!);
              const col = parseInt(cell.getAttribute("data-col")!);
              handleCellClick(row, col);
            }
          }}>
            <GameBoard game={game} />
          </div>

          {status === "waiting" && (
            <div className="flex items-center gap-4 flex-wrap">
              <Button
                data-testid="button-start-game"
                onClick={() => startMutation.mutate()}
                disabled={startMutation.isPending || players.length < 2}
              >
                {startMutation.isPending ? "Starting..." : "Start Game"}
              </Button>
              {players.length < 2 && (
                <span className="text-sm text-muted-foreground">Need at least 2 players to start</span>
              )}
            </div>
          )}

          {status === "discussion" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Submit Move</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Action Type</label>
                  <Select value={actionType} onValueChange={setActionType}>
                    <SelectTrigger data-testid="select-action-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACTION_TYPES.map((a) => (
                        <SelectItem key={a.value} value={a.value} data-testid={`option-action-${a.value}`}>
                          <span className="flex items-center gap-2">
                            <a.icon className="h-4 w-4" />
                            {a.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {targetPosition && (
                  <div className="text-sm" data-testid="text-target-position">
                    Target: ({targetPosition.x}, {targetPosition.y})
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-2"
                      onClick={() => setTargetPosition(null)}
                      data-testid="button-clear-position"
                    >
                      Clear
                    </Button>
                  </div>
                )}

                {(actionType === "attack" || actionType === "ability") && enemyPlayers.length > 0 && (
                  <div>
                    <label className="text-sm font-medium mb-1 block">Target Player</label>
                    <Select value={targetPlayerId || ""} onValueChange={setTargetPlayerId}>
                      <SelectTrigger data-testid="select-target-player">
                        <SelectValue placeholder="Select target" />
                      </SelectTrigger>
                      <SelectContent>
                        {enemyPlayers.map((p: any) => (
                          <SelectItem
                            key={p.userId || p.id}
                            value={String(p.userId || p.id)}
                            data-testid={`option-target-${p.userId || p.id}`}
                          >
                            {p.username || p.role} ({p.role})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="flex gap-3 flex-wrap">
                  <Button
                    data-testid="button-submit-move"
                    onClick={handleSubmitMove}
                    disabled={moveMutation.isPending}
                  >
                    {moveMutation.isPending ? "Submitting..." : "Submit Move"}
                  </Button>
                  <Button
                    variant="outline"
                    data-testid="button-resolve-round"
                    onClick={() => resolveMutation.mutate()}
                    disabled={resolveMutation.isPending}
                  >
                    {resolveMutation.isPending ? "Resolving..." : "Resolve Round"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Players</CardTitle>
            </CardHeader>
            <CardContent>
              <PlayerPanel players={players} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function LeaderboardView() {
  const { data: leaderboard, isLoading } = useQuery<any[]>({
    queryKey: ["/api/games/leaderboard/tactics"],
  });

  if (isLoading) {
    return (
      <div className="space-y-3 p-6 max-w-4xl mx-auto">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (!leaderboard || leaderboard.length === 0) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No leaderboard data yet. Play some games!
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-3">
      {leaderboard.map((entry: any, index: number) => (
        <Card key={entry.userId || index} data-testid={`card-leaderboard-${index}`}>
          <CardContent className="flex items-center gap-4 py-3 flex-wrap">
            <span className="text-lg font-bold w-8 text-center" data-testid={`text-rank-${index}`}>
              {index + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate" data-testid={`text-leaderboard-user-${index}`}>
                {entry.user?.firstName || `Player ${index + 1}`}
              </p>
              {entry.metadata && (
                <p className="text-xs text-muted-foreground">
                  Role: {(entry.metadata as any)?.role || "N/A"} | Rounds: {(entry.metadata as any)?.rounds || 0}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-yellow-500" />
              <span className="font-semibold" data-testid={`text-score-${index}`}>
                {entry.score ?? 0}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function TacticsArena() {
  const [, params] = useRoute("/games/tactics/:id");
  const gameId = params?.id;

  if (gameId) {
    return <GameView gameId={gameId} />;
  }

  return (
    <Tabs defaultValue="play" className="w-full">
      <div className="border-b border-border px-6 pt-4">
        <TabsList data-testid="tabs-tactics">
          <TabsTrigger value="play" data-testid="tab-play">
            <Target className="h-4 w-4 mr-2" />
            Play
          </TabsTrigger>
          <TabsTrigger value="leaderboard" data-testid="tab-leaderboard">
            <Trophy className="h-4 w-4 mr-2" />
            Leaderboard
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="play">
        <LobbyView />
      </TabsContent>
      <TabsContent value="leaderboard">
        <LeaderboardView />
      </TabsContent>
    </Tabs>
  );
}
