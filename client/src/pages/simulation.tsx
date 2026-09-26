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
import { errorText } from "@/lib/api-error";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { NOVA_GRADIENT_CSS } from "@shared/backing";
import { countdown, phaseCopy, urgency } from "@shared/simulation/lobby-copy";
import type { Role } from "@shared/simulation/types";
import { Loader2, Users, Clock, ArrowRight, Sparkles, ShieldCheck, TrendingDown } from "lucide-react";
import { lookOf } from "@/components/sim/market-look";
import { SeasonStanding } from "@/components/sim/season-standing";

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
  /** Which year the next tick resolves, and how many the season runs. Null before it starts. */
  year: number | null;
  totalYears: number | null;
  lobbySize: number;
  openRoles: Role[];
  seats: Seat[];
  you: { role: Role | null; isCeo: boolean };
}

export default function SimulationPage() {
  /*
   * `?room=` opens that room. Someone at a public table who joins their
   * company's training season is in two rooms at once, and "Go to your table"
   * has to mean the one it was pressed for — not whichever the list below
   * happens to put first.
   */
  const [ventureId, setVentureId] = useState<string | null>(() => {
    try { return new URLSearchParams(window.location.search).get("room"); } catch { return null; }
  });

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
  const { data: mine, isLoading } = useQuery<{ ventures: { id: string; phase: string; seasonStatus?: string }[] }>({
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
    /*
     * The most recent room still being played, and not one walked out of.
     * The server orders them.
     *
     * Two ways this reopened a room it shouldn't. A venture stays in phase
     * "running" after its season ends, so a company whose fourteen years were
     * up was handed back for ever and the market picker was unreachable —
     * hence the season's own status, which is the server's answer rather than
     * the venture's. And a room left during this visit is not one to be
     * returned to, however the cached list still describes it.
     */
    const open = mine.ventures.find((v) =>
      v.phase !== "retired"
      && v.seasonStatus !== "finished" && v.seasonStatus !== "abandoned"
      && !left.current.has(v.id));
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
    // errorText, not e.message: an ApiError's message is "409: {…json…}", which is what these toasts used to show.
    onError: (e: any) => toast({ title: "Couldn't join", description: errorText(e), variant: "destructive" }),
  });

  if (isLoading) return <Centered><Loader2 className="h-6 w-6 animate-spin text-primary" /></Centered>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:py-8">
      <header className="rounded-2xl p-[2px]" style={{ backgroundImage: NOVA_GRADIENT_CSS }}>
        <div className="rounded-[calc(1rem-1px)] bg-background p-5 sm:p-6">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Pick a market</h1>
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
          <CardContent className="space-y-4 p-4 sm:p-5">
            {/*
              * Stacked on a phone, side by side from `sm` up. Squeezed into one
              * row on a narrow screen the premise — the one line that tells two
              * markets apart — was wrapping to four lines beside a button that
              * had shrunk to the word "Join".
              */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">{niche.name}</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">{niche.premise}</p>
              </div>
              <Button
                className="w-full shrink-0 sm:w-auto"
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
                    {(() => {
                      const read = loyaltyRead(s.loyalty);
                      return <>{s.loyalty >= 0.6 ? <ShieldCheck className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />} {read.label}: {read.hint}</>;
                    })()}
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
        description: errorText(e, "Try another."),
        variant: taken ? "default" : "destructive",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}`] });
    },
  });

  /*
   * Leaving. What it costs depends on how far along the room is, and the
   * dialog says which one it is about to do — giving up a seat nobody is
   * counting on yet is not the same as walking out on four people mid-season.
   */
  const [leaving, setLeaving] = useState(false);
  const leave = useMutation({
    mutationFn: () => apiRequest("POST", `/api/sim/ventures/${ventureId}/leave`, {}).then((r) => r.json()),
    onSuccess: (body: { handedOver?: boolean }) => {
      setLeaving(false);
      queryClient.invalidateQueries({ queryKey: ["/api/sim/ventures"] });
      toast({
        title: "You're out",
        description: body?.handedOver
          ? "Your chair went to a stand-in, and the company plays on without you."
          : "You can join another market whenever you like.",
      });
      onLeave();
    },
    onError: (err) => {
      setLeaving(false);
      toast({ title: "Still here", description: errorText(err), variant: "destructive" });
    },
  });

  const release = useMutation({
    mutationFn: () => apiRequest("POST", `/api/sim/ventures/${ventureId}/release`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}`] }),
    /*
     * Usually the clock ran out between the click and the request, and the
     * seat is already dealt. It used to fail in silence with the button still
     * there; say why and refetch so the room shows where things stand.
     */
    onError: (e) => {
      toast({ title: "Couldn't give up the seat", description: errorText(e), variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}`] });
    },
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

  const started = room.phase === "running";

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:py-8">
      <div className="rounded-2xl p-[2px]" style={{ backgroundImage: NOVA_GRADIENT_CSS }}>
        <div className="rounded-[calc(1rem-1px)] bg-background p-5 sm:p-6">
          {/*
            * The clock above the title on a phone, beside it from `sm` up. In
            * one row at 360px the countdown took a third of the width and the
            * phase title — the sentence saying what to do next — wrapped to
            * three lines under it.
            */}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">{room.niche?.name ?? "Market"}</p>
              <h1 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl" data-testid="text-phase-title">{copy.title}</h1>
              <p className="mt-1.5 max-w-lg text-sm text-muted-foreground">{copy.body}</p>
            </div>
            {room.phase !== "running" && room.phase !== "retired" && (
              <div className="shrink-0 sm:text-right">
                <p
                  className={`text-3xl font-bold tabular-nums ${clock === "now" ? "text-destructive" : clock === "soon" ? "text-amber-600" : ""}`}
                  data-testid="text-countdown"
                >
                  {countdown(secondsLeft)}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground sm:justify-end">
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
      <Card className="rounded-2xl nova-ring-soft">
        <CardContent className="p-4 sm:p-5">
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
          <CardContent className="p-4 sm:p-5">
            <h2 className="text-sm font-semibold">Seats still open</h2>
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
        /* The company, running: the one thing on this page to do next, so it carries the ring and the glow. */
        <Card className="rounded-2xl nova-ring nova-glow" data-testid="card-running-company">
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl nova-chip"><Sparkles className="h-5 w-5" /></span>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-extrabold leading-tight">{room.name}</h2>
                {room.product && <p className="truncate text-sm text-muted-foreground">{room.product}</p>}
              </div>
            </div>

            {/*
              * Which year it is and where the company stands, on the screen
              * people actually land on. This used to be one click away on the
              * standings page, and one click away was far enough that most
              * teams never saw it.
              */}
            <SeasonStanding ventureId={ventureId} />

            <p className="text-sm text-muted-foreground">{copy.body}</p>

            {/* Stacked and full width on a phone; a row from `sm` up. */}
            <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap">
              <Button size="sm" className="nova-chip border-0 hover:opacity-90" onClick={() => navigate(`/simulation/${ventureId}`)} data-testid="button-open-desk">
                Open your desk <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate(`/simulation/${ventureId}/standings`)} data-testid="button-open-standings">
                The whole table
              </Button>
              {/* The page opens on your running room, so without this there was no way to the market list short of leaving the page. */}
              <Button variant="ghost" size="sm" onClick={onLeave} data-testid="button-pick-another-market">Pick another market</Button>
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

      {/* Quietly, at the foot: leaving is allowed, and it is not the thing to do next. */}
      {room.phase !== "retired" && (
        <button
          type="button"
          onClick={() => setLeaving(true)}
          className="mx-auto block text-xs text-muted-foreground underline-offset-4 hover:underline"
          data-testid="button-leave-room"
        >
          {started ? "Leave this company" : "Leave this room"}
        </button>
      )}

      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent data-testid="dialog-leave-room">
          <AlertDialogHeader>
            <AlertDialogTitle>{started ? `Leave ${room.name ?? "this company"}?` : "Leave this room?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {started
                ? "The season carries on without you: your chair goes to a stand-in, who files an ordinary decision every year. You can't take it back, and you won't be able to rejoin this company."
                : "Your seat goes back, and you can pick a different market. If you're the last one here, the room closes."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-leave-cancel">Stay</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); leave.mutate(); }}
              disabled={leave.isPending}
              data-testid="button-leave-confirm"
            >
              {leave.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {started ? "Leave the company" : "Leave"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NamingCard({ ventureId, isCeo }: { ventureId: string; isCeo: boolean }) {
  const { toast } = useToast();
  const [name, setName] = useState("");

  const submit = useMutation({
    mutationFn: () => apiRequest("POST", `/api/sim/ventures/${ventureId}/name`, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}`] }),
    onError: (e: any) => toast({ title: "Couldn't set that", description: errorText(e), variant: "destructive" }),
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

/**
 * What a segment's loyalty means for a team that wants its customers.
 *
 * The same four-step scale as loyaltyRead() in mobile/src/components/sim/lobby.ts,
 * words included. The web used a single cut at 0.7, so a 0.65 segment read
 * "Winnable: they leave easily" here and "Sticky" on the phone — two screens
 * giving the same table opposite advice about the same market.
 */
function loyaltyRead(loyalty: number): { label: string; hint: string } {
  if (loyalty >= 0.8) return { label: "Locked in", hint: "Years of consistency, or nothing." };
  if (loyalty >= 0.6) return { label: "Sticky", hint: "Winnable, slowly, by being better for a long time." };
  if (loyalty >= 0.4) return { label: "Persuadable", hint: "Moves for a real reason, and moves back just as easily." };
  return { label: "On the rope", hint: "Already half out of the door. Your first customers." };
}

const Centered = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center justify-center min-h-[60vh]">{children}</div>
);
