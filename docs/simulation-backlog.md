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
10. ~~Capacity "maxed at 8,000" was the quarterly build lag, not a cap: asking
    20,000 from 5,064 opens 8,798.~~ **Nothing owed** — explained on the lever and
    marked on the forecast bar already. Struck through rather than left looking
    open, which is what it was doing.

### ~~Market share reads as nothing on a world map~~
~~A company that opens in Leeds holds about 0.2% of the world market, and the
standings say so. That is true and it is useless: a team winning its own
continent reads as a rounding error.~~

**Done**, as proposed: the headline is the share of the regions you sell in, and
the world reading sits beside it — `sharesWhereSold` in `market.ts`,
`shareWhereYouSell` on the report and the standings payload, `shareReading` on
both clients.

Two decisions worth knowing about, because both are the kind a later change
would undo without noticing:

- The denominator is everyone's customers scaled by the company's own `reachOf`,
  which makes it **exactly** `marketShares` at full reach. That is deliberate and
  tested: the two numbers sit on one row, so a company that has finished
  expanding has to see them agree to the last decimal, or the table is arguing
  with itself. It is an approximation in the other direction — it assumes a
  company's regions hold their weighted share of the market's customers, because
  `allocate` reports who was won per segment and not per region.
- The world reading is suppressed when the two render the same *string*, not when
  they are the same number. 23.14% and 23.02% both print "23%", and a row reading
  "23% where it sells · 23% of all" is worse than printing nothing.
- The bar on the phone's table stays on the world reading, so bars remain
  comparable down the table.

### Closed: the phone had no Past and no Future

The web desk has three tabs — what just happened, what to do about it, where that
leads — and the phone had one long scroll that was almost entirely the middle one.
Both missing screens now exist as routes, `/sim/past/<venture>` and
`/sim/future/<venture>`, linked from the desk in the places they belong: the
record under last year's report, the forecast above the levers.

**Nothing new was added to the wire.** `lastFiled`, `standing`, `forecast` and
`idleCostPerUnit` had all been in the desk payload since the web screens were
built; no phone code had ever read any of them. That is the whole shape of this
bug and it is worth remembering next time something looks absent.

What each screen was costing:

- **Past.** The phone could say what happened to a company and never what the
  five of them did to cause it. Decisions live on the desk for a fortnight and
  then vanish; sealed bids are deleted the moment they settle. A phone-only table
  could lose a third of its cash at auction and afterwards have nothing to look at
  but one line of prose saying so. Now: every lever as filed, per seat, with the
  seats that filed nothing named — the caretaker ran those, which is the most
  useful thing a table can learn from the year behind it — plus how each sealed lot
  settled, and where every company sits.
- **Future.** The sharper loss. A phone operations seat set capacity against
  *nothing at all*, while a teammate on a laptop had the demand range, the room,
  what empty shelves cost if the year came in low and what walks to a rival if it
  came in high. Capacity is the one lever that binds in both directions and it was
  the one the phone asked people to guess at.

Two things found while building it, both fixed:

- `desk.niche` on the phone was typed `{ id, name, premise }` and the server has
  always sent `voice` as well, so every phone screen said "customers" whatever the
  business was. Construction calls them **clients**; a restaurant counts covers.
- `Card` in `mobile/src/components/ui.tsx` took no `testID`, so every card in the
  app tagged an inner `View` instead — putting the handle on a box inside the card
  rather than on the card, and on a pressable card, not on the thing taking the
  press.

The arithmetic lives in `mobile/src/components/sim/past.ts` and `future.ts`, both
free of React Native so `test/unit/mobile-mirror.test.ts` can load them. It now
checks the phone's `capacityRisk` against the engine's at every verdict boundary,
its `readDecision` against the web's on the same payload, and its
`ORDER_FAR_TOO_MUCH` against the web's by reading the constant out of the source —
that last one textually, because it is a local const inside `ForecastCard` and
nothing else in either suite would notice it moving.

`mobile/scripts/phone-contract.ts` drives both screens against a live server, and
now resolves a year first so the Past checks run against a real record rather than
reporting "not reached" in year one. 37 checks, construction: forecast likely
1,205 in a band of 0.35, idle room at 125.13 each, "Room to spare: room 1,875 vs
783–1,627", four of five seats named as having run on the caretaker, and the
market's word for its customers arriving as "clients".

### The phone has not caught up
~~The expansion vote is the sharp one: a phone player can cast the vote (it is a
`levels` lever and `LevelsField` draws it) but never sees the region, its cost,
who voted or whether it carried — the card whose whole point is showing what
your colleagues think is web-only.~~ **Done 1 Oct 2026**, and half of it was
already untrue: `LevelsField` does render an option's `help`, and the desk route
puts the region's name, its price and the brand-ramp warning in there, so the
phone always showed *what* was being voted on. What it could not show was the
rest of the table — who had voted, which way, and whether it carried — on the one
decision whose whole point is finding out what your colleagues think.

`ExpansionVoteCard` reads the `expansion` the payload has always carried, at the
same slot the web uses. The semantics worth knowing are in `proposed`: a region
is *announced* to everybody every year and nothing is decided until the
operations seat puts it up, so an unproposed region says "Not put up" rather than
showing five seats that have all failed to vote — telling four people their
colleagues refused something none of them was asked is worse than saying nothing.
Pinned by `mobile/src/components/sim/expansion.test.ts`. ~~The teammate and rival-company profiles have
no phone counterpart either, so nudging a seat that has not filed is web-only~~ —
**nudging is done, 1 Oct 2026**; the two profile screens are not.

Nudging was the wrong way round rather than merely missing: a phone player could
already *receive* one — `sim_nudge` has had an icon in the notifications tab all
along — and had no way to send one, on the client somebody actually has in their
pocket when a year is closing. It is a button on the table card now, and
`canNudge` agrees with the server's four refusals (yourself, a seat that has
filed, a stand-in that files without being asked, an empty chair) so that the
button never appears where the request would be turned down. The server's own
wording is passed through rather than flattened, because "that seat is a stand-in"
and "they have already filed" are different things to be told.

~~What is still web-only is the two profile screens themselves — the teammate's and
the rival company's — and neither is URL-addressable, so the in-app browser
fallback cannot catch them either.~~ **Done 1 Oct 2026**, as *routes* rather than
modals — `/sim/seat/<venture>/<user>` and `/sim/company/<venture>/<company>` —
which is the half of the complaint that mattered: the web's are dialogs with no
address, so nothing could link to them and the in-app browser fallback had
nowhere to land. The desk's table rows and rival rows open them.

The seat screen answers the question a desk cannot: the desk says "still
deciding" and nothing about the eleven periods before it. `turnoutRead`
distinguishes somebody who missed three early from somebody who has missed the
last three, which read identically when only totals were reported.

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

15. ~~**Bots never expand.**~~ **Not a defect in the configuration that ships.**
    Chased twice on 1 Oct 2026, fixed, reverted, and then measured properly —
    which is the only part of this worth keeping.

    The entry claimed bots never expand, pointing at the empty `expand` lever.
    That lever is deliberately empty (a bot table voting with itself is noise);
    bots open regions through the marketing seat's `targetCities`. The question is
    whether they do it enough, and the answer depends entirely on **what else is
    in the market** — which is what made this so easy to get wrong:

    | measured over sixteen quarters | regions a bot reaches, of ten |
    |---|---|
    | one bot alone against the incumbents | **2–4** |
    | four bots and a competent team, as a season actually runs | **6–10** |

    A bot alone has an uncontested market, so its plant never fills, so the
    `load > 0.8` trigger never fires and it looks trapped. Put rivals in the
    market and demand is contested, plants fill, and the trigger fires plenty. The
    first figure is the one that produced this entry, and it is not a season.

    Two attempted fixes are recorded because both are tempting and both are wrong.
    Adding the opposite trigger (`held > 0 && load < 0.45`) makes **every bot in
    every market open its second region in period two** — a two-period-old company
    is serving a handful of people against the plant it opened with, which looks
    identical to being stranded and is just being new. Narrowing it to the recorded
    symptom (one region, three years in, money to leave) fixes that and still
    changes five markets of seven, because one extra region brings customers,
    which fills the plant, which trips `load > 0.8`, which opens another: a narrow
    nudge cascades.

    The recorded symptom — a bot holding 2.0% in one region for six years — is
    real and rare: **1 of 42** bots never leaves its opening region. Whatever was
    wrong with that company, "bots cannot expand" was not it.

16. ~~**`targetCities` bypasses the expansion mechanic entirely.**~~ **Largely
    landed, and this entry had gone stale.** Re-read 1 Oct 2026: the change this
    entry says was "tried and reverted" was in fact landed, at a floor rather than
    at nothing. `boughtReach` floors a bought region at **50%**
    (`BOUGHT_REACH_FLOOR`) against the announced door's 15%, applied in
    `resolve.ts` to every region `targetCities` opens — so the row in the table
    below that said "first-year reach: full" has not been true for some time, and
    the comment on `BOUGHT_REACH_FLOOR` records the measurement: 0.15 fails the
    catalogue, 0.4 upwards passes, and at 0.5 "the rule bites through both doors
    now, and the door you pay 30% more for is the one that gets you further in."

    What remains is a real choice rather than one door and a worse door:

        | | buying (cmo `targetCities`) | announcing (coo `expand`) |
        |---|---|---|
        | available | period 1 | year 4 |
        | which region | any | the one announced |
        | agreement | none | a majority of the table |
        | opens | immediately | next year |
        | first-year reach | `brand/60`, floor **50%** | `brand/60`, floor 15% |
        | cost | 100% | 70% |

    **The part that was still broken was the guide, and that is fixed.**
    `docs/playing-your-own-season.md` taught one floor — 15%, the announced
    door's — and worked an example through it: "a brand of 20 reaches a third of
    it in the first period." For the door available from period one, which is the
    one most people find first, the answer is *half*. It now carries the table
    above, and both mentions of the ramp say which floor applies to which door.

    `test/unit/two-doors-into-a-region.test.ts` pins the guide's numbers against
    the engine — both floors, the shared `brand/60` rate above them, the two
    unlock years and the discount — so the next drift fails a test rather than
    quietly misleading somebody who read the instructions.

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

### From driving the app at two hundred players, 30 Sept – 1 Oct 2026

Measured rather than reasoned about, with `scripts/sim-load.ts` — the HTTP
driver `docs/ops/scaling-to-2000.md` step 0 asks for, which did not exist until
now. Two hundred real accounts, joined to one market in the same instant, racing
for the same seat, then polling at the intervals the client actually uses.

**What held.** Every concurrency invariant, at two hundred: 44 rooms, none over
five seats, nobody seated twice, one person per chair, and the seat race
producing exactly 156 `role_taken` refusals (39 tables × 4 losers). Joins queued
through their per-market advisory lock at ~85/s, worst wait 2.9s. The simulation
was never the bottleneck at this size.

**Fixed on the way through, both found by running it and neither findable by
reading:**

- A lobby the bots had just filled sat unstarted for its whole fifteen minutes
  if nobody was watching it, and a season starts only once every one of its
  rooms has left the lobby — so one person who joined and closed their tab held
  up the other thirty-nine in their season. `settleLobbies` sweeps only lobbies
  whose *deadline* has passed; the bot filler ran an hour earlier and advanced
  nothing. Measured before the fix: bots seated at 60s, and ten minutes later
  the room was still `filling` with five seats and 2m40s left on its clock,
  while the tick ran every minute throughout and settled other lobbies. After:
  111s. (`simulation-tick.ts`, the `bots.filled` loop; held by
  `sim-tick.test.ts`.)
- The room screen polled every two seconds for the whole season rather than
  only while the room was gathering, which made it the largest single source of
  requests in the product — about a hundred a second at two hundred players,
  each one advancing the lobby and joining three tables to answer a question
  whose answer had stopped changing. Thirty seconds once running, and nothing at
  all for a retired room (`roomPollMs`, held by `credit-refresh.test.ts`).
- Every simulation filing triggered a re-read of `/api/subscription`, and a
  period deadline has every table filing inside the same minute: two hundred
  needless requests arriving together, measured at p95 2.5s purely from queueing
  (the endpoint itself is 17ms). No route under `/api/sim/` charges for
  anything, and the test that skips them also walks the routes and fails if one
  ever starts.

**Not worth doing, with the reason, so nobody re-opens it:**

- *Shortening the join queue.* The 2.9s worst case is queue time, not work —
  about 13.5ms of lock held per joiner, which is already tight. The lock is
  per-market because two joiners who cannot see each other both create a season;
  narrowing it to per-season reintroduces that race to save a wait nobody would
  abandon the product over.
- *`/api/subscription`'s four sequential awaits.* 17ms idle. The p95 was
  queueing behind the filing burst above, and "optimising" it off that reading
  was very nearly done before it was measured on an idle server.

**Owed.**

20. **A season waits for its slowest table, and at two hundred players it always
    pays.** *(The wait is accepted; what it was being explained as, on the phone,
    was not — fixed 1 Oct 2026, see the end of this entry.)* Measured: the first table ready waits **358 seconds** for the last in
    its season. That is the designed chain — 60s for bots, 180s claiming, 120s
    naming — triggered by one human who sits idle, which at forty people a
    season is near-certain. Accepted deliberately for launch rather than fixed:
    the options are to shorten a straggler's clocks once the rest of its season
    is ready, or to start without them, and both change what the lobby promises.
    Worth revisiting against a real session rather than a load run.
    **What was fixed, since the wait itself is accepted.** The web desk has long
    explained it properly — "Year one begins once the 3 rooms still choosing seats
    have finished — usually a minute or two, and never more than twenty" — and
    distinguishes a solo table, a market where every room is in, and one still
    waiting. The phone said **"The table is still filling"** whatever was true, and
    that is usually the wrong reason: a season waits for *every* room, so the
    common case by far is a table that has claimed every seat and named itself,
    waiting on strangers. Telling those five people they are the hold-up, for the
    six minutes this entry measures, is the worst version of an accepted wait.

    `roomsStillChoosing`, `yourRoomReady` and `solo` have been in the payload since
    the wait was given a shape; the phone did not read them. `notStartedReason`
    now says which of the three is true, and says "Your table is ready" when it is.
    Held by `mobile/src/components/sim/expansion.test.ts`.

21. ~~The crowded-market balance is verified on one market.~~ **Done.**
    `balance.test.ts` runs eight teams — what a full public season actually
    deals, since `MATCH_MAX_ROOMS` caps a season at eight tables — in **every**
    market, three season ids each. Crowding turns out to *improve* every measure
    rather than strain it: in `dating_apps` the best team's share falls from 26.6%
    at four teams to 13.2% at eight, and across all seven the worst case of each
    measure leaves a wide margin on every threshold the suite asserts:

    | | best team's share | incumbents keep | also-rans standing |
    |---|---|---|---|
    | threshold | under 60% | over 20% | at least 2 of 7 |
    | worst market | 24.1% (`project_saas`) | 49.4% (`project_saas`) | 5 of 7 |
    | best market | 3.1% (`drone_delivery`) | 70.1% (`restaurant_chain`) | 7 of 7 |

    One thing it corrected: the note below about a wiped-out plan says "always
    `cheap`", and that was only ever true of `dating_apps`. Across the other
    markets `grower` is wiped out too — in construction, project_saas and mmos —
    and `project_saas` loses somebody in five seasons out of eight against
    `dating_apps`' three. Which is the better evidence for the conclusion in that
    note: it is about what a fixed plan does after a bad year, not about which
    plan it was.
22. ~~No fixture strategy ever responds to distress.~~ **Done, and it found
    something.** `balance.test.ts` has a `survivor` plan that reads `distressOf`
    and acts — cuts spending to `focus: "survival"`, prices up rather than down,
    stops opening regions, holds cash back — and a `makeSurvivorRescue` that takes
    recovery moves. Recovery is applied the way the tick applies it: a move chosen
    during the year, applied to the world *before* `resolveYear`.

    **The module's central promise now has a test.** "A team that trades well can
    still climb back" was unchecked by anything that plays; the best available
    move is worth more than 1.2× doing nothing, and the rescue raise is the one
    that actually clears insolvency rather than slowing the fall.

    **What the measurement found.** Forcing exactly one move, the first year the
    company is in trouble — insolvent after one ruinous year, with debt and no
    assets:

    | | nothing | restructure | dissolve_seat | rescue_raise |
    |---|---|---|---|---|
    | seed arc | 59m | 57m | **92m** | 78m |
    | seed arc2 | 51m | 46m | **158m** | 83m |
    | seed arc3 | 47m | 45m | **73m** | 70m |

    `dissolve_seat` is much the strongest, and it is not a fixture artifact —
    `decisionsForYear` iterates `company.seats`, so the dissolved chair's levers
    really are gone, and the salary saving outweighs them anyway. `restructure` is
    **negative**: six reputation and a two-year spending cap against three points
    of interest relief on a modest debt. That is not a defect — `recoveryOptions`
    says it orders by how much of the company survives a move, not by how much the
    move helps, and each one's copy states its cost plainly. It does mean **a team
    taking the first thing offered takes the worst of the three**, which is worth
    knowing before anybody treats the order as advice.

    Two things the tests deliberately do *not* claim. The ranking above is for one
    position; a company that owns things would be offered the fire sale, which is
    never offered here. And the rescue's value turned out to be mostly in clearing
    `bankruptSince` rather than in the cash — removing the cash injection entirely
    left the season-level test passing, because the flag is what lifts a company
    out of administration. The money is pinned by a direct test of `applyRecovery`
    instead.

23. **The load harness has only ever run on one laptop**, with the generator and
    the database beside the server, so every latency is pessimistic and every
    throughput a floor.

    **Demonstrated rather than merely asserted, 1 Oct 2026.** Three attempts at a
    `--client mixed` measurement were abandoned because the machine was carrying a
    load average of 21, then 57, then 59 — twice from another session building, once
    from this one running its own unit suite alongside the load run. On a shared
    laptop the latency columns cannot be measured at all when anything else is
    happening, which is a stronger statement than "the numbers are floors": for
    latency there are no numbers. Request *counts* and the invariants are unaffected,
    which is why those are the figures quoted elsewhere in this file. Step 0 of `docs/ops/scaling-to-2000.md` is not actually
    closed until it is run from a second machine against the tier being bought.
    It is at least runnable by name now — `npm run load:sim -- --users 200` — and
    it exits non-zero on a broken invariant or a missed budget, so it can be a
    gate. Nothing uses it as one yet, which wants a decision about where: it
    takes nine minutes and needs a database, so it is a nightly job rather than a
    pull-request check.
24. ~~The phone's polling was never inventoried.~~ **Inventoried 1 Oct 2026, and
    it differs enough to matter.** `sim-load.ts --client mobile` now replays it,
    so the comparison is measurable rather than arguable. Every simulation screen
    on the phone shares one constant — `ROOM_POLL_MS = 2_500` in
    `mobile/src/components/sim/useSim.ts` — where the browser tunes each screen:

    | | browser | phone | |
    |---|---|---|---|
    | the desk | 8,000ms | **2,500ms** | 3.2× |
    | standings, embedded | 60,000ms | **2,500ms** | **24×** |
    | standings, own page | 30,000ms | **2,500ms** | 12× |
    | the market | 15,000ms | **2,500ms** | 6× |
    | offers | 15,000ms | **2,500ms** | 6× |
    | the venture list | not on a timer at all | **2,500ms** | phone only |
    | credit balance after a write | skipped for `/api/sim/` | no such hook | phone lighter |
    | messages count | 10,000ms | 20,000ms | phone lighter |

    Two of those are worth a decision rather than a shrug.

    **The venture list was polled from a tab.** ~~`useVentures` is mounted by the
    Sprints tab as well as the simulation index, so a phone user who never opens a
    season asks for `/api/sim/ventures` twenty-four times a minute.~~ **Fixed.**
    The poll exists because `ventureRoute` reads a row's phase, and the only
    route-changing flip is *into* `running`, which can only happen to a row that
    is not running yet — so `venturesPollMs` keeps the fast rate exactly while
    one of those is on the list and goes to thirty seconds when none is. That is
    the stated reason for the poll, honoured rather than overridden. Measured at
    two hundred players: 6,905 requests in ninety seconds became **600**, the
    phone's total fell 15,327 → **9,325**, and the run went from failing its
    filing budget to passing.

    **Still owed: standings and the desk, which are now almost all of it.**
    `useStandings` at 2.5s is deliberate and was priced before anybody measured
    it — the comment makes the trade openly, "one number to change is worth more
    than the handful of requests a slower one would save" — and that is a fair
    call; it is just that the handful is 24× the browser's rate on a figure that
    changes once a period. With the list poll fixed, standings (3,483 requests)
    and the desk (3,442) are **74% of everything the phone asks for**, and the
    phone is still 2.2× the browser rather than 3.6×.

    **Both now done, and the desk's answer did follow from its own purpose after
    all.** The reason given for its 2,500ms was "the year resolving underneath the
    screen is precisely what a player wants to be told about" — true of the minute
    before a year resolves and not of the twenty-three hours before it, and the
    desk payload already carries `resolvesAt`, so it does not have to guess which
    it is in. `deskPollMs` is 2,500ms inside a minute of the resolution (and past
    it, since the tick can run a little late) and the browser's 8,000ms otherwise,
    which is still live enough to watch a teammate's filing arrive. Note the
    direction: nothing about the moment that matters got slower.

    Standings could not be adaptive the same way, because `StandingsView` carried
    the year, the status and the rows and no deadline — so the standings response
    now carries `resolvesAt` too, as the desk's always has, and
    `standingsPollMs` is 2,500ms around the tick and 30,000ms between ticks. Both
    directions improved: the screen somebody is most likely to be staring at when
    a year lands is now *quicker* than the old flat rate, and it costs nothing for
    the rest of a period during which the table cannot change at all. A response
    with no deadline rests rather than racing — an unknown deadline is not an
    imminent one.

    **Two left alone, deliberately.** The market and offers screens still poll at
    2,500ms where the browser uses 15,000ms, and their reasons are specific and
    about somebody else acting on their own phone: a rival can list an asset at any
    moment, and "an offer is a question put to five other people… both the asking
    and the answering happen on somebody else's phone." Those are live
    negotiations on screens a person visits deliberately rather than sits on, so
    the pattern that fixed the others does not apply, and applying it anyway would
    be the mistake this entry started out making.

    Measured end to end, two hundred players, ninety seconds of play:
    **15,327 → 9,325 → 4,099 polled requests**, which is now lighter than the
    browser's 4,261. Filing p95 went 3,071ms → 819ms, and the phone profile went
    from failing its budget to passing.

    One behavioural difference, not a load one: `useVenture` stops polling
    entirely once the phase is `running`, so a phone left on a running room never
    notices the season ending. The browser catches it within thirty seconds.

25. ~~A phone left on a running room never notices the season ending.~~ **Fixed.**
    `useVenture` stopped polling on `running` as well as `retired`, on the
    reasonable-looking grounds that a trading company has nothing left to
    announce. It has one thing left: the season ending. So the screen went on
    saying "your company is trading… it's yours for the season" about a season that
    was over, with the `retired` branch that would have said otherwise two hundred
    lines below it and unreachable. `venturePollMs` now rests at 30s while running
    — the browser's rate, and for exactly this reason — and stops only on
    `retired`, which is genuinely final.

26. ~~The harness measured itself wrong three times.~~ **Fixed — and the fixes
    are worth knowing about before trusting its output.** All three were found in one
    suspicious `--client mixed` run — p95s of five to ten seconds across every
    endpoint at the *lowest* request volume ever measured — which is the shape of
    a result that is about the instrument rather than the subject.

    - **The bystander probe was not signed in.** It asked for `/api/sim/niches`
      with no cookie; `isAuthenticated` answers 401 and returns before `next()`,
      so it never reached the session store, the database or a handler. It
      measured whether the process would accept a connection and run one
      middleware, and reported a steady 3ms while everything around it took five
      seconds. It holds a real session now and asks an authenticated count.
      What that invalidates: the reading "a bystander was as fast as idle while
      200 played". What it does not: every request *count*, every invariant, and
      the password-hashing finding — a 401 the process cannot answer is a thread
      that is not running, which is exactly the symptom, and that one was
      corroborated by measuring event-loop lag directly.
    - **`--client mixed` only ever produced two of its four combinations.** The
      client and the screen were both chosen on `i % 2`, so every browser user was
      at a desk and every phone user in a room. The giveaway was `poll room·w`
      missing from the results table altogether.
    - **It could not tell a busy laptop from a slow server.** That run's real cause
      was a load average of 21 from another process building on the same machine.
      It prints the load average now and says so when it exceeds the core count,
      because uniform slowness across unrelated endpoints is the signature of
      contention and remembering to check by hand is not a plan.

27. **The join queue costs about six milliseconds a joiner, and the obvious way
    to shorten it is unsafe.** Every joiner for a market waits for the one in
    front, so the wait is that figure times the people ahead: two hundred at once
    measured p50 2.7s end to end, a queue draining at a steady rate rather than
    contention.

    Taken apart with `explain analyze` on a copy with real volume and a timer
    inside the locked section itself (`JOIN_LOCK_SLOW_MS` logs a joiner that holds
    the queue too long). Of the ~6ms: about 1ms of queries, 1.06ms of commit, and
    the rest spread across the seven sequential round trips the section makes.
    Client-side p50 at twelve joiners was 178ms against ~96ms of queue, so about
    half of a join's latency is the queue and half is work outside it — the rejoin
    check, `advanceVenture` after the commit, and the request itself.

    **So round trips are the lever, and the first one anybody reaches for breaks
    the lock.** Folding the advisory lock into the season select as a materialised
    CTE is wrong: `MATERIALIZED` promises the CTE is evaluated once and nothing
    about *when*, so the planner may scan `sim_seasons` first and lock afterwards.
    Measured, twelve simultaneous joiners produced **ten rooms across two seasons
    instead of three rooms in one**, and the hold got four times worse from the
    contention it had stopped preventing. The warning is in the code beside the
    lock. `sim-lobby.test.ts` catches it — and did, when the broken version was
    put back deliberately to check: "five people who press join at the same
    moment" went to 2 rooms instead of 1. That is the test to run after touching
    anything in there, and reaching for the load harness instead is how an hour
    gets spent.

    What is left, if this is ever worth more work: collapse the room search,
    recount and seat insert into one statement. That removes two round trips but
    gives up the authoritative recount, which the advisory lock makes redundant
    *in theory* and which is the defence in depth that caught a six-person
    five-seat room once already. Not worth it for two milliseconds a joiner on a
    machine that cannot measure two milliseconds.

28. ~~**Nothing drives the phone's own screens.**~~ **Addressed 1 Oct 2026, with a
    stated limit.** `mobile/scripts/phone-contract.ts` signs up two accounts
    through the real flow, takes a table through joining, claiming and naming, and
    then runs **the phone's own code against the live payloads** — the poll rules,
    the "why has year one not started" sentence, the nudge predicate, the turnout
    line, the vote's outcome.

    What it does not do is render a screen. `mobile/` has no renderer — its tests
    stub React Native for logic that does not need one — and adding one is a
    dependency decision rather than a test, in a package another session is
    actively editing. So this drives everything between the socket and the pixels,
    which is where both phone bugs found this week actually lived: a room screen
    that told a finished season it was still trading, and a vote whose tally the
    phone received and never showed.

    The check worth having is the **nudge contract**: for every seat at the table
    it asks the phone whether it would offer the button and the server whether it
    would accept the request, and fails on any disagreement in either direction —
    a button that fails, or a reminder nobody can send. That is a class of bug no
    fixture can catch, because a fixture is written by whoever also wrote the
    predicate.

    It distinguishes **"not reached" from "disagrees"**: a season does not start
    until every room in its market leaves the lobby, so a short run legitimately
    never sees a table or a rival, and calling that a failure would make the script
    cry wolf. Unreached checks are counted and named instead.

    `cd mobile && npm run check:phone -- --base http://localhost:5021`. The table
    is **four accounts and a stand-in**, which is a measurement decision rather
    than a convenience: two accounts take six minutes to reach year one, because
    two people cannot satisfy "every seat is taken" so the claiming and naming
    clocks both run in full, and leaving the fifth chair to a bot is the only way
    the "that seat is a stand-in" refusal gets exercised at all. First full run,
    24 checks, including the contract itself:

        nudge agrees for ceo (you)       — phone hides,  server refuses 400
        nudge agrees for cfo             — phone offers, server accepts
        nudge agrees for coo (stand-in)  — phone hides,  server refuses 409 is_bot

    One thing it cannot be: a script up in `scripts/` beside `sim-load.ts`. The
    root package is `"type": "module"` and `mobile/` is not, so importing these
    files from there gets named exports out of what Node treats as CommonJS and
    refuses to load. It lives in the package it tests, and resolves as the app
    does.

29. *(was 28)* `--client mobile` replays the
    phone's *intervals* against the same HTTP API, which answers "what does a
    phone cohort cost the server". It does not drive the Expo app, so anything
    that is wrong in the phone's own code — the stale running room above, for
    instance — is still only found by hand.

## The half of this file that runs

`test/unit/known-imbalances.test.ts` states the properties the sections above
say are missing, as `it.fails` tests. Each carries its measurement in a comment
and fails on the assertion — none of them are skipped, and none pass by
throwing.

The point of writing them that way: fix one of these and **its test starts
failing**, because a `.fails` test that passes is a failure. That is the alarm
telling you what you changed. Drop the `.fails` and the assertion becomes an
ordinary guard against the bug returning.

**Corrected, 2 Oct 2026.** The four items this section used to list as live
`it.fails` tests are not in that file and have not been for some time — and the
file's own header says so: four were fixed (bots opening where no company could
survive; bots unable to pay for a region out of a period's marketing budget; the
annual discount best at its cap; a bot in a thin-margin market borrowing to spend
for ever, which turned out to be drone delivery's biggest segment priced below
what a business there costs) and price tiers were **withdrawn**, because the
measurement behind it compared the best tier setting against no tiers at all,
which asks whether a well-set lever beats not using it. That is true of every
lever in the game.

So the cycle worked, five times, and this section went on naming the inputs. It
mattered because of what it implied: that four known problems had alarms wired to
them. They did not — there was no `it.fails` anywhere in the suite, so fixing or
worsening any of them would have gone unnoticed.

What is in there now: five ordinary guards, left behind by the five that closed,
plus one live alarm —

  - **`it.fails`: a well-played local firm cannot reach 30% of its own town.**
    Measured 2 Oct 2026 after `Segment.innovationPace` made residential
    construction playable at all: peak share went 6.6% → 12.6%, and a firm pushing
    harder plateaus near 15% with quality ~75, against a ceiling of 32.9% that the
    allocator will pay out at quality/brand/service 80. So the target exists and
    the climb to it does not fit in fourteen periods. Whether that is a gap or the
    right answer for a dominant local position against four incumbents is a
    judgement; the alarm is there so that if anything moves it, somebody is told.

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

   **The instrument this needed now exists** (1 Oct 2026): "a competent team
   against bot-run rivals" in `balance.test.ts` plays one strategy against four
   bot companies and reports the person's share, value, rank and survival, plus
   whether the bots are still a market. Every other balance test in that file
   plays against the *incumbents*, so a change in rival strength was invisible —
   which is why the bot expansion attempt above had to be reverted and why
   `plantOverhead`'s "suppresses strong companies too" could not be checked.

   The baseline it records: a competent plan comes first in six markets of seven,
   bots hold 3.5–7.8% of a market between them, and 2–4 of 4 survive a season.
   Those are the numbers a cost-base change has to be measured against.
2. **Rebuild MMOs' market content** — ~~it needs incumbents that are beatable by
   more than one strategy~~ *and* a margin that makes coasting unsafe. Both at
   once, measured against the skill guard, not one and then the other.

   **Half of this is already true, measured 1 Oct 2026.** All four strategies end
   MMOs with a real business — grower 63m, premium 110m, cheap 217m, local 78m,
   a spread of 2.4x best to worst — and its skill premium is 1.55x, the second
   highest of the seven. So "beatable by more than one strategy" is not what is
   wrong with MMOs. What is left is the margin: MMOs is the market where nobody
   dies, and that belongs to the cost base rather than to its incumbents.

   **And the skill guard it was to be measured against was not fit to measure
   anything, which is now fixed.** It ran four markets of seven and ten seasons
   each:

   - `drone_delivery`, `restaurant_chain` and `construction` were never checked,
     and two of those three are the markets where skill pays *least* —
     1.18–1.25x against 1.25–2.09x elsewhere. Exactly what the gap was hiding.
   - Ten seasons was inside the noise. Renaming the seeds moved `dating_apps`
     from 1.24x to **1.07x**, below the threshold it asserts, without touching the
     engine. The guard was passing on the seeds it happened to hold.
   - Averaging several seed "families" does not fix that, and this is the part
     worth remembering: a season's whole economy derives from its id, so a naming
     scheme is not a *sample* of economies, it is one fixed set of them. Three
     sets averaged is still one deterministic answer per scheme, and two schemes
     disagreed by 0.13 at twenty-five seasons each.
   - Only the count closes it. Measured at 25 / 75 / 200 / 400, two independent
     schemes converge from 0.131 apart to about 0.03. The guard now runs **150
     seasons per market per skill, all seven markets** — 2,100 seasons, 27s — and
     the threshold stays at 1.15 rather than being raised to a figure only five
     markets could meet.

   Drone delivery sitting near the floor is not a fault: its customers are novelty
   orderers with a loyalty of 0.12, cheap to win and gone whatever you do, so there
   is less there for care to buy.
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

**Swept properly, 1 Oct 2026, and the plan below is the wrong shape.** It is
wired now — called from its own line in `resolve.ts`, with the constant at 0 —
so turning it on is one number. Measured against the repaired skill guard (150
seasons, all seven markets) and the winnability guards:

| PLANT_OVERHEAD | deaths/20 | skill guard | principle guards |
|---|---|---|---|
| 0.0 | 2.9 | holds | all pass |
| 0.05 | — | holds | 2 construction failures |
| 0.1 | 3.9 | holds | 1 construction failure |
| 0.2 | 4.9 | holds | 3 failures |
| 0.3 | 6.9 | holds | — |

The target is reachable at about **0.25**, and **the skill guard is not what
stops it** — that holds at every setting tried, in all seven markets, which is
the opposite of the fear recorded above. **Construction stops it, and
immediately.** At 0.05 the self-funding archetype there reaches 18% of the best
way to play against a floor of 25%: a plan that will not raise capital cannot
absorb a new fixed cost, and construction already has the most deaths of the
seven (12/20 at an overhead of 0.35, against dating apps' 2/20).

So the second half of the plan — harder opening segments in the *soft* markets —
is aimed at the wrong end. The blocker is the hardest market breaking first.

**And it is not really about construction either.** Two things were checked next,
and both say the lever is fine and the room is not there:

- **The lever is well normalised.** At 0.35 it costs 15–24% of a company's own
  revenue in the median year in every market — construction 22%, mid-pack. The
  worry that it falls unevenly because it is anchored to the cheapest segment's
  per-unit margin (34 in dating apps, 560 in construction) does not survive the
  measurement: bigger per-unit margins come with proportionately smaller plants.
- **The "nobody locked out" floor has about four points of headroom, today, with
  no overhead at all.** Every way of playing, every market:

  | | tightest archetype | share of the best plan | floor |
  |---|---|---|---|
  | construction | `outOfRevenue` | **29%** | 25% |
  | podcasts | `frugal` | **29%** | 25% |

  `frugal` is the weakest approach nearly everywhere (29–39%) and `outOfRevenue`
  is weakest in construction. Four points is all a global cost increase has to
  spend, which is why every setting above 0.05 breaches it somewhere.

So raising the cost base needs the floor's headroom widened first — which means
making the self-funding and frugal approaches stronger, not making the soft
markets harder. That is the opposite end of the problem from where the plan above
points.
Construction wants easing, or exempting, before the cost base can come up
anywhere; and the spread at 0.35 (2/20 to 12/20) says these markets stop
resembling each other well before the average reaches six.

Two things that also came out of the sweep and are worth not re-finding:

- **`plantOverhead` had no callers at all.** It was written, measured in some
  other working copy, and never invoked — so every attempt at this starts by
  wiring it, and there is more than one way to do that.
- **Inside `fixedCosts` is the wrong way.** That function is salaries and
  executives; three tests assert on what it returns, and they fail for reasons
  that have nothing to do with balance. It belongs beside `idleCapacityCost`.

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

### One approach is the best in five markets of seven

Measured 1 Oct 2026 while sweeping the cost base. Across the seven ways of
playing in `every-way-of-playing.test.ts`, `undercut` is the best in **five** of
the seven markets; `premium` takes construction and `grower` takes MMOs.

`balance.test.ts` already guards against a dominant plan — "has no strategy that
wins every market" — but it asks four hand-written strategies and passes as soon
as two different ones win anything, so it reads five-of-seven as three distinct
winners and is satisfied. It is a guard against winning *all* of them, and it
cannot see concentration.

Whether five of seven is too many is a judgement about the product, so nothing
asserts a stricter standard than the product has chosen. Two tests now pin the
figure where it is — no approach best in more than five markets, and at least
three approaches winning something — so a change that makes undercutting best in
six or seven fails with the count in the message.

Worth weighing together with the floor measurement above: every approach reaches
29–100% of the best, so nobody is locked out; it is just that the same one is
usually ahead.

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
5. ~~**Quarters and months** — 4 or 12 periods a year, at $6 and $10 a seat,
   with a developer bypass. Independent of all of the above and the largest
   plumbing job: the year is the atom in about thirty places, and every rate,
   lag and threshold has to scale per period.~~ **Done** — the conversion is
   written up under *Years, quarters and months* below, including the rule the
   arithmetic rests on.

   One thing the entry above records that the code no longer says: monthly was
   planned at **$10** a seat and ships at **$6**. It was introduced at $10
   (`fd26a7cb`) and repriced alongside Nova's seat (`61093735`), so that was a
   decision rather than a drift — worth knowing if anybody is wondering why the
   dearest cadence costs the same as the middle one.

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

## Every market has a route for every kind of player, 30 Sept 2026

`every-market-winnable.test.ts` asks whether *a* competent founder can build
something. That is the floor, and not the same question as whether the market is
worth entering for the person you actually are. A market with one answer is a
puzzle somebody solves once.

So: seven archetypes — undercut, go premium, lead on product, grow hard, spend
out of revenue, price by segment, keep your powder dry — against every market,
each free to choose how hard it spends, median of several seeds, real economy,
events on. The weakest archetype as a share of the best:

    before   premium 1% in construction · 6% in drone delivery · 13% in podcasts
             undercut 8% in construction
    after    no archetype below 25% of the best in any market

**Both fixes were to how the strategy was expressed, not to the game.** Premium
had been written as a single list price at nine tenths of the dearest segment —
which in construction, whose segments run 900, 3,800 and 14,000, is 12,600
charged to everybody, and prices out all but a rounding error of the market.
Undercut had the same error mirrored: one price at four fifths of the *cheapest*
segment, charging the client who would have paid 14,000 a price of 720 and
throwing away almost everything the market is worth.

Tiers are what the engine provides for pricing by segment, and they arrive in
year two with help text that says what they do. Expressed through tiers, both
archetypes have a route in every market. So the engine was right and the
measurement was wrong — the fifth time this week.

**The one real asymmetry, and it looks deliberate.** The cautious player is
profitable on eight seeds of eight in every market and goes bankrupt in none,
but lands at 21–34% of the best and beats filing nothing in only one or two
seeds of eight in the larger markets. Caution preserves and does not build,
which is a reasonable thing for the game to say, and it is the only archetype
that behaves that way.

Worth carrying forward for the product rather than the engine: in year one a
player has a single list price and nothing else, so a wide-spread market
punishes a positioning choice made with the only instrument available. Tiers
arrive in year two, which bounds it — but anybody writing desk copy for year one
in construction or podcasts should know that "put the price up" and "undercut
them" are both near-fatal there until tiers exist.

## Closed: the three ways out of a company had almost no tests
`release`, `leave` and `standings` had one, three and three references between
them across the whole integration suite, against fifty-odd for the desk — and
they are the routes that run when somebody changes their mind. Getting them
wrong leaves a person stuck in a company they walked away from, or four people
playing a season with an empty chair nobody told them about.

Nine cases now, and the reason they are worth having is that the right answer
*changes* part-way through a season:

  - **Releasing a seat** works only while the table is still arguing. The fifth
    claim ends it — the room leaves `claiming` for `naming` the moment every
    chair is taken — so the test claims four of five to reach the window at all,
    which is the thing a reader would get wrong. Once the season runs it is a
    409 with `wrong_phase`, and the seat is left exactly as it was, which is
    what matters to the other four.
  - **Leaving before the first year** gives the seat up, and a room the last
    person walks out of is retired rather than left standing empty.
  - **Leaving a running season** cannot unmake the company, so the chair goes to
    one of that venture's own bots: the person is out, the seat is still there,
    and all five are filled — asserted by joining `users` and checking the new
    occupant really is a bot rather than the seat merely existing.
  - **Standings** rank every company in the market in order of what each side
    owns, include the asker's own, and 404 for somebody else's company.

Coverage went from 1, 3 and 3 references to 4, 5 and 7. Run alongside the lobby
and responsibilities files rather than alone, because these share a market and a
season with them and a helper that assumes it owns the room is the standing trap
in this suite.

## The measurements themselves, 30 Sept 2026

### Closed: an event's cost multiplier compounded for every period it lasted
`world.economy` is the economy *after* last period's weather was applied, and
`resolveYear` used it as the base to apply this period's weather to. So a market
event was re-applied for every period it stayed in force. A twelve per cent
freight shock became 1.12^12 across a monthly year: unit cost went from 6 to
**25.79** by the second year, the company was serving customers at four times
what they paid, and it went bankrupt. Quarterly it is 1.12^4 — milder and
equally wrong.

The world now carries `economyBase`, the weather-free economy weather is applied
*to*, and `economy` stays the weathered one everything reads. A caller that
supplies an economy is still believed, which is what lets a test build a world
with a chosen economy and have it respected.

A first attempt derived the base instead — `economyFor(seasonId, year, periods)`
whenever the caller passed nothing — and that was wrong in a way worth recording:
it overrode the deliberate `{ demand: 1 }` worlds that a dozen tests build, and
broke thirteen of them. The bug was never that the stored economy was the wrong
*trajectory*; it was that weather was applied twice.

**What it moved.** The suite needed one real change: `balance.test.ts` counted
seasons finishing above the £6m they started with, and that stops discriminating
once the economy is right — a company ends with £10m to £36m, so both skills
clear the line together, identically. The gap it used to report *was this bug*,
hurting the weaker bot more. The margin is the measurement now, and it is a real
one:

    dating_apps   survivor 36,683,336   filler 28,892,861   1.27x
    podcasts      survivor 19,365,228   filler 10,330,679   1.88x
    mmos          survivor 21,302,851   filler 14,862,703   1.43x
    project_saas  survivor 34,063,677   filler 25,313,778   1.35x

Also worth knowing: the plant's advantage drops from 4.62x to **2.56x** with the
compounding gone, which is a third of the story that measurement was telling.

### Closed: the harness froze the economy, and the levels have been re-derived
Fixed above was the compounding. The other half was that a caller passing no
economy got a *constant* one for the whole season — the base never advanced, so
demand never moved. The server was never affected (`tickSeason` passes the
period's economy); `every-market-winnable.test.ts` and every scratch sweep were.

Both now pass `economyFor(seasonId, period, periods)`, as the server does. **The
levels in this document were measured against an economy that does not happen,
and here is what they actually are:**

    keeping an idle plant     reported 4.62x → 2.56x with compounding fixed → 2.00x
    scoring inversions        reported 30% before the earnings term, 21% after → 8%
    Nova markets winnable     8/8 seeds, every market, no bankruptcies anywhere
    quorumcast                6/8 (two seeds with no profitable plan)

Two of those are worth saying plainly. The plant's dominance — four experiments,
three write-ups, "the only decision in the game" — was **mostly this bug**: 1.98x
is an ordinary important decision, not a lever that swamps the others. And the
earnings term is twice as effective as it looked.

### Closed: a falling season is one where holding the money is the right play
Switching to a real economy immediately failed four cases, all on the one season
seed that opens at the top of the cycle: dating apps 910,802 against 940,139,
and worse in three generated markets.

That is not a defect, and the test was wrong rather than the game. The economy is
a cycle; a season opening at the top of it falls all the way down (seed "h" runs
1.118 to 0.908 across sixteen quarters). Spending into that is a mistake the desk
warns about a period ahead — `outlook` is computed from the step to the next
period, reads "tightening", and is on the screen. So holding is the better play,
and a test that demanded spending beat holding was asking the game to reward a
signposted mistake.

The guard now asks only that a falling season leaves a business standing, and
keeps the full claim for flat and rising ones. "Beaten by filing nothing" counts
in the sweeps are high for the same reason and are not a fault.

### Closed: there were only seven economies, and the comment said otherwise
`economyFor` offset each season's position in the business cycle by `seed % 7`
against a cycle nine years long — seven possible phases however many seasons
exist, so the line beside it ("offset per season, so no two seasons sit at the
same point in it") was false. Across sixteen season ids there were **six**
distinct demand trajectories: the same boom, the same trough, in the same
quarter, shared by two seasons in three.

A prime modulus read as a fraction of the cycle fixes it. **Sixty season ids now
give sixty distinct economies.** The cycle's length and depth are untouched;
only where a season starts in it.

It reshuffled every season, and the four properties that failed with it in each
turned out to be the test rather than the game:

  - **Two of them were the harness still freezing the economy.** `balance.test.ts`
    and `a-season-not-a-period.test.ts` both called `resolveYear` without one,
    so a sweep whose whole purpose is to see past the economy was running with
    it nailed down. Both now pass the period's economy, as the server does.
  - **The survivor-versus-filler gap was a sample of four.** At four seasons a
    market, project SaaS showed the filler six per cent ahead; at ten the
    survivor is twenty-seven per cent ahead, and the gap is 1.27x to 1.68x in
    every market. A season has an economy in it and four is not enough to see
    past which part of the cycle they landed in.
  - **Two were the fixture sitting in the wrong part of the cycle.**
    `a-season-not-a-period` ran on a seed that falls 1.108 to 0.880, the
    steepest decline any seed gives, where holding the money is the right play
    and the engine is correct to score it so. That file is about cadence and
    about a price nobody can pay; it now runs in a flat season (0.966 to 0.972)
    where neither a tailwind nor a headwind decides anything. A *rising* season
    was tried first and is wrong for the opposite reason — it carries a company
    that does nothing to a small profit, which is true of a real business in a
    growing market and says nothing about whether filing nothing costs.

### Withdrawn: growth does pay, and the one case where it does not is a windfall
Recorded as a fact about thin-margin markets. It was neither thin margins nor a
flat season. On genuinely flat seasons — seeds whose demand moves by half a
point across sixteen quarters — spending the most on offer is the best play in
**every** market, and by a lot:

    dating_apps 7.4x   drone_delivery 37.7x   podcasts 43.1x   restaurant_chain 3.3x
    construction 29.1x   project_saas 5.2x   mmos 63.6x

The case that looked broken was drone delivery on one seed, and the cause is the
year's events. With them off, spending beats holding 2.2x there, as everywhere.
With them on, the *holding* company's value rises from 65,286 to 759,232,
because that seed draws "the category is suddenly fashionable" twice and its
customers go from 2,232 to 8,690.

The windfall multiplies both companies by about 3.9x — it does not favour the
idle one. What it does is make the money the other one spent redundant: the
growth it bought arrived free. So in a season with a large positive demand
event, spending on growth is waste, and holding wins. That is a defensible
lesson rather than a fault, and it is only visible at all because events are
always on in play.

Worth keeping for the next person: measuring anything about "does playing well
pay" on a single seed will find the events on that seed, not the property.

Also corrected while here: the guard's spend ladder was 0.06 and 0.12 of the bank
*per quarter* — a quarter to a half of everything, every year. That is not
competence, it is spending hard, and the score now punishes it correctly. Four
rates from 0.01, and the best of them is what "played competently" means.

### Closed by measurement: quorumcast's two dead seeds
The one market not 8/8 under a real economy. It is 8/8 **with the year's events
on**, which is how every season actually runs — `tickSeason` passes no options,
so events are never off outside a test. With them off it is 6 of 8, the two
seeds being `m` and `w`, both of which *rise*; they open in a trough and a
market of 8,000 people never clears break-even before it lifts.

Raising `PRICE_ROOM_FOR_A_BUSINESS` from 28 to 40 fixes them, and the suite stays
green either way. It is not worth it: the bar is what lifts a generated market's
prices, and 40 takes the sea-swimming app from £35 a year to £121, which is not
a swimming app. Paying that to fix a condition that does not occur in play is
the wrong trade. Recorded rather than fixed, with the number to raise if the
judgement changes.

### Withdrawn: there is nothing wrong with the monthly season length
Recorded earlier as the sharpest open problem in this document: "nothing a
founder decides pays off in a monthly season", measured at 1.00x against filing
nothing at two years and 1.49x at four, with the conclusion that the product's
"closest to your actual week" option was inert.

It is not. Re-measured with a real per-period economy and a spend ladder that
includes frugal rates, monthly at its default two years:

    podcasts          pays in 7/8 seeds   1.79 1.42 1.08 1.92 1.35 0.91 3.42 1.82
    project_saas      pays in 7/8         0.99 1.31 1.13 1.74 1.49 1.57 1.77 1.45
    restaurant_chain  pays in 8/8         1.01 1.10 1.08 1.44 1.14 1.16 1.48 1.20
    dating_apps       pays in 7/8         0.71 1.20 1.09 1.75 1.35 1.25 1.82 1.16
    mmos              pays in 8/8         1.77 1.73 1.19 1.99 1.25 1.03 2.24 1.88

Building the business pays in seven or eight seasons of eight, typically by ten
to eighty per cent, and the handful below one are the falling seasons where
holding the money is the right play anyway. `DEFAULT_YEARS.monthly = 2` and the
reasoning beside it — "two years is the shortest span in which a monthly table
sees its own work arrive" — hold up.

The old figure had two faults stacked. The economy was frozen at the opening
period, so a monthly season never saw demand move; and the only spend rates
tried were a quarter and a half of the bank a year, which the score punishes
because it should. Neither the cadence nor the lags were ever the problem, and
the lag-speed experiment that failed to fix it failed because there was nothing
to fix.

**Third time a measurement error produced a finding.** The three were: weather
compounding because no economy was passed, the economy frozen for the same
reason, and a spend ladder that only contained bad answers. Anything in this
document measured before the economy was fixed should be read with that in
mind — the defects stand, because they were found by comparing runs under
identical conditions, and the levels have been re-derived where it mattered.

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


## The small local business, 2 Oct 2026

Prompted by a flat domain correction: construction is not a hard market, it is a
hard market to become *commercial* in. Residential work is cheap to enter and a
local operator can do very well out of it. The simulation disagreed, and it was
the simulation that was wrong.

### Closed: residential construction was unplayable, and it looked like market balance

Construction had been measured as the catalogue's harshest market — 12 deaths in
20 at a plant overhead of 0.35 against dating apps' 2 — and the explanation on
file was its costs. It was not its costs.

Its three segments are not one trade. Fitting kitchens for homeowners (210,000
customers at £900), building for developers (29,000 at £3,800) and tendering for
councils (6,000 at £14,000) are different businesses sharing a word, and the
market had one `innovationPace` for all three. It was 0.45, the lowest of the
seven, set by the slowest of them — while quality is the axis construction's
customers weigh most heavily. So quality decayed by 3 a year and could be bought
back only at 45%, and a firm doing extensions was held to the learning curve of
public infrastructure.

Measured, a one-region residential firm, 16 strategies over 4 seeds: a peak of
**6.6%** of its own town, quality stuck at **43** against incumbents at 51–83,
and **11 of the 16 strategies bankrupt in all four seeds**. There was no way to
play it.

Fixed with `Segment.innovationPace`, an optional per-segment override read
through `paceFor`. Domestic work declares 1.0; developers and public declare
nothing and stay at the market's 0.45, which is the whole point — cheap to enter,
hard to become commercial in. Absent means "the market's pace", so no other
market moves: the full unit suite (202 files, 2,393 tests) is unchanged.

After: peak **12.6%** of its own town, quality **70**, brand 80, service 74,
£781k profit in year 14, and **no deaths** in the strategies that reinvest.
Pinned by three tests in `balance.test.ts`, all three of which fail when
`homeowners.innovationPace` is put back to the market's.

The ceiling was never the allocator, which is worth recording because it was the
first suspicion. Asked directly, a one-region firm with quality/brand/service at
80 takes **32.9%** of its own town and at 100 takes 39.7%. The 30% a local
operator should be able to aim at was always there; what was missing was any
affordable route to the stats that reach it. A well-played firm now plateaus near
15% with quality ~75, so 30% stays something to play towards rather than a floor,
which seems right for a dominant local position against four incumbents.

Also measured and worth not re-deriving: price barely moves this segment despite
a `priceSensitivity` of 0.85 — 7.8% of town at £900 against 7.6% at £450. That is
why construction is the one market where `premium` beats `undercut`.

### Rejected, with the measurement: scaling marketing by the footprint you sell in

The first attempt at the above, and it is written down because it is an
attractive idea that does not work.

`fixedCosts` already discounts a one-region company's payroll through its
footprint, so a local firm got 40% of the costs and was quoted 100% of the price
of competing: `atScale(220_000, scale)` keys the brand threshold to the *market's*
scale, which is 1.0 for all seven catalogue markets, and `reachOf` never touched
it. Being the best-known builder in Leeds cost what a national campaign costs.
The asymmetry is real.

Scaling those thresholds by a compressed `reachOf` fixed it and broke something
worse. `lift` curves are **concave**, so halving a threshold helps the *smallest*
spender most — and the smallest spender is not only the handyman, it is also the
company that does nothing. A filler never expands, so it collects the largest
discount of anyone on the table. `balance.test.ts` caught it exactly there:
"pays a survivor better than a filler" failed on restaurant_chain, playing well
£21.7M against going through the motions £22.0M, where the margin has to be 15%.
The filler had risen; the good player had not moved.

It was reverted rather than tuned. Measured against `paceFor` alone, it was worth
12.6% → 15.4% of the town — a fifth of the benefit, for a change that touches the
early game of all seven markets and subsidises passivity in every one of them.

If anyone picks this up again, the thing to find is a mechanism that rewards a
*deliberate* local strategy without rewarding a passive one; a cheaper threshold
cannot tell them apart.

### Open, found in passing: one service threshold is not at the market's scale

`serviceGain` in `resolve.ts` reads a bare `150_000 * per` where every lever
around it reads `atScale(..., company.scale)`. Harmless in the seven catalogue
markets, which are all scale 1 — and wrong in a market Nova wrote a two-hundredth
of that size, where keeping service up costs more than the market is worth. The
same class of bug `atScale` was introduced to fix, in the one place it was never
applied.

Left alone rather than fixed in passing: it moves every custom market and so
wants its own change and its own measurement.

### Closed: no bot had ever declared who its company was for

Found while asking why the construction change moved `scripts/balance-report.mjs`
by *nothing at all* — 48 seasons in each of 7 markets, identical to the pound
with the new segment pace on and off.

The reason: `positioning` is the only lever of kind `segment`, the bot's field
loop has a branch for `choice` and none for that, and the field's default is a
string — so it fell through the `typeof value === "number"` catch at the bottom
of the loop and nothing was ever written. Every bot company in the history of the
game played undeclared, taking a flat 1 from `positioningFor` where a player who
chooses gets 1.18 on their own people and 0.92 on everybody else.

It mattered most where it was least visible. `balance-report.mjs` is the
instrument this project judges its markets by, and it runs bots — so the verdict
on every market was measured against a strategy no competent table plays, and any
market whose difficulty turns on positioning read as harder than it is. That is
the same trap as "most of the catalogue's weakness was the harness", one layer
down.

**The trade, which is the part worth keeping.** Positioning is not a bonus. With a
fraction `s` of demand in the chosen segment, appeal moves by `0.92 + 0.26s`,
which clears 1 at `0.08 / 0.26` — so declaring pays only above about **31%**
(`POSITIONING_BREAK_EVEN` in `market.ts`, derived from the two multipliers rather
than tuned). Which segments that leaves is worth writing down:

    restaurant chain  lunch 60%   ·  delivery 25%  ·  families 15%
    drone delivery    novelty 63% ·  rural 32%     ·  clinics 5%
    construction      homeowners 86% · developers 12% · public 2%

So most markets have exactly one segment worth declaring for, and a company that
declares for any of the others has made itself worse. `bestSegment` in
`bot-play.ts` weighs fit, size and loyalty but **not** this penalty, so taking its
answer unconditionally made bots worse in every market whose best-fitting segment
is small: it drove "pays a survivor better than a filler" *below 1.0* in
restaurant chain, a competent bot losing to a careless one. Measuring that was
what found the break-even.

Now: a survivor declares only when the sum works and declares for nobody when it
does not; a filler does not decide this at all, because a warm body in a seat
nobody took does not do segment analysis, and that is one of the few things
separating the two skills.

**Measured, 48 seasons × 14 years × 7 markets, before → after:**

    survivor   survived 328/336 → 336/336
    filler     survived 334/336 → 325/336
    construction, survivor   41/48, median £0.1m → 48/48, median £7.4m
    construction, filler     48/48, median £1.3m → 39/48, median £0.0m

Every market's competent median rose and every market's careless median fell or
held, which is the shape the three questions at the top of `balance.test.ts` ask
for. Construction's harshness did not go away — it is still the lowest median and
the narrowest spread of the seven — but it moved off competent teams and onto
careless ones, which is the difference between a hard market and a broken one.

Skill now pays 2.3× (dating apps) to 15.6× (drone delivery) on the median.

### Closed: the phone had no year-end report, and no way out of a season

Two of the three gaps the parity audit found. Both were on the wire already; the
pattern by now is familiar.

**The report.** `/api/sim/ventures/:id/reports{/:year}` was never called from
`mobile/` at all, so a phone player saw the one-line summary of the period just
gone on their desk and could reach neither the accounts behind it nor any year
before it. In a fourteen-period season that is thirteen years of a team's own
history visible only to whoever happened to be on a laptop — and the web file's
own header calls this the most important screen in the simulation, on the
reasoning that a decision you cannot trace to an outcome is one you cannot learn
from.

Now `/sim/report/<venture>`, in the web's order — the result, the accounts, the
cash, the customers, everybody else — with the year in the address and a row of
years rather than the web's route per year, so a season is one tap away instead of
a walk through a navigation stack. Reached by tapping the desk's own report card,
which is the gesture the web has from the same card.

The accounts are the point of it: every cost with the seat that spent it named
beside it, which is what turns "we lost two million" into "marketing spent 2.1m to
win 900k". That is also the thing most likely to rot, so it is the thing pinned
hardest. `accountsReconcile` in `mobile/src/components/sim/report.ts` returns the
discrepancy between the phone's own cost lines and the operating profit the engine
wrote, and the mirror test runs real seasons in all seven markets and asserts it
stays under a pound. Mutation-checked: dropping one line fails with *"worst at
construction year 13, out by 173620.29 — a cost was probably added to
ProfitAndLoss and not to accountLines"*, which is the failure this is for. A cost
added to the engine and not to the reading leaves a report wrong by exactly the
new line and looking entirely reasonable; nobody reconciles a screen by hand.

**Leaving.** `POST /api/sim/ventures/:id/leave` had no caller in `mobile/`. The
phone had `release`, which gives up a seat you have not started playing, and
nothing for the other thing — so once a season was running a phone-only player was
in it until it ended, with no way out of a company, a market or a table on the
client most of them use.

One button, two acts, and the confirm has to say which: before the season starts
the seat goes back and the room may close behind you; once it is running the chair
is handed to a stand-in, cannot be taken back, and the company cannot be rejoined.
`Alert.alert` with a `destructive` option, as `BlockAction` does it.

Two things worth keeping from building it:

- The success message is an `Alert`, not this screen's notice banner. The banner
  is rendered by the room and the room has just been replaced, so a notice shown
  there unmounts in the same frame and nobody reads it.
- The server hands the chair to a bot *or* deletes the seat if it cannot seat one.
  The confirm promises a stand-in, so when the other thing happens the phone says
  so rather than repeating the promise — the seat is then empty and the company
  runs it on the caretaker rules.

Both are driven by `mobile/scripts/phone-contract.ts`, which now resolves a year
and leaves at the end (destructive, so last). 51 checks against a live server:
accounts reconciling against the stored P&L to the penny, 11 cost lines each with
a seat, 3 cash steps, 3 segments, 4 rivals, a year fetched by number — and leaving
mid-season answering "passed to a stand-in, as the confirm promised", the desk
then 404, and a second leave returning 200 rather than an error.

Also fixed in passing: `ReportCard` in `DeskKit` had no way to be opened, so the
desk's summary was a dead end.

## The four gaps, 2 Oct 2026

### Decided: harder bots stay

Giving bots the positioning lever made every rival in the game meaningfully
stronger, and that was put to the owner rather than assumed: it is realistic, so
it stays. Recorded here because it is the kind of change that gets re-litigated by
whoever next reads a balance table and finds the rivals tougher than the old
figures say.

### Closed: neither client warned you could not serve what you were buying

The sharpest of the four. `GET /offers` has sent `you.capacity` and
`you.customers` since the mechanic was built, with a comment saying why — *"A
screen without this cannot warn about the one mistake this mechanic punishes
hardest."* `applyAcquisition` hands the buyer every customer the seller had and
none of their plant, so anybody beyond capacity is turned away, in public, in the
year every other team is watching the company that just bought somebody; and
`allocate` then gives those people to whoever does have room. The asking price
says nothing about it and `canOffer` will not refuse it.

The phone had the sum (`serviceGap`); the **web had nothing**, so the two clients
disagreed about whether a deal was survivable — which is worse than neither
warning, because one of them gets trusted.

Now `servingAfter` in `shared/simulation/mergers.ts` owns the arithmetic and the
threshold, the web imports it, and the phone mirrors it. Three states on both,
including the reassuring one: a warning that only ever appears when something is
wrong teaches people that its absence means nothing was checked.

`SERVING_TIGHT` (one tenth of your own room) is the new middle case the phone was
missing — a deal that lands you exactly at capacity has no slack for a good year,
and "everybody who arrives gets served" is true of it this period and misleading
about the next.

One refactor fell out of it: the sum moved to its own module
(`mobile/src/components/sim/serving.ts`) because `offers.ts` imports `../../theme`
for the eleven colours its verdict copy carries, which puts React Native in its
graph and out of reach of `mobile-mirror.test.ts`. `offers.ts` re-exports it, so
nothing that imported it had to change. Pinned across eight boundary cases
including the exact tight line, and mutation-checked: drifting the phone's
threshold to 0.25 fails.

### Corrected: there were no alarms, and the one that exists now is new

The backlog claimed `known-imbalances.test.ts` held four live `it.fails` tests.
It held none, and had not for some time — the file's own header records four fixed
and one withdrawn. So the cycle had worked five times and the backlog went on
naming the inputs, implying four known problems were being watched when nothing
was watching anything.

Corrected above, and the convention is back in use with one alarm, for the one
thing measured-and-open: a well-played local firm in construction cannot reliably
reach a third of its own town.

**And a figure of mine needed correcting with it.** The "32.9% ceiling at
quality/brand/service 80" reported earlier was one `seasonId`. `buildWorld` seeds
the incumbents from the season id, so the same stats are worth anything from 20.0%
to 37.5% depending on the draw. Over twelve seeds:

    stats (q/b/s, rep)      min    median     max
    75/77/68, rep 70       13.8%    20.4%    34.3%   ← what a season actually reaches
    80/80/80, rep 70       20.0%    24.9%    37.5%
    90/90/90, rep 70       24.7%    27.9%    41.1%
    100/100/100, rep 90    32.2%    35.4%    48.8%

So a third of a town is reachable only near the top of the scale or against a soft
draw, and the honest gap is "about a fifth where a third is the aim" rather than
"half the ceiling". The alarm reads the median over twelve seeds for that reason.
Mutation-checked: making the aim reachable fires it.

### Closed: three things the server sent and nothing read

- **`desk.research`** — the worst of the three, and it was on *both* clients. A
  table pays a year's marketing budget for a report, the server builds it, and it
  went into a payload field nothing looked at. The one lever in the game that took
  money and produced nothing anybody could see. Now on both desks, with the point
  of it said plainly: both reports are about *next* year.
- **`desk.ours`** — the niche a table spent a year's research carving out. The
  lever was filable on the phone and the phone showed nothing afterwards: not what
  was bought, not the premium those people pay, not how long the head start lasts,
  and not that a rival went looking in the same place and found the same people.
- **`desk.staffQuality`** — unread on both. It is what `staffLeverage` multiplies
  the support budget by, so a table that trained its people could not see it
  working. Now a reading on the phone's desk.

### Rejected, with the measurement: making a plant need people

`workforce.ts` has `canServe`, `staffFor` and `UNMANNED_FLOOR` — written, tested,
and with no callers. The obvious reading is that somebody left it half-done.

Wired as an experiment (capping each company's serving room at what its staff can
look after, floored at `UNMANNED_FLOOR`, in `effectiveOf` where the market sees
the company) and measured with `sim:balance`, 48 seasons × 7 markets:

    market            median before   median after
    Dating apps            £43.1m          £1.0m
    Project saas           £33.7m          £2.0m
    MMOs                   £37.5m          £1.9m
    Restaurant chain       £26.2m          £0.4m   (and 48/48 → 44/48)
    Construction            £7.4m          £0.8m

Medians fall by ten to forty times and the winners-versus-losers spread collapses
from £11–66m to £0.4–8.5m, which is the part that matters: skill stops deciding
anything. Everything in the game is calibrated against capacity that runs itself,
and the bots never hire for a constraint that has never existed.

So this is not an unwired function, it is an unbuilt feature: it needs hiring
re-balanced across all seven markets and bots taught to hire before the constraint
can be switched on. Reverted. Anybody picking it up should start from these
figures rather than from the fact that the functions exist.

### Closed: a sealed bid was invisible to the commitment meter

The meter is the one number on the desk that no individual seat could work out for
itself — each person sees their own spend and nobody sees the sum — and a bid at
auction was not in it.

The money is committed the moment the bid is placed: `settleMarket` takes it on the
tick and the bidder cannot spend it twice. The market screen already warned
whoever placed it that their bids added up to more than the company had. It had no
way to tell the other four, who were filing a year against a total that looked
comfortable. Measured live on a construction season: £2.5m standing at auction
against £722k of filed spend, so the meter read **722,318** where the table had
promised **3,222,318** — understated by four and a half times.

This is the same failure the city-entry cost had, and the comment on `openingCost`
already argues the case: the engine books one as spend and the other as a cash
movement, which is bookkeeping, and what the five of them have promised is the same
money either way.

Fixed the same way. `commitment()` takes an optional `bids` total, folds it into the
chief executive's line because bidding is their lever (`BID_IS_THE_CEOS`), and names
it as `bidsOutstanding` so a screen can say "of which bid at auction, not yet
settled" rather than leaving the table to wonder why the total moved when nobody
filed anything. `draftPreview` passes it through so the warnings see it too — a
preview calling the year fine beside a meter saying otherwise reads as the meter
being broken. The desk route totals the table's live bids for the year and sends
them.

The seal is not touched: these are this company's own bids shown to this company's
own table, which is the premise the whole product rests on — *five people privately
making reasonable decisions that are collectively ruinous is the failure this game
is built around, and the only defence is being able to see what the others have
committed while there is still time to argue.*

An exposure rather than a certainty, since most bids lose. Counted anyway, for the
reason the announced region is counted before the vote: overstating what a year
might cost is the safe side of a meter whose job is to stop a table committing
money it has not got.

Pinned three ways — a case in the phone/engine mirror (mutation-checked: a phone
that shows the line but leaves it out of the total is caught), five tests in
`levers.test.ts` covering the seat it lands on, the ratio tipping over, a `NaN`
total not poisoning the meter, and the preview's warnings, and three live checks in
`phone-contract.ts` that place a real bid and watch the meter move.

### Closed: nothing checked that a market Nova wrote could be won

`test/unit/every-market-winnable.test.ts` has asked this of the seven catalogue
markets since three separate faults produced markets nobody could play — rivals
seated across the whole of a segment, the same arriving through the economy, and an
opening plant whose idle cost bankrupted the founder. Each was found by sweeping
markets against seeds and noticing a column of zeros. None of them was reported,
and none of them would be: a season that cannot be won is not a bug anybody files,
it is a fortnight somebody spends losing and concludes they are bad at it.

None of that protected the markets players actually get. `buildCustomMarket` checks
a generated market's *shape* and nothing checked whether a business could be built
in it.

The harness moved out of that test into `shared/simulation/winnable.ts`, which the
test now imports — one definition, because a guard more forgiving than the test
would let through exactly what the test exists to catch. `parseMarket` runs
`winnabilityOf` and returns null for a market that cannot be won, which is already
its documented answer for an unreadable one: the route falls back to the nearest of
the seven and tells the player the market is not theirs. A far better outcome than a
bespoke market they cannot play.

**Two things measurement changed.**

*The guard was calibrated wrong first time.* It checked eight periods, on the
reasoning that the faults show up early — true of the zeros and the bankruptcy,
false of "can it be run at a profit". At eight periods **six of the seven catalogue
markets fail**, because a company does not turn a profitable quarter in its first
two years. A guard calibrated that way would have rejected almost everything Nova
wrote and quietly handed every player a catalogue market, and the only trace would
have been a log line. Sixteen periods costs the same 57ms and the seven pass, which
is the only calibration available: a guard that rejects a shipped market is wrong
about the market.

*The cleaner is better than expected, and the guard still has teeth.* Three
fixtures written to be unwinnable all came back playable, each one showing where
the real defence already is — incumbents given the whole of every segment are
**normalised** back down, and a `baseUnitCost` above the price of everything is
**clamped** (2,000 became 420 against a cheapest price of 600). So every one of the
three historical faults is already repaired upstream when written on its own. What
the cleaner cannot see is a *combination* of individually legal numbers: smallest
segments allowed, no growth, customers 95% loyal, the most incumbents allowed, all
at 98 and all undercutting at half price. Every field inside its range; a competent
founder wins **nobody** in sixteen quarters. That is the fixture now, and only
playing the market finds it.

**And the replay path is deliberately unguarded.** `parseMarket` is also called to
replay a market a project already owns, where a refusal returns "nothing to
replay" — taking away a season somebody has already played in order to tell them it
was unfair. That call passes `check: false`.

### Closed: the service lever did nothing in a small market

`serviceGain` in `resolve.ts` read a bare `150_000` where every lever around it
read `atScale(..., company.scale)`. Right for the seven catalogue markets, which
are all worth about £400m and so all scale one; wrong for a market Nova wrote a
two-hundredth of that size.

How wrong is worth writing down, because "the lever was weak" understates it. In a
generated market turning over £1.5m a year, the threshold should be about £657 and
was £150,000 — a tenth of the entire market's annual turnover to move service one
notch. Service decays by 3.5 a year, so:

    support spend    service it bought    against 3.5 of decay
       £2,000             0.20             fell behind
       £5,000             0.48             fell behind
      £15,000             1.36             fell behind

Every affordable spend lost ground. The lever was not weak, it was impossible:
service in a small market could only ever decline, whatever anybody did. At the
scaled threshold £15,000 buys 14.37.

Fixed in `resolve.ts` and in `forecast.ts`, which mirrors it — fixing one alone
would have left a small market's forecast promising service the year would not
deliver. Nothing in the catalogue moves: `atScale(150_000, 1)` is `150_000`, and
all seven markets are scale 1.0000.

### Closed: the engine wrote £ into every season's prose

Every figure the engine put in a sentence carried a hardcoded pound sign, so a
season built around a business banking in dollars was told its investors wanted
"£4,200,000" — the error `shared/currency.ts` exists to prevent, made inside the
engine where that module could not reach it.

`World.currency` now carries it, `buildWorld` takes it, and `startSeason` reads
the project's currency once and writes it on the world — which every later tick
loads back, so it rides along for the season's life with no further lookups.

Two decisions in it:

- **`money` is a factory, not a function with module state.** One server resolves
  many seasons; a mutable "current currency" would leak one table's pound signs
  into another table's dollars with nothing failing. The symbol is a closure made
  per resolve.
- **Absent means GBP, not the product's default of USD.** A compatibility choice
  and not a claim: a world written before this existed produced pound signs, and
  turning every one of them into a dollar sign would rewrite the prose of every
  season already in flight. The fallback only reaches callers with no season
  behind them — tests, probes and projections.

### Closed: every project outside America began life in dollars

The currency field on a new project started on USD for everybody. A field that is
already filled in is a field people skip, so the default was doing real work and
doing it wrong.

`suggestedCurrency` in `shared/currency.ts` now picks what the dropdown starts on
from the browser's locales and the chosen language. It is a suggestion and never a
decision — what a business counts in belongs to the business, which is the whole
premise of that module, so a Leeds café still reads in pounds for every viewer in
every language.

**The region decides and the language only fills in**, because that is the
direction the information runs: `en-GB` and `en-US` are one language and two
currencies, and knowing somebody reads English tells you nothing about which. The
language is asked only when no locale carries a region at all.

Three things it deliberately refuses to guess, each of which a shorter version
gets wrong:

- **An unrecognised region stops the guess** rather than falling through to the
  language. `de-CH` is Swiss francs, which this product cannot write honestly;
  knowing somebody is in Switzerland is positive evidence that "German, therefore
  euros" is wrong, so it falls to the default. The first draft of this returned
  EUR and the test caught it.
- **A bare `es` or `pt` is not evidence of euros.** Spanish is spoken by far more
  people in the Americas than in Spain and Portuguese more in Brazil than in
  Portugal, and offering euros to somebody in Mexico is a wrong number in a field
  they may not re-read.
- **The EU is not the eurozone.** Sweden, Denmark, Poland and the Czech Republic
  are in the first and none of them in the second, so the euro countries are
  listed out rather than inferred.

Decided once, when the form mounts: switching language afterwards does not move a
field somebody may have already set on purpose.

### Closed: thirty-six of the forty-nine "From year N" notes were wrong

`UNLOCKS` in `responsibilities.ts` is the only schedule anything runs on —
`isUnlocked` reads it, the desk builds a seat's form from it, the bots skip a
lever because of it. The notes on the decision types in `decisions.ts` are prose
beside a type, and prose cannot be wrong in a way that fails. So when the ramp was
compressed ("the ramp is short… by year five it has all of it") the schedule moved
and the notes stayed.

Measured rather than estimated: **36 wrong, 13 right**, and every single wrong one
named a *later* year than the truth. `tiers` said three and arrives in two.
`segmentFocus` said eight and arrives in four. `regionFocus` said seven, also
four. `deals` said five, arrives in three.

Nothing was broken by it. Every lever worked, every test passed. The cost was that
the most authoritative place to read what a seat gets and when had been quietly
lying — to anybody reading the type to answer a player's question, and to anybody
setting a new lever's year by looking at its neighbours.

All thirty-six corrected, and `test/unit/unlock-comments.test.ts` now compares the
two so it cannot happen again. Four checks, each for a way this actually goes
wrong:

- a note that names a different year from `UNLOCKS` — the drift that just
  happened, and it lists all of them rather than failing on the first, because
  finding thirty-six one test run at a time is its own small punishment;
- a note that promises a wait for a lever nothing gates, which would have a player
  waiting for something they already have;
- the same lever described with two different years, which several of these were:
  `dealVotes` appears on all five decision types and all four copies had drifted
  to year five together. Two copies disagreeing is worse than both being wrong,
  because then the file contradicts itself;
- and that the extraction is reading both halves at all, because a regex that
  quietly stops matching passes every other assertion in the file for ever.

Mutation-checked on all three failure modes.

### Closed: the phone's market screen was three fields behind the payload

An audit of the whole screen rather than the one gap already on this list. The
route sends eleven fields; the phone read eight. The three it missed had all been
added with a comment saying what they were for.

**An asset's life was printed in the wrong unit, and that was the worst of it.**
`expiresIn` is decremented once a *tick*, so a three-year licence in a quarterly
season arrives as twelve — and this screen printed that number with "years" after
it. "12 years, then it lapses" for a three-year asset, on the one screen where
somebody is deciding what to bid for it: a four-fold overstatement of the thing
being bought. Fixed on the web when `periods` was added and missed here.

`lastsFor` now mirrors the web's: whole years in years, a remainder in the unit the
table decides in — because "2.5 years" is not a sentence and rounding it would be
the same bug in a smaller coat. `lifeRead` keeps the phone's spelled "One year"
for the sentence while `lifePill` stays numeric for the label.

**"+6 quality" became "quality 54 → 60".** The route sends `you` with a comment
saying a listing said "+6 quality" and left a founder doing arithmetic against
numbers held on a different screen — which is the whole decision. Measured live on
a construction season, the room reading is the one that gained most: `room 1.1k →
16k` where it used to say `+14.9k capacity`, and a fifteen-fold increase is not
something a delta conveys.

**The screen stopped calling every decision a "year".** The banner, the
sealed-bid explanation and the "argue for it before the year resolves" line all
now use the season's own word.

`currency` is read for completeness and deliberately not used for a symbol: this
phone's `money()` carries none on purpose, so that a figure on a card reads the
same as the same figure inside a sentence the server wrote.

Twelve new tests, mutation-checked on both substantive fixes (printing a tick
count as years, and dropping the before-and-after). The live driver confirms all
three fields arrive and that a lot reads as a before and after; the quarterly
arithmetic is unit-tested rather than driven, because the public season a driver
can reach decides yearly.

### Closed: the phone had no period vocabulary, and said "Year 7 of 4"

`year` on every sim payload counts *periods*; `totalYears` is in years. Four phone
screens divided one by the other, so a quarterly season four years long told its
players:

    before   Year 7 of 4        ← past its own end, progress bar pinned at full
    after    Quarter 7 of 16    9 to go

The server's own comment on `totalPeriods` names this exact failure and says the
field was added to fix it — *"The engine has never been confused about this; only
the screens were."* The web was fixed. The phone read `totalPeriods` **nowhere at
all**, on any screen.

It was never only arithmetic. A season can be run yearly, quarterly or monthly,
and every word on these screens said "year", so a table deciding every quarter
read "Year 7", "this year" and "12 years, then it lapses" about a three-year asset.

`mobile/src/components/sim/period.ts` now holds the vocabulary: the words, the
decisions in a year, the span of a season, the heading, and `lastsFor` — which
moved here from `market.ts` because four screens had the same bug and were each
going to need their own copy otherwise.

**Where the words come from, in order.** The route's own `period` and
`totalPeriods` first, because the server knows the cadence and the client should
not have to agree with it independently. Then the cadence, for the room route
(`GET /api/sim/ventures/:id`), which sends that instead — and which is why the
phone needs mirrors of `PERIOD_NAME` and `totalPeriods` rather than this being a
pure reading of the payload. Then "year" last, which is what an older server would
have meant anyway.

Fixed on four screens: the room's season progress, the standings banner, the
acquisitions banner, and the market screen (done in the previous pass). The count
is also clamped to the span, because a season resolving its last period can
momentarily report a `year` one beyond it, and "Quarter 17 of 16" is the same
nonsense in a smaller coat.

Pinned three ways: 16 tests on the reading, four in `mobile-mirror.test.ts`
against `shared/simulation/cadence.ts` — including a sweep over every length and
cadence, and a check that every cadence the engine has exists on the phone, so a
fourth one added there cannot silently fall back to "year" — and seven live checks
that each route carries the span and that no screen reads past its own end.

Mutation-checked: a phone that disagrees about quarters per year, one that words a
quarter differently, and one missing a cadence entirely are all caught.

### Closed: three small things, and one that was never a gap

**The standings table could not open a company.** The screen has existed since the
profiles were built and was reachable only from the desk's rival rows — so the
table where somebody is *looking at* the competition was the one place they could
not tap one. The web opens it from here. Rows are now pressable, for the teams
only: an incumbent has no profile route and a row that looks tappable and does
nothing is worse than a row that does not.

**`dissolveSeats` and `offer` read as live features and are not.** Nothing in
`resolveYear` has ever looked at either, neither is in `LEVER_FIELDS`, and no
client can set them — so the doc comments promised a reader two powers that do not
exist. `types.ts` recorded the decision; the fields themselves did not, which is
where somebody actually meets them. Both now say plainly that nothing reads them
and point at what does: `RecoveryKind "dissolve_seat"` for closing a seat, and
`canOffer`/`applyAcquisition` for buying a company. Kept rather than deleted so the
one-shot reset in `defaultDraft` keeps clearing a stale value out of a carried
draft.

**`staffQuality` was phone-only, which was an asymmetry this work introduced.**
It had been sent and read by neither client; the phone took it a few passes ago
and the web did not. Now on both. It is what `staffLeverage` multiplies the
support budget by, so a table that spent a year training its people could not see
it working.

### Withdrawn: `simSeatPurchases` being insert-only is correct

Reported as a gap three times in this session — "written in two places, zero
selects" — and wrong every time. The count is right and the conclusion was not.

The entitlement lives as columns on `companies` (`simPlaySeatsPaid` and its
siblings, read through `seatsHeld`). This table is an idempotency ledger, and its
own doc comment already says so: *"The ledger exists for one reason: Stripe
redelivers. Without a record keyed on the session, a webhook delivered twice
credits the seats twice."* Its sibling `gamePlayPurchases` carries the same note.
Insert-only is the design, not an omission, and a read route would have been
speculative work on a table nobody needs to read.

Worth recording because the audit that produced it was mechanical — "sent and
never read" is a reliable way to find real gaps and an unreliable way to judge
them. The same sweep flagged `desk.shock` (the CEO sees it through the lever's own
label, which the server rewrites to `Answer: ${shock.headline}`) and
`dissolvedSeats` on the desk payload (the web's rehire lever has its options
filled from it server-side). Neither of those was a gap either.
