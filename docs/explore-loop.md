# The Explore loop

Open Discover → see a match → open their profile or project → follow, connect,
message, or comment on their progress → come back later and do it again.

## Events

Ten, in `shared/explore-events.ts`, stored in `activity_events` and separate
from the check-in loop's events in `shared/loop-events.ts`, which stay a small
fixed set on purpose. Six are sent by the client through `/api/track` — only it
sees a page open, a card on screen, a tap, or the app being left. The four
actions are recorded by the endpoints that perform them (below), and
`/api/track` refuses them, so an action can't be missed or claimed twice.

| Event | Fired when |
| --- | --- |
| `explore.open_discover` | Discover, Matches or the project list opens |
| `explore.view_match_card` | a builder or project card is at least half on screen — once per card per visit to the page |
| `explore.open_profile` / `explore.open_project` | a card is clicked on one of those pages |
| `explore.follow` | a builder or project is newly followed — not a repeat, not an unfollow (recorded by the server) |
| `explore.connect_request` | a connection request succeeds (recorded by the server) |
| `explore.message_sent` | a message sends (recorded by the server) |
| `explore.comment` | a comment posts on someone else's progress update — not your own, not your own project's (recorded by the server) |
| `explore.return_to_discover` | Discover opens again in a tab that already opened it |
| `explore.session_end` | the tab is left after anything happened in the loop |

Five properties, and nothing else is stored (on an action, `matchType` and
`targetId` come from the server; the client adds the rest as `explore` in the
request body): `matchType` (builder / project),
`targetId`, `rankPosition` (from 1), `source` (which page), and
`timeToActionMs` (on actions only: milliseconds since Discover opened in that
tab). The server drops unknown keys and out-of-range values.

## The action step: endpoints

Follow, connect, message and comment are the loop's success path. Each endpoint records
its event when the write succeeds, in the requester's visit, via
`recordExploreAction` in `server/explore-actions.ts`:

| Action | Endpoint | Event | Clients |
| --- | --- | --- | --- |
| Follow a project | `POST /api/projects/:id/follow` `{ following: true, explore? }` | `explore.follow` (project) | web cards and project page; app Discover cards and project screen |
| Follow a builder | `POST /api/users/:id/follow` `{ following: true, explore? }` | `explore.follow` (builder) | web profile |
| Connect | `POST /api/connections/request` `{ userId, note?, explore? }` | `explore.connect_request` | web cards and profile; app Discover cards and builder screen |
| Message | `POST /api/messages/:userId` `{ content, explore? }` — connected people only | `explore.message_sent` | web cards and messages; app cards and chat |
| Comment on their progress | `POST /api/feed/:id/comments` `{ content, parentCommentId?, explore? }` in `server/feed-routes.ts` — on a post by someone else, or a project you're not on | `explore.comment` (project when the post is on one, builder otherwise) | web feed, Following feed and post page (`client/src/components/feed-comments.tsx`); app post screen |

Around them: `GET /api/connections/statuses` (where you stand with everyone on
a page), `POST /api/connections/:id/accept`, `GET /api/users/:id/follow-status`,
`GET /api/projects/:id/follow-status`, `GET /api/user/followed-projects`. A
refused action (a message before they accept, a second request) records nothing.

**One visit, web or app.** The web app's visit is the `st_sid` cookie. The
mobile app keeps no cookies, so it sends `X-ST-Visitor`, `X-ST-Session` (a visit
ends after 30 quiet minutes, as the cookie does) and `X-ST-Session-Start` on a
visit's first request; the server uses them when there's no cookie. Opening
Discover is sent at once, not batched, so it's stored before an action seconds
later and the cycle count reads them in order.

**Tests.** `test/integration/explore-loop.test.ts` (each endpoint records its
event with sanitized context; the tracker can't claim one; app headers join the
visit; the funnel, time to first action, repeat rate and a full cycle),
`test/integration/discover-actions.test.ts`, and in a real browser
`e2e/explore-loop.spec.ts` (open → follow from a card → return, counted as one
cycle on the owner's dashboard) and `e2e/discover-actions.spec.ts`.

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

1. Run the app (or the mobile app) and open Discover (or Matches, or Projects).
2. Scroll the cards, open a profile, send a connection request or a message.
3. Go back to Discover.
4. As the owner, open the analytics page: the Explore loop card counts that
   session at each step it reached. The live feed shows each event by name.

The browser batches events for up to four seconds, so give it a moment.

## Closing the loop

What brings someone back, what makes coming back worth it, and how coming back
is measured.

| Step | Mechanism | Code | Tests |
| --- | --- | --- | --- |
| Remember what you looked at | `explore_seen` rows per person — builder or project, epoch-ms — written by `POST /api/discover/seen` when you open a profile or project (web and app), and by the follow, connect and message endpoints themselves when you act | `server/discover-routes.ts` (`rememberSeen`), `server/explore-actions.ts`, `client/src/lib/seen.ts`, `mobile/src/explore.ts` | `test/integration/discover-return.test.ts` |
| Tell you there's news | **Discover badge** — "N new" on Discover in the web sidebar and on the app's Discover tab — and **"N new since you last looked"** at the top of the home feed, linking to Discover. Both from `GET /api/discover/new-count`: new posts from what you've looked at since the later of when you looked and your last Discover visit | `client/src/components/app-sidebar.tsx`, `client/src/components/discover-news.tsx`, `mobile/app/(tabs)/_layout.tsx` | `test/integration/discover-return.test.ts`, `e2e/return-loop.spec.ts` |
| Show the news on return | Card badges ("2 new posts") and the welcome-back banner, from `GET /api/discover/updates` | `client/src/hooks/use-explore-updates.ts`, `client/src/components/return-banner.tsx` | `e2e/return-loop.spec.ts` |
| Hear back from what you did | A **reply** to your comment, a **reaction** to it, a **comment** or **mention** on your own post, a **follow**, a **connection request** or **acceptance** is a notification (`server/notifications.ts`), shown in the bell (`client/src/components/notification-bell.tsx`, `mobile/app/(tabs)/notifications.tsx`) and opening the post or person. A **message** counts as unread until read: the Messages badge in the web sidebar and the app's Inbox tab (`GET /api/messages/unread-count`). New progress from who you follow is "N new updates from people you follow" on the home feed and the Following tab (`followedPosts` in `GET /api/notifications/unread-count`) | `server/notifications.ts`, `server/feed-routes.ts`, `client/src/components/notification-bell.tsx`, `client/src/components/founder-feed.tsx`, `client/src/components/app-sidebar.tsx` | `test/integration/notifications.test.ts`, `test/integration/explore-comment.test.ts`, `e2e/explore-conversation.spec.ts` |
| Repeat | Opening Discover (`POST /api/discover/visit`) moves the badge's "since" to now, so the badge clears and the next post brings it back; cards keep their news until the thing itself is opened | `client/src/lib/explore.ts`, `mobile/app/(tabs)/discover.tsx` | both of the above |

- **Only what you interacted with** is remembered — opening, following,
  connecting, messaging — so a return isn't a wall of badges. The most recent
  thirty are kept per person. It's on the server, so it's the same on every
  device; a browser that remembered things locally before hands them over once,
  never overwriting a newer record or trusting a clock from the future.
- **News is counted through the feed's own visibility rules** (at most 8 targets
  checked, 5 posts counted each), so a badge can't reveal a post the feed would
  hide, and your own posts never count. Up to three cards get a badge.
- **The welcome back.** A banner on return names what's new, links to it, and
  offers **Continue exploring** — to the first card you haven't looked at yet.
- **The nudge.** After you connect or follow, the toast offers **More like
  this**: Discover searched by their top skill, or Projects filtered to that
  category (`?q=` and `?category=` in the URL).
- Remembering and visiting aren't logged as actions in the behaviour stream.

**Repeat measure:** a *cycle* is open Discover → follow, connect, message or
comment → come back. The Explore card shows the share of sessions with two or more, from
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
