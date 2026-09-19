/**
 * The furniture every round of Ten Years From Now sits in.
 *
 * One header, one clock, one way of showing a card. Rounds differ in what they
 * ask; they should not differ in how they look, because a player has about six
 * minutes per round and none of it should go on relearning where things are.
 */
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Check, Clock, Loader2 } from "lucide-react";

/** Seconds as a clock reads them. */
export function clockText(seconds: number | null): string {
  if (seconds === null) return "—";
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The round's clock.
 *
 * Goes amber under a minute and red under fifteen seconds, and that is the
 * only animation on the screen — a clock that pulses the whole way through
 * teaches a player to ignore it, which is the opposite of what a deadline is
 * for.
 */
export function RoundClock({ secondsLeft }: { secondsLeft: number | null }) {
  const urgent = secondsLeft !== null && secondsLeft <= 15;
  const soon = secondsLeft !== null && secondsLeft <= 60;
  return (
    <div
      data-testid="round-clock"
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold tabular-nums transition-colors",
        urgent ? "bg-destructive/15 text-destructive"
          : soon ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
            : "bg-muted text-muted-foreground",
        urgent && "animate-pulse",
      )}
    >
      <Clock className="h-3.5 w-3.5" />
      {clockText(secondsLeft)}
    </div>
  );
}

/** Where you are in the five. */
export function RoundRail({ rounds, current }: { rounds: string[]; current: string }) {
  const at = rounds.indexOf(current);
  return (
    <div className="flex items-center gap-1.5" data-testid="round-rail">
      {rounds.map((r, i) => (
        <div
          key={r}
          className={cn(
            "h-1.5 flex-1 rounded-full transition-colors",
            i < at ? "bg-primary"
              : i === at ? "bg-primary/60"
                : "bg-muted",
          )}
          title={r}
        />
      ))}
    </div>
  );
}

export function RoundHeader({
  title, blurb, secondsLeft, rounds, current,
}: {
  title: string; blurb: string; secondsLeft: number | null;
  rounds: string[]; current: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="round-title">{title}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{blurb}</p>
        </div>
        <RoundClock secondsLeft={secondsLeft} />
      </div>
      <RoundRail rounds={rounds} current={current} />
    </div>
  );
}

export interface GamePlayer {
  id: string; name: string; avatar: string | null; isBot: boolean; isYou: boolean;
}

/**
 * Who is playing, and whether they've answered yet.
 *
 * "Waiting on Ada" is the single most useful thing this screen can tell you
 * while a clock runs, and it is the difference between a pause that feels like
 * a game and one that feels broken.
 */
export function Players({ players, answered }: { players: GamePlayer[]; answered: Record<string, boolean> }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="players">
      {players.map((p) => (
        <div
          key={p.id}
          className={cn(
            "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm",
            answered[p.id] ? "border-primary/40 bg-primary/5" : "border-border",
          )}
        >
          <span className="font-medium">{p.isYou ? "You" : p.name}</span>
          {/* A bot carries an ordinary name so the game reads like a game.
              This is what keeps that honest. */}
          {p.isBot && <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">Bot</Badge>}
          {answered[p.id]
            ? <Check className="h-3.5 w-3.5 text-primary" />
            : <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/50" />}
        </div>
      ))}
    </div>
  );
}

export interface DeckCard {
  id: string; label: string; detail: string; consequence: string; group: string;
}

/**
 * One card.
 *
 * The consequence is always visible rather than hidden behind a tap. The whole
 * design rule of the deck is that every card is specific enough to be wrong,
 * and a player who has to open each of eighteen cards to find that out will
 * pick from the three they happened to open.
 */
export function PickCard({
  card, picked, byPartner, onPick,
}: {
  card: DeckCard; picked: boolean; byPartner: boolean; onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      data-testid={`card-${card.id}`}
      className={cn(
        "group relative flex h-full flex-col rounded-xl border p-4 text-left transition-all",
        "hover:scale-[1.015] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        picked
          ? "border-primary bg-primary/5 shadow-sm"
          : "border-border bg-card hover:border-primary/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold leading-snug">{card.label}</span>
        {picked && <Check className="h-4 w-4 shrink-0 text-primary" />}
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">{card.detail}</p>
      <p className="mt-3 border-t border-border/60 pt-2.5 text-xs leading-relaxed text-muted-foreground/90">
        {card.consequence}
      </p>
      {/* Your partner's pick, on the card itself. You cannot argue somebody
          round if you have to look somewhere else to see what they chose. */}
      {byPartner && (
        <Badge variant="secondary" className="absolute -top-2 right-3 text-[10px]">
          Their pick
        </Badge>
      )}
    </button>
  );
}

/** What the screen says about how a round ended. */
export const SETTLE_COPY: Record<string, string> = {
  agreed: "You both went for it.",
  // Fires after either merge round, so it must be true of a list of product
  // claims as well as of two budgets being averaged.
  merged: "Both of yours went in — the two were combined.",
  coin: "You couldn't agree, so the coin decided.",
  unopposed: "Only one of you answered, so that's what stands.",
  nobody: "Neither of you answered in time.",
};
