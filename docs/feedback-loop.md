# The build loop: publish a progress post and get feedback

A product loop. A builder posts progress with specific questions, people outside
the team answer, the team turns answers into work, the next update credits the
feedback — and the person who gave it is brought back to answer that update's
questions. It closes on that last step: the output of one round (a credited
update with new asks) is the input of the next.

In-app only. There is no email or push; what brings each side back is a count
or card where they already look, and the notification bell.

## The steps, and where each one lives

| # | Step | Code | Proof |
|---|------|------|-------|
| 1 | Post an update with up to 4 specific asks | `client/src/components/feed-composer.tsx`, `POST /api/feed` in `server/feed-routes.ts`, rules in `shared/feedback-loop.ts` (`validateAsks`), column `feed_posts.asks` | `test/unit/feedback-loop.test.ts` |
| 2 | People answer in comments (threaded) and reactions; each post has its own page | `client/src/components/feed-comments.tsx`, `client/src/pages/post-detail.tsx`, `GET /api/feed/:id`, `GET /api/feed/:id/reactions` | `test/integration/feed-comments.test.ts`, `test/integration/post-page.test.ts` |
| 3 | The team sees outside feedback as new, and turns a comment into a task in one click | `client/src/components/feedback-inbox.tsx` (`FeedbackInbox`, new-feedback badge), `server/feedback-loop-routes.ts` (`GET /api/projects/:id/feedback`, `POST /api/feed/comments/:id/apply`) | `test/integration/feedback-loop.test.ts` |
| 4 | When the task is done, the next update credits the feedback ("Acts on feedback from …") | composer's credit picker in `feed-composer.tsx`; `closableComments` and `markClosed` in `server/feedback-loop-routes.ts`; `feed_comments.closed_by_post_id` | `test/integration/feedback-loop.test.ts` |
| 5 | The commenter is told their feedback was used — on their feed and in their bell — and is handed the update's new asks | `FeedbackUsedCard` in `client/src/components/feedback-inbox.tsx` (on the home feed, `client/src/components/founder-feed.tsx`); `GET /api/me/feedback-used`; `feedback_used` notification from `markClosed` via `server/notifications.ts`; bell in `client/src/components/notification-bell.tsx` | `e2e/feedback-loop.spec.ts` (a real browser: the card, the new ask and the bell are visible on the commenter's next feed load) |
| ↺ | Back to step 2: answering the crediting update is new feedback on the project, and puts the card away | `markClosureAnswered` in `server/feedback-loop-routes.ts`, called from `POST /api/feed/:id/comments` | `test/integration/feedback-loop.test.ts`, `e2e/feedback-loop.spec.ts` |

## What closes it

The return path is the credited update itself: `markClosed` records the credit
and sends the commenter a `feedback_used` notification that opens the update
(`/posts/:id`), and `FeedbackUsedCard` shows that update's asks with an
"Answer their questions" button. Their answer lands in the team's inbox as new
feedback — the next round.
