/**
 * The lobby: choosing a market, and the four minutes that decide the fortnight.
 *
 * Two screens behind one address. `/simulation` is the markets; once you've
 * joined one you're in a room, and the room is the same component through all
 * four of its phases — filling, claiming, naming, running — because it is the
 * same five faces the whole way and swapping the screen under them would lose
 * the thread of what they were arguing about.
 *
 * ## The room is live, and this is a polled screen
 *
 * Five people are looking at this at once while it changes. It refreshes every
 * two seconds and the countdown ticks locally in between — polling once a
 * second to move a number is a lot of requests to animate something the client
 * can work out for itself. The server advances the phase when it is read, so
 * polling is also what keeps the clock honest for everyone.
 *
 * ## Claiming is a race, so nothing here is optimistic
 *
 * Showing a seat as yours before the server agrees means showing four other
 * people a lie for two seconds. A refused claim is not an error either: 409
 * `role_taken` means somebody was quicker, which is information, not a
 * failure, and it is shown as such.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { NOVA_GRADIENT_CSS } from "@shared/backing";
import { countdown, phaseCopy, urgency } from "@shared/simulation/lobby-copy";
import type { Role } from "@shared/simulation/types";
import { Loader2, Users, Clock, ArrowRight, Sparkles, ShieldCheck, TrendingDown } from "lucide-react";
import { lookOf } from "@/components/sim/market-look";

interface NicheView {
  id: string;
  name: string;
  premise: string;
  segments: { id: string; name: string; description: string; size: number; loyalty: number }[];
  incumbents: { id?: string; name: string; share: number; posture: string; tagline?: string; known?: string }[];
}
interface RoleView { id: Role; title: string; levers: string[] }
interface Seat { userId: string; name: string; avatarUrl: string | null; role: Role | null; assigned: boolean; isBot: boolean; isYou: boolean }
interface Room {
  id: string;
  phase: "filling" | "claiming" | "naming" | "running" | "retired";
  /** Null once the room is running or retired: those phases have no deadline. */
  secondsLeft: number | null;
  /** Retired because its season ran to the end, not because it never filled. */
  seasonOver?: boolean;
  /** While filling: when the empty seats go to bots if nobody else arrives. Null when there's nothing to fill. */
  botsInSeconds?: number | null;
  name: string | null;
  product: string | null;
  niche: { id: string; name?: string } | null;
  lobbySize: number;
  openRoles: Role[];
  seats: Seat[];
  you: { role: Role | null; isCeo: boolean };
}

export default function SimulationPage() {
  const [ventureId, setVentureId] = useState<string | null>(null);

  /*
   * The room you are already in, found on the way in.
   *
   * Without this the only thing holding your place was a piece of component
   * state: reload the page, come back on a different device, or simply open the
   * tab again, and the app showed you the list of markets as though the four
   * people waiting on you did not exist. Joining again would have found the
   * same room — the server is careful about that — but nobody would think to,
   * because the screen had already told them they were nowhere.
   */
  const { data: mine, isLoading } = useQuery<{ ventures: { id: string; phase: string }[] }>({
    queryKey: ["/api/sim/ventures"],
    /*
     * Fresh every time the page opens. The app caches queries for ever by
     * default, and this list is exactly the one that goes out of date: a
     * season that finished since it was fetched still read as running, so
     * the page kept reopening a room that had closed.
     */
    staleTime: 0,
    refetchOnMount: "always",
  });

  /*
   * Rooms left from this screen in this visit. "Pick a market" on a closed
   * room cleared the room, and the effect below promptly put the same room
   * back from the cached list — so the button looked as though it did
   * nothing. A room you walked away from is not one to be returned to.
   */
  const left = useRef(new Set<string>());

  useEffect(() => {
    if (ventureId || !mine?.ventures?.length) return;
    // The most recent room that has not been retired. The server orders them.
    const open = mine.ventures.find((v) => v.phase !== "retired" && !left.current.has(v.id));
    if (open) setVentureId(open.id);
  }, [mine, ventureId]);

  const leave = () => {
    if (ventureId) left.current.add(ventureId);
    queryClient.invalidateQueries({ queryKey: ["/api/sim/ventures"] });
    setVentureId(null);
  };

  if (isLoading && !ventureId) {
    return <Centered><Loader2 className="h-6 w-6 animate-spin text-primary" /></Centered>;
  }

  return ventureId
    ? <Room ventureId={ventureId} onLeave={leave} />
    : <MarketPicker onJoined={(id) => {
        // A room you join is one you mean to be in, even if you left it earlier this visit.
        left.current.delete(id);
        queryClient.invalidateQueries({ queryKey: ["/api/sim/ventures"] });
        setVentureId(id);
      }} />;
}

/* ── Choosing a market ─────────────────────────────────────────────────── */

function MarketPicker({ onJoined }: { onJoined: (ventureId: string) => void }) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ niches: NicheView[]; roles: RoleView[]; lobbySize: number }>({
    queryKey: ["/api/sim/niches"],
  });

  const join = useMutation({
    mutationFn: (nicheId: string) => apiRequest("POST", "/api/sim/join", { nicheId }).then((r) => r.json()),
    onSuccess: (res: { ventureId: string }) => onJoined(res.ventureId),
    onError: (e: any) => toast({ title: "Couldn't join", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  if (isLoading) return <Centered><Loader2 className="h-6 w-6 animate-spin text-primary" /></Centered>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <header className="rounded-2xl p-[2px]" style={{ backgroundImage: NOVA_GRADIENT_CSS }}>
        <div className="rounded-[calc(1rem-1px)] bg-background p-6">
          <h1 className="text-2xl font-bold tracking-tight">Pick a market</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Five of you run one company for fourteen days — a day is a year. Nine tenths of every market below already
            belongs to somebody, and they will not hand it over. Which market you choose decides what winning looks
            like.
          </p>
        </div>
      </header>

      {data?.niches.map((niche) => {
        const look = lookOf(niche.id);
        return (
        <Card key={niche.id} data-testid={`niche-${niche.id}`} className="overflow-hidden">
          {/*
            * A band across the top, so seven markets are seven things at a
            * glance rather than seven paragraphs that have to be read to be
            * told apart. The line on it is the *shape* of the market — the
            * problem it poses — not a restatement of its subject.
            */}
          <div className={`flex items-center gap-2.5 border-b px-5 py-2.5 ${look.tint}`}>
            <look.Icon className={`h-4 w-4 shrink-0 ${look.ink}`} />
            <p className={`text-xs font-medium ${look.ink}`}>{look.shape}</p>
          </div>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold text-lg">{niche.name}</h2>
                <p className="text-sm text-muted-foreground mt-0.5">{niche.premise}</p>
              </div>
              <Button
                onClick={() => join.mutate(niche.id)}
                disabled={join.isPending}
                data-testid={`button-join-${niche.id}`}
              >
                {join.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Join <ArrowRight className="ml-1 h-4 w-4" /></>}
              </Button>
            </div>

            {/*
              * Loyalty is the number that decides whether a market is winnable,
              * so it is shown rather than buried: a segment nobody is attached
              * to is the door in, and one that never moves is the wall.
              */}
            <div className="grid gap-2 sm:grid-cols-3">
              {niche.segments.map((s) => (
                <div key={s.id} className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{s.description}</p>
                  <p className="mt-2 text-[11px] text-muted-foreground flex items-center gap-1">
                    {s.loyalty >= 0.7
                      ? <><ShieldCheck className="h-3 w-3" /> Hard to take: they stay put</>
                      : <><TrendingDown className="h-3 w-3" /> Winnable: they leave easily</>}
                  </p>
                </div>
              ))}
            </div>

            {/*
              * Who is already here, with something to hold on to.
              *
              * This was four badges reading "Ember · 39%", which is the same
              * shape of nothing in all seven markets — nobody picks a
              * fortnight on a percentage. The line under each name is how they
              * describe themselves, so the market arrives with four
              * personalities in it and a player can already tell which one
              * annoys them most.
              */}
            <div className="space-y-1.5 pt-1">
              <p className="text-xs text-muted-foreground">Already here, holding nine tenths of it between them:</p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {niche.incumbents.map((i) => (
                  <div key={i.name} className="flex items-baseline gap-2 min-w-0" data-testid={`incumbent-${i.id ?? i.name}`}>
                    <span className="text-sm font-medium shrink-0">{i.name}</span>
                    <span className="text-xs tabular-nums text-muted-foreground shrink-0">{Math.round(i.share * 100)}%</span>
                    {i.tagline && <span className="text-xs text-muted-foreground italic truncate">“{i.tagline}”</span>}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
        );
      })}

      {data?.roles && (
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold">The five seats</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              One person each. You'll argue over these in a moment, so it helps to know what they actually do.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {data.roles.map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium">{r.title}</p>
                  <ul className="mt-1 space-y-0.5">
                    {r.levers.map((l) => <li key={l} className="text-xs text-muted-foreground">· {l}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ── The room ──────────────────────────────────────────────────────────── */

function Room({ ventureId, onLeave }: { ventureId: string; onLeave: () => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data: room, isLoading } = useQuery<Room>({
    queryKey: [`/api/sim/ventures/${ventureId}`],
    // Two seconds: enough to feel live, few enough requests that five people
    // watching one room is not a load problem. The clock below fills the gaps.
    refetchInterval: 2000,
  });
  const { data: meta } = useQuery<{ roles: RoleView[] }>({ queryKey: ["/api/sim/niches"] });

  /*
   * The countdown ticks locally between polls, re-anchored on every response.
   * The server's `secondsLeft` is the truth — a browser tab that was asleep,
   * or a clock that is three minutes out, must not decide when a phase ends.
   */
  const [ticked, setTicked] = useState(0);
  useEffect(() => { setTicked(0); }, [room?.secondsLeft]);
  useEffect(() => {
    const t = setInterval(() => setTicked((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const secondsLeft = Math.max(0, (room?.secondsLeft ?? 0) - ticked);
  const botsIn = room?.botsInSeconds == null ? null : Math.max(0, room.botsInSeconds - ticked);

  const claim = useMutation({
    mutationFn: (role: Role) => apiRequest("POST", `/api/sim/ventures/${ventureId}/claim`, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}`] }),
    onError: (e: any) => {
      /*
       * Someone was faster. That is the game working, not a failure — so it is
       * a plain note naming whoever got there, and the room refreshes to show
       * the seat taken.
       */
      const taken = e?.code === "role_taken" || /first|before you/i.test(e?.message ?? "");
      toast({
        title: taken ? "Taken" : "Couldn't claim that seat",
        description: e?.message ?? "Try another.",
        variant: taken ? "default" : "destructive",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}`] });
    },
  });

  const release = useMutation({
    mutationFn: () => apiRequest("POST", `/api/sim/ventures/${ventureId}/release`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}`] }),
  });

  const copy = useMemo(() => room && phaseCopy({
    phase: room.phase,
    seated: room.seats.length,
    lobbySize: room.lobbySize,
    yourRole: room.you.role,
    isCeo: room.you.isCeo,
    named: !!room.name,
    seasonOver: !!room.seasonOver,
  }), [room]);

  if (isLoading || !room || !copy) return <Centered><Loader2 className="h-6 w-6 animate-spin text-primary" /></Centered>;

  const roleInfo = (role: Role) => meta?.roles.find((r) => r.id === role);
  const clock = urgency(secondsLeft);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-5">
      <div className="rounded-2xl p-[2px]" style={{ backgroundImage: NOVA_GRADIENT_CSS }}>
        <div className="rounded-[calc(1rem-1px)] bg-background p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground">{room.niche?.name ?? "Market"}</p>
              <h1 className="text-2xl font-bold tracking-tight mt-1" data-testid="text-phase-title">{copy.title}</h1>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-lg">{copy.body}</p>
            </div>
            {room.phase !== "running" && room.phase !== "retired" && (
              <div className="text-right shrink-0">
                <p
                  className={`text-3xl font-bold tabular-nums ${clock === "now" ? "text-destructive" : clock === "soon" ? "text-amber-600" : ""}`}
                  data-testid="text-countdown"
                >
                  {countdown(secondsLeft)}
                </p>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1 justify-end mt-0.5">
                  <Clock className="h-3 w-3" /> left
                </p>
              </div>
            )}
          </div>
          {room.phase === "filling" && botsIn != null && (
            /*
             * The minute the room waits for people, on screen. The big clock
             * is the fifteen-minute one; without this, bots arriving at 14:00
             * looked like the room giving up on people for no reason.
             */
            <p className="mt-3 flex items-center gap-1.5 text-sm" data-testid="text-bots-in">
              <Users className="h-4 w-4 text-primary shrink-0" />
              {botsIn > 0
                ? <span>Waiting for people. Bots take the empty seats in <span className="font-semibold tabular-nums">{countdown(botsIn)}</span> unless someone joins.</span>
                : <span>Nobody new arrived, so bots are taking the empty seats…</span>}
            </p>
          )}
          {copy.deadline && <p className="text-xs text-muted-foreground mt-3 border-t border-border pt-3">{copy.deadline}</p>}
        </div>
      </div>

      {/* Who is here. The same list through every phase — these are the people you're doing this with. */}
      <Card>
        <CardContent className="p-5">
          <h2 className="font-semibold flex items-center gap-2 text-sm">
            <Users className="h-4 w-4" /> In the room ({room.seats.length}/{room.lobbySize})
          </h2>
          <div className="mt-3 space-y-2" data-testid="list-seats">
            {room.seats.map((seat) => (
              <div key={seat.userId} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                <UserAvatar name={seat.name} src={seat.avatarUrl ?? undefined} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate flex items-center gap-1.5">
                    <span className="truncate">{seat.name}</span>
                    {seat.isYou && <span className="text-muted-foreground font-normal">· you</span>}
                    {/*
                      * Said plainly, beside the name, on every phase of the
                      * screen. A bot carries an ordinary name so the room
                      * reads like a room — which is exactly why leaving this
                      * off would be the product telling somebody something
                      * untrue about who they are playing with.
                      */}
                    {seat.isBot && (
                      <Badge variant="outline" className="font-normal shrink-0" data-testid={`badge-bot-${seat.userId}`}>
                        Bot
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {seat.role ? roleInfo(seat.role)?.title ?? seat.role : "Hasn't chosen yet"}
                    {/* Dealt by the clock, not chosen — worth saying, because it changes how it feels. */}
                    {seat.assigned && " · dealt by the clock"}
                  </p>
                </div>
                {seat.role && <Badge variant={seat.assigned ? "outline" : "secondary"}>{seat.role.toUpperCase()}</Badge>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {room.phase === "claiming" && (
        <Card>
          <CardContent className="p-5">
            <h2 className="font-semibold text-sm">Seats still open</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {room.openRoles.map((role) => (
                <button
                  key={role}
                  onClick={() => claim.mutate(role)}
                  disabled={claim.isPending}
                  className="text-left rounded-lg border border-border p-3 hover:border-primary transition-colors disabled:opacity-60"
                  data-testid={`button-claim-${role}`}
                >
                  <p className="text-sm font-medium">{roleInfo(role)?.title ?? role}</p>
                  <ul className="mt-1 space-y-0.5">
                    {roleInfo(role)?.levers.map((l) => <li key={l} className="text-xs text-muted-foreground">· {l}</li>)}
                  </ul>
                </button>
              ))}
              {room.openRoles.length === 0 && <p className="text-sm text-muted-foreground">Every seat is taken.</p>}
            </div>
            {room.you.role && (
              <Button variant="outline" size="sm" className="mt-4" onClick={() => release.mutate()} disabled={release.isPending} data-testid="button-release">
                Give up {roleInfo(room.you.role)?.title ?? room.you.role}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {room.phase === "naming" && <NamingCard ventureId={ventureId} isCeo={room.you.isCeo} />}

      {room.phase === "running" && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> {room.name}
            </h2>
            {room.product && <p className="text-sm text-muted-foreground">{room.product}</p>}
            <p className="text-sm text-muted-foreground">{copy.body}</p>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={() => navigate(`/simulation/${ventureId}`)} data-testid="button-open-desk">
                Open your desk <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate("/sprints")}>Back to sprints</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {room.phase === "retired" && (
        <Card data-testid="card-room-retired"><CardContent className="p-5">
          <p className="text-sm text-muted-foreground">{copy.body}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {room.seasonOver && (
              <Button size="sm" onClick={() => navigate(`/simulation/${ventureId}/report`)} data-testid="button-final-report">
                See how it finished <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            )}
            <Button size="sm" variant={room.seasonOver ? "outline" : "default"} onClick={onLeave} data-testid="button-pick-market">
              {room.seasonOver ? "Start a new company" : "Pick a market"}
            </Button>
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}

function NamingCard({ ventureId, isCeo }: { ventureId: string; isCeo: boolean }) {
  const { toast } = useToast();
  const [name, setName] = useState("");

  const submit = useMutation({
    mutationFn: () => apiRequest("POST", `/api/sim/ventures/${ventureId}/name`, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}`] }),
    onError: (e: any) => toast({ title: "Couldn't set that", description: e?.message, variant: "destructive" }),
  });

  if (!isCeo) {
    return (
      <Card><CardContent className="p-5">
        <p className="text-sm text-muted-foreground">
          Waiting on the chief executive. Naming rights are theirs — the rest of you can only shout suggestions.
        </p>
      </CardContent></Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="sim-name">Name the company</Label>
          <Input id="sim-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Northbound" maxLength={60} data-testid="input-company-name" />
          <p className="text-xs text-muted-foreground">
            That's the only thing to decide here. What you sell is what the five of you choose to do with it, year by year.
          </p>
        </div>
        <Button onClick={() => submit.mutate()} disabled={name.trim().length < 2 || submit.isPending} data-testid="button-name-company">
          {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start year one"}
        </Button>
      </CardContent>
    </Card>
  );
}

const Centered = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center justify-center min-h-[60vh]">{children}</div>
);
