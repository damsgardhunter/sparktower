# A contest the product scores itself

Most contests are judged: entrants file a link to what they built and a person
reads them. A contest can instead name a *game*, and the standings are then
worked out from what entrants did in it. Nothing is filed and nobody judges.

The first one is **Ten Years From Now**, ranked on the **ten-year valuation** —
the big number on the game's results screen.

## Running one

1. **`/admin/contests`** → new or edit. Set **How it's decided** to
   *Ten Years From Now*. The form shows the sentence entrants will see.
2. Set **Opens** and **Closes**. These are the window, and they are the whole
   eligibility rule: a game counts if its verdict landed between them.
3. Set **Prize** to whatever you are paying — it is a line of text, not money the
   product moves. Paying the winner is still something a person does.
4. Leave status `upcoming` until you want it listed; `active` lists it and opens
   the window.

Entrants then see **Standings** and **Play** instead of a box to paste a link
into. The entry button is unchanged: they still have to enter.

## The rules, exactly

- **Each entrant's best game counts**, not their latest. Three games, the highest
  valuation stands.
- **Any game inside the dates counts, whenever they entered.** Somebody who plays
  a good game on day one and enters on day three keeps it. This is why the
  standings are a query rather than a stored score — see below.
- **Both players are credited.** The game is played in pairs and there is one
  verdict, so two entrants who played each other share a number *and* a rank.
  That is correct: they built the same company. Both screens say so, because
  unsaid it reads as a bug.
- **A fallback verdict does not count.** When the model cannot be reached the game
  writes an honest placeholder (`from_model = false`). The game's own boards leave
  those out because a placeholder that ranks is a lie — and here it would be a lie
  worth whatever the prize is.
- **Ties share a rank and the next rank skips.** Two firsts are followed by a
  third, which is what people expect.
- **Somebody who has not played is last, with no rank at all** — not sorted among
  the zeroes. Not having played is a different thing from having built something
  worth nothing.
- **Non-entrants never appear**, however well they played.

## Why the standings are computed and not stored

The obvious build is a `best_score` column written when a verdict lands. Three
things go wrong with that, and all three disappear if the table is worked out when
somebody reads it:

- **Entering late.** "Any game inside the dates" needs a backfill the moment
  somebody joins, and that backfill is a second implementation of the same
  question which can disagree with the first.
- **A verdict that changes.** A verdict is rewritten when the model is asked again
  after a failure. A maximum taken from the old one stays wrong and nothing points
  at it.
- **Dates moving.** An admin changing the end date would have to move every stored
  score with it, or the standings quietly describe a window that no longer exists.

The cost is bounded by entrants, not by games: the query starts from this
contest's participants and reaches their games through the two player indexes.
`startup_game_verdicts` gained an index on `created_at` for the window filter.

## One thing that is deliberately not reused

`contest_participants.score` is an `integer`, and a ten-year valuation overflows a
32-bit integer at about 2.1 billion — an ordinary result in this game. The
standings never pass through that column. It stays where it was, for a judged
contest's scores.

## What is still a person's job

- **Paying the winner.** The product names them; it does not send money.
- **Closing the contest.** Set status `completed` (or let the window end) and the
  standings read as final rather than live.
- **Awarding the badge**, if the contest has one.

## Adding another scored game later

One entry in `CONTEST_SCORERS` ([shared/contests.ts](../shared/contests.ts)) with
its id, label and the sentence entrants read, one id in the `scored_by` enum
([shared/schema.ts](../shared/schema.ts)), and a branch in `standingsFor`
([server/contest-standings.ts](../server/contest-standings.ts)). A test fails if
the list and the enum disagree, and another fails if a scorer has no sentence.

Held by [contest-standings.test.ts](../test/integration/contest-standings.test.ts)
(14) and [contest-scored-by-game.test.ts](../test/unit/contest-scored-by-game.test.ts)
(22). Every rule above was checked by breaking it on purpose — a fallback verdict
counting, the window ignored, only one player credited, the first game beating the
best, ties split, and the idle sorted first.
