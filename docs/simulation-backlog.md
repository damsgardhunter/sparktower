# The simulation: what is built, and what is owed

Kept because this work has run across many sessions and several people, and
"we said we'd do that" is not a plan. Anything deferred deliberately is here
with the reason. Anything here that stops being true should be deleted rather
than ticked.

## Owed, and why it was deferred

### From a founder playing their own season, Sept 2026

Reported in one sitting while playing a quarterly solo season. Ordered as we
agreed to take them; struck through here when done rather than deleted, so the
list stays readable against what was reported.

1. ~~Growth is too fast — 6.6% of the market taken in the first quarter, and
   capacity full in period one.~~ **Done.** The unheld half of the market
   belonged to nobody; it is seated as "Everybody else" now, leaving a tenth
   genuinely free as the catalogue markets do. Free customers in that founder's
   market: 18,975 → 3,455.
2. ~~The capacity projection is not shown.~~ **Done.** The forecast bar carries
   a second marker for the room the lever actually sets, and says so.
3. ~~A market lot should say what it would do to *this* company.~~ **Done.**
   The market sends where the company stands on each axis, and a lot reads
   "quality 54 → 60" where that is known.
4. ~~Nothing ever bids against the player.~~ **Done.** Each incumbent takes a
   tenth of a chance on each lot, a little over the reserve. Measured over 56
   periods: 36% of lots contested. In-memory rather than written to `sim_bids`,
   whose `venture_id` is a foreign key to a room an incumbent does not have.
5. ~~The price has to be entered again every period.~~ **Already fixed**, by
   the read-back change — `defaultDraft` always carried it, but a solo
   founder's draft was being rebuilt from the chief executive's row alone.
   Covered by a test now, across a real period boundary.
6. ~~The unit cost Nova writes is dearer than the founder's real product.~~
   **Done.** It was unbounded against the prices in the same answer: 18, with
   segments paying 12 and 7, so two of four could never be sold to. Capped at
   70% of the cheapest segment's price, and the prompt now says what the number
   means. Existing seasons repair on read (18 → 5, 14 → 4).
7. ~~The forecast does not move when a decision changes.~~ **Done.** The
   projection endpoint cleaned the draft as `seat.role`, so a solo founder's
   price and capacity were parsed as the chief executive's and dropped. It
   splits per desk now, as filing does, and this period's demand comes back
   with the draft applied so the forecast card moves as somebody types.


### A sealed bid is invisible to the commitment meter
The desk's meter shows what the seats plan to spend against what the company
has. A sealed bid sits outside it, so a table can file a year that looks
affordable and then lose a third of its cash at the auction — which is exactly
what happened in the first season anybody played.

Needs a decision before it needs code: should a live bid reserve its money on
the meter (honest, but leaks the bid's existence to every seat), or should the
meter simply name the exposure without the amount?

### From the same founder, a second sitting

8. ~~Growth still too fast: 22% of the market while open in one region worth
   9% of it.~~ **Done.** Reach was a weight, not a ceiling — appeal squared
   could win customers in regions never opened, by the allocation *and* by the
   overflow path. Both capped now.
9. ~~Raising the price loses nobody.~~ **Done.** A price *level* was judged;
   a price *rise* was not. `priceWas` carries last period's, and a rise churns
   a little, scaled by how big it is and forgiven by loyal segments.
10. Capacity "maxed at 8,000" was the quarterly build lag, not a cap: asking
    20,000 from 5,064 opens 8,798. Explained on the lever and marked on the
    forecast bar already; nothing further owed.

### Market share reads as nothing on a world map
A company that opens in Leeds holds about 0.2% of the world market, and the
standings say so. That is true and it is useless: a team winning its own
continent reads as a rounding error.

Probably: the headline share should be share *of the regions you sell in*, with
the world share beside it. Not decided.

### The phone has not caught up
The expansion vote is the sharp one: a phone player can cast the vote (it is a
`levels` lever and `LevelsField` draws it) but never sees the region, its cost,
who voted or whether it carried — the card whose whole point is showing what
your colleagues think is web-only. The teammate and rival-company profiles have
no phone counterpart either, so nudging a seat that has not filed is web-only,
and neither is URL-addressable, so the in-app browser fallback cannot catch
them.

The new desk fields (a region's continent, whether the company is foreign
there, whether it can be entered at all), the two Past-tab cards and the
expansion vote's faces are web only. The vote itself files fine from the phone
— it is a `levels` field like the offers, and `LevelsField` already draws it —
but the card showing who voted which way is not there.
`mobile/src/components/sim/*` mirrors the maths and the drift tests keep it
honest, so this is screens rather than logic.

### Paying for a simulation
Both tiers are built end to end — the two prices, the gate at the start line,
the checkout that knows which seat it is selling, and the webhook that credits
the right balance against a ledger keyed on the Stripe session so a redelivery
cannot credit twice. A session from before the split carries no `seatKind` and
is credited as the Nova seat it was sold as.

What is still owed: nothing decrements. A seat is held, not consumed — which
is what the copy says and what the price assumes — so a company buys once and
plays for ever. That is deliberate. A refund does not take seats back, and
there is no purchase history beyond a count, though `sim_seat_purchases` has
recorded every line needed to show one.

### Nova's simulation has never met a real model
`buildSimulationPrompt` and `parseSimulationBrief` are tested hard, and the
route around them is not: no integration test calls the model. The prompt asks
for a market whose *shape* matches the business, which is exactly the kind of
judgement that needs looking at on real companies before anybody is charged
for it.

### From a sixteen-quarter playtest, 29 Sept 2026

Four strategies run through the engine on two markets — one Nova wrote, one
written by hand in the same shape. Numbers and method in
`docs/simulation-playtest.md`. Every item below is measured, and two of the
original five findings did not survive being measured properly.

1. ~~One person is shown nineteen levers before making a decision.~~ **Done.**
   A solo season reads `SOLO_ORDER`/`soloSchedule` instead of `UNLOCKS`: eleven
   to open with, the rest a few a period across three quarters of the season.
   Period one goes 19 → 11. `replaceBid` joined `LEVERS_FOR_A_TABLE` on the way
   past — it was showing to founders without `replaceSeat`, which was already
   hidden, so there was a bid field with nothing to bid on.

2. ~~Ordering capacity costs nothing on the card that is about capacity.~~
   **Done.** The forecast card prices the *order* as well as the room, when the
   order is past anything the market could currently bring.

3. ~~Doing nothing is cash-positive for four years.~~ **Done.** Four things
   were paying for it:
   - **A founder cost £700 a year.** `EXECUTIVE * scale` scaled a *person's*
     pay linearly with the market. `payScale` compresses it instead; exponent
     0.7, calibrated, and `payScale(1) = 1` so the catalogue does not move.
   - **The opening plant was sized against a payroll the company was never
     charged.** `startingCompany` left the regional footprint off the executive
     line and `fixedCosts` applied it. Both ask `officerCost` now.
   - **Overflow was a customer magnet.** Customers a rival turns away go to
     whoever they would have chosen next, and the candidates were only the
     companies with *room* — so in a market whose incumbents are all full, an
     idle newcomer took half of everything. Intake is now bounded by what a
     company won on merit (`SPILL_TOPUP_MAX`), shared proportionally.
   - **The bank was sized against the market and the bill against the
     company.** `startingCashFor` gives every company the same number of years
     of its own costs. Runway: catalogue five-person 18.6y (unchanged), custom
     five-person 1.7y → 17.1y, solo 85.7y → 17.1y.

   Deciding nothing now ends £10,155 down with its customers cut from 134 to
   105 and a company worth 1,890, against 4,392 for one that plays well.
   Before: ended *up* and profitable in every period.

   **Still owed.** Partial, and the bound is the catalogue: at a top-up cap of
   5 only one team in five finished `balance.test.ts` with a business worth
   anything, so the cap sits at 8 for margin. Those markets are fed by overflow
   harder than anybody realised — **32% to 74% of what a new team holds in its
   first period is overflow, not customers who chose it**, in every catalogue
   market. Worth understanding before tightening further.

4. ~~A market Nova wrote can be made unplayable by writing its rivals strong.~~
   **Done, and it was mostly something else.** `INCUMBENT_STRENGTH_MEAN_MAX`
   bands the field's *mean* quality, brand and service at 70, scaled not
   clipped so the ordering survives. A single fortress at 88 with three
   ordinary rivals passes untouched, as do all seven catalogue markets. But the
   SaaS market that prompted this was not unplayable because of its fortress —
   it was unplayable because of the defects in (3).

5. ~~Nobody is ever turned away after the first period.~~ **Wrong premise.**
   People are turned away constantly and on purpose: `stepIncumbent` keeps 6%
   of headroom precisely so the overflow exists, and 12% was tried once and
   left every new team in single figures. What was missing is that the
   *player* never hit their own ceiling, because their opening plant was
   oversized. Fixed by (3).

6. ~~The only decision that could end a season in one keystroke.~~ **Done.**
   Setting capacity to nought threw out every customer at once — 380 to zero in
   a period, unrecoverable. `capacityBuild` floors a cut at the customers being
   served.

   Swept across every lever at its extremes — price multiplied and divided by
   twenty, every money lever zeroed, every choice set to each of its options,
   every city closed — **nothing else costs even a quarter of the customers in
   one period.** Worth re-running that sweep after any allocation change.

7. ~~Expanding was strictly worse than not expanding.~~ **Done.** Entry costs
   are the one number Nova writes in absolute money that nothing scaled. All
   seven catalogue markets price a region at **0.75%–2.0% of that region's own
   annual worth**; a market Nova wrote priced it at **7%–33%**. Expanding at any
   point bankrupted the company: one extra region ended with nothing and 269
   customers, against money and 244 for never expanding. `ENTRY_COST_MAX_SHARE`
   pulls a whole market's entry costs back by one factor when any region
   exceeds the catalogue's ceiling, so the shape the model wrote survives.
   After: 287 customers and 18% more company value.

8. ~~Putting the price up for ever was strictly profitable.~~ **Done, in two
   places.** Commit 9fc46d03 (another session) fixed the appeal side —
   `expectationPenalty` drives appeal to ~0.00005 at seventy times the ceiling
   — and that was necessary and not sufficient, because customers *already
   held* leave by a different path:
   - The gouge rate was capped at 0.85 and then multiplied by `per`, so a
     quarterly season shed 21% a period however absurd the price, while a price
     raised 50% a period compounded faster. Being priced past what somebody can
     pay is not an annual rate; it is now applied per period, which is what the
     comment above it already said it meant.
   - A list price was judged against the *dearest* ceiling in the market, so a
     company could charge eighteen times what its largest segment references
     and those customers were shielded by a richer segment's ceiling. Staying
     is not choosing: retention is now judged per segment, against what the
     people actually paying the bill will pay.

   Sixteen quarters, a market referencing £15: +50% a period went from a
   company worth 149,602 (79× the best honest strategy) to one worth nothing;
   +20% a period went from 20,057 to 6,905.

   **Open, and a judgement call rather than a hole.** A steady 20% a period
   still ends the best single strategy measured — £274, twenty-one customers,
   worth 6,905 against 4,392 for playing well. That is a premium niche business
   being worth more than a bigger cheap one, which is a real thing and which
   `valuation` (revenue × 1.2 + assets − debt) will always say. Left as is.

### A sweep of every lever, 29 Sept 2026

Each spending lever run alone for a full season at the same share of cash, then
every non-spending lever at each of its settings, measured on what the company
is worth at the end. Three bugs, all the same shape as the price one: a rate
written per **year** applied to a **period**, so a quarterly season got four
times the effect and a monthly one twelve. `cadence.ts` states the rule; these
are the three places that did not follow it.

9. ~~A PR push landed a year's brand every period.~~ **Done.** `prOutcome` had
   neither `atScale` nor `per`, unlike `brandGain` and `perfGain` beside it. It
   was the only lever in the game with a **negative net cost** — twelve
   quarters of PR alone took a company from 16,576 customers to 27,990 and
   ended with *more* money than it started — and beat everything else per pound
   by four times. In a market Nova wrote the same flat £100,000 threshold was
   twice a founder's whole bank, so the lever could not be used at all. Now
   599 per £1,000 spent, against celebrity at 486 and brand at 393.

10. ~~Payment terms were free money.~~ **Done, twice over.** `termsOf` deferred
    `days / 365` — a share of a *year's* takings — applied to a *period's*
    revenue, so ninety-day terms in a quarterly season deferred a quarter of
    what ninety days actually is. And nothing charged for carrying the
    receivable at all: it was free capital. Together, the longest terms in the
    market won more customers **and** ended with more cash **and** more profit
    than billing on delivery. Deferral is now per period, and what is owed is
    carried at the company's *own* credit rate — so the company nobody wants to
    lend to pays most to be patient with its customers. Ninety days now ends
    with less cash than billing on delivery, and the sweet spot is 30–60.

11. ~~A promotion's churn was charged on a tenth of what it won.~~ **Done.**
    `dealChasers` was booked from `allocation.fresh` — customers new to the
    market — which is a small minority of what a promotion wins; the rest come
    from rivals and from rivals' overflow. One measured period: 36 fresh
    against 403 from overflow, so the cost landed on eight per cent of the
    benefit. Every arrival counts now. "First month free" fell from +85,008 to
    +43,920 of company value in dating apps, and "a January sale" from +38,016
    to −672.

**Open, and measured rather than guessed:**

- **"First month free" is still never a mistake.** Halved, but positive in all
  seven markets at every horizon tried. Its appeal is 0.16 for a cost of
  one-twelfth of *new* customers' revenue; a January sale is 0.09 for four per
  cent of *everyone's*. Per unit of cost the free month is about five times the
  better buy, which is why nobody would ever choose the sale. Equalising them
  is a tuning judgement nobody has taken.
- **Whether a sale hurts depends on the horizon.** At sixteen quarters it costs
  money in dating apps and drone delivery; at twelve it pays in all seven. The
  test that came out of this asserts the deal-chaser *accounting* rather than
  the sign of the outcome, because the sign moves with the season length and
  pinning it would be pinning the seed.
- **Cost-cutting levers score nothing.** `valuation` is `revenue × 1.2 + assets
  − debt`, so efficiency, a margin focus, a cost review, automation and
  sourcing all improve profit and change the score by exactly zero. Excluding
  cash is load-bearing — it is what makes the price-ramp company worth nothing
  — so this is a question about the score, not about the market, and it wants
  answering on its own.
- **The lesson the game is built on is thin at the length it is sold.** Over
  forty quarters, doing both marketing and product is worth twice doing
  marketing alone. Over sixteen — the length of a custom season — it wins by
  five per cent. The ordering is right at every length; the *teaching* wants
  six years to land.

### Levers with no downside, 29 Sept 2026

A second sweep, this time every *choice* and *percent* lever at each of its
settings over forty quarters, with the options read out of `LEVER_FIELDS` so
they could not be mistyped. Three of the fixes above came out of it. What is
left is a pattern rather than a bug, and it is the thing to look at next.

**Several levers have a benefit that compounds and a cost that does not.**
Measured on dating apps over twenty-four quarters, stacked on top of ordinary
competent play:

    invest in marketing and product              1,289,280
    + annual discount at its cap                 1,459,248
    + ninety-day terms + first month free        2,028,528

Three levers, **+57%**, none of which has a setting where it hurts. A player
who finds them takes all three every time, which makes them not decisions.

- ~~**`annualDiscount` is monotonically best at its cap in every market.**~~
  **Done.** Giving away `d` cost `d`, and what it bought — customers who cannot
  leave — was worth the same at every depth, so deeper was always better and the
  lever's range collapsed onto its cap.

  What was missing is what happens when the plan ends: a year at 30% under list
  makes the list price a 43% rise, and a rise on people already paying is what
  this market has always said they walk out over. It is also the only cost here
  that does not scale linearly, since the step back up is `d / (1 - d)`. See
  `ANNUAL_UNWIND`, calibrated to 0.3. The cap is now the best setting in none of
  the seven markets, a shallow plan is worth taking in six of seven, and two
  markets are worse at the cap than with no plan at all.

  Worth knowing: `responsibilities.ts` says every lever "was built to have a
  real trade-off, and the tests hold them to it: a range where it helps, and a
  setting where it hurts". For annual plans the tests assert only that the
  mechanism exists — revenue down, retention up, customers up — all in a single
  period. The property the comment claims is not actually tested here, which is
  the same blind spot that hid the price bug.

- ~~**Price tiers are worth up to three times the company, and are never
  wrong.**~~ **Withdrawn — the measurement was wrong.** It compared *one* tier
  setting, each segment at its own reference price, which is the best setting
  there is, against a single list price. That asks whether a well-set lever
  beats not using it, which is true of every lever in the game.

  Swept across settings, tiers behave like the price they are. Every market has
  an interior best and both ends are punished: undercutting every segment is
  worse than one list price in four of the seven markets (restaurant chain
  606,622 → 527,817, construction 230,040 → 109,806, project management 540,474
  → 394,084, MMOs 135,324 → 94,637), and pricing every segment at 2.2× what it
  expects takes three of them to nothing. Leakage was already modelled —
  `TIER_LEAK`, and a premium tier set far above the rest is partly a price
  nobody pays. The lever meets the standard; the test did not.

**Things that look dead and are not.** Several levers moved nothing in the
sweep because their preconditions were absent, not because they are broken:
`referralSpend` does nothing below quality 40 by design; `techDebtPaydown` has
nothing to pay down at zero debt; `recruitingSpend` and `trainingSpend` need
staff; `featureMode` needs a `featureBet`; `engineerPay` and `factorPct` need
headcount and receivables. Worth re-checking any of them in a run where the
precondition holds before concluding anything.

**What this harness cannot see.** Insurance and the shock levers were measured
with `withoutEvent`, so they read as pure cost — they cannot be judged this
way. Bids go through `sim-market-routes.ts` rather than through `resolveYear`,
so the auction is untouched by any of this and still wants its own sitting.

### What the copy promised and the code did not, 29 Sept 2026

A third pass, looking for fields that are written and never read, and for moves
whose notes describe something the code does not do. Two of the four recovery
moves were lying to the player — the escape route from a bankruptcy that had
just been given teeth.

12. ~~Rescue funding was free.~~ **Done.** The move hands over £1.5m or more,
    clears the bankruptcy, and costs three points of reputation. Its note has
    always said "for a third of the company", and `founderShare` was never
    touched — not by the move, not by the caller in `simulation-tick.ts`. Free
    money in the one situation where money is worth most, while the game said
    in words that it had cost a third. The test that covered it asserted the
    *note* matched `/third of the company/i`. It now takes the third, floored
    at the same 5% an ordinary raise uses, and the note reports the real
    number.

13. ~~Restructuring promised a lower rate and never gave one.~~ **Done.**
    `restructure` sets `covenant.rateRelief = 0.03` and tells the player "the
    creditor agreed: a lower rate, and a cap on discretionary spending". The
    field was in the type, set by the move, rendered on the desk and built by
    three test files, and **read by no code anywhere** — `interestOn` never saw
    the covenant. So the move cost six reputation and a spending cap in
    exchange for nothing. The relief now applies while the covenant is in force
    and stops when it lifts; emergency debt is deliberately excluded, since a
    creditor restructuring the line is not also discounting the rescue that
    came before it.

14. ~~Bots opened in better regions than people.~~ **Done.** `openingRegion`
    gives a person the cheapest region above a size floor — the same home every
    season, deliberately, so teams are comparable. For a bot it tossed a seeded
    coin and half the time took *the largest region it can afford*. Reach is a
    hard ceiling on the market a company can ever address, so that is a
    permanent head start no person can have:

        market            human home   bot average   ratio
        Podcasts               9.0%        19.4%      2.2x
        MMOs                   8.1%        17.1%      2.1x
        Drone delivery         9.9%        15.3%      1.5x
        (all seven markets)                          1.4-2.2x

    A player using a bot's own policy, decision for decision, finished fifth of
    five against four of them. With the size bias removed — the scatter kept,
    which was the stated purpose — bots average 0.9x to 1.2x the human home and
    that player finishes third. The test that pinned the old behaviour asserted
    the implementation; the `describe` above it and `openingRegion`'s own
    comment both state the purpose as scatter alone, and say "the point is not
    that bots play well".

**Open, and honestly unexplained.** A 3x gap remains between the best bot and a
player running a bot's identical policy. One attempt to isolate it — five
identical policies in one market — collapsed into everyone ending near zero,
which is a degenerate case and says nothing about the real one. It wants a
purpose-built experiment rather than a theory.

**Two veins now exhausted, for whoever looks next.** Every lever on every desk
is read by the engine (checked by walking `LEVER_FIELDS` against the engine
source). Every field written onto `Company` is read somewhere. The bugs in this
section were the last of the "set but never read" kind.

### Where a company opens decides its season, 29 Sept 2026

Chasing the unexplained gap between a bot and a player running a bot's own
policy. One company against the incumbents, identical policy, twenty-four
quarters, varying only the home region:

    home weight   cities opened   customers   founder value
       2.0%             1            11,635              0
       9.0%             5           216,100     11,205,776
      12.6%             9           569,691     35,718,881
      15.3%             9           526,937     32,550,485

That is the whole of the gap. It is not strategy and it is not the bots: a
company that opens in a small region never escapes it. Reach is a hard ceiling
on the market it can address, so a small home means small revenue, which means
it cannot afford to open anywhere else, which keeps it small. The one at 2.0%
opened a single region in twenty-four quarters and finished worth nothing —
and it could afford to expand at period four and the bot logic never tried.

A person is protected from the worst of this: `openingRegion` gives them the
cheapest region that is *still a real place to sell* (`weight >= 0.08`), so a
human is never handed the 2.0% death sentence. Bots have no such floor.

**Two things worth someone's time, neither of them a one-line fix:**

15. **Bots never expand.** `bots.ts` files an empty `expand` every period
    (`if (field.id === "programme" || field.id === "expand") draft[field.id] = ""`)
    and deletes `expandVote`, so a bot never puts a region up and never votes
    on a person's. Bot-run companies grow only through `targetCities`. A bot
    that lands somewhere small therefore has no way out at all, which is why
    the 2.0% company above sat on one region for six years with the money to
    leave.

16. **`targetCities` bypasses the expansion mechanic entirely.** There are two
    doors into a new region, and the designed one is worse on five axes out of
    six:

        | | targetCities (cmo) | expand (coo) |
        |---|---|---|
        | available | period 1 | year 4 |
        | which region | any | the one announced |
        | agreement | none | a majority of the table |
        | opens | immediately | next year |
        | first-year reach | full | brand / 60, floored at 15% |
        | cost | 100% | 70% |

    The player guide teaches the ramp as a rule of the game — "a region opened
    this period is reached only as far as your brand carries" — and it is
    simply untrue for anybody who has found the marketing seat's lever. The
    announced region, the vote, the discount and the brand ramp are all
    bypassed by a lever available on day one.

    **Tried and reverted.** Applying the same ramp to a bought region is a
    four-line change and it costs the catalogue its balance: `balance.test.ts`
    went from two-plus teams finishing with a business to one. Those markets
    are tuned against regions being fully reached the period they are paid
    for. Making the rule consistent means re-tuning expansion economics, not
    adding a ramp, so it is written down here rather than half-done.

    There is a reading in which this is not a defect at all: full price for
    immediate full reach, against 70% for slow and announced. That reading
    does not survive the other four axes — year four, one region, a vote, and
    a year's delay is a lot to pay for 30% off.

17. ~~Bots opened where no company could build a business.~~ **Done.** A person
    is given the cheapest region that is still a real place to sell — the
    cheapest above `VIABLE_WEIGHT`, which is 8% of the market. Bots scattered
    across everything they could afford with no such floor, so **46% to 67% of
    them, depending on the market, opened somewhere they could never grow
    from**: one region for twenty-four quarters, 11,635 customers, a company
    worth nothing. Half a field of corpses is not a field.

    They now scatter across the viable regions only. Five bots run through a
    full season, identical policy:

        before                          after
        edinburgh  2.0%  1 region   0   manchester 15.3%  9 regions  11.2m
        leeds      9.0%  5 regions 11.2m  leeds      9.0%  5 regions  12.7m
        glasgow   12.6%  9 regions 35.7m  birmingham 13.5%  6 regions  12.4m
                                          glasgow   12.6%  8 regions   9.1m
                                          leeds      9.0%  5 regions   6.2m

    The second column is the more interesting one: founder value is no longer
    monotonic in the size of the home. The bot opening at 9.0% finishes ahead
    of the one at 15.3%. What looked like "where a company opens decides its
    season" was really "opening below the viability floor decides its season";
    above the floor, the decisions decide it.

    The cost, stated plainly: bots now average 1.3x to 1.7x the human home,
    because a person takes the *cheapest* viable region and any scatter across
    the band sits above the bottom of it. That is a difficulty setting rather
    than an unfairness — a bot follows a fixed, middling policy all season and
    a person can play — and it is a different thing from what was removed
    earlier, which handed a bot the *best* region as a rule. The guard in
    `season.test.ts` now asserts the absence of that rule rather than a ratio.

### From playing two seasons by hand, 30 Sept 2026

Two custom markets built from scratch and played period by period, with a
handful of deliberate mistakes to see whether the engine punishes them. An AI
meeting-notes tool at scale 0.01 (opening bank $47,773) and a consumer
rent-splitting app at scale 0.09 (opening bank $228,404).

18. ~~A region could be opened with money the company did not have.~~ **Done.**
    Opening one is charged in full in the period it happens, and it was the
    only purchase in the game with no affordability check — every other line is
    cut to what the company can pay, including a feature bet, which is counted
    for exactly this reason. Played out: a company holding $88,915 ticked four
    regions costing $149,000, opened all four, finished the quarter on nothing
    and carried $43,290 of debt it had never agreed to take. `affordableCities`
    now takes the ones the money reaches, cheapest first, and says which stayed
    closed.

19. ~~An annual interest rate reported as a quarterly one.~~ **Done.**
    `inPeriodWords` rewrote every "a year" so a note written for a yearly
    season reads right in a quarterly one — including the "a year" inside "at
    30.1% a year". A company that ran out of money was told its emergency loan
    cost 30.1% *a quarter*: four times the real rate, twelve times in a monthly
    season. Anything with a percentage in front of it is left alone now.

**Open, and measured:**

- **Entry costs do not count against the spending budget.** They are real money
  leaving in that period and they belong in `fundYear`'s `wanted` beside the
  feature bet. Putting them there narrows the gap between a table that plays
  well and one that does not by about half — `balance.test.ts` measures a
  survivor beating a filler by 13 points and it drops to 6 — because those
  markets are tuned against expansion being free of the budget. Trimming to
  what is affordable (above) fixes the defect that was actually observed;
  charging it against the purse is the larger, separate job.

- **Borrowing destroys a small company's score instantly.** `valuation` is
  `revenue × 1.2 + assets − debt`, so at 64 customers paying $36 a year that is
  $2,765 against a $6,000 loan — 38% of the credit line — and the company is
  worth nothing from then until the debt is repaid. Cash is not a term either,
  so $5,762 in the bank counts for zero. A going concern with customers,
  quality and money reads as worthless on the board the seasons rank on.

- **Quality barely moves at startup scale.** Two quarters and $4,200 of feature
  spend took quality from 37 to 37: it ships at about a point a quarter against
  0.55 of decay. Sixteen quarters of near-continuous investment reached 61,
  while the market leader opened at 74.

- **A price round-trip is nearly free.** Cutting $11 to $4 cost a quarter's
  revenue and bought 4% more customers — correctly punished. Putting it
  straight back to $11, a 175% rise, cost almost nothing and the company
  finished the quarter with *more* customers than before the experiment. The
  `resented` cap of 0.2 is deliberate, so this is a judgement rather than a
  bug, but it means price can be searched by trial with no memory.

- **The engine writes £ in a game denominated in $.** "Cleaning it up cost £11",
  from the breach note.

**Three things worked exactly as intended**, which is worth recording as well:
building for 3,000 seats when 87 customers were in sight bled about $8,900 a
quarter and was reversible in one decision; pricing at $150 against a $42
reference took 64 customers to 11 in a quarter and *lowered* revenue; and
hiring forty people flipped +$18,112 to −$45,932 and was equally reversible.

Not tested, and worth its own sitting: multiplayer, bots as rivals, the
auction, and mergers. This was one founder against the market.

## The half of this file that runs

`test/unit/known-imbalances.test.ts` states the properties the sections above
say are missing, as `it.fails` tests. Each carries its measurement in a comment
and fails on the assertion — none of them are skipped, and none pass by
throwing.

The point of writing them that way: fix one of these and **its test starts
failing**, because a `.fails` test that passes is a failure. That is the alarm
telling you what you changed. Drop the `.fails` and the assertion becomes an
ordinary guard against the bug returning.

What is in there now:

  - an annual discount that is the right call in every market at every level
  - price tiers that are never the wrong call
  - a bot that never proposes a region in a whole season
  - a region bought outright reaching further than one opened as announced

One has already come out of that file, which is the cycle working: bots opening
below the floor a person is given. See below.

Anything measured and deliberately left should go in there as well as here, so
that the backlog cannot quietly stop being true.

## Built, so nobody rebuilds it

- Every seat's decisions, arriving over the first five years of a season
  (`shared/simulation/responsibilities.ts`).
- Regions, the plant and the balance sheet — the "depth" phase.
- Bots that make each standing call on a seeded coin, differently per company
  and per year, and never past a purse they can pay from.
- Bidding is the chief executive's; the table watches.
- The Past tab keeps what every seat filed, the year's auctions, and where
  every company stands.
- The world: seven continents, forty regions, real populations and incomes,
  guarded and closed markets (`shared/simulation/geography.ts`).
- A company season can choose its scope (one country, one continent, the whole
  world) and seat up to fifty companies of bots.
- Two seats, priced apart and held apart. A `play` seat is $3 — a person at a
  table in one of the markets we wrote. A `nova` seat is $5 — a person at a
  table in a season Nova built from the company's own project. Neither
  substitutes for the other.
- The gate is at the start line, against the people who actually sat down, not
  against company headcount and not at creation: a company of forty never pays
  for a season five of them play, and bots are not charged for. Creating a
  season is free; Nova's build asks for one Nova seat up front because it costs
  a model call.
- The web market can withdraw a listing, which only the phone could do. Every
  refusal on that screen and on the desk now says "that year just closed" and
  refetches when the tick catches somebody mid-action, instead of going red
  about a failure that did not happen (`isYearClosing`).
- Coming back from paying for seats says so, once, and then takes it out of
  the address so a reload does not congratulate somebody twice.
- A failing Ten Years valuation backs off and stops after eight attempts. It
  used to ask once a minute for a day, which is 1,440 model calls for one
  game, and the count lives on the row so a restart does not hand it a fresh
  budget.
- `sim_ventures.state` is gone. It was written every tick — a whole engine
  Company per venture — and read by nothing; the season's world was always the
  source. `Company.teamId` went with it.
- Bot companies spend against what the market can return rather than against
  their bank balance, and keep selling through a bad year instead of going
  quiet. Every company starts with the same cash in every market and what
  that cash can earn varies fourfold, so a bot anchored to its balance spent
  like a dating app in a market returning a fifth as much. Measured over 168
  seasons, survival went from 107 to 114 and the median company ended with
  two to twelve times more cash in every market — bot rivals are opponents
  now rather than corpses.
- Opening the announced region is the whole table's: operations puts it up,
  which is its vote for, the other four vote, and a majority of the votes cast
  carries it — a tie or silence leaves the region shut (`expansionOutcome` in
  `shared/simulation/world.ts`). The desk shows every seat's face against what
  they voted, counted by the server so the screen and the engine cannot
  disagree.

## Years, quarters and months

A season has always been fourteen years, one decision each. That is the right
rhythm for learning what the levers do and it is not how anybody runs a
business: real operators decide quarterly at worst, and "we saw it in March
and moved" is a skill an annual season cannot teach.

A season now carries a cadence — yearly, quarterly or monthly — chosen when it
is created and refused rather than quietly downgraded if it is not one of the
three. Somebody who asked for a monthly season and got a yearly one has been
sold the wrong thing.

Priced as its own seat, because it is more of the product for the same people:
**$6 a seat quarterly, $10 monthly**, against $3 for a season from our markets
and $5 for one Nova writes. The cadence outranks the origin — a monthly season
is a monthly season whether Nova wrote the market or we did, and it is the
dearer thing. `SIM_DEV_FREE_SEATS=1` lets a developer start one without
paying, local only and never production, mirroring `devAdvanceOn` and logging
loudly so a season started that way is never mistaken for one somebody bought.

### The rule the arithmetic rests on

Divide the flows, keep the stocks.

A **flow** is a quantity per unit of time: salaries, interest, marketing
spend, revenue, and the thresholds those are measured against. Ask a table
four times a year and each answer covers a quarter, so each is a quarter of
the size — *including* the thresholds, or a lever costing £220,000 a year
would cost £880,000 a year in a quarterly season and every quarterly season
would be unplayable.

A **stock** is a quantity at a moment: cash, customers, capacity, brand,
quality, headcount. Those do not care how often anybody is asked.

Two places it is tempting to be lazy, both tested. **Growth compounds rather
than divides** — 8% a year is 1.94% a quarter, not 2%, which is nothing in one
period and material over fourteen years. And **a lag stays as long as it was**:
research that landed in two years still lands in two years, which is eight
quarters, not eight periods called years.

### The engine, converted

`resolveYear` is period-aware. `World.periodsPerYear` is 1, 4 or 12; the
engine derives `per = 1 / periodsPerYear` and every flow is multiplied by it
while every stock is left alone. At `per = 1` the arithmetic is exactly what
it always was, which is why all 1,440 tests passed unchanged.

What had to move, in the order the measurements found it:

- **Flows.** Fixed costs, interest, revenue, variable cost, idle cost, and
  both halves of every `lift` — threshold *and* ceiling, because `lift`
  saturates and scaling only the threshold buys the same fraction of the
  ceiling four times a year.
- **Lags.** `brandLanding`, `qualityLanding`, `staffing` and `capacityBuild`
  were scalar pipelines that emptied themselves every call, so a one-year lag
  became a one-*quarter* lag. Each now releases a period's share of what is
  waiting: same steady state, same annual throughput, exact at `per = 1`.
- **Lags measured in years.** A feature build, a region opening, a bond
  maturing, a distribution deal expiring and the niche head start are all
  multiplied by `periods`, because `world.year` now counts periods.
- **Growth.** `segmentDemand` compounds annual growth over the period
  (`(year - 1) / periods`) rather than applying it whole, four times.
- **Rates.** Churn was the clearest case: the comment says a third of a
  segment a year is the outer limit, and it was applying that per call.
  Breaches, outages, lawsuits and poaching are annual chances now too.
- **Unserved demand.** It arrives across the year instead of all on the first
  day, so a quarterly season does not take four successive bites at the same
  open pool.
- **The news.** `eventFor` is drawn once a year, on the last period of it and
  seeded on the year rather than the period. This was the single biggest
  distortion found: a monthly season met twelve scandals a year, and brand
  came out 126% above the yearly run almost entirely because of it.

Measured over one year of an identical plan, quarterly and monthly now land
within 0.7% of yearly on cash, exactly on capacity, and within a fifth on
brand. `test/unit/cadence.test.ts` holds that as a regression test.

### The clock, converted

`sim_seasons.year` counts **periods**. Everything that schedules one now goes
through two numbers that were previously the same number and are not:

- **Span** — how much simulated time the season covers, still in years
  (`totalYears`).
- **Period length** — how much *real* time one decision gets
  (`period_minutes`, renamed from `year_minutes` in `0066`; for a yearly
  season a period is a year, so every existing value keeps its meaning).

They are deliberately unhooked, because hooking them gives you either a
monthly season that runs 168 real days or one that demands a decision every
two hours. The default keeps the day people have learned and shortens the
span: `DEFAULT_YEARS` is 14 yearly, 4 quarterly, 1 monthly. Whoever creates
the season can override both — the bounds narrow with the cadence, because
the real rule is counted in decisions (`PERIODS_MIN` 4, `PERIODS_MAX` 24) and
not in years.

Fixed along the way, each of which was a genuine bug rather than a rename:

- `seasonOver(year + 1, season.totalYears)` compared a period count against a
  year count, so a four-year quarterly season would have ended three quarters
  into its first year.
- `economyFor` runs a nine-*year* business cycle off what is now a period
  counter — a monthly season would have gone through the whole cycle in nine
  months. It takes `periods` and reads the year back out.
- `season-control.ts` hard-coded `DAY_MS` when rewinding a season to force an
  early resolve, so a workshop on ten-minute periods had its start put in the
  wrong place and its next tick landed hours out. It uses `periodMsOf` now,
  which is the one place that answer lives.
- The company season form had no cadence selector at all — the cadence was
  reachable by API only. It now picks the cadence, the period length and the
  span, and the span narrows under the choice.

### News at three grains

A season that decides twelve times a year should not meet the same one event
twelve times. Each grain has its own catalogue, sized to it: yearly keeps the
structural news (regulation, a funding winter, a recall) **and its exact
existing array**, because `pick` chooses by index and appending to it would
silently change which event every running season meets. Quarterly and monthly
are new, separate, and smaller.

A market event writes its multipliers onto `World.weather` with the period
they expire, so a funding winter drawn in the first quarter is still cold in
the fourth rather than being one bad quarter out of four.

The result, over four simulated years: yearly meets 3 events, quarterly 3 + 12,
monthly 3 + 12 + 36. The first year has no news at any grain, as before.

### Four things only playing found

The unit tests and the one-year invariant were green while all four of these
were live. They only showed up when a survivor-skill table actually played a
season at each cadence and the output was read as a business.

- **A new company could not get in at quarterly or monthly.** It won 1,970
  customers in its first quarter against 60,480 in a yearly season's first
  year. The winnings from the pool scaled perfectly — 5,292 against 1,323,
  exactly a quarter — but a newcomer's first customers do not come from
  winning: they come from incumbents winning more than they can serve and the
  overflow spilling to whoever has room. Rationing the *standing unserved
  pool* by period meant the incumbents were never saturated, so nothing ever
  spilled. Unserved people are a stock, not a flow; they are not rationed now.
  Churn is the flow that refills the market, and churn is scaled.
- **Bot rivals spent a year's budget every period.** A bot's budget is a share
  of cash plus turnover, filed per decision, so a monthly season's bots spent
  twelve years of money a year and the humans played against a market of
  corpses. `botDecision` takes `periods`.
- **Service ran away.** One `lift` — the service one — was never scaled, so a
  quarter's support spend was weighed against a year's threshold and bought a
  year's ceiling. Quarterly seasons reached service 75–79 where yearly reached
  59–64. There are no unscaled `lift` calls left in `resolve.ts`.
- **Staff were worth a year of support every period**, for the same reason:
  `supportEquivalent` is an annual salary figure added to a per-period budget.

The forecast (`projected` in `forecast.ts`) was annual throughout and is now
period-aware too — otherwise a quarterly table was shown a projection
promising a year's brand for a quarter's spend.

### Seven more, found by playing each cadence to six years

The first four were found in a single season. These needed the *same* business
played to the same simulated year at all three cadences and the columns put
side by side — at which point monthly's quality went 38 → 33 → 26 → 5 while
yearly's went 35 → 54 → 89 on identical decisions.

Every one is the same mistake in a different costume: **a standing condition,
or a stock's own decay, written as a yearly figure and then applied once per
decision.**

- **`sourcing.quality: -3`** — outsourcing makes the product a few points
  worse for as long as it is outsourced. Applied per period that is −36 a
  year at monthly. This was the quality collapse.
- **`programmeYield`** paid a programme out over three *calls* against a
  window of three, so a monthly season got three years of a programme's
  benefit in three months and then nothing.
- **`sourcing.unitCost`, `auto.unitCost`, `focus.cost`** — three standing
  multipliers applied to the stored unit cost every period. Outsourcing at
  1.09 a year compounded to 2.8x a year at monthly; by year six the company
  was charging eight times its opening price just to stay level. They are
  raised to the power of `per` now, because that is what a multiplier's
  period-share is.
- **`securityNext` / `dataNext`** kept a fifth of their level per *call*.
  `0.8¹²` is 0.07, so a monthly season's security and data went to nothing
  however much was spent on them.
- **The review scar and the second shift's toll** on service, same shape.
- **`isUnlocked`** gated levers on `year >= 2` while `year` counts periods, so
  a quarterly season handed a table every lever in the game inside nine months
  and a monthly one inside three. That is not a faster game, it is the
  teaching order thrown away — and it is the single most player-visible thing
  in this list.
- **The monthly default span was one year**, which is shorter than every lag
  in the game. Twelve decisions, none of which ever paid off; a table that did
  everything right finished on brand 16. The default is two years now, and
  `cadence.test.ts` asserts no default is ever below two.

### The late game had nothing in it

Playing a full fourteen years showed the other half of what was wrong, and it
had nothing to do with cadence: **a competent table pinned quality at 100 by
year eight and brand and service by year twelve.** The last third of the
flagship season was cash piling up against stats that could not move.

The cause was that decay was a flat 4.5 points a year at every level while
gains kept coming, so once a company's gains cleared the rate it climbed to
the ceiling and parked. Two changes, and the measurement demanded both:

- **Decay is proportional to level**, measured against fifty — a company in
  the middle of the scale pays exactly what it always paid, and one at
  ninety-five pays nearly twice.
- **Gains meet headroom above the midpoint.** Decay alone was not enough and
  the numbers said so: a good table gains about twenty-one points of brand a
  year against a decay that now reaches nine, and still climbed. Below fifty
  nothing changes at all, so the whole early game is untouched; above it each
  point costs more than the last.

The season now moves both ways — brand *falls* between years eight and ten on
a plan that used to climb — and the markets differentiate instead of all
arriving at 100: drone delivery ends on quality 76, construction 68, project
management software 96.

### How it plays now

A survivor-skill table in all seven markets, at each cadence's own default
span, all solvent and none pinned:

```
yearly, 14y     cash £29.6m–£171m   brand 93–97  quality 68–96  service 56–67
quarterly, 4y   cash £2.3m–£8.0m    brand 43–72  quality 42–67  service 52–56
monthly, 2y     cash £4.1m–£6.8m    brand 22–27  quality 34–44  service 50–51
```

The finer cadences end lower because they cover fewer simulated years, which
is the trade the span defaults make. What they buy is responsiveness: on an
identical first year, quarterly finishes with 8% more customers and monthly
16% more, for the same cash to within 0.2%.

Played to the *same* six simulated years, the three now track each other
rather than diverging — quarterly and monthly both end ahead of yearly on
customers and behind on quality, which is the honest shape of deciding more
often with the same lags.

### What 336 seasons say

A survivor-skill table, twelve seeds per market per cadence, at each cadence's
default span. The seed changes the events, the incumbents' moves and every
jittered decision, so it is the closest thing to "a different table played
this market".

```
                 survived   ended richer   cash p10 / median / p90
yearly, 14y         87%          75%       varies by market (below)
quarterly, 4y      100%          29%
monthly, 2y        100%          26%
```

Per market at yearly, the spread is wide and the markets differ, which is what
you want:

```
Project management   92% survived   92% richer   £15.7m / £97.3m / £179.5m
MMOs                100%            83%           £5.6m / £81.1m / £122.9m
Podcasts            100%            75%           £0.3m / £56.3m /  £95.1m
Dating apps          83%            75%          -£0.1m / £80.6m / £146.7m
Restaurant chain     92%            67%           £1.2m / £33.8m /  £62.3m
Construction         83%            75%          -£0.5m / £37.9m /  £74.7m
Drone delivery       58%            58%          -£2.8m / £12.7m /  £36.4m
```

Three things that need a decision rather than a fix:

- **Skill barely matters.** The same 84 seasons played by the `filler` bot —
  the deliberately weak one — survived 88% and ended richer 68%, against the
  `survivor` bot's 87% and 75%. The difficulty tier built to play better is
  worth seven points of "ended richer" and *nothing* on survival. For a game
  whose purpose is teaching people how to enter a market and survive, that is
  the most important number in this document.
- **Nobody ever dies at quarterly or monthly.** 168 seasons, zero
  bankruptcies, and only a quarter of them end richer than they started. The
  finer cadences are currently "cannot lose, cannot win" — flat and safe —
  where the yearly game has a real 13% failure rate and a real spread.
- **Drone delivery is the one market that fails**, at 58%, and it fails for
  both skill levels equally.

### Making skill matter

The measurement above said the difficulty tier was worth nothing. Finding out
why took three experiments, and the first two answers were both wrong.

**A lever sensitivity sweep** — one fixed plan over ten years, one lever moved
at a time — gave the shape of it. With capacity following demand, *every*
investment lever had a negative return: no brand spend beat the baseline by
14%, no product spend by 21%, and filing nothing at all on every lever beat a
balanced plan by 12%. With capacity generous, the same levers turned positive:
five times the product budget was worth 46%, and filing nothing died 5 seasons
out of 5.

So the levers were never broken. **A company at 85% of its plant cannot use
another customer**, so money put into being more appealing buys demand it then
turns away — and both bots ran at 82–89% utilisation, because `botCapacity`
did not take the skill at all. Both were equally boxed in, so the one that
spent more simply wasted more.

Two changes, and a third that was measured and thrown away:

- **`priceLicence` (market.ts).** A segment's `referencePrice` is what it
  expects to pay for the ordinary thing, and every company was judged against
  it — so a company with quality 90 was punished for charging more than one
  with quality 30, and the only thing being good ever bought was volume. A
  company can now charge up to 18% over the reference, earned from the axes
  the segment actually cares about. Not more: at 25% the premium play won all
  seven markets and `balance.test.ts` caught it.
- **`botCapacity` takes the skill.** A survivor keeps about a third more room
  than it is using and does not wait until it is full to build, because room
  ordered now opens a year from now. On a fixed plan over ten years, room
  built generously returned £32.1m against £13.1m for room that followed
  demand — the same money, more than twice the company.
- **Letting a survivor spend like an operator was tried and reverted.** Raising
  its share of gross from 5% to 18% made it visibly better at running a
  company — brand 94 against 85, quality 93 against 89 — and worse at owning
  one: median cash fell from £70m to £33m and it began dying *more* often than
  the weak bot. The note in `bots.ts` keeps the finding where the next person
  to have the idea will read it.

Lowering the switching tolerance so a better offer pulls customers harder was
also tried. It moves the number but breaks four guard tests at once, and it is
the single deepest knob in the market — it wants its own pass, not a
drive-by.

### What it bought

```
              survivor              filler            gap
yearly        90% / 82% richer      87% / 69%         +13
quarterly    100% / 30% richer     100% / 19%         +11
monthly      100% / 25% richer     100% /  6%         +19
```

Monthly shows it most sharply — four times as many good seasons as bad play
gets — which is the right shape, because deciding twelve times a year is worth
most to somebody who knows what to do with the decisions.

`balance.test.ts` now holds this as a guard: a survivor must end richer than a
filler by more than ten points across sixteen seasons a side. It was the
absence of that test that let the tier be worth nothing for as long as it was.

### A pain-point sweep, and what it caught

Every market at every cadence, three seeds each, with a detector that flags
anything that looks wrong rather than anything that looks right: non-finite
numbers, fractional people, negative anything, markets holding more customers
than they have, costs that dwarf revenue, stats pinned at the ceiling, and
prose that names the wrong unit of time.

Four things fixed:

- **2,918 notes said "year" inside a quarterly or monthly season.** A monthly
  table read "The year was run for growth" twelve times a year. Fixed with
  `inPeriodWords` in `cadence.ts`, applied once where the report is assembled
  rather than at twenty-nine call sites.

  It is deliberately narrow. "Next year" is left alone, because the lags
  really *are* a year — room ordered now opens a year from now however often
  the table meets, and a new hire is useful in their second year. Rewriting
  "it opens next year" to "next month" would be a lie. Only the phrases that
  mean *the span just decided* are touched, and at yearly cadence the function
  returns the string it was given.
- **Fractional customers.** A report could say 14,353.5 people. My own
  `capacityBuild` change had made capacity fractional (`current + gap × per`),
  which flowed into the spill pass and out the other side as a fraction of a
  person. Rounded at source, and then guaranteed once more where customers
  become the company's, so no future pass can reintroduce it.
- **Drone delivery started every company underwater.** Starting capacity is
  the smaller of a tenth of the home region and £9m of revenue, and in a
  market where the cheap segment is most of the people the region term binds
  first: room for 38,214 customers at £25 is £955,000 of possible revenue
  against a £1.4m salary base. It lost money in year one whatever anybody
  decided. There is a floor now — a company that fills its plant can at least
  pay the five people running it, with half as much again on top. Year one
  goes from −£136k to +£522k, and the median season from £12.7m to £32.2m.
- **A flaky test.** `data-shape.test.ts > secret box` fails in the full suite
  and passes in isolation. Not mine, not investigated, worth knowing.

What the sweep says is still wrong is in the sections above and below: the
market over-service (454 flags, every one of them real) and three cases of
brand still reaching 100.

### Why the easy markets will not die, and what actually controls it

The target is about six failures in twenty. Podcasts, project management and
MMOs were at zero. Six levers were tried against that, each measured over 140
seasons, and five of them did nothing:

```
lever                          average deaths / 20
baseline                              2.0
incumbents vary by season             2.1   ← kept
starting cash × 0.62–1.12             2.1   (breaks pinned tests)
starting cash × 0.32                  2.6   (a third of the runway, +0.6 deaths)
leave-rate cap 0.35 → 0.65            2.0   (no change at all; broke 11 tests)
opening plant sized to a safety band  2.4   (broke 9 tests)
idle plant 0.08 → 0.30                2.6   (drone 10/20, but at a year-4 cliff)
contribution margin 91% → 62%         2.3
```

The last one is the most interesting failure. Survival correlates almost
perfectly with contribution margin — MMOs at 91% never died, drone at 60% died
eight times in twenty — so tightening every market to ~62% looked certain to
work. It moved the average by 0.3. **Margin predicts survival without causing
it.**

What the measurements do establish:

- **A profitable company is never in danger.** Every death in 140 seasons was
  a company that failed to get traction early and then took until year 8 to
  burn its bank. Nothing in the game can take down a business that is working,
  which is why nothing that squeezes a working business changes the count.
- **Break-even is at about a sixth of the plant.** Full-plant gross runs
  £1.5–2.4m against a £0.32m cost base, so a company only has to fill 16% of
  what it built to cover its costs. That is the number that makes failure
  nearly impossible, and it is upstream of every lever above.
- **What is special about drone delivery is its customers, not its economics.**
  Its opening price targets the cheapest of its three segments — novelty
  orderers, price sensitivity 0.75, loyalty 0.12 — so a company there serves
  people who are cheap to win and leave immediately. MMOs and project
  management open onto loyal, valuable customers. That is market content, not
  a constant.

So reaching six in twenty means one of two deliberate decisions, both of which
are bigger than a knob:

1. **Raise the cost base** so break-even needs half a plant rather than a
   sixth. This is the honest fix and it would make every other lever start
   working, because a company that dips would actually be in trouble. It also
   re-tunes every market at once and will break the guard tests that pin the
   current economics — those tests are asserting today's balance, so they
   would need re-setting against the new one rather than being worked around.
2. **Give the soft markets harder customers** — a cheaper, more fickle opening
   segment, the way drone delivery has one. Narrower, safer, per-market, and
   it keeps the markets feeling different from each other instead of
   flattening them.

**Kept from this round:** incumbents now vary by season (±5 points on each
axis, ±16% of share), so entering a market means finding out what is already
in it rather than meeting the same four companies at the same strength every
time. Tried at ±10 and ±7 and both dropped a competent team below the 5% share
floor in MMOs, which is the guard doing its job.

**Reverted:** the per-season opening climate (it breaks tests that pin a
company's opening to exactly £6m, and bought 0.1 deaths), the opening safety
band, the leave-rate cap, the idle-cost rise, and the margin change — that last
one because reshaping what all seven markets *are* is a decision worth making
deliberately, not a side effect of a failed experiment.

### Why 6/20 has not landed: every route breaks something else

The plan was overhead first, then harder opening segments, then re-set the
guards. It was followed, and it produced a genuinely useful negative result
instead of the number. Recorded here so nobody spends another day on it.

**A cost base charged on the plant kills the volume strategies.** An overhead
proportional to capacity hits exactly the plays that build capacity. Measured
in dating apps at 0.35, against the same four synthetic strategies the guard
tests use:

```
                grower   premium   cheap   local
no overhead        7.8      11.9     4.2     9.6
capacity 0.35      0.4      11.9     0.4     9.5
```

Growing and competing on price both fell by a factor of twenty. The market
still had a door, but only two ways through it.

**A flat cost base kills the margin strategies.** The obvious alternative —
charge for running a company rather than for its room — has the mirror
problem, because a low-volume high-price play cannot cover a large fixed cost:

```
                grower   premium   cheap   local
no increase        7.8      11.9     4.2     9.6
running × 1.6      0.3       0.1     0.4    10.3
running × 3.4      0.1       0.1     0.3     0.2   (deaths 8.3/20)
```

At 3.4 the failure rate finally passes six in twenty and *nothing works at
all* — 0.28% of the market to the best of four strategies.

So the two shapes of cost pressure fail in opposite directions, and neither is
a tuning problem. The reason is structural: **the strategies are fixed plans.**
They file the same decisions for fourteen years regardless of what anything
costs. A real table — and the bots — would respond to a changed cost base by
changing the plan; a fixture cannot. Until the strategies and the bots adapt
to the cost base, raising it will always look like the game breaking.

**MMOs is separately broken, and was before any of this.** At zero overhead
its best strategy reaches 5.20% revenue share against a 5% floor, held up
entirely by the cheap play; premium gets 0.1% and growing gets 0.0%. It has
been sitting two tenths of a point above its own guard, so any change at all
tips it over. Its incumbents are much stronger than any other market's
(quality 78 and 88, brand 89) while its margin is 91%, which makes it
simultaneously the hardest market to win share in and the only one where a
company cannot fail.

Softening those incumbents was tried. It fixes the share and breaks the skill
guard — weaker rivals mean weak play succeeds too, and the survivor's margin
over the filler fell below ten points. Reverted.

### What would actually work, in order

1. **Make the bots and the strategy fixtures cost-aware** before touching the
   cost base again. This is the blocker, not the constants.
2. **Rebuild MMOs' market content** — it needs incumbents that are beatable by
   more than one strategy *and* a margin that makes coasting unsafe. Both at
   once, measured against the skill guard, not one and then the other.
3. **Then** raise the cost base, with the guards re-set against the new
   economics afterwards.

### The cost base is the lever, and it is written but not wired in

Of everything tried, one thing moves the failure rate: **what it costs to keep
a plant ready, full or not.** `plantOverhead` in `decisions.ts` charges a
share of what a full plant earns at the market's own reference price.

```
PLANT_OVERHEAD    average deaths / 20
    none (today)          2.0
    0.34                  3.7
    0.45                  5.1
    0.55                  6.0   ← the target, exactly
```

At 0.55 every market kills somebody and the spread is right: drone 10/20,
project management 7, podcasts 6, restaurant 6, construction 6, dating apps 5.
MMOs is the last hold-out at 2.

**It is deliberately not wired in.** At that strength it does not only kill
weak companies, it suppresses strong ones: a competent team's share in MMOs
falls from 5% to 2.4%, a good plan stops growing before the season ends, and
fourteen guard tests fail — two of them guarding principles rather than
thresholds. That is the difference between a balance that needs re-calibrating
and one that is wrong, and the second is not worth shipping to hit a number.

One real flaw was found and is worth knowing separately: **incumbents have
never paid `fixedCosts` at all.** They run on a simplified model. That was
ignorable while the cost base was £320,000; at £1.2m it is a tax on being the
newcomer rather than a harder game. Charging them symmetrically did not on its
own fix the share collapse, so there is more to it.

The route from here, in order:

1. Overhead at ~0.35 rather than 0.55 — enough to make a bad year matter,
   not enough to flatten everybody.
2. The second half of the plan: harder opening segments in podcasts, project
   management and MMOs. Drone delivery is hard because its opening price
   targets novelty orderers — price sensitivity 0.75, loyalty 0.12, cheap to
   win and gone immediately. The soft markets open onto loyal, valuable
   customers and that is the whole difference.
3. Incumbents charged for their plants too.
4. The guard tests re-set against the new economics **afterwards**, and never
   to turn a red suite green.

### Drone delivery is not a cliff, it is a slow starve

Deaths do not happen where the intuition puts them. Across 140 seasons, *every
single death was in year 8 or later*, and drone delivery's clustered at
exactly year 8 — which looks like a scheduled event and is not one.

```
Dating apps        3/20 died   years 8, 8, 10
Drone delivery     6/20        years 8, 8, 8, 8, 10, 10
Podcasts           0/20
Project management 0/20
MMOs               0/20
```

Tracing one: the company reaches year 3 with 3,400 customers against 70,000 of
capacity, never finds traction, and bleeds. Year 8 is simply how long £6m
takes to burn at that rate. The bankruptcy is the end of the story rather than
the story.

So the real question is not "why do they die in year 8" but **why do some
seeds never get traction at all in drone delivery when podcasts, project
management and MMOs never fail once in twenty**. That is a market-content
question — the opening region, the incumbents' strength, the segment mix — and
it is the one remaining thing standing between this and a balanced set.

### A market can hold more customers than it has people — fixed

Two things were wrong and both are now right.

**Every leaver was counted twice.** `alreadyHeld` is measured after churn, so
the people who just left were in the open pool once as "not held any more" and
again as `poolForNewcomers`. `alreadyHeld + upForGrabs` therefore exceeded the
segment's population by the churn, every period, for ever.

**And a shrinking segment took nobody with it.** Holdings only grew: when the
number of people in a segment fell — the economy turns, the growth rates
differ — nothing gave.

```
            before            after
year  demand      held    ratio   held    ratio
   3  6,883,269  7,154,827  1.04   6,883,261  1.00
   6  6,552,711  7,586,738  1.16   6,552,701  1.00
  12  5,963,009  9,277,942  1.56   5,962,995  1.00
```

A segment now adds up to the people in it, to within rounding, in every year
of every market. Revenue, cash and the value a season is ranked on were all
inflated by up to half and are not any more.

A shrinking market is a real movement, so it gets its own line in the year-end
report — `leftMarket`, beside `lostTo` and `turnedAway`. "We lost four
thousand people and nobody took them" is a different sentence from losing them
to a rival, and a team that reads the second when the first is true goes and
fixes a price that was never the problem.

**It cured MMOs.** The market that could not be played — best strategy 5.20%
revenue share against a 5% floor, held up by one strategy — reaches 10.8%
once the arithmetic closes. It was choked by a market holding half again as
many customers as it had people.

`cheap` went from 0.2–0.4% of a market to 5–19%: the whole strategy was being
starved by the same bug.

### An optimiser, and the four objectives that were wrong

`shared/simulation/optimiser.ts`. Every bot until now decided one seat at a
time — `botDecision` is called once per role, with that role's levers and no
idea what the other four are doing — so five seats spent against the same cash
and none of them knew. This one solves the whole company at once: one budget,
one objective, every lever competing for the same pound, allocated a slice at
a time to whichever returns most at the margin. Because every lever in the
engine saturates, that produces the ramp a good operator has, with brand,
product and service rising together.

Getting the objective right took four tries, and each failure says something
about the game:

| objective | what it did |
|---|---|
| money | raised price ~1.5× a year, compounding to **290×** over fourteen; served 174k where the ordinary bot served 1.4m; £1.9bn, brand 30, **quality 4** |
| this year's forecast | spent **nothing** on product — and was right to, since `projected` leaves this year's shipping out because it lands next year — finishing on quality 5 |
| next year's forecast | spent to exactly the solvency constraint, every year ending on nothing: **52% survival** |
| + a year's reserve | survived more, ended poor: 62% survival, **10%** of seasons richer |
| + money in the score | 62% / 62% |

The first is the most useful finding on its own: an unconstrained optimiser
**proves** this engine still rewards gouging, and it found it in one pass.
Price is now anchored to the segment's own reference rather than to last
year's price, which makes the compounding inexpressible.

### Breadth was the real gap, and horizon was hiding inside it

Measuring what each tier actually *files* was more useful than measuring what
it achieves:

```
Levers the game offers:  72
optimal   touches  9  (13%)   →  16  (22%) after this work
survivor  touches 40  (56%)
Neither ever touched:    31
```

The optimiser was out-searching the survivor on a narrow slice and losing on
the whole game. Among the 31 neither had ever touched: **the entire finance
seat** — borrow, repay, raise, dividends, factoring, refinancing, buyback,
cost review — and **every expansion lever**. No bot in this codebase had ever
opened a second region, in any season, so companies spent fourteen years
selling into a tenth of a market. One of five seats was unexercised by any
simulation, which means every balance number in this document was produced by
tables that never borrowed a pound or entered a second market.

It now borrows and expands. Expansion is the interesting one: it takes a
majority of the five seats, so it is the one decision an optimiser can express
and five independent per-role bots structurally *cannot*.

**Breadth and horizon turned out to be the same problem.** Adding the levers
was not enough — the optimiser still refused to expand, and it was right to.
A region committed this year opens *next* year, so at the moment the next-year
forecast is taken it is an entry cost and nothing else; a one-year objective
prices it at exactly its cost. It only started expanding once the objective
credited a region that is about to open, at what it will reach when it gets
there. The levers it was missing were precisely the long-payback ones, and no
amount of widening the search reaches them without widening the horizon too.

### Cash is not the score, and measuring it that way hid two things

A weak bot appearing to end "richer" than it started, as often as a good one,
turned out to be half a measurement problem and half a real one.

**The measurement.** "Ended richer" was cash above the opening £6m, and cash is
deliberately *not* what a season ranks founders on. `valueOf` in `resolve.ts`
is: a year of what the customers pay, plus what the company owns, less what it
owes. Scored that way, over 56 seasons a side:

```
mode        median value   median cash   customers   survived
idle               £0.0m        £2.5m       1,682        55%
filler            £15.2m       £12.8m     308,232        86%
survivor          £17.1m       £21.4m     419,505        86%
optimal           £10.4m        £7.8m     176,099        91%
```

A table that never files anything ends **worthless** and dies in 45% of
seasons. The model does punish doing nothing; measuring it in cash did not
show that, because a company can bank its opening endowment while its business
rots — profitable for eight years on a position it never earned.

**And the real one.** Filler at £15.2m against survivor's £17.1m is a 12% gap
for the difference between playing badly and playing well. That is too close,
and it is the same finding as ever: this engine rewards spending weakly, so
the bot that spends least is never far behind.

**The optimiser was optimising the wrong thing.** It banked the most cash of
any tier (£30.3m at one point, against the ordinary bot's £18.8m) on half the
customers, and came *last* on the measure the game actually uses. It was
liquidating: a pound not spent scored a pound, and a pound spent had to earn
its way back. It now scores on the engine's own `value`, which moved it from
£9.6m to £12.5m on the same seeds — and it is still behind both bots on value
while surviving more than either. Cautious, not optimal.

### Three instruments tried against "doing nothing is too safe"

- **A plant overhead** cannot tell "played badly" from "never turned up",
  because both hold a plant. At 0.20 it bankrupted an idle team by year five,
  which breaks a deliberate product guarantee — *"five people join, argue
  about seats, and never come back; fourteen days later there must still be
  something there, because the one who wanders back on day twelve is the
  player worth having"*. At 0.12 the guarantee holds and the skill gradient
  inverts instead, because a cost rise always hits the spender hardest.
- **Opening the sealed segments** (the tolerance recalibration) does not touch
  it: the passive company is capacity-bound, not churn-bound. It holds exactly
  its starting plant because even a terrible company can fill it. And it still
  breaks the same three guards.
- **Scoring on value rather than cash** is the one that landed, and it fixed
  the optimiser rather than the balance.

The unresolved shape of it: **a company's opening position is profitable
enough to coast on for eight years.** Until that is false, the bot that does
least will stay close to the bot that does best, and every instrument that
makes coasting expensive makes playing expensive too.

### Does it look like a business? `npm run sim:realism`

A season can balance perfectly and still describe something nobody would
recognise. `scripts/realism-report.mjs` puts what a season produces next to
what real firms report:

```
market             gross%  op%  salary%   rev/head   growth  leader   HHI
Dating apps           92%   27%      9%      £744k      15%     36%  0.29
Drone delivery        72%  -18%     17%      £403k      20%     39%  0.30
Podcasts              90%   20%     15%      £497k      22%     36%  0.27
Restaurant chain      74%   31%      6%    £1,296k      26%     43%  0.28
Construction          76%  -58%     44%      £155k      17%     35%  0.28
Project management    87%   38%      8%    £1,140k      35%     35%  0.29
MMOs                  94%   26%     16%      £451k      22%     42%  0.30

anchors            20-80%  5-25%  15-40%  £80-400k   5-40%  15-40%  0.1-0.25
```

### Who works here: `shared/simulation/workforce.ts`

The five are the players. Everybody beneath them is the operations seat's
`headcount`, and a head was a head: one flat salary, identical in every
market, and the only thing it bought back was service.

A market now describes its own people, beside the rest of its vocabulary:

```
market              salary/head   room  product  service   who
Restaurant chain        £65,450     50%      15%      35%   chefs and kitchen staff, front of house, area managers
Drone delivery          £82,875     50%      25%      25%   pilots, mechanics, dispatchers
Podcasts                £82,450     40%      40%      20%   producers, editors, ad sales
Dating apps             £95,200     20%      40%      40%   moderators, engineers, community managers
Construction           £102,638     55%      25%      20%   site crews, structural engineers, quantity surveyors
MMOs                   £117,300     25%      45%      30%   game developers, game masters, server operations
Project management     £128,350     25%      45%      30%   engineers, customer success, infrastructure
```

Each kind says what hiring it buys — **room** (the ability to serve at all),
**product**, or **service**; nothing buys brand, because you cannot hire your
way to being known — what one costs against an ordinary salary, and roughly
what share of the payroll they are. `fixedCosts` charges the market's own
weighted rate, so "should we take somebody on" is a genuinely different
question in a kitchen from what it is in software rather than the same
arithmetic with different nouns.

**Nova writes one for a custom market**, from the same prompt that writes the
voice and the segments, and it is asked to be specific: *"Staff" is not an
answer; "dispatchers" is.* Anything missing, nonsensical or adding up to 1.4
falls back or is normalised rather than failing the market — a season that
cannot start because a model left a field out is worse than one whose people
are called operators.

The price licence came down from 12% to 9% on the back of this: a kitchen's
people cost two thirds of a studio's, and moving that moved which strategy
wins where.

### Making a plant need people: built, measured, not wired in

Each kind of person now says how many customers one of them looks after in a
year, and the numbers are derived rather than guessed — set so that revenue
per head lands at about three times the market's own wage, which puts the
salary share where real companies report it:

```
market              serves/head   opening £   rev/head   salary share
Restaurant chain         15,000         £13      £195k            34%
Podcasts                 18,000         £14      £252k            33%
Drone delivery           10,000         £25      £250k            33%
Dating apps               7,000         £40      £280k            34%
Construction                341        £900      £307k            33%
MMOs                      8,000         £45      £360k            33%
Project management        7,000         £55      £385k            33%
```

`canServe` and `staffFor` in `workforce.ts` are the two functions that turn
that into a constraint, and wiring them into `resolveYear` does exactly what
it should. Measured across all seven markets over fourteen years:

```
                     before        after
headcount                 5       16–122
revenue per head   £1.3m–£10.1m   £217k–£414k
salaries               6–16%        20–24%
profit swing          12–44%         8–16%
```

Four of the seven realism columns move from outside the real-world band to
inside it. A restaurant chain goes from £50.7m of turnover with five people
to £29m with a hundred and twenty-two.

**It is not wired in, because it breaks six balance guards.** Every strategy
fixture in the suite was written when room and people were unrelated — they
build nine hundred thousand of plant and hire twenty — so with the constraint
live they own empty buildings. Staffing the fixtures fixes four of the six and
leaves the two that matter most: no strategy wins every market, and every
strategy is viable somewhere. Competing on price is hit hardest, which is
*correct* — a low-price high-volume business is labour-intensive — and is
exactly why it needs a balance pass rather than a constant.

Three things were learned on the way and are worth not rediscovering:

- **Capping the forecast by headcount deadlocks the sizing loop.** A team
  staffs the plant it builds and builds the plant the forecast asks for, so a
  forecast that already knows the headcount can only ever say "stay the size
  you are". What understaffing costs belongs *beside* the forecast, the way
  `capacityRisk` sits beside it, not inside it.
- **A second shift is people, by definition**, and leased room comes with
  somebody in it — which is most of why leasing costs forty per cent more
  than building. The cap belongs on the plant a company built and has to
  staff itself.
- **A hard cap is too blunt.** It takes a plant to nothing the moment the
  payroll dips, which no real operation does. Understaffing should run the
  doors badly, not shut them: `UNMANNED_FLOOR` is the softer form and it
  passes two more guards than the cliff does.

The order for the pass that lands it: teach the strategy fixtures to staff
what they build, then retune for the fact that volume plays now carry a
payroll, then wire the constraint. The optimiser already sizes headcount
against capacity and is the one table that would not be blindsided.

**Nobody works at these companies.** Headcount ends at exactly five in every
market, in every season — the five people in the chairs, and not one person
hired in fourteen years:

```
market              year 14 revenue   headcount   customers per head
Restaurant chain             £50.7m           5              563,038
MMOs                         £34.6m           5              113,531
Dating apps                  £22.9m           5               84,929
Construction                  £6.4m           5                1,045
```

A restaurant chain turning over £50.7m and serving 2.8 million people with
five staff is not a business, and it is the root of several things this
document has been circling for a long time. Labour is the largest cost in
almost every real company and here it is 6–16% of revenue; that is why the
cost base is light enough to coast on, why break-even sits at a sixth of the
plant, and why every attempt to make standing still expensive had to reach
for an artificial overhead instead.

The reason nobody hires is that hiring is priced as a pure cost: `fixedCosts`
charges the salary and the only thing a head buys back is service, through
`staffing`'s `supportEquivalent`. Capacity is a free-standing number with no
people attached, so a bot that hires is simply a bot that spends more. **The
fix is to make capacity need people** — a plant can only serve what its staff
can serve. That would put labour where it belongs, make the operations seat's
hiring lever matter, and make coasting cost what coasting costs.

It is also a serious rebalance, and the history in this document is that every
cost increase lands hardest on whoever is spending. It wants its own pass,
with the bots taught to hire before the constraint arrives — note that the
optimiser already sizes headcount against capacity, so it is the one table
that would not be blindsided.

**Also worth knowing:**

- **Every market has software margins.** Construction runs a 76% gross margin
  and a restaurant chain 74%. Real construction is 10–20% and restaurants are
  labour-heavy. The markets differ in their customers and not in their
  economics.
- **Operating margins run hot where the game is winnable** (27–38% against a
  5–25% anchor) and deeply negative where it is not (−18%, −58%). There is
  very little middle.
- **Markets are more concentrated than typical** — HHI 0.27–0.30 against
  0.1–0.25, leaders on 35–43%.
- **Construction's profit swings by 44% of revenue year to year**, which is
  three times the anchor. It is the market that has been hardest all along.
- The price-spread column reads 37x in podcasts and that one is a **false
  positive**: the market spans £14 to £380 by design, so a premium entrant
  beside a mass-market incumbent is the market working, not a fault.

### Doing nothing is no longer a way to finish a season

A table that never files anything used to end more than half of seasons alive
and sometimes richer than it started, coasting on an opening position nobody
had earned. It is wound up now, in every market, every time.

The mechanism is deliberately keyed on **nobody filing**, not on spending
little — which is the distinction every cost lever failed to make. A plant
overhead cannot tell a team that played badly from one that never turned up,
because both hold a plant. `decisionsForYear` already knows who was absent, so
it marks the year `steered: false` when every seat is empty, and the engine
winds the company down from the second silent year: the plant goes, the
customers follow, and after six it is wound up altogether.

Trimming customers alone did nothing at all, which is worth recording — a
company at these sizes is capacity-bound with demand to spare, so the market
simply refilled it every year. Taking the room away is what does it.

**This replaces a deliberate guarantee** that a company nobody filed for was
still standing after fourteen years, whose rationale was that the player who
wanders back on day twelve is the one worth having. The two rules cannot both
hold: a company nobody runs for ten years cannot be both closed and
recoverable. What is kept is the half that survives the arithmetic — the
counter resets the moment anybody files, so a table that goes quiet for a
year or two and comes back finds a company that lost ground rather than one
that ended, and `season.test.ts` holds that.

### And the bots stopped changing their minds every year

Every choice in the game — positioning, pace, sourcing, how a feature is
built — was re-rolled from scratch annually, because the seed carries the
year. A bot that picks a different market position every twelve months is not
playing badly, it is not playing at all, and no lever that rewards
consistency could ever pay for it. Last year's answer stands now unless a
one-in-five roll says otherwise.

### Closing the gap: it is the best table in the codebase now

Scored on all four of the things a season is made of, 42 seasons a side:

```
mode        value     cash   customers   survived
idle        £0.0m    £3.4m          11         0%
filler      £9.9m   £10.6m     167,242        83%
survivor   £10.6m   £18.3m     198,313        86%
optimal    £15.1m   £31.1m     247,943        86%
```

Ahead on value, cash and customers; level on survival. Getting there needed
three years of rollout with a continuation that *grows* rather than a frozen
plan, a plant allowed to double rather than grow by half, cash weighted at
eight hundredths of a pound of company (at zero it spends to the last pound
for any gain at all; at a half it hoards and the business collapses to 29,000
customers), and two years of running costs held back rather than one or
three.

The route there, each step measured:

```
                                                survives   richer
one year ahead, valued on cash                     62%       57%
  + net off the debt it borrowed                   62%       62%
  + believe the engine over the forecast           62%       62%
  + a plant that grows at a plant's speed          71%       71%
  + value the position over the years left         76%       76%
  + roll two years forward, not one                81%       81%
  + a finer search (16 slices, not 10)             84%       81%
```

Tracing the deaths was worth more than any amount of searching harder. Every
season it lost looked the same: **it spent nothing at all for the first three
years**, held about a thousand customers, and bled fixed costs until it died.
It was scoring correctly every one of those years — nine customers at £740 of
margin against £700,000 of running costs is a bad year however much you spend
on it — which is exactly why the objective was the thing to fix.

Four findings, in the order they mattered:

- **Borrowed money was counted as wealth.** The score read `me.cash` and never
  subtracted `me.debt`, so drawing on the credit line was free points: it took
  a million in its first year, spent none of it, and paid interest for the
  privilege, in every season it lost.
- **It exploited the forecast.** `forecastDemand` describes itself as a sketch
  of the engine, and a search against an approximate model finds where the
  approximation is generous. In dating apps it committed £5.7m against a
  forecast of 350,000 customers, the year delivered 44,000, and it spent three
  years paying for a plant four hundred thousand seats too big. The position is
  now the smaller of what the sketch predicts and what the engine actually
  produced: the forecast can argue the company down and no longer up.
- **The plant was sized by that optimism.** Now it grows at most half as much
  again as it is already serving — a fast year for an operation and an
  absolute limit for one.
- **One year of lookahead cannot see compounding**, which is the whole game.
  Brand bought now pays by making next year's brand cheaper. Rolling a second
  year forward — holding the same plan, one more run of the engine per
  candidate — moved survival from 76% to 81% on its own, and it is the single
  largest step in the table.

It decides 16 of the game's 72 levers against the survivor's 40 and beats it
anyway, which says the other 56 are worth less than knowing what a year is
worth.

What it is worth now is what a benchmark is worth. It is deterministic, it
coordinates all five seats, and `test/unit/optimiser.test.ts` holds the
properties that make it one — same plan twice, spends only what the company
could raise, prices against the market, keeps a year of costs back, and puts
money into the product that a one-year objective never would.

### A loyal segment is not loyal, it is sealed

Found underneath the fix, and it is the next thing.

Appeal is a weighted geometric mean of scores that cannot exceed one, so the
gap between a near-perfect company and an ordinary one tops out around **0.19**.
The tolerance a rival has to beat before anybody even considers moving is
`0.06 + loyalty * 0.34` — a span of 0.06 to **0.40**.

```
segment              loyalty  tolerance   best gap   churn
Swipers                 0.15      0.111      0.125    2.4%
The recently single     0.22      0.135      0.155    3.2%
The long-haulers        0.86      0.352      0.192    0.0%
```

A segment at loyalty 0.86 is not hard to take. It is impossible: no company
that could exist can produce a gap that clears its tolerance. And even the
flightiest segment in the game only ever leaks 2.4% a year.

It went unseen because the double-count left a tenth of every segment
unclaimed, so a challenger took those instead and the door looked open. The
test that guards this — "a moat that never leaks is a wall, and a wall makes
the game unwinnable" — was passing for the wrong reason, and now measures the
mechanism it names against an appeal gap big enough to show it.

**Recalibrating the tolerance to the reachable range was tried and is not in.**
At `0.02 + loyalty * 0.13` a great company takes about 6% a year from the most
devoted segment and 14% from the most flighty, which is the door the comment
asks for. It also hands every one of the seven markets to the premium play,
because once customers can actually move, the best offer wins and being
excellent is underpriced. Four separate levers were tried against that — the
price licence, the headroom on gains above the midpoint, the tolerance itself
and the appeal exponent — and premium swept all seven at every setting.

So the order is: **make excellence cost what it is worth, then open the door.**
Not the other way round, which is what was attempted here.

### What is not done

**The long tail of "year" still says year.** The survey found roughly 200
sites outside the engine that read `year` as a year. Most are now correct by
construction — one decision row per period, one report per period, which is
what a quarterly season should have. Three groups are not, and are the next
work:

- **Year-denominated thresholds in shared, outside the engine**: `entrants.ts`
  (`year < 3`), `mergers.ts` (`year >= totalYears`), `recovery.ts`
  (`COVENANT_YEARS` counted in ticks), `criteria.ts` (`DRIFT_PER_YEAR`),
  `treasury.ts`, `finance.ts`, `projection.ts`, `assets.ts` (asset life
  decremented per tick), `challenges.ts`, `forecast.ts` (`year <= 2`). Each is
  a lag or a rate measured in years being applied per period.
- **Two unique constraints that were sized as "once a year"**:
  `sim_offers_once (from, to, year)` and `sim_recovery_once (venture, year)`.
  Under monthly cadence these become "once a month", which is a 12x behaviour
  change rather than a rename, and probably wants a decision rather than a fix.
- **The wording.** Roughly 40 client files and a dozen server strings say
  "Year N", "each year lasts", "one real day is one year of trading".
  `PERIOD_NAME` in `cadence.ts` exists for this and is used in two places.

**Past insolvency the cadences legitimately diverge**, and they should — a
quarterly table sees the hole two quarters sooner and reacts to it, which is
most of what the extra $6 a seat buys. The invariant is therefore asserted
over one year, not six. A six-year run of a plan that goes broke still shows
large gaps; that is the game working, not the arithmetic failing.

**The clock in `simulation-tick.ts` still ticks annually.** Nothing reads a
season's cadence to decide when the next deadline falls, so a quarterly season
is period-aware in the engine and still yearly on the calendar. That is the
next piece.

## Niches a company goes and finds

A market is written with three or four segments, and that is a useful lie.
Real markets have dozens, and most of them did not exist until somebody went
looking: a company notices that a slice of a segment wants something slightly
different, names it, builds for it, and for a while owns it because nobody
else is even describing those people as a group.

The marketing seat can now do that, from year five. What it finds is the
people who want what the company is *already* good at — measured against the
middle, so a company strong on quality and weak on brand finds people who care
about quality and not about brand. The advantage is earned rather than
granted: a company that is middling at everything finds a corner barely
different from the segment it came from, which is the honest outcome.

Three things the arithmetic holds, each with a test:

- **The buyers come from somewhere.** A niche is carved out of a segment that
  already exists. Opening one does not invent demand; it describes part of the
  market more precisely than anybody else.
- **Never most of a segment.** However many niches are found inside one,
  most of it stays people who were not looking for anything in particular.
- **The run at them closes.** For three years rivals are worth less to those
  people because they have a product for the segment, not for the corner of
  it somebody named. Then it is an ordinary segment that happens to suit you.

### How it lives on the world

The market is rebuilt from code every year so balance edits reach seasons
already running, which would wipe anything a season invented. So opened
niches live on the world and are composed back onto the market in
`resolveYear` — which turned out to be the one place the engine reads it
(`const { niche } = world`). Everything downstream, all forty-odd things that
walk the segment list, sees them without knowing they are new.

### What it does, measured

Traced against the same company without one: the year after opening, +25%
revenue and +8,700 customers — **and 30,077 people turned away**, because
capacity could not serve them.

That is the right answer rather than a disappointing one. Finding a niche
creates demand, and demand the operations seat has not built for is people who
tried you once and tell others. It is the marketing-and-capacity interlock the
whole game is built on, arriving at the moment a table feels cleverest.

Bots do not open niches, for the same reason they do not choose a programme or
an improvement: it costs a year of research money and commits the company to a
corner of the market for the rest of the season, which is a decision about
what this company is *for*. So the balance harness is unchanged at 68%.

### Two tables, one idea

Teams in the same season look at the same market, and the good ideas in it
are not infinite. As first built, two tables who thought of the same thing
would each be handed a private corner *and a head start against each other* —
which is the same niche twice, and nonsense to anybody who met the other team.

It is settled in two passes, and the split between them is the point.

**The arithmetic decides the same people.** Same segment, wanting the same
things within a tolerance, at about the same price — that is measurable, so
`mergeSimilar` decides it and needs nobody's opinion. It runs at the end of a
year rather than when a niche is filed, so whoever went first gets a year of
it being theirs before finding out somebody had the same idea. The first
opener keeps the naming; the other is recorded as having found the same
people; and neither has a head start on the other, though everybody else
still has to catch up.

**Nova decides the same idea.** What arithmetic cannot see is two niches a
little apart numerically and obviously the same thing to anybody reading them
— "Weekend players" and "Casual Saturday users". Only the borderline pairs are
read: ones the engine already merged need no opinion, and ones far apart on
every axis are not close calls whatever they are called. That is a handful of
short questions a season, not one a year.

It cannot run inside the engine — `resolveYear` is a pure, deterministic
function and a model call is neither — so it lives in `server/nova-niche-review.ts`
and produces exactly the shape `mergeSimilar` does. The engine cannot tell
whether a merge came from arithmetic or from judgement, which is what keeps
seasons replayable.

The rule it is built to: **being wrongly told your idea is somebody else's is
worse than being wrongly left with your own**, because the first takes
something away. So an unreadable answer, an out-of-range pair, or any
uncertainty leaves both niches alone, and the prompt says so.

### The desk shows it

A table that spent a year's research on this had nothing on screen saying what
they bought. There is now a card answering the three things they ask in order:
who these people are and how many are yours, how long the run at them lasts,
and — said plainly rather than buried — whether somebody else has turned up in
the same corner.

### Still owed on niches

- **Rivals copying a good one.** The head start fading is the timer; nothing
  yet makes an entrant or an incumbent *aim* at a niche somebody proved.
  `entrantsFor` already aims newcomers at whatever is working, so this is a
  short step from here.
- **A second niche.** One per company per season at the moment.
- **What a failed company leaves behind** — its niche, or a patent worth
  buying. Needs the failure event first.
- **The desk does not show it.** The lever is there and the choice is real,
  but nothing on the screen tells a table what their niche is doing.

## A market that notices you

The cast used to be fixed: the incumbents a market was written with, the
tables that joined, and nobody else for fourteen years. That was the biggest
thing missing from a market feeling alive. In the real world the force that
punishes a company for getting comfortable is usually not an existing rival
moving — it is somebody new arriving because the margins looked good from
outside, and the loudest signal a market sends is somebody having just entered
it and done well.

`shared/simulation/entrants.ts` watches three things: demand nobody served,
how far above cost the people here are pricing, and whether a newcomer has
just taken real share. When it adds up, somebody turns up — aimed at whatever
just worked, which is what copying a niche means.

Four rules it is built to, each of which is the reason it is not annoying:

- **They start from nothing.** No customers. Handing an entrant share would
  take it from the people playing, which makes doing well a punishment rather
  than a consequence of it.
- **At most one a year.** A market that gains three companies in a year is a
  gold rush, and a season of gold rushes is noise. One arrival is something a
  table notices, talks about and can answer.
- **Not before year three.** A table that meets a new rival in year one has
  not done anything to attract one.
- **Deterministic.** Seeded on the season and the year, so a season replays
  exactly and "where did they come from" has an answer.

Measured across the seven markets: an arrival every two or three years in an
attractive one, the first around year three to five, and none at all in a
market where nobody is doing anything. Overall survival is unchanged at 68% —
and the runaway ceilings came down, which is the point: dating apps' best
season fell from £275m to £213m and MMOs from £349m to £325m, because a
company running away with a market now attracts company.

`roomFor` scales with the market, so this is also the first piece of the
small-market answer: a £2m market Nova wrote for one business supports a
handful of companies, not a dozen.

### The rest of the living market, in the order it should come

Recorded rather than started, and this is the sequence they depend on:

1. **Weights drift as a market matures** — price sensitivity and loyalty rise
   as a market commoditises. Independent of everything else and small.
2. **Price wars** — rivals answering each other's prices rather than each
   responding to the market alone. Needs entrants first, because a price war
   between a fixed cast is just a slow slide.
3. **Niches as things companies make** — targeting one, creating one, rivals
   copying a good one. The richest idea and the deepest change: 45 places read
   the segment list assuming it never changes.
4. **Failure and what it leaves** — a company going under, and its patents or
   its niche coming up for sale. Needs entrants and niches.
5. **Quarters and months** — 4 or 12 periods a year, at $6 and $10 a seat,
   with a developer bypass. Independent of all of the above and the largest
   plumbing job: the year is the atom in about thirty places, and every rate,
   lag and threshold has to scale per period.

## Bots that make the decisions a person makes

Asked for: a difficulty above the warm body, so a table learning to enter a
market can watch somebody do it.

`BotSkill` is the setting — `filler` is what bots have always been, `survivor`
is a company actually trying — and it lives on the season, so a season for
people learning can ask for rivals worth learning from.

Three levers decided it, and all three were ones no bot had ever touched
deliberately. A bot's price was last year's number nudged twelve per cent,
which meant the most powerful lever in the game was the one nobody in a bot
company ever pulled.

- **What to charge** (`bestPrice`): share against the companies actually in
  this market, times what each customer is worth, maximised. Not a discount
  rule — against weak rivals it comes back *above* the going rate.
- **Who to aim at** (`bestSegment`): a newcomer opens with brand 8 against
  quality 38 and service 40, so it should sell to the people who care least
  about being unknown.
- **Where to sell** (`regionsWorthKeeping`): one region the chosen segment is
  concentrated in beats four the company is invisible in.

Measured over 112 seasons, filler against survivor on identical code:

| | filler | survivor |
|---|---|---|
| Survived | 71/112 (63%) | **76/112 (68%)** |
| Podcasts, median end | £25.0m | **£51.1m** |
| MMOs | £14.4m | **£24.9m** |
| Project management | £25.0m | **£31.6m** |
| Construction, survived | 3/16 | **5/16** |

Better in five markets, level in two, and nothing worse.

### Two things the measuring taught that are worth keeping

**Discounting barely works in this engine, and that is deliberate.** Appeal is
flat below the reference price: `priceScore` is capped at 1.08, so cutting
price buys almost nothing while margin falls. The comment on that cap explains
why — without it "being cheap quietly outranked being good at anything". It
does mean the price lever is one-directional, which is worth knowing before
anybody tunes it.

**A weighted geometric mean needs its exponent.** The first `fitFor` took the
product of scores raised to segment weights, which is what `appealFor` does —
correctly, because it compares companies *inside* one segment, where the
weights are identical for everyone and the bias cancels. Comparing segments
against each other it does not cancel: every score is below one, so a smaller
exponent gives a bigger number, and "best fit" was always whichever segment
demanded least. It picked the same segment for a company with brand 8 and one
with brand 90. Normalising by the sum of the weights fixes it, and a test
holds it.

### What was measured and thrown away

Each of these is the obvious idea, and each made the game worse.

**Cutting price to win a foothold**: 11 in 16 down to 5. The margin goes
before the customers arrive.

**Giving a broke company a smaller factory**: 2 in 16 down to 0, in every
band. A company with £0 opens with plant sized for a tenth of its region and
pays £289,440 a year of idle rent before selling anything, which looks exactly
like the bug that dooms it. Capacity is also the ceiling on what the company
can earn, and the salary bill underneath does not shrink with it. The dial is
left in `opening.ts` with the finding written on it.

## Where a company starts, and the finance seat that would not act

Asked for: a project should be able to open a season either level with
everybody else, or where it actually is — which for most people means no
money, no credit and no customers.

`shared/simulation/opening.ts` has the model. Four bands off how far the
project has got through its path, each changing what the first year is about:
no cash and a twenty credit score at one end, a real line and paying
customers at the other. Measured on dating apps, 16 runs each:

| Opening | Cash | Survived |
|---|---|---|
| An idea, and the work so far | £0 | 2/16 |
| Building it | £0.48m | 3/16 |
| Something people use | £1.20m | 11/16 |
| Trading | £2.10m | 12/16 |

### The finance seat would not act

A bot chief financial officer files nothing for money on purpose: borrowing
and raising are decisions, and a bot inventing a loan is a bot making one
with somebody else's company. But refusing to borrow while the company runs
out of money is also a decision, and a worse one — a company opened where a
real project is, with no cash and a bot in that seat, survived one time in
sixteen. It was not losing the argument; nobody was having it.

It now draws what the year needs and not a penny more, and raises what the
credit line will not cover — which is what an early-stage founder actually
does, since a company with no trading history has almost no credit. That
alone took the zero-cash opening from 1/16 to 12/16.

And then broke everything else. A company that can always top up cannot fail:
overall survival went from 62% to 94% and five of the seven markets became
impossible to lose, which the balance harness flagged immediately. A game you
cannot lose is a slideshow. So the rescue is gated on still being investable
— investors stop at repeated missed targets, and they do not fund a company
past its first years with nobody buying anything. That lands at 66% overall,
with the five healthy markets between 69% and 88%.

### What is still wrong with starting from nothing

The raises happen and the company still dies: traced, customers fall from
18,250 to 1,393 over ten years whatever is raised. Brand opens at zero, the
marketing a broke company can afford does not hold position against churn,
and funding only delays it. That is arguably true of real startups and it is
not a good game, and "start where you actually are" is the mode somebody
picks precisely because they want the real answer.

The lever a person would reach for and a bot will not is focus: one region,
one segment, a price that buys a foothold. Until that is worth measuring, the
honest summary is that this opening is a hard mode a mediocre player loses.

### Not built yet

- **The stance is not wired up.** `opening.ts` is modelled, measured and
  tested against nothing: no column on the season, no choice on the form, no
  route that honours it.
- **A solo founder still cannot run the table.** `sim_seats` is unique on
  (venture, user), so one person holds one seat and the rest go to bots —
  including the finance seat, which is the one that decides whether a company
  with no money survives at all. A leader filing for the seats nobody holds
  is the missing piece, and it matters most in exactly the mode above.

## What a market Nova writes actually plays like

Run against a real model, with a real project. Asked about scheduling
software for small independent vet practices, it wrote a good market: 14,400
clinics in four segments at £59–£149, seven UK regions with sensible weights,
four incumbents with knocks worth aiming at, and a voice that says "practice",
"subscription" and "appointment slots". No validation problems.

And it was unplayable. The market is worth £1.65m a year; the company opened
in it with £6m in the bank — three and a half times the entire market — and a
salary bill it could never earn back. It lost money in all fourteen years and
finished £5.7m down.

Nothing was wrong with the market. Everything absolute in the engine is tuned
to the seven written by hand, which are all worth about £400m a year: six
million in the bank, £140,000 executives, £220,000 for sixteen points of
brand. In a market a two-hundredth of that size, every lever costs more than
the company can earn, so none of them do anything at any price it can afford.

So the company scales to the market (`marketScale`, `atScale`). Less in the
bank, smaller salaries, and every threshold in the money of the market being
played. The decisions and the ratios are identical — which is the point,
because the ratios are the game. Both markets tested now survive fourteen
years near break-even instead of spiralling:

| | before | after |
|---|---|---|
| Vet scheduling (£1.65m market) | bankrupt, −£5.7m | survives, ~break-even |
| Bell-ringing apps (£1.14m market) | — | survives, profitable by year 11 |

The seven are untouched, and a test holds them there. The reference is set
just below the smallest of them so every one clamps to exactly one: at £400m
it did not, and drone delivery — already the hardest — quietly lost four per
cent of its opening bank.

### Still owed on this

- **Fractional customers.** A written market produced "7,194.5 customers" in
  a report. Cosmetic, and it gives away that nobody chose the number.
- **A written market has no balance pass.** The seven were tuned against each
  other over many seasons. A written one is one model's answer, clamped into
  range — `sim:balance` can measure one, but nothing does it automatically
  before a team plays it.
- **The route has still never been exercised end to end.** The generation and
  the play were driven from scripts against a real model; the HTTP path that
  creates the company and the season was tested with the model stubbed out.

## Two markets nearly nobody survives

Measured, not felt. `npm run sim:balance` runs the same reasonable company
many times in every market and prints what became of it. Across 24 runs each:

| Market | Survived | Median end |
|---|---|---|
| Project management | 21/24 | £23.9m |
| MMOs | 21/24 | £36.0m |
| Dating apps, Podcasts, Restaurants | 18/24 | £11–23m |
| **Drone delivery** | **11/24** | **−£0.1m** |
| **Construction** | **7/24** | **−£2.3m** |

`test/unit/balance.test.ts` passes on all seven, and is right to: every market
*can* be won and *can* be lost. A pass cannot show a distribution, which is
how two markets sat at half the survival rate of the others without anything
going red.

What is underneath it: the cost of existing is about the same everywhere by
design — five salaries and the overhead under them, because the seats are the
game. What a first year can earn against that is not. The gross profit
available at full capacity in year one runs from £0.57m to £2.36m across the
seven, and the survival rate tracks it.

Two fixes that did not work, so nobody tries them again. Giving the thin
markets more opening capacity made them **worse** — unsold plant is rent, and
a company that cannot sell what it has does not want more of it. Tuning how
hard the bots spend moved the total by one company in fifty-six, which is
noise; the constant was swept from 0.03 to 0.4 and the two markets failed at
every value.

What is left is the market content itself: drone delivery earns £15 a unit
against a £25 price, and construction sells 2,646 units a year at £900. Both
are defensible as businesses and both are thin against a flat cost base.
Changing them means editing balance that was tuned by hand against the other
five, which is a judgement about how those markets should feel rather than an
arithmetic error to correct.

## Known and deliberate

### The accounts add up, and are tested to
`pnl.capacity` used to include the plant, which `pnl.operations` already
carried — so the report's cost column charged the company twice for automating
it, running a second shift or holding stock, while the profit printed
underneath counted it once. Anyone adding up the column got a different number
from the one below it. The capacity line is now room only, the five cost lines
that were computed and never rendered (capacity, incidents, partner share,
insurance) are on the screen, and planning sits on its own signed row because
it is an effect rather than a cost. `test/unit/depth.test.ts` asserts the
identity — sales, less every line, plus planning, is the profit — so it cannot
drift again.

### A fifty-company season costs nothing to speak of, and none of them fail
Measured: `npm run sim:scale` runs fourteen years of a season at 1, 10, 25 and
50 bot companies and prints what each cost. Fifty companies × fourteen years is
about three quarters of a second of engine time in total, with the worst single
year — the one held inside a transaction — under 100ms. Going from 25 companies
to 50 costs about 1.5x the time, so the resolve is under linear in companies
and fifty is nowhere near a limit. The script exits non-zero over its budget,
so it can be a gate rather than something somebody remembers to run.

One thing it turned up that is not a performance question: at every size, every
bot company was still solvent after fourteen years. Bots never fail. Whether a
season of rivals that cannot go under is the rivalry we want to sell is a
balance question, and nobody has asked it yet.

### The meter counts a region that may never open
Operations putting the announced region up adds its cost to the table's
commitment straight away, before the vote. The table may vote it down and the
money stays. Overstating what a year might cost is the safe side of a meter
that exists to stop a company filing a year it cannot pay for, so both the web
and the phone count it that way — but it is a choice, not an oversight.

## The measurements themselves, 30 Sept 2026

### Open, and it comes before everything else: the harness has been feeding the engine the wrong economy
`resolveYear(world, decisions, economy, options)` takes the year's economy. Left
undefined it falls back to `world.economy`, and that is not a safe default:

  - `world.economy` is the economy **as stored after the last period**, which
    already carries that period's weather. `resolveYear` then applies the new
    weather on top of it, so a market event's multiplier is re-applied for every
    period it stays in force. A twelve per cent freight shock becomes 1.12^12
    across a monthly year: unit cost went from 6 to **25.79** by year two, the
    company was serving customers at four times what they paid, and it went
    bankrupt. Quarterly it is 1.12^4, which is milder and equally wrong.
  - With events off it is a different error and just as bad — the year-one
    economy is frozen and repeated for the whole season, so demand never moves.

The server never hits either, because `tickSeason` passes
`economyFor(seasonId, period, periods)` every time. **Every sweep in this
document taken from a scratch harness did**, and so does
`every-market-winnable.test.ts`.

That matters for what is written above. It does not invalidate the defects —
those were found by comparing two runs under identical conditions, and a
mistake present in both does not create a 29x recall or a market seated above
its own demand. It does cast doubt on the *levels*: how often a market is
winnable, how much the plant is worth, where filing nothing ranks.

Passing a fresh economy, as the server does, immediately fails five cases that
pass today, in markets and cadences that had looked settled. That is the real
state and it should be fixed before any further balance conclusions are drawn
from this harness.

Two things to do, in order. Make the default safe — either store the unweathered
base on the world so `resolveYear` can rebuild rather than re-apply, or require
the economy and let the type system find the callers. Then re-run the sweeps
with it and re-derive the levels.

### Withdrawn pending that: the monthly season length
A monthly season was going to go from two simulated years to four, with the
real-time tick halved so forty-eight decisions still take the twenty-four days
twenty-four used to. The measurement behind it — building the business is worth
1.00x at two years and 1.49x at four — was taken through the harness described
above, with a frozen economy. It is not evidence yet.

The shape of the finding survives: two years is flat, four is not, and it is
time in market rather than the rhythm, since a quarterly season cut to two
years is just as flat and shortening the lags moves nothing at any speed. What
does not survive is the confidence to change a product default on it. Re-measure
with a real economy first.

## Whether a market can be entered at all

### Closed: rivals held more of a market than it was written with
`seedIncumbents` weighted each rival's hold by how well a segment suited its
posture, and the comment said it then scaled the result back to the share the
niche says they own. Nothing did. `fit` averages about 1.1, so what was written
as 90% was seated anywhere from 84% to **113%** of a segment depending on the
market and the season's seed.

Above 100% is the part that mattered. `allocate` sizes the unowned pool as
demand minus what is held, so a segment seated over demand opened with a
negative pool, clamped to zero, and stayed shut: a founder playing well won
**zero customers in sixteen quarters, in every segment, at every level of
spending**, with nothing on screen saying why. Two of six sampled season seeds
in one Nova market were unwinnable for this reason alone, and restaurant chains
seated its rivals holding 102% of the market in an ordinary season.

Now scaled across the market to the written share, with a cap
(`SEGMENT_HOLD_MAX`) so no single segment runs over. Segments still vary — some
soft, some hard — because the weak flank is how a newcomer gets in. What is
gone is the segment that was shut before anyone arrived.

### Closed: a below-trend economy closed the market completely
Rivals were seated against the sizes a market is *written* with, while a
segment contains `size * economy.demand` people and the opening economy is
drawn anywhere in `1 ± 0.12`. Any season drawing below 0.90 therefore opened
over-subscribed, with the same dead result as above.

Fixed asymmetrically, in `buildWorld`: a bad economy shrinks what the rivals
hold, a good one does not grow it. Both halves earn their place. Seating them
against demand in a *boom* took the newcomer's opening away instead — the pool
a founder enters against halved, from 21.8% of the market to 11.2%, and a
five-team season that left several companies standing left one. A boom's new
demand is genuinely unserved, and it should go up for grabs.

### Closed: the open share was not a knob
`TRULY_OPEN_SHARE` claims a tenth of a market has no supplier, but only the
fragmented tail respected it: the tail is seeded as "everything the named
rivals left over, above the open share", so writing the rivals *smaller* simply
handed the difference to the tail and left a newcomer exactly as much room as
before. A market's room could not be adjusted at all.

Markets can now say (`niche.openShare`), and dating apps says a sixth, which is
the room it has always actually had.

### Closed: a bot could not afford the cheapest region in the game
A one-off was judged against 15% of headroom. A dating-apps bot finished a
season holding £120,850 next to a £50,000 entry it had never been allowed to
consider. Now a third for a survivor, and still a sixth for a filler — raised
for both alike it worked and closed the gap between playing well and going
through the motions from 13 points to 6, which is the other thing being
measured.

### Closed: the cash bridge did not add up for a company that ran out
When there is neither cash nor credit, the shortfall becomes debt and the bank
balance is floored at zero. The bridge had no line for it, so the year's
movements ended below zero while the balance read nought — out by exactly what
the company failed to pay. Found by another session running the suite against
an uncommitted tree, which is worth saying because nobody had run it yet.

### Closed: every company opened with room for a region it would never hold
The opening plant was sized against `market * home.weight * TRULY_OPEN_SHARE`
— every customer in the home region with no supplier, which is the whole pool
every company in the season competes for. Sizing one company's plant against
all of it assumes that company wins the lot, which allocation never lets
anybody do: a newcomer takes about a twentieth of its region's pool in the
first period.

Idle room is not free, and this is what it cost. In drone delivery a founder
opened with room for 38,214, served 1,662, and paid **£72,725 a quarter in idle
capacity** — the largest single line in the accounts, seven times the revenue,
more than marketing and product together, and incurred before any decision was
taken. The markets where it was fatal are the ones with the thinnest
contribution per customer, because there the plant costs more than the
customers can ever bring in.

Measured over ten markets and eight season seeds, best of four spend rates:

    before   beaten by doing nothing  8 seasons · bankrupt  5 seasons
    after    beaten by doing nothing  0         · bankrupt  0

`PLANT_SHARE_OF_POOL` is the ceiling coming down to meet the `breakEven` floor
that was already there. Three fifths, and not less: sized off break-even alone
the plant stops being related to the opportunity, and a company that buys a
second region cannot use it — measured, buying one multiplied customers by
exactly 1.00, because the plant was full either way.

Worth keeping in mind for the next market that reads as unwinnable: what looked
like a market problem was a cost handed to every company at birth, and it was
invisible because `idleCapacity` is not one of the lines anybody reads first.

### Closed: drone delivery's biggest segment was priced below what a business costs
The largest segment in a market is the one the opening defaults size a company
against. Drone delivery's was novelty orders at £25 against a £10 unit cost, so
break-even was 9,333 customers — **9.3% of the unowned pool of a home region**,
where every other market in the catalogue sits between 1.8% and 3.8%. It was
the only market where paying your people needed more customers than the market
could realistically hand you.

What that did to a season was worse than making it hard. Outside a boom, the
worth of a season by how much of its cash the founder spent each period:

    spend    0%      2%      4%      6%      9%     12%
    worth   48,840  63,840  75,360   8,307      0    0 (bankrupt)

A cliff between 4% and 6%, with nothing on screen to say it was there. At £65 —
which lands break-even at 2.5% of the pool, between dating apps and podcasts —
the same sweep rises to a peak at 9% and tapers: a best answer in the middle
and a price for overreaching, like the other six markets.

It also closed the bot problem this document previously described as separate.
Survivor bots there went from **0 of 6** ever affording a second region to 6 of
6, and `bot-play.test.ts` now asserts the rule across every market again rather
than excluding this one. The bots were not spending badly; they were in a
market that could not pay for the spending.

Two things worth carrying forward. `voice.test.ts` caught the market's own copy
still claiming a clinic pays "twenty-eight times a novelty order" when the
segments now say eleven — prose about the numbers goes stale when the numbers
move, and that test is the reason it did not ship that way. And the diagnostic
that found this is a good one to reuse: **break-even as a share of the home
region's reachable pool**, compared across markets. The outlier was visible at
a glance and nothing else in the catalogue was close.

### Closed: Nova could write a market nobody could run a business in
Every rule in `custom-market.ts` checked a market's *shape* — how many
segments, how big, what the rivals hold, what a region costs to enter. None
asked whether a company could live in the result.

Nova is asked to write small, because it is writing about a real project.
Eight markets generated from real briefs all came back under £33m a year and
five of them under £700,000. A tenth of a market that size, split again across
five or six regions, is not a business. On the worst of them — a kiln-firing
marketplace, 9,000 people, £235,000 a year — a founder's home region held
**270 unowned customers against a break-even of 181**, and nobody was ever once
profitable: not on any of eight season seeds, not at any rate of spending from
nothing to an eighth of the bank a period, never in sixteen quarters. The most
anyone reached was 104 customers of 9,000.

Measured across the eight, playing each on eight seeds at six spend rates:

    a tenth     3 of 8 markets had no profitable season at any spend
                1 was beaten by filing nothing
    the rules   8 of 8 winnable, profitable, never bankrupt, never beaten

Two rules, deliberately not held to the same bar. `openShareFor` opens the
market up until the home region holds enough unowned customers to clear
break-even — how much of a young market is unserved is a number nobody wrote
down and nobody will miss. `pricedForABusiness` lifts prices only for whatever
that could not reach, because a price is something Nova *said*. Held to the
same bar, a sea-swimming app's prices went up 246-fold, from £1 a year to £246;
split, the same eight markets get there on a 20-fold lift with the open share
doing the work, and every price moves together so who pays more than whom
survives.

Two things worth keeping. The diagnostic that found it — **break-even as a
share of the home region's reachable pool** — is the same one that found drone
delivery, and it is the first thing to reach for when a market reads as
unplayable. And the rule ranks the seven hand-written markets about the way
playing them does: it asks least of project SaaS, profitable on eight seeds of
eight, and most of drone delivery and podcasts, profitable on two. That is the
evidence it measures the right thing rather than being a number chosen to
rescue the markets it was written for.

## The catalogue pass, 30 Sept 2026

Seven hand-written markets, eight season seeds, seven strategies each (lean,
grower, premium, cheap, sensible, tiered, product) with the year's events on.

### Closed: a recall cost the same in a market a two-hundredth the size
`events.ts` held one piece of money and it was the one nothing scaled: a flat
£450,000. Four tenths of the opening bank in a catalogue market, and 29.1x the
*entire* bank in an allotment-glut marketplace, 22.5x in a kiln-firing one,
17.3x in a parish-council one. Recalls fire there three or four times across
eighteen seasons, so a founder could lose twenty-nine times everything to one
draw, with no decision that would have made it smaller. `atScale` now applies.

Found only because the sweeps ran with events on for the first time.
`every-market-winnable.test.ts` now runs both ways.

### Not the fault it looked like: most of the catalogue's weakness was the harness
Measured with strategies that never cut an over-built plant, the seven markets
looked alarming — thirteen bankruptcies in construction alone, ten across the
catalogue. Almost all of it was the plans: `capacityTarget: max(capacity, ...)`
can only grow, so a company that had priced itself down to two customers went
on paying £49,613 a quarter for 1,588 units of plant it would never fill. A
person cuts. With plans that cut by a fifth a period, bankruptcies fall to
**three in 336 runs**, and every market has a plan profitable on six seeds of
eight or better.

Worth remembering before reading the next alarming sweep: a strategy that
cannot do something a player obviously would is not evidence about the market.

### Withdrawn: "filing nothing out-scores deliberate play"
Recorded here earlier the same day, with the cause given as `valuation =
revenue x 1.2 + assets - debt` having no term for profit. Both halves were
wrong and the correction is worth more than the claim was.

**The measurement was mine, not the game's.** Every strategy in that sweep cut
its plant toward what it currently served. Run the same strategy with the same
spending and no plant cut:

    restaurant_chain, median of eight seeds, events on
    grower, cutting the plant     revenue 329,350/qtr   profit -26,616   value 1,580,881
    grower, keeping it            revenue 904,872/qtr   profit +39,316   value 4,343,384
    filing nothing                revenue 363,566/qtr   profit +28,679   value 1,745,117

Filing nothing was not beating deliberate play. It was beating seven strategies
that had each capped themselves below what they could sell, and it keeps the
plant it opened with because `defaultDraft` carries the capacity target
forward. With one plan in the pool that manages its plant, filing nothing falls
from first of eight to between second and fourth of nine, and remains **last in
all fourteen markets Nova wrote**.

**And a profit term does not fix it, because there was nothing to fix.** Tried,
measured over twelve markets: adding cash at face value makes filing nothing
rank *first* in five of seven catalogue markets, because a passive company
keeps the opening bank while active ones spend theirs. Adding earnings at four
or eight times moves nothing — in those markets a passive company genuinely has
both the higher revenue and the positive profit, so no formula built on those
two can rank it below. The scoring function is not what was wrong.

The lesson is the same one as the catalogue pass above, twice in one day: a
strategy that cannot do what a player obviously would is not evidence about the
game. Both times the harness was the finding.

### Open: keeping room is worth more than any decision in the catalogue
Identical spending, the only difference being whether the plant is cut toward
what is served:

    dating_apps 2.94x   drone_delivery 4.62x   podcasts 4.34x
    restaurant_chain 2.75x   construction 2.29x   project_saas 3.11x   mmos 3.45x
    cairnwait 1.31x   kilnshare 1.32x

Keeping capacity is worth between 2.3x and 4.6x the company's final value in
every hand-written market, and 1.3x in the markets Nova writes. A company can
win several times what it holds in a period, so the plant — not appeal, price,
product or spend — is what decides the season, and retiring idle plant is
punished harder than any pricing mistake.

**Not the overflow, and not the price of idle room.** Both were swept:

    SPILL_TOPUP_MAX  8 → 4.62x   4 → 4.62x   2 → 4.61x   1 → 4.70x
    IDLE_RATE     0.08 → 4.62x  0.15 → 4.27x  0.25 → 4.65x  0.40 → 2.49x
                                 (5 failures)  (16)         (21)

Five times the idle price still leaves the ratio at 2.49x while breaking
twenty-one tests, so the cost of holding room is not what is mispriced. What is
left is the ceiling itself: `allocate` caps merit wins at capacity, and a
company with room can win several times its holdings in one period, so the
option on that capacity is worth far more than any plausible rent on it. The
lever is the *growth rate* a company can absorb, which nothing currently
bounds, and that is a design change rather than a constant.

Worth knowing before touching it: idle cost is also what makes a thin-margin
market punishing (drone delivery, above), so it is one number pulling two ways.

### Closed: owning something for a whole year made the year worse
A company holding a patent and a distribution deal won 25,118 customers at the
allocation against 15,338 without them, and finished the year with **fewer**
customers than the same company owning nothing. Merit wins were monotonic; the
whole inversion was in the overflow.

Customers a full rival turns away are shared among the companies with room, in
proportion to `appeal² × reach × fit` — and that took no account of how much
room each one had. A rival 105 customers short of its own capacity took 96.9%
of the claim on 45,695 people, kept its 105, and the other ~44,000 evaporated
instead of passing to the newcomer with room for 27,373. It only had room
because the *stronger* newcomer had taken enough on merit to leave it short, so
improving the product moved the newcomer from all of the overflow to a
thirtieth of it.

Each claim is now scaled by the share of the rejected a company could actually
hold — `weight × min(1, room / count)`, a single pass rather than a
redistribution, which is what an earlier water-filling attempt got wrong. The
year is monotonic: **13,673 plain · 17,108 patent · 17,588 deal · 21,638
both**. `SPILL_TOPUP_MAX` comes down from 8 to 3 with it, and that also fixes
two things the earlier attempt broke — a passive company loses money again, and
a bought region is worth its price.

The four-team bar in `balance.test.ts` was re-derived from 4% of market
potential to 3%, with the reason written there: closing the leak sends the
turned-away to whoever can use them, which in a crowded market is the strongest
company, and every also-ran came down about 15%. All four teams still finish
with real companies — 471,887 / 1,250,246 / 73,351 / 87,212 customers, none
bankrupt — so what the bar stands for is unchanged.

### Closed: the smallest generated markets paid for it, and have been paid back
Closing the overflow leak took `SPILL_TOPUP_MAX` from 8 to 3, and the two
smallest generated markets lived on that top-up. Measured over eight seeds and
eight strategies, seeds with a plan that turns a profit:

    quorumcast   8/8 → 5/8 with events off, 8/8 → 7/8 with them on
    hearthmap    8/8 → 7/8 with events off, 8/8 → 8/8 with them on

`PRICE_ROOM_FOR_A_BUSINESS` from 25 to 28 gives them back — 8/8 with events on
for every generated market, which is the condition real play runs in. Twenty-
eight is the least that does it, and the reason not to go further is what it
costs the fiction: at 40 the sea-swimming app's prices go to £121 a year, which
is not a swimming app any more. At 28 it is £35.

`pricedForABusiness` also now converges in twelve passes rather than four.
Raising prices raises what a market is worth, which raises what its people
cost, so each pass closes only part of the gap; four of them stopped about 5%
short of the bar rather than at it.

### Closed: no test exercised a market Nova wrote
`every-market-winnable.test.ts` walked `NICHES` — the seven hand-written
markets — and was most of the balance contract in this repo. It had never once
touched a generated market, which is how the regression above went through CI
green and was only caught by a scratch harness.

It now builds four markets through the same `buildCustomMarket` the server
uses, so `openShareFor` and `pricedForABusiness` are exercised rather than
assumed: a marketplace whose biggest segment is its cheapest, a consumer app
whose biggest segment pays about what it costs to serve, a public-sector B2B
market with few buyers and six regions, and one with real money in it. They are
small on purpose — every market generated from a real brief came back under
£33m a year and most under £700,000, which the hand-written seven cannot stand
in for.

A fourth property is asserted for these that the catalogue markets are not held
to: **the season can be run at a profit**. That is what the overflow change
cost, and the other three — wins customers, stays solvent, beats filing nothing
— all passed throughout it.

**Two harness lessons in one day, both of which produced wrong numbers.** The
5/8 above was measured with events *off* while a second harness measured the
same market at 7/8 with them on, and the two were compared as though they were
the same thing. Before quoting a number from a scratch harness: check what it
is holding constant.

### Closed: the join between a real company and a season had no tests
`company-baseline.ts` turns a business's weekly check-ins into a starting
position for the simulator. It is read by `decision-sim-routes.ts`,
`marketing-routes.ts` and the desk in the client, and it had **no tests at
all** — 168 lines of translation between the two halves of the product, which
is exactly where a number drifts without anybody noticing.

Ten cases now hold it to the contract it documents for itself: a week's
takings become a month's revenue, cash is the *latest* filed balance rather
than an average of the bank, a field the owner has typed is never overwritten,
and what the check-ins cannot answer is reported as missing rather than
invented — no cost base derived from a margin from a revenue, and a software
company's new-revenue figure is not read as a total.

Checked by mutation rather than assumed: dropping the owner-override guard
fails one case, and taking cash from the oldest week instead of the newest
fails another. A test that passes against the bug it was written for is worth
nothing, and two of the findings in this document were exactly that.

### Closed: a season in flight would have been repriced under the players
`marketOf` rebuilds a season's market through `buildCustomMarket` on every
read — deliberately, because the stored row may have been written by an older
version of this code. That is safe while the cleaner only *clamps*: run a bound
twice and nothing moves.

`openShareFor` and `pricedForABusiness` are not bounds. They open a market up
and raise its prices until a business is possible in it. Measured against
markets stored before those rules existed, the next read would have done this:

    kiln firings     prices x6.3   open share 0.10 -> 0.35
    sea swimming     prices x35.0
    parish minutes   prices x4.9
    shift swapping   prices x1.0   open share 0.10 -> 0.21

A company that priced at 20 against a reference of 15 would come back to find
itself priced at 20 against 95 — cheap beyond anything it chose, every
expectation and ceiling in its market moved, halfway through a season it was
playing. Nobody gets to change the game under the people playing it.

Both transformations now happen when a market is *written* and never again
(`BuildOptions.fresh`, set by `parseMarket`). A read gets all of the validation
and none of the rewriting, so a season keeps the market it started with and a
new one gets the rules. The round trip was checked first and is stable —
building twice moves nothing — so the risk was only ever across versions, which
is exactly the case a rebuild-on-read is there to handle and the one it could
not handle here.

The trade is stated plainly: a season started before the rules keeps a market
that may be hard or unplayable. That is the right side to err on, and it stops
mattering as those seasons finish.

### Closed: `opening.ts` is wired
169 lines that were written, finished, and connected to nothing — no import, no
column, no control. Now a season can open two ways, which is what it was for:

  - **Funded and level** — money in the bank, a credit line, nobody to serve,
    everyone identical. Every season until now, and still the default, so
    nothing changes for anybody who does not ask.
  - **Where you actually are** — the cash, credit, rating and customers the
    work so far implies. Its own comment makes the case: "a simulation that
    hands them six million pounds is teaching them to run a company that is not
    theirs."

Five pieces: `simSeasons.opening` and `simSeasons.openingStanding` (migration
0087, both additive with defaults so existing rows are untouched), a standing
snapshotted from the project's path at creation, `buildWorld` applying
`atStanding` after `startingCompany`, the tick passing the season's choice
through, and a control beside the cadence picker.

The standing is taken **once, when the season is made**, not read live: a
season is a fixed question about a fixed starting point, and a founder who
ticks off three milestones in week two has not changed the company they
started with.

Eight tests, and the two that matter most are the ones about what did *not*
change: a competitive season is bit-for-bit what it always was even when a
standing is supplied, and no project — however far along — opens richer than
the funded contest. "Where you actually are" is a different question, not a
bonus.

### Closed, mostly: the score had no term for whether the business worked
`valueOf` was `sales x 1.2 + assets - debt`. Nothing in it asked whether the
sales paid for themselves, so volume was the whole of it. Measured across
twelve markets and nine ways of playing them, over every pair where one company
clearly made money and the other clearly lost it:

    before   21 of 70 pairs (30%) ranked the profitable company below the loss-making one
    after    15 of 70 (21%)

In restaurant chains a plan earning £58,772 a quarter came eighth of nine while
one losing £49,122 came fourth.

There is now an earnings term at six times annualised profit, bent into a band
of 0.75 of a year's sales either way. Both halves are necessary and both were
found by failing:

  - **Unbounded** an eight-times multiple fails in both directions at once. A
    heavy loss drives every company in a hard market to the zero floor, where
    they all tie and the score says nothing; and on the other side it makes the
    company that spent nothing and banked a small profit the best-scoring one
    in four markets.
  - **Hard-banded** it ties again, at the band edge this time. Two companies
    with identical sales and very different margins scored the same to the
    pound — which is the third time a hard bound has produced exact ties in
    this engine, after the spill and the intake.

So the band is `tanh`, which approaches it without ever arriving: more earnings
is always worth more, and the bound still holds.

Twenty-one per cent is not nought, and the remainder is the band doing its job
— a company with enormous sales and a small loss still outranks a tiny
profitable one, which is defensible and is what the bound is for. Going further
means weighting earnings until they decide the season, and that fails the tests
above.

This was also the thing the plant's dominance kept pointing at: there was no
route to the score except customer count. There is one now, and it is worth
re-running the four capacity experiments against it before concluding anything
further about the plant.

### Open, and a product question: nothing a founder decides pays off in a monthly season
Balance had only ever been measured quarterly. Running the winnability sweep at
a monthly rhythm found it immediately. Building the business, measured against
doing nothing at all, by how many years the season runs:

    podcasts          2yr 1.00x   3yr 1.00x   4yr 1.49x
    project_saas      2yr 1.00x   3yr 1.00x   4yr 1.41x
    restaurant_chain  2yr 1.01x   3yr 1.02x   4yr 1.25x
    dating_apps       2yr 1.01x   3yr 1.01x   4yr 1.58x
    mmos              2yr 1.08x   3yr 1.08x   4yr 1.72x

`DEFAULT_YEARS` gives monthly two years, reasoning that "every lag in this game
is a year long ... two years is the shortest span in which a monthly table sees
its own work arrive". The direction was right and the number is not.

**It is not the rhythm.** A *quarterly* season cut to two years is just as flat
(3,057,729 doing nothing against 3,051,750 spending), and a monthly season given
four years pays *better* than a quarterly one (12,768,910 against 11,072,392).
It is the length, and monthly is simply the cadence whose default is short.

That matters more than it sounds, because monthly is the option the product
offers as "closest to your actual week" — the one a founder rehearsing their own
business is steered towards, and the one where nothing they decide pays for
itself.

**Shorter lags were tried and are not the answer.** A monthly season releasing
its queues faster than real time — brand over six months rather than twelve,
room sooner, a hire useful in half the time — leaves the two-year case exactly
where it was at every speed tried:

    MONTHLY_LAG_SPEED   2      3      4      6
    podcasts   2yr      1.00x  1.00x  0.99x  0.98x
    project_saas 2yr    1.00x  1.00x  1.01x  1.00x
    dating_apps 2yr     1.02x  1.02x  1.02x  0.99x

And the faster settings make longer seasons erratic rather than better
(restaurant chains at four years goes 1.25x to 0.95x, mmos 1.72x to 0.99x). So
the flatness is not the lags: it is time in market. Customers come out of the
unowned pool at a rate the pool and the plant bound, and two years is not long
enough to take much of it however fast brand and quality arrive.

What is left is a season far longer than a fortnight, or accepting monthly as a
short flat rehearsal. What was done instead: the winnability guard now runs
monthly and holds it to customers, solvency and running at a profit, with this
measurement written where it will be read.

Worth noting the near-miss. A first run of the monthly sweep looked like a
cadence bug — one market went bankrupt and annualised costs came out 15x
quarterly's. It was the harness spending a share of the bank *per decision*
rather than per year, so a monthly season spent three times as much: marketing,
product and operations all came out at exactly 3x annualised while salaries and
idle capacity matched, which is the tell. Third time this week the harness was
the finding.

### Re-run against the new score: the plant is a big decision, not the only one
The four capacity experiments were worth re-running once the score had a term
for earnings, because what they kept pointing at was that nothing reached the
score except customer count. Two things came out of it.

**The earnings term does not reduce the plant's pull** — 4.62x becomes 5.39x at
worst. A fuller plant is more revenue *and* more profit, because the fixed costs
are already paid, so the new term rewards it as well. Construction and
restaurant chains improved (2.29x to 1.57x, 2.75x to 2.09x); podcasts and drone
delivery got slightly worse.

**But the plant was never the dominant lever, and the earlier framing was
wrong.** Set against the spread across ways of playing the same market:

    restaurant_chain   best-to-worst strategy 7.6x   ·   cutting the plant 2.09x
    project_saas       best-to-worst          7.8x   ·   cutting the plant 3.17x

The plant is worth a third to a half of what the rest of the decisions are worth
between them. "Keeping room decides the season" was measured against nothing
else, and it does not survive being measured against the alternatives.

What the new score visibly fixed, in the same table: `cheap` in restaurant
chains has the second-highest revenue in the market and loses £49,122 a quarter,
and it has gone from fourth of nine to **last**. The two profitable plans it used
to beat, `premium` and `lean`, have both passed it. That is the scoring change
doing exactly what it was for.

So this is downgraded from a defect to a fact about the game: capacity is a good
investment and retiring it while you could still sell is a real mistake, priced
about as heavily as one or two other bad calls. Nothing further is owed here
unless the ratio moves again.

### Closed by measurement: keeping room decides the catalogue season
Identical spending, the only difference being whether the plant is cut toward
what is served: keeping it is worth **2.3x to 4.6x** the company's final value
in every hand-written market, and 1.3x in the markets Nova writes.

Four things have now been tried against it, and the way they fail is more
informative than any of them individually:

    the rent          IDLE_RATE 0.08 -> 0.40     4.62x -> 2.49x, 21 tests broken
    the overflow      SPILL_TOPUP_MAX 8 -> 1     4.62x -> 4.70x, no effect
    a bound on wins   room still free to receive 4.62x -> 4.46-5.30x, worse
    a bound on both   hard, saturating, and
                      sub-linear intake          4.62x -> 2.5-4.1x

The third one is the tell: bounding what a company can *win* while leaving its
room free to *receive* made the magnet worse, because the customers the bound
stops you winning become somebody's turned-away and the big plant takes them in
as spill instead. The pressure does not go away, it moves.

The fourth is the other tell. A hard ceiling ties every company that reaches
it — four tests failed on exact ties, including a company with a patent and a
distribution deal winning precisely as many customers as one owning nothing,
which is the fault this engine has already had once. A saturating ceiling ties
them slightly further up. Sub-linear intake (`limit * (asked/limit)^0.5`) has no
ceiling and no ties, and at the loosest setting that leaves only three tests
failing the magnet is back to 4.14x — which is to say, gone.

**The likely reading: this is not a mispriced constant.** Capacity is the
binding constraint on customers, and customers are the only thing the season is
scored on, so anything that reduces what capacity is worth reduces what playing
well is worth by the same amount — they are the same lever seen from two ends.
Making the plant matter less means giving the other decisions a route to the
score that does not run through customer count: margin, retention, what a
customer is worth rather than how many there are. That is a design change to
what a season measures, not a number in `market.ts`, and it should be taken
together with the valuation having no profit term (above).

Four experiments are written down here so the fifth person does not run them
again.

