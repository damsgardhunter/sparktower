# What the phone has, and what it is missing

The mobile app is not a thin client — it has its own screens, its own kit
(`mobile/src/components/ui.tsx`, `MoreKit`, `SimKit`) and its own pure logic
with its own tests. That is why it drifts: a web feature does not appear here
by being built, and nothing fails when it doesn't.

This is the ledger. `test/unit/mobile-mirror.test.ts` already holds the parts
where the two share pure logic and must agree; everything below is the parts
where they simply do not exist.

## Fixed just now

### Three things the phone and the web had drifted on

- **Searching your connections for someone to message.** The phone had this
  before the web did, which is the drift running the other way for once — and its
  copy had quietly stopped agreeing. It matched the display name and the headline
  but not the **username**, so a handle typed from memory returned nothing, and it
  left the list in the order the server sent (by when each connection was made)
  rather than by name. Both sides now use a pure module —
  `mobile/src/connectionSearch.ts` against `client/src/lib/connection-search.ts` —
  and `mobile-mirror.test.ts` runs the two on the same rows. The one deliberate
  difference is the nameless fallback: `personName` refuses to print an email on a
  phone and says "Builder".
- **Choosing which part of a photo survives.** Both clients cut a profile photo
  to a circle and a cover to a wide band, and the phone cut the middle without
  asking. It now opens the native crop UI, at the same ratios the web's cropper
  frames (1:1 and 4:1, `mobile/src/profileCrop.ts` mirrored against
  `CROP_PRESETS`). Worth knowing: `aspect` is Android-only, so on iOS the frame is
  square whatever is asked for and a cover is cropped vertically afterwards. The
  choice of *region* is the part that matters and that part works; the shape of
  the frame does not match the web there.
- **"Is there a problem? Report it."** The web puts it in every footer. The phone
  had nothing, so the one person who could tell you a screen was broken had no way
  to. It is now a row in More and a screen at `/report-problem`, which takes a
  `?path=` so a caller can say where somebody was. Deliberately not behind a
  surface flag: a way to say "this is broken" that can itself be switched off is
  the one feature you want left on when something is. Its validator is mirrored
  too, and that mirror immediately earned itself — the phone's copy had the
  ceiling at 2,000 characters against the server's 1,000, which would have let a
  long report pass on the phone and be refused by the server for exceeding a limit
  the screen had just said it was inside.


The profile header — your cover, your face, your three numbers — was on **every
tab**, because the layout set it as the default header and only the menu
overrode it. It is the top of *Home*: it is what you see when you open the app
and it slides away as you read. Above a list of conversations it was a quarter
of the screen spent showing you yourself on the way to something else.

Worse, the header floats over the scene, and three screens left about sixteen
points of room for two hundred and twenty of header — so **Simulations, the
leaderboard and your own profile drew their first rows underneath it**, where
nobody could reach them. That was not a polish problem; it was content you
could not get to.

Both halves came from the same thing: which header a tab wears and how much
room a screen leaves for it lived in different files with nothing keeping them
in step. One list now (`mobile/src/components/header-kind.ts`), read by the
layout and by the hook that answers the spacing, with a test.

## Missing on the phone

**Audited 2026-10-01, and most of this section was wrong.** Five entries
described features the phone already had, one of them 651 lines of it. That is a
worse failure than having no list: the list's own closing rule warns about
discovering in six months that the phone is a different product, but a stale list
sends somebody to rebuild what is already there, and this one nearly did — the
decision simulator was about to be ported on the strength of a line saying "the
phone needs the screens".

What each claim turned out to be, with where the evidence is:

| Was listed as missing | Actually |
|---|---|
| The decision simulator | **Present.** `app/sim/business.tsx`, 651 lines, calling all four `decision-sim` endpoints the server offers |
| Ten Years From Now, for a real company | **Present.** Same file — it POSTs `/decision-sim/ten-years` with an allocation |
| The path (`/path` on web) | **Built just now**, `app/path.tsx` |
| Discover as a destination | **Present**, and larger than the web's: 438 lines against 118 |
| The document builder | **Partly present.** `app/project/[id]/documents/[docId].tsx` plus `manage/tools/Documents.tsx`, 553 lines against the web's 1,212 |
| Leaderboard | **Present**, `app/(tabs)/leaderboard.tsx`. The web has no `pages/leaderboard.tsx` at all, so the comparison in the old entry was to something that does not exist |
| Contests | **Partly present**, 99 lines against 188 |

### Genuinely still missing

- [ ] **The customer console.** Nothing on the phone, and still reasonably last:
  it is an operator tool and an operator has a laptop.
- [ ] **The rest of `client/src/components/nova/`**: `LiveDot` and `Glance` have
  no phone counterpart. `Working` now does, and `Pill` and `Block` exist under
  those names in the phone's own kit — which is not the same thing as agreeing
  with the web's, and nobody has checked.

### Partial, and unmeasured

The two "partly present" rows above are the honest state: the phone has a screen
for each and it is smaller than the web's. Nobody has compared them feature by
feature, so neither "done" nor "missing" is true, and writing either would put
this list back in the state this audit found it in. Measuring them is a job in
itself — and worth more than it sounds, because a half-ported screen is the one
kind of gap a line count cannot settle.

## The rule worth keeping

A feature is not done because the web has it. Either build both, or write the
gap down here on the day — the cost of this list is one line per feature, and
the cost of not having it is discovering in six months that the phone is a
different product.

And the other half, learned the hard way above: **cross a line off on the day
too.** An entry that is wrong is not merely out of date, it is an instruction to
do work that has already been done, and it is believed precisely because it is
written down. If a claim here cannot be checked in a minute, it should say where
the evidence is — a file and a line count — so the next person can tell whether
it is still true without reading the whole app.
