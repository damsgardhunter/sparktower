# Playing the simulation, and what it feels like

Sixteen quarters, four strategies, two markets, run through the real engine.
One market is one Nova actually wrote (`SaturdaySunday Sharp`, a betting
analytics tool). The other is a B2B SaaS written by hand in the same shape —
deploy previews sold per seat — to check the engine is not tuned to one market.

No model was called. What is under test is the engine, not the market writer.

## The short version

**The scale is right.** A solo founder opens with about £60,000 and a plant
sized to their region, at a price the largest segment expects. That reads like
a small business, and it is a real improvement on the corporation-sized numbers
this used to hand a startup.

**Four things did not hold up.** All four are fixed; each has its own section,
and the measurements are the ones the fixes were calibrated against.

1. A company that decided nothing was profitable from its first period and
   ended the season richer than it started.
2. One person was shown 19 levers before making a single decision, and 49 by
   the end.
3. Setting capacity to nought threw out every customer at once — the only
   decision in the game that could end a season in one keystroke.
4. A market Nova wrote could be made unplayable by writing its rivals strong,
   with nothing to band that the way share is banded.

A note on method, because it changed two of the findings. The first pass of
this document read a company's **capacity** as its customer count, and reported
a do-nothing company "holding 334 customers" when it held none and had room for
334. It also drove the engine with a budget set as a share of the *bank* rather
than of what the business could earn — £28,800 a year of spending against
£4,000 of revenue — which made every active strategy look like a money pit. Two
of the original five findings did not survive being measured properly. The
numbers below all come from filing `defaultDraft`, which is what the desk shows
when nobody changes anything.

### 1. Doing nothing was the safest way to play — fixed

It used to end with **more money than it started** — £60k in, £66k out,
profitable in every single period — while its customers fell by 60% and its
quality decayed 37 → 30. Nothing ever forced the question, and the strategy
that required no thought was the only one that never ran out of cash.

Three things were paying for it, and none of them were what the first draft of
this document guessed:

**A founder cost £700 a year.** Executive pay was scaled linearly by market
size, so in a market a hundredth of catalogue size one person cost a hundredth
of a person. There was almost nothing for the revenue to have to cover. Pay
compresses now instead of shrinking; a market at catalogue scale is unchanged
by construction.

**The opening plant was sized against a payroll the company was never charged.**
Two places computed the same executive bill and disagreed — one applied the
regional footprint and the other did not — so every company opened with room
for two and a half times the salary bill it actually had.

**Overflow was a customer magnet.** Customers a rival turns away go to whoever
they would have chosen next, which is deliberate and is the door a newcomer
comes in through. But the candidates were only the companies with *room*, and
in a market whose incumbents are all full that is one company — so an idle
newcomer took half of everything every rival turned away. A thousand customers
in its first period, in segments it had a 0.6% claim on. Room was not a bet; it
was a magnet, and the biggest empty plant won. Intake is now bounded by what a
company won by being chosen.

Sixteen quarters, after:

| | customers | cash | company worth |
|---|---|---|---|
| Does nothing | 134 → 105 | **−£10,155** | 1,890 |
| Markets only | 150 → 239 | −£59,376 | 4,302 |
| **Plays it well** | 136 → **343** | −£58,229 | **6,174** |
| Overbuilds | 134 → 105 | −£47,109 | 1,890 |

Deciding nothing now bleeds, shrinks and ends worth a third of a company that
fixed the axis its segment weighs. It is a partial fix and the limit is
documented in `simulation-backlog.md`: the five-team catalogue seasons turn out
to lean on overflow harder than anybody realised, so the bound sits where those
markets can still be played rather than where the startup case would put it.

### 2. Marketing alone is a trap, and that part works

Brand climbed 8 → 53, the highest of any run, and customers *fell* to 207 while
$65,000 went out of the door. That is the geometric mean doing its job: brand
on a product scoring 30 for quality buys nothing, because a segment that weighs
quality cannot be talked round.

This is the single clearest lesson in the game and it lands. Leave it alone.

### 3. Capacity overbuild was priced too late — fixed

The "balanced" run built **22,000 seats of room for 1,665 customers** and went
to zero cash.

The projection panel does warn — "More room than demand, idle room costs
money", once the room is past 1.3× the top of next period's range. What it did
not do was price the *order*. The forecast card's two tiles ("if the year comes
in low, N idle, costing X") were both worked out from the room the company has
today, so typing 22,000 into the capacity lever moved nothing on the card that
is about capacity. The bill turned up a year later as a company with no cash
and no way to tell which decision had spent it.

The card now says so at the moment the number is typed, when the order is past
anything the market could currently bring: what it is a multiple of, how much
sits idle, and what that costs a period. Only for the "far too much" case —
building ahead of demand is a real strategy, and interrupting it every time
would be noise.

### 4. Nobody is ever turned away

After the first period, capacity exceeds demand in every run, so the
turned-away mechanic — and the reputation it costs — never fires. A whole piece
of the model is unreachable in a startup-scale market. It is tuned for a
market where demand outruns a company, which is not the market a founder is in.

## The same strategy, two markets

The identical "plays it well" strategy grew 2.3× on the betting market and
1.17× on the B2B SaaS one, and the difference looked like incumbent strength: a
34% fortress at quality 78 and brand 82. It was not. With the three defects
above fixed and no clamp at all, the SaaS market now goes 81 → 455 customers
and ends worth five times a company that coasts — a better spread than the
betting market gives.

Incumbent strength is clamped anyway, because the argument for banding it is
the same one that already bands incumbent *share*: a company opens at quality
38 and brand 8, four years of good play reaches about 64 and 57, and against a
field averaging ninety nothing a founder does changes the ordering. The band
applies to the field's *mean*, not to any one rival — a single fortress at 88
with three ordinary rivals is a real market shape and passes untouched, as do
all seven catalogue markets.

## Nobody is ever turned away — wrong

People are turned away constantly. The incumbents do it every period on
purpose: `stepIncumbent` keeps six per cent of headroom precisely so the
overflow exists, because that overflow is the door a newcomer comes in through.
Twelve per cent of headroom was tried once and left every new team in single
figures.

What was actually missing is that the *player* never hit their own ceiling,
because the plant they opened with was several times what their region could
fill. That is fixed above. And turning away is now bounded at both ends: an
incumbent's overflow only reaches companies people would plausibly have chosen,
and a player cannot cut their own room out from under the customers they are
already serving — which used to be the one decision in the game that could end
a season in a single keystroke.

## Too much information?

Yes, measurably. Levers shown at once, quarterly:

| Period | Solo founder | One seat at a table of five |
|---|---|---|
| 1 | **19** | 3–5 |
| 5 | 26 | 5–7 |
| 12 | 39 | 9–10 |
| 16 | **49** | 10–16 |

Nineteen decisions in the first period is already more than a person holds in
their head. Forty-nine is a spreadsheet.

The five-person game is fine — that is what the seats are for, and 3–5 levers
is a role somebody can learn in a minute. The solo game inherits all five desks
and the unlock schedule was written for people who each only see a fifth of it.

**Fixed.** A solo season now reads its own schedule (`SOLO_ORDER` and
`soloSchedule` in `shared/simulation/responsibilities.ts`). Eleven levers open
it — where the period goes, who the company is for, what it charges, how much
it can serve, two ways people hear about it, how it gets better, how it looks
after people, who it employs, what it borrows and what it keeps back — and the
rest arrive a few a period across three quarters of the season, in the order a
table meets them. Nothing is taken away, and a season still only reaches the
levers it is long enough to reach.

Eleven rather than the eight this was first written with. Eight was an
aesthetic preference and the desk's own integration tests were the correction:
they file a brand budget, hold cash back and declare a focus in a solo first
period, because those are decisions a business really does make on day one.

| Period | Before | After |
|---|---|---|
| 1 | 19 | **11** |
| 4 | 19 | 19 |
| 8 | 26 | 34 |
| 12 | 39 | 49 |
| 16 | 49 | 49 |

The end state is the same, because a four-year season should end with the game
in your hands. What changed is that you meet it about four at a time instead of
nineteen at once, then seven, then thirteen. A monthly season spreads it to roughly one
a period.

## What is genuinely good

- **The opening numbers are believable.** $60k, 334 customers, $20 a seat.
- **Quality compounds and is visible**: 37 → 74 over a good season, and you can
  watch it in the report.
- **The failure modes are the real ones** — overbuilding, marketing a weak
  product, pricing under the floor. A founder who loses here loses for a reason
  they would recognise.
- **Nothing is random in a way that matters.** Two runs of the same decisions
  give the same season, which is what makes it worth arguing about.

## What I did not test

Multiplayer, bots as rivals, the auction, mergers, and anything that needs
several people. This was one founder against the market, which is the case the
custom-season product actually sells.
