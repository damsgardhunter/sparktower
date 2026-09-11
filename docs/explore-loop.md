# The Explore loop

Open Discover → see a match → open their profile or project → follow, connect
or message → come back later and do it again.

## Events

Nine, in `shared/explore-events.ts`. They ride the behaviour stream — sent by
the browser through `/api/track` with the page views, stored in
`activity_events` — and are separate from the check-in loop's events in
`shared/loop-events.ts`, which stay a small fixed set on purpose.

| Event | Fired when |
| --- | --- |
| `explore.open_discover` | Discover, Matches or the project list opens |
| `explore.view_match_card` | a builder or project card is at least half on screen — once per card per visit to the page |
| `explore.open_profile` / `explore.open_project` | a card is clicked on one of those pages |
| `explore.follow` | a project is followed (not unfollowed — the endpoint toggles) |
| `explore.connect_request` | a connection request succeeds |
| `explore.message_sent` | a message sends |
| `explore.return_to_discover` | Discover opens again in a tab that already opened it |
| `explore.session_end` | the tab is left after anything happened in the loop |

Five properties, and nothing else is stored: `matchType` (builder / project),
`targetId`, `rankPosition` (from 1), `source` (which page), and
`timeToActionMs` (on actions only: milliseconds since Discover opened in that
tab). The server drops unknown keys and out-of-range values.

## Success signals

On the owner's analytics page, under **Explore loop**, from
`GET /api/admin/analytics/summary` → `explore`:

- **Funnel** — sessions reaching each step: opened, saw a match, looked closer,
  acted, came back. Each step as a share of the sessions that opened Discover.
- **Time to first action** — median and 90th percentile, from opening Discover
  to the first follow, connection request or message in the same tab.
- **Repeat rate** — of the people who opened Discover in the window, the share
  who did on two or more separate visits.

## Checking it by hand

1. Run the app and open Discover (or Matches, or Projects).
2. Scroll the cards, open a profile, send a connection request or a message.
3. Go back to Discover.
4. As the owner, open the analytics page: the Explore loop card counts that
   session at each step it reached. The live feed shows each event by name.

The browser batches events for up to four seconds, so give it a moment.

## Closing the loop

What makes coming back worth it, and how coming back is measured.

- **What you looked at is remembered** — in the browser, per builder or project,
  when you open their page or follow, connect or message. Only what you
  interacted with, so a return isn't a wall of badges.
- **News since then.** On Discover, Matches and Projects, one request to
  `GET /api/discover/updates` asks how many posts each of those has had since you
  looked (at most 8 checked, 5 counted each). It counts through the feed's own
  visibility rules, so a badge can't reveal a post the feed would hide, and your
  own posts never count. Up to three cards get a "2 new posts" badge.
- **The welcome back.** A banner on return names what's new, links to it, and
  offers **Continue exploring** — to the first card you haven't looked at yet.
- **The nudge.** After you connect or follow, the toast offers **More like
  this**: Discover searched by their top skill, or Projects filtered to that
  category (`?q=` and `?category=` in the URL).

**Repeat measure:** a *cycle* is open Discover → follow, connect or message →
come back. The Explore card shows the share of sessions with two or more, from
`countCycles` in `shared/explore-events.ts`.

## Following

- **Follow a builder** from their profile (one-way, instant — `user_follows`),
  or **a project** from its page or card (`project_follows`). Both send the
  state they want, so a double click can't undo itself, and both revert if the
  server refuses.
- **The Following feed** is the home feed's second tab, `GET /api/feed?scope=following`:
  posts by builders you follow or on projects you follow, decided inside the
  query so a follow counts the moment it's saved, and still through the feed's
  visibility rules. `followingCount` lets it tell "follows nobody" (with a way
  to Discover) from "quiet".
- **Following visibly changes something:** the button flips at once, the feed
  re-reads, and the notice's **Open Following** goes to `/?feed=following`.
