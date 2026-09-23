# The simulation: what is built, and what is owed

Kept because this work has run across many sessions and several people, and
"we said we'd do that" is not a plan. Anything deferred deliberately is here
with the reason. Anything here that stops being true should be deleted rather
than ticked.

## Owed, and why it was deferred

### The web market cannot withdraw a listing
`DELETE /api/sim/ventures/:id/listings/:listingId` exists and the phone calls
it (`mobile/app/sim/market/[id].tsx`). The web market page fetches the listing
ids and uses only the name, for an "Already up for sale." label — so on the web
an asset put up for sale cannot be taken down.

### `year_closing` was built for a client behaviour no client has
`YEAR_CLOSING` in `server/simulation-tick.ts` exists so a desk can say "a
moment" rather than "something went wrong" while a tick is rolling the year.
Neither client checks the code: the desk shows its generic red "Couldn't file
that" and does not refetch, so the screen stays on a year that has already
ended.

### Two dead columns, and a dead field
`sim_ventures.state` is declared with a docstring and never written or read —
the world lives on `sim_seasons.world`. `Company.teamId` is written in
`startingCompany` and read nowhere. `sim_seat_purchases` is insert-only: it
does its job as a Stripe idempotency key, but nothing reads the receipt, so
there is no purchase history to show. Deleting the first two is safe; the third
is a decision about whether a billing screen is coming.

### `?seats=bought` is a promise to nobody
The Stripe return URL appends `?seats=bought` / `?seats=cancelled`. No client
reads a `seats` query param, so paying for seats returns you to the company
page with no confirmation that anything happened.


### A sealed bid is invisible to the commitment meter
The desk's meter shows what the seats plan to spend against what the company
has. A sealed bid sits outside it, so a table can file a year that looks
affordable and then lose a third of its cash at the auction — which is exactly
what happened in the first season anybody played.

Needs a decision before it needs code: should a live bid reserve its money on
the meter (honest, but leaks the bid's existence to every seat), or should the
meter simply name the exposure without the amount?

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
- Opening the announced region is the whole table's: operations puts it up,
  which is its vote for, the other four vote, and a majority of the votes cast
  carries it — a tie or silence leaves the region shut (`expansionOutcome` in
  `shared/simulation/world.ts`). The desk shows every seat's face against what
  they voted, counted by the server so the screen and the engine cannot
  disagree.

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
