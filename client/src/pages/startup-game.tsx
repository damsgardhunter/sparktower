/**
 * One game of Ten Years From Now.
 *
 * The round shell, the chat beside it, and whichever round body is open. It
 * polls: a round can end because your partner agreed with you, because the
 * clock ran out, or because the sweep settled it, and none of those originate
 * here.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, LogOut, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { RoundHeader, Players, SETTLE_COPY, type DeckCard, type GamePlayer } from "@/components/game/kit";
import { DeckRound, EraPicker, IdeaRound, ProductRound, type GameIdea } from "@/components/game/rounds";
import { BudgetRound } from "@/components/game/budget";
import { VerdictScreen, type StandingRow } from "@/components/game/verdict";
import { ROUND_COPY, PLAYABLE_ROUNDS } from "@shared/sprints/game";
import { customCard, isCustomCard, MAX_CUSTOM_CARDS } from "@shared/sprints/cards";
import { allocated, type Allocation } from "@shared/sprints/budget";
import type { Claim } from "@shared/sprints/product";

const RAIL = PLAYABLE_ROUNDS as string[];

export default function StartupGamePage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  /*
   * A second while a round is open, five once it's over. The clock is the
   * thing being watched and a stale one is the whole game feeling broken;
   * after the verdict there is nothing left to change.
   */
  const { data: state, isLoading } = useQuery<any>({
    queryKey: ["/api/games", id],
    refetchInterval: (q) => {
      const round = (q.state.data as any)?.round;
      return round === "verdict" || round === "abandoned" ? 5000 : 1000;
    },
  });

  const round: string = state?.round ?? "idea";
  const players: GamePlayer[] = state?.players ?? [];
  const you = players.find((p) => p.isYou);
  const them = players.find((p) => !p.isYou);

  /*
   * What "this game is over" has to touch.
   *
   * Every query in this app is `staleTime: Infinity`, so a cached answer is
   * kept until something invalidates it — and nothing did. Leaving a game
   * invalidated nothing at all, so `/api/games/active` still held the game you
   * had just walked out of: the entry card on /sprints went on offering "Back
   * to your game" and clicking it landed on "That game ended". The same held
   * after the last round, where the finished game is also no longer active and
   * has just changed every board it appears on.
   */
  const gameEnded = () => {
    void qc.invalidateQueries({ queryKey: ["/api/games", "active"] });
    void qc.invalidateQueries({ queryKey: ["/api/games", "history"] });
    void qc.invalidateQueries({ queryKey: ["/api/games", "leaderboard"] });
  };

  const submit = useMutation({
    mutationFn: async (payload: any) => (await apiRequest("POST", `/api/games/${id}/submit`, payload)).json(),
    onSuccess: (data: any) => {
      void qc.invalidateQueries({ queryKey: ["/api/games", id], exact: true });
      // The submit that closes the final round is the one that ends the game.
      if (data?.state?.round === "verdict") gameEnded();
    },
    onError: (e: any) => toast({ title: "Couldn't put that in", description: readMessage(e), variant: "destructive" }),
  });

  const leave = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/games/${id}/leave`, {})).json(),
    onSuccess: () => { gameEnded(); toast({ title: "You left the game." }); navigate("/sprints"); },
  });

  /*
   * The clock can end a game without anybody pressing anything: the last round
   * settles on the sweep, or on a poll. So the cached active-game list is
   * refreshed when the poll reports an ending too, not only on the mutations.
   */
  const endedRound = state?.round === "verdict" || state?.round === "abandoned" ? state.round : null;
  useEffect(() => {
    if (endedRound) gameEnded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endedRound, id]);

  if (isLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!state) {
    return <div className="py-20 text-center text-muted-foreground">No such game.</div>;
  }

  if (round === "abandoned") {
    const whoLeft = state.game.abandonedById === you?.id ? "You" : them?.name ?? "Your partner";
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <h1 className="text-2xl font-semibold">That game ended</h1>
        <p className="mt-2 text-muted-foreground">{whoLeft} left before it finished.</p>
        <Button className="mt-5" onClick={() => navigate("/sprints")}>Back to sprints</Button>
      </div>
    );
  }

  const copy = ROUND_COPY[round as keyof typeof ROUND_COPY] ?? ROUND_COPY.idea;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-5">
          {round !== "verdict" && (
            <>
              <RoundHeader
                title={copy.title}
                blurb={copy.blurb}
                secondsLeft={state.secondsLeft}
                rounds={RAIL}
                current={round}
              />
              <Players
                players={players}
                answered={{
                  [you?.id ?? ""]: !!state.yours,
                  [them?.id ?? ""]: !!state.theirs,
                }}
              />
              {/* Why the last round ended the way it did. A pick that vanished
                  with no explanation is what people write in about. */}
              <LastRoundNote settledBy={state.game.settledBy} round={round} />
            </>
          )}

          <RoundBody
            /*
             * Keyed by the round so it remounts when one ends.
             *
             * Its local state — a half-built budget, a list of claims — is
             * seeded from `state.yours` on mount only. Without the key that
             * mount happens once, during the first round, and every later
             * round's draft starts from whatever the first round left behind.
             * It happens to come out right today because the first round's
             * payload has neither a budget nor claims in it; that is luck, not
             * a design.
             */
            key={round}
            gameId={id!}
            state={state}
            round={round}
            busy={submit.isPending}
            onSubmit={(payload) => submit.mutate(payload)}
            onPlayAgain={() => navigate("/sprints")}
            onSeeBoards={() => navigate("/sprints/boards")}
          />
        </div>

        <div className="space-y-4">
          <Chat gameId={id!} players={players} live={round !== "verdict"} />
          {round !== "verdict" && (
            <Button
              variant="ghost" size="sm"
              className="w-full text-muted-foreground"
              onClick={() => leave.mutate()}
              disabled={leave.isPending}
              data-testid="button-leave-game"
            >
              <LogOut className="mr-1.5 h-3.5 w-3.5" /> Leave the game
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function LastRoundNote({ settledBy, round }: { settledBy: Record<string, string> | null; round: string }) {
  const previous = RAIL[RAIL.indexOf(round) - 1];
  const reason = previous && settledBy?.[previous];
  if (!reason || reason === "agreed") return null;
  return (
    <p className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      {SETTLE_COPY[reason]}
    </p>
  );
}

/** Whichever round is open. */
function RoundBody({
  gameId, state, round, busy, onSubmit, onPlayAgain, onSeeBoards,
}: {
  gameId: string; state: any; round: string; busy: boolean;
  onSubmit: (payload: any) => void;
  onPlayAgain: () => void; onSeeBoards: () => void;
}) {
  const { toast } = useToast();
  const youId: string = state.players?.find((p: any) => p.isYou)?.id ?? "me";
  const [era, setEra] = useState<string | null>(state.game.era ?? null);
  const [customs, setCustoms] = useState<DeckCard[]>([]);
  const [claims, setClaims] = useState<Claim[]>(state.yours?.claims ?? state.yourDraft?.claims ?? []);
  const [allocation, setAllocation] = useState<Allocation>(state.yours?.allocation ?? state.yourDraft?.allocation ?? {});
  const saveDraft = useDraftSaver(gameId);

  /*
   * Claims and budget are kept as they change, for the same reason the idea
   * is: if the clock runs out before the round is committed, what was on the
   * screen stands in rather than nothing. Skipped on first render, which is
   * only the saved state coming back.
   */
  const firstClaims = useRef(true);
  useEffect(() => {
    if (firstClaims.current) { firstClaims.current = false; return; }
    if (round === "product") saveDraft({ claims });
  }, [claims]);
  const firstAllocation = useRef(true);
  useEffect(() => {
    if (firstAllocation.current) { firstAllocation.current = false; return; }
    if (round === "spend") saveDraft({ allocation });
  }, [allocation]);

  const { data: deck } = useQuery<any>({
    queryKey: ["/api/games", gameId, "deck", round],
    enabled: round === "customer" || round === "model",
  });

  /*
   * Hoisted above every branch below, not called inside the verdict one.
   * Hooks must run in the same order on every render, and a `useQuery` behind
   * an `if` changes that order the moment the round advances — React then
   * matches this hook's state against a different hook's and the screen breaks
   * in a way that has nothing to do with what it is rendering.
   */
  const { data: standings } = useStandings(gameId, round === "verdict" && !!state.verdict?.fromModel);

  const ideas = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/games/idea-options", { productStyle: era ?? "modern" })).json(),
    onError: (e: any) => toast({ title: "Couldn't think of one", description: readMessage(e), variant: "destructive" }),
  });

  if (round === "verdict") {
    return (
      <VerdictScreen
        verdict={state.verdict}
        standings={standings ?? null}
        companyName={state.game.idea?.name ?? "Your company"}
        onPlayAgain={onPlayAgain}
        onSeeBoards={onSeeBoards}
      />
    );
  }

  if (round === "idea") {
    return (
      <div className="space-y-5">
        {!state.game.era && <EraPicker era={era} onPick={setEra} />}
        <IdeaRound
          mine={state.yours}
          saved={state.yourDraft}
          onDraftChange={(idea) => { if (!state.yours) saveDraft({ idea }); }}
          theirs={state.theirs}
          picked={state.yours?.name ?? null}
          onWrite={(idea) => onSubmit({ idea })}
          onPick={(idea) => onSubmit({ idea })}
          /*
           * Fills your draft; it does not submit it.
           *
           * It used to put the first generated idea straight in. Against a
           * person that only put it forward, but a round against a bot closes
           * the moment you answer — so one tap committed an idea you had not
           * read and moved the game on. Now it lands in the form, where you
           * can read it, change it, or ask again, and "Put this forward"
           * stays the one button that commits.
           */
          onGenerate={() => ideas.mutateAsync().then((data: any) => data?.ideas?.[0] ?? null).catch(() => null)}
          generating={ideas.isPending}
          busy={busy}
        />
      </div>
    );
  }

  if (round === "customer" || round === "model") {
    /*
     * Cards either of you invented, rebuilt from what the server holds.
     *
     * They used to live only in this component's state, which broke two
     * things. Your partner's invention was invisible to you — it is in
     * neither the dealt deck nor your own list, so the card marked "their
     * pick" simply did not render, in a game whose entire premise is arguing
     * about what the other person chose. And your own disappeared on a reload:
     * the server still had your pick, but there was no card on screen to show
     * it against, so you looked unanswered to yourself.
     *
     * The submissions carry the label and detail, which is everything a card
     * needs, so both are reconstructed here and merged with anything added in
     * this session.
     */
    const fromServer = [state.yours, state.theirs]
      .filter((sub: any) => sub?.cardId && isCustomCard(sub.cardId))
      .map((sub: any) => ({
        id: sub.cardId,
        label: sub.label,
        detail: sub.detail ?? "",
        consequence: "Invented for this game.",
        group: "Yours",
      }));

    const seen = new Set(fromServer.map((c) => c.id));
    const allCustoms = [...fromServer, ...customs.filter((c) => !seen.has(c.id))];

    return (
      <DeckRound
        cards={deck?.cards ?? []}
        pickedId={state.yours?.cardId ?? null}
        partnerPickedId={state.theirs?.cardId ?? null}
        onPick={(card) => onSubmit({ cardId: card.id, label: card.label, detail: card.detail })}
        customs={allCustoms}
        onAddCustom={(label, detail) => {
          if (customs.length >= MAX_CUSTOM_CARDS) return;
          // Owned by you, so your invention and your partner's can never be
          // read as the same card. See `customCard`.
          setCustoms([...customs, customCard({ label, detail, index: customs.length, owner: youId })]);
        }}
        onRemoveCustom={(cardId) => setCustoms(customs.filter((c) => c.id !== cardId))}
        busy={busy}
      />
    );
  }

  if (round === "product") {
    return (
      <ProductRound
        claims={claims}
        onChange={setClaims}
        onCommit={() => onSubmit({ claims })}
        committed={!!state.yours}
        theirs={state.theirs?.claims ?? []}
        busy={busy}
      />
    );
  }

  return (
    <BudgetRound
      allocation={allocation}
      onChange={setAllocation}
      onCommit={() => onSubmit({ allocation })}
      committed={!!state.yours}
      partnerTotal={state.theirs?.allocation ? allocated(state.theirs.allocation) : null}
      busy={busy}
    />
  );
}

/**
 * Where this game placed, asked for only once it is known to have a placing.
 *
 * Gated on the verdict having come from the model rather than polled.
 * `refetchInterval` reads the *raw* response, which is `{scored:false}` both
 * while the valuation is still running and forever afterwards for a game that
 * was never scored — so a poll keyed on it either stopped before the standings
 * existed or asked every three seconds for the rest of the session. There is
 * nothing to wait for here: a scored game has standings immediately, and an
 * unscored one never will.
 */
function useStandings(gameId: string, scored: boolean) {
  return useQuery<StandingRow[] | null>({
    queryKey: ["/api/games", gameId, "standings"],
    enabled: scored,
    select: (data: any) => (data?.scored ? (data.standings as StandingRow[]) : null),
  });
}

/** The argument. */
function Chat({ gameId, players, live }: { gameId: string; players: GamePlayer[]; live: boolean }) {
  const [body, setBody] = useState("");
  const qc = useQueryClient();
  const bottom = useRef<HTMLDivElement>(null);

  const { data } = useQuery<any>({
    queryKey: ["/api/games", gameId, "messages"],
    refetchInterval: live ? 2000 : false,
  });

  const send = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/games/${gameId}/messages`, { body })).json(),
    onSuccess: () => { setBody(""); qc.invalidateQueries({ queryKey: ["/api/games", gameId, "messages"] }); },
  });

  const messages = data?.messages ?? [];
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  return (
    <div className="flex h-[28rem] flex-col rounded-xl border bg-card lg:sticky lg:top-6">
      <div className="border-b px-4 py-2.5 text-sm font-semibold">Talk it out</div>
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3" data-testid="game-chat">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            This is where you argue. The round settles when you agree — or when the clock does it for you.
          </p>
        )}
        {messages.map((m: any) => {
          const who = players.find((p) => p.id === m.userId);
          return (
            <div key={m.id} className={cn("text-sm", who?.isYou && "text-right")}>
              <span className="text-xs text-muted-foreground">{who?.isYou ? "You" : who?.name ?? "Them"}</span>
              <p className={cn(
                "mt-0.5 inline-block max-w-[85%] rounded-lg px-2.5 py-1.5 text-left",
                who?.isYou ? "bg-primary text-primary-foreground" : "bg-muted",
              )}>
                {m.body}
              </p>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      {live && (
        <form
          className="flex gap-2 border-t p-3"
          onSubmit={(e) => { e.preventDefault(); if (body.trim()) send.mutate(); }}
        >
          <Input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Say something"
            maxLength={1000}
            data-testid="input-chat"
          />
          <Button type="submit" size="icon" disabled={!body.trim() || send.isPending}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      )}
    </div>
  );
}

function readMessage(err: any): string {
  const raw = err?.message ?? "";
  const start = raw.indexOf("{");
  if (start >= 0) {
    try { return JSON.parse(raw.slice(start)).message ?? raw; } catch { /* keep */ }
  }
  return raw || "Something went wrong.";
}


/**
 * Keeps a copy of what is being typed on the server, a moment after typing
 * stops, and once more on the way out.
 *
 * Nothing here submits. The server holds it separately and reads it only if
 * the round's clock runs out before the player puts an answer forward — see
 * `saveDraft` in server/startup-game.ts. Failures are ignored on purpose: this
 * is a safety net under the real submit, and a toast about a background save
 * would be noise on a screen with a clock on it.
 */
function useDraftSaver(gameId: string) {
  const pending = useRef<any>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const payload = pending.current;
    pending.current = null;
    if (payload) void apiRequest("POST", `/api/games/${gameId}/draft`, payload).catch(() => {});
  };

  useEffect(() => () => flush(), [gameId]);

  return (payload: any) => {
    pending.current = payload;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 1_200);
  };
}
