# The product loop: follow a goal path

Follow a goal path (Ship an MVP, Systemize a business, Raise funding) → do the
next milestone task → post the week's progress → receive comments and feedback
→ return to the next step.

**Weekly check-ins are retired.** The builder's standing notes say check-ins
aren't a loop, so this loop's "weekly" step is the **weekly progress update**: a
feed post made from the steps finished on the path that week. It closes because
feedback on that post comes back as notifications, and the post links the team
straight back to the next step.

## The steps, and where each one lives

| # | Step | Code | Proof |
|---|------|------|-------|
| 1 | Choose or enter a goal path | goal and type picked at creation in `client/src/pages/project-create.tsx`, instantiated by `instantiatePathTree` in `server/phase-trees.ts`; switching with `POST /api/projects/:id/path/switch` (`switchPath`) from the path map in `client/src/components/path-panel.tsx`; projects from before paths adopt one with `POST /api/projects/:id/path/adopt` | `test/integration/phase-trees.test.ts` |
| 2 | See the next milestone task | `GET /api/projects/:id/path` (`pathStatus`), the next action in `client/src/components/path-panel.tsx`; "Continue your path" at the top of the home feed (`client/src/components/continue-path-card.tsx`, `GET /api/me/next-steps` in `server/path-return.ts`) and on mobile (`mobile/src/components/ContinuePath.tsx`) | `e2e/retention-loop.spec.ts`, `test/integration/path-return.test.ts` |
| 3 | Do it — the answer is the task's artifact | `POST /api/projects/:id/path/work` (Nova's options, build packet or template), `POST /api/projects/:id/path/work/:workId/choose` (`chooseWork` writes the answer and closes the task), `PATCH /api/kanban/:taskId`; every completion runs `onPathTaskDone`, which moves pace and tells the rest of the team (`afterPathStepDone`) | `test/integration/phase-trees.test.ts`, `test/integration/path-return.test.ts` |
| 4 | Post the week's progress | `weeklyUpdateFor` in `server/path-return.ts` (the week's finished steps no post has shared, tracked with a `posted:<postId>` tag on each task); `WeeklyUpdateDialog` on the home card and the path; `POST /api/feed` with `pathStepIds` (`entityType: "path_week"`) or a single step with `pathTaskId` (`path_step`) in `server/feed-routes.ts`; one `weekly_update` reminder per project per week | `e2e/path-loop.spec.ts`, `test/integration/path-return.test.ts` |
| 5 | Receive comments and feedback | comments and replies: `POST /api/feed/:id/comments`, `GET /api/feed/:id/comments` (`server/feed-routes.ts`, `client/src/components/feed-comments.tsx`); the post's page `/posts/:id` (`GET /api/feed/:id`, `client/src/pages/post-detail.tsx`); each comment, reply and reaction is a notification (`server/notifications.ts`, `GET /api/notifications`, `client/src/components/notification-bell.tsx`); outside comments also land in the project's feedback inbox (`server/feedback-loop-routes.ts`) | `e2e/path-loop.spec.ts`, `test/integration/notifications.test.ts`, `test/integration/feed-comments.test.ts` |
| ↺ | Return to the next step | on a post shared from the path, the team sees **Your next step** linking to `/projects/:id/manage` (`NextStepLink` in `client/src/pages/post-detail.tsx`); path notifications (`path_step_done`, `next_step`, `weekly_update`) open the project's path (`notificationHref` in `shared/notifications.ts`); the home card is always one tap from it | `e2e/path-loop.spec.ts`, `e2e/retention-loop.spec.ts` |
