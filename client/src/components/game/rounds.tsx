/**
 * The four rounds that aren't the budget.
 *
 * Each one collects a different shape and they all end the same way — you put
 * something forward, you can see what your partner put forward, and it settles
 * when you agree or when the clock says so.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Plus, Sparkles, Star, Trash2, X } from "lucide-react";
import { PickCard, type DeckCard } from "./kit";
import { MAX_CLAIMS, MAX_CORE_CLAIMS, type Claim } from "@shared/sprints/product";
import { MAX_CUSTOM_CARDS } from "@shared/sprints/cards";

// ─── Round 1: the idea ───────────────────────────────────────────────────────

export interface GameIdea {
  name: string; tagline: string; pitch: string; twist: string; whoItsFor: string;
  proposedBy?: string;
}

const ERAS = [
  { id: "past", label: "The past", blurb: "Something that should have existed and didn't." },
  { id: "modern", label: "Now", blurb: "Something the world is ready for today." },
  { id: "futuristic", label: "The future", blurb: "Something the world isn't ready for yet." },
] as const;

export function EraPicker({ era, onPick }: { era: string | null; onPick: (id: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3" data-testid="era-picker">
      {ERAS.map((e) => (
        <button
          key={e.id}
          type="button"
          onClick={() => onPick(e.id)}
          data-testid={`era-${e.id}`}
          className={cn(
            "rounded-xl border p-4 text-left transition-all hover:scale-[1.015]",
            era === e.id ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card hover:border-primary/40",
          )}
        >
          <div className="font-semibold">{e.label}</div>
          <p className="mt-1 text-sm text-muted-foreground">{e.blurb}</p>
        </button>
      ))}
    </div>
  );
}

/**
 * Your idea, and theirs, side by side.
 *
 * You submit whichever of the two you want to build — so backing your
 * partner's idea is the same gesture as backing your own, and the round ends
 * the instant you both point at the same one.
 */
export function IdeaRound({
  mine, saved, theirs, picked, onWrite, onPick, onGenerate, onDraftChange, generating, busy,
}: {
  mine: GameIdea | null;
  /** What you had typed and not put forward, from the server — so a reload puts it back. */
  saved?: GameIdea | null;
  /** Called as you type, so the server has a copy if the clock runs out before you submit. */
  onDraftChange?: (idea: GameIdea) => void;
  theirs: GameIdea | null;
  /** The idea currently submitted, by name. */
  picked: string | null;
  onWrite: (idea: GameIdea) => void;
  onPick: (idea: GameIdea) => void;
  /** Asks for an idea and resolves with it, or null. The caller never submits it. */
  onGenerate: () => Promise<GameIdea | null>;
  generating?: boolean;
  busy?: boolean;
}) {
  const [draft, setDraft] = useState<GameIdea>(mine ?? saved ?? {
    name: "", tagline: "", pitch: "", twist: "", whoItsFor: "",
  });

  /*
   * Every change goes up to be kept, generated ideas included. The text in
   * these boxes used to exist nowhere but here, so when the round's clock ran
   * out before "Put this forward", the game carried on with a company that had
   * no name and no description.
   */
  useEffect(() => { onDraftChange?.(draft); }, [draft]);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Your idea</h3>
          <Button
            type="button" variant="outline" size="sm"
            onClick={async () => {
              const idea = await onGenerate();
              // Functional, so it lands on the draft as it is when the idea
              // arrives rather than a copy from before the wait.
              if (idea) setDraft((current) => ({ ...current, ...idea }));
            }}
            disabled={generating}
            data-testid="button-generate-idea"
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            {generating ? "Thinking…" : "Give me one"}
          </Button>
        </div>

        <div className="mt-3 space-y-3">
          <Input
            placeholder="What's it called?"
            value={draft.name}
            maxLength={80}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            data-testid="input-idea-name"
          />
          <Input
            placeholder="One line — what is it?"
            value={draft.tagline}
            maxLength={160}
            onChange={(e) => setDraft({ ...draft, tagline: e.target.value })}
            data-testid="input-idea-tagline"
          />
          <Textarea
            placeholder="The pitch. Two or three sentences."
            value={draft.pitch}
            maxLength={600}
            rows={3}
            onChange={(e) => setDraft({ ...draft, pitch: e.target.value })}
            data-testid="input-idea-pitch"
          />
          <Button
            type="button"
            onClick={() => onWrite(draft)}
            disabled={busy || !draft.name.trim()}
            data-testid="button-put-forward"
          >
            {picked === draft.name.trim() ? "Updated" : "Put this forward"}
          </Button>
        </div>
      </div>

      {theirs && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Their idea</h3>
          <IdeaCard
            idea={theirs}
            picked={picked === theirs.name}
            onPick={() => onPick(theirs)}
            busy={busy}
          />
        </div>
      )}
    </div>
  );
}

export function IdeaCard({
  idea, picked, onPick, busy,
}: { idea: GameIdea; picked: boolean; onPick?: () => void; busy?: boolean }) {
  return (
    <div className={cn(
      "rounded-xl border p-4 transition-colors",
      picked ? "border-primary bg-primary/5" : "border-border bg-card",
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">{idea.name}</div>
          {idea.tagline && <p className="text-sm text-muted-foreground">{idea.tagline}</p>}
        </div>
        {picked && <Badge className="shrink-0">Backing this</Badge>}
      </div>
      {idea.pitch && <p className="mt-2 text-sm leading-relaxed">{idea.pitch}</p>}
      {idea.twist && (
        <p className="mt-2 text-sm text-muted-foreground"><span className="font-medium">The twist: </span>{idea.twist}</p>
      )}
      {onPick && !picked && (
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onPick} disabled={busy}>
          Build theirs instead
        </Button>
      )}
    </div>
  );
}

// ─── Rounds 2 and 3: the decks ───────────────────────────────────────────────

/**
 * A deck round.
 *
 * Grouped, because eighteen cards in one grid is a wall nobody reads — and the
 * groups are the argument ("we're picking somebody at work, not somebody at
 * home") as much as they are navigation.
 */
export function DeckRound({
  cards, pickedId, partnerPickedId, onPick, customs, onAddCustom, onRemoveCustom, busy,
}: {
  cards: DeckCard[];
  pickedId: string | null;
  partnerPickedId: string | null;
  onPick: (card: DeckCard) => void;
  customs: DeckCard[];
  onAddCustom: (label: string, detail: string) => void;
  onRemoveCustom: (id: string) => void;
  busy?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [detail, setDetail] = useState("");

  const groups = [...new Set(cards.map((c) => c.group))];
  const all = [...cards, ...customs];

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group} className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">{group}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {all.filter((c) => c.group === group).map((card) => (
              <PickCard
                key={card.id}
                card={card}
                picked={pickedId === card.id}
                byPartner={partnerPickedId === card.id}
                onPick={() => !busy && onPick(card)}
              />
            ))}
          </div>
        </div>
      ))}

      {/* The deck is a prompt, not a cage — the best answer is often somebody
          the two of you actually know. */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground">Yours</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {customs.map((card) => (
            <div key={card.id} className="relative">
              <PickCard
                card={card}
                picked={pickedId === card.id}
                byPartner={partnerPickedId === card.id}
                onPick={() => !busy && onPick(card)}
              />
              <Button
                type="button" variant="ghost" size="icon"
                className="absolute right-1 top-1 h-6 w-6 text-muted-foreground"
                onClick={() => onRemoveCustom(card.id)}
                aria-label="Remove"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}

          {customs.length < MAX_CUSTOM_CARDS && !adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              data-testid="button-add-custom"
              className="flex min-h-[8rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
              Add your own
            </button>
          )}

          {adding && (
            <div className="rounded-xl border border-primary/40 bg-card p-4">
              <Input
                placeholder="Who, specifically?"
                value={label} maxLength={80}
                onChange={(e) => setLabel(e.target.value)}
                data-testid="input-custom-label"
                autoFocus
              />
              <Input
                className="mt-2"
                placeholder="What makes them different?"
                value={detail} maxLength={200}
                onChange={(e) => setDetail(e.target.value)}
              />
              <div className="mt-2 flex gap-2">
                <Button
                  type="button" size="sm"
                  disabled={!label.trim()}
                  onClick={() => { onAddCustom(label.trim(), detail.trim()); setLabel(""); setDetail(""); setAdding(false); }}
                  data-testid="button-save-custom"
                >
                  Add
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Round 4: the product ────────────────────────────────────────────────────

/**
 * What it does better than what already exists.
 *
 * Up to ten, at most three of them core. The cap on core is the round's whole
 * teaching mechanism — a pair who mark everything essential have said nothing,
 * and the second, harder question is which three are the reason this exists.
 */
export function ProductRound({
  claims, onChange, onCommit, committed, theirs, busy,
}: {
  claims: Claim[];
  onChange: (next: Claim[]) => void;
  onCommit: () => void;
  committed: boolean;
  theirs: Claim[];
  busy?: boolean;
}) {
  const [text, setText] = useState("");
  const coreCount = claims.filter((c) => c.core).length;

  const add = () => {
    const t = text.trim();
    if (!t || claims.length >= MAX_CLAIMS) return;
    onChange([...claims, { text: t, core: false }]);
    setText("");
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">What does it do better?</h3>
          <span className="text-xs tabular-nums text-muted-foreground">
            {claims.length}/{MAX_CLAIMS} · {coreCount}/{MAX_CORE_CLAIMS} core
          </span>
        </div>

        <div className="mt-3 flex gap-2">
          <Input
            placeholder="One thing it beats the alternatives at…"
            value={text}
            maxLength={160}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            disabled={claims.length >= MAX_CLAIMS}
            data-testid="input-claim"
          />
          <Button type="button" onClick={add} disabled={!text.trim() || claims.length >= MAX_CLAIMS}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <ul className="mt-3 space-y-2">
          {claims.map((claim, i) => (
            <li
              key={`${claim.text}-${i}`}
              className={cn(
                "flex items-start gap-2 rounded-lg border p-2.5 transition-colors",
                claim.core ? "border-primary/40 bg-primary/5" : "border-border",
              )}
              data-testid={`claim-${i}`}
            >
              <button
                type="button"
                onClick={() => {
                  const next = [...claims];
                  // The cap binds here rather than silently dropping it later.
                  if (!claim.core && coreCount >= MAX_CORE_CLAIMS) return;
                  next[i] = { ...claim, core: !claim.core };
                  onChange(next);
                }}
                title={claim.core ? "Core feature" : coreCount >= MAX_CORE_CLAIMS ? `Only ${MAX_CORE_CLAIMS} can be core` : "Mark as core"}
                className={cn(
                  "mt-px shrink-0 transition-colors",
                  claim.core ? "text-primary" : "text-muted-foreground/40 hover:text-muted-foreground",
                  !claim.core && coreCount >= MAX_CORE_CLAIMS && "cursor-not-allowed opacity-40",
                )}
                data-testid={`toggle-core-${i}`}
              >
                <Star className={cn("h-4 w-4", claim.core && "fill-current")} />
              </button>
              <span className="min-w-0 flex-1 text-sm">{claim.text}</span>
              <button
                type="button"
                onClick={() => onChange(claims.filter((_, j) => j !== i))}
                className="shrink-0 text-muted-foreground/50 hover:text-destructive"
                aria-label="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>

        {claims.length > 0 && coreCount === 0 && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            Star at least one — the reason this exists, not something nice it also does.
          </p>
        )}

        <Button
          className="mt-3"
          onClick={onCommit}
          disabled={busy || claims.length === 0 || coreCount === 0}
          data-testid="button-commit-claims"
        >
          {committed ? "Update my list" : "Put my list in"}
        </Button>
      </div>

      {/* Both lists are kept, so seeing theirs is about not repeating them. */}
      {theirs.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold text-muted-foreground">Theirs — both lists get kept</h3>
          <ul className="mt-2 space-y-1.5">
            {theirs.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Star className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", c.core ? "fill-current text-primary" : "text-muted-foreground/30")} />
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
