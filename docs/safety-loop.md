# The admin safety loop

Review the safety signals → act on reports → see what the action did → come
back tomorrow and start from what changed.

| Step | Where | Evidence |
| --- | --- | --- |
| Review reports, rate-limit hits and content volume — together | `/admin/safety` (`client/src/pages/admin-safety.tsx`), `GET /api/admin/safety/review` (`server/safety-routes.ts`) | `test/integration/safety-loop.test.ts`, `e2e/safety-review.spec.ts` |
| Take a moderation action (remove, shadow-hide, ban, suspend, switch a surface off) | `/admin/reports`, `/admin/surfaces`; `server/moderation.ts`, `server/surfaces.ts` — every action is a row in the append-only `moderation_log` | `e2e/moderation-loop.spec.ts`, `test/integration/write-floor.test.ts` |
| Monitor impact | Per action, `GET /api/admin/safety/impact/:logId`; shown on the review under **What recent actions did**, and one click from the queue (**See impact** on the decision's notice) | `test/integration/safety-loop.test.ts`, `e2e/safety-review.spec.ts` |
| Repeat | The review's checklist, `POST /api/admin/safety/review`, recorded as `safety_review_completed` in the moderation log; the next review covers the time since it | `test/integration/safety-loop.test.ts`, `e2e/safety-review.spec.ts` |

## The daily review

One page, loaded by one request:

- **Alerts** — worked out in `safetyAlerts` (`shared/safety.ts`, unit-tested in
  `test/unit/safety.test.ts`): a report open longer than 24 hours (urgent), open
  reports, a jump in new reports, a rate limit spiking, a review that's due, and
  surfaces switched off.
- **Reports** — open, the oldest open, new in the window against the window
  before, and open reports by reason.
- **Rate limits** — per limit, how many people it refused in the window and the
  window before, how many it allowed in the last day, and whether it's spiking
  (at least 5 refusals and at least double).
- **Content** — posts, comments and messages against the window before.
- **What recent actions did** — every moderation action in the last 7 days, with
  its impact (below).
- **Switched off** — surfaces currently off.
- **The checklist** — reports triaged, spikes looked at, impact checked,
  switched-off surfaces reconsidered. **Complete review** needs all four and
  takes an optional note for the next reviewer.

The window is the time since the last completed review — at least 24 hours, at
most 7 days — compared with the same span before it. The sidebar's **Safety
review** entry (reviewers only) shows the number of non-info alerts, or **Due**
when the last review was 24 hours ago or more.

## Refusals are kept

A rate-limit refusal used to be a console line only. `recordRefusal`
(`server/moderation.ts`) now also writes `safety.limit_refused` to
`activity_events`, with the limit's name and `volume` (429) or `duplicate`
(409). Rows are bucketed per person, limit and minute with a `count`, so a
flood costs two writes a minute and the sum is still exact.

## Impact of an action

Measured 24 hours either side of the action's own `created_at`. The after side
is usually still filling up, so it's read as a pace over a full 24 hours
(`compareWindows`): two reports in six hours reads as eight a day.

| Action on | Metrics |
| --- | --- |
| An account (a removal, a ban, a suspension) | reports against that account; its posts, comments and messages; its rate-limit refusals |
| A surface (switched on or off) | writes on that surface's API; refusals on it |
| Always, for context | new reports, refusals, and posts/comments/messages site-wide |

Each action is **Too early** for its first hour, **Watching** through the first
day, then **Settled**; its headline names the metric it touched that moved most.

All windows are computed in the database, relative to `now()` or the log row's
`created_at` — the timestamps carry no zone.
