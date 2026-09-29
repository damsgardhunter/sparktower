/**
 * "Your idea stays yours" — on the card before you play, and inside the game.
 *
 * ## Why this is on the screen at all
 *
 * The game asks somebody to invent a startup, in writing, in a box, on a
 * website they have known for ten minutes. The reasonable thought at that
 * moment is *what happens to this*, and the product had no answer anywhere near
 * where the question gets asked — the terms say the right thing, and nobody
 * reads the terms while a five-minute round clock is running.
 *
 * ## Why it describes the software rather than quoting the law
 *
 * The first draft of this said it would be illegal for us to take an idea
 * without consent. It is not written that way, because that sentence is not
 * reliably true and a reassurance that does not hold up is worse than none:
 * somebody who checks it and finds it overstated has been given a reason to
 * doubt everything else on the page. An idea in the abstract is not what the
 * law protects — the words somebody writes are theirs, the underlying idea is
 * generally not anybody's property, and none of it is a criminal matter.
 *
 * What is both true and stronger is what the code does, which is checkable:
 * `gameState` refuses every request from anybody who is not one of the two
 * players (server/startup-game.ts), so there is no route by which another
 * player, a visitor, or a leaderboard reaches what was typed. The boards carry
 * a startup's name, its valuation and who played — nothing from the rounds.
 * And the terms say the licence is storage and display to the people you chose,
 * and nothing more, so this links to them rather than paraphrasing them.
 *
 * If that promise ever stops being true of the code, this file is the thing
 * that has to change first.
 */
import { Lock } from "lucide-react";
import { Link } from "wouter";

export function YourIdeaStaysYours({ compact = false }: { compact?: boolean }) {
  return (
    <p
      className={`flex items-start gap-2 rounded-lg border border-border bg-background/60 p-3 ${compact ? "text-xs" : "text-sm"}`}
      data-testid="text-your-idea-stays-yours"
    >
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">
        <span className="font-medium text-foreground">Your idea stays yours.</span>{" "}
        What you write in a game is seen by you and your partner and nobody else. It is never published, never shown to
        other players, and never put on the leaderboards — those carry only a startup's name, its valuation and who
        played. We claim no ownership of anything you write here, and we don't use it for anything beyond running your
        game.{" "}
        <Link href="/terms" className="underline hover:text-foreground">The terms say so too</Link>.
      </span>
    </p>
  );
}
