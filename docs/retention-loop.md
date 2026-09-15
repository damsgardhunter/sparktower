# The retention loop: return to the next step

Open SparkTower → see each project's next step → do it → share what it
produced for feedback, or just see the path move → come back when the next step
is ready. It closes because finishing a step, and time away from a waiting step,
both produce something that brings the builder back to the path.

In-app only: the home card and the notification bell, on web and mobile.

## The steps, and where each one lives

| # | Step | Code | Proof |
|---|------|------|-------|
| 1 | Open SparkTower and see your paths — the first thing on the home feed | `ContinuePathCard` in `client/src/components/continue-path-card.tsx` (mounted in `client/src/components/founder-feed.tsx`); `ContinuePath` in `mobile/src/components/ContinuePath.tsx` (the mobile feed header, `mobile/app/(tabs)/feed.tsx`); `GET /api/me/next-steps` in `server/path-return.ts` | `e2e/retention-loop.spec.ts`, `test/integration/path-return.test.ts` |
| 2 | See the next step (who acts, how long) and Continue straight to it | `nextStepsFor` in `server/path-return.ts` (from `pathStatus`); Continue opens `/projects/:id/manage`, where `client/src/components/path-panel.tsx` shows the next action | `e2e/retention-loop.spec.ts` |
| 3 | Do the step; its answer is the step's artifact, stored on the path task | `chooseWork` / `saveIntake` in `server/phase-trees.ts`, `POST /api/projects/:id/path/work/:workId/choose`, `PATCH /api/kanban/:taskId`; every completion runs `onPathTaskDone` | `test/integration/phase-trees.test.ts`, `test/integration/path-return.test.ts` |
| 4 | The path advances; the rest of the team is told what was finished and what's next; the step can be shared for feedback, tied to the step | `afterPathStepDone` (`path_step_done` notification) in `server/path-return.ts`, called from `onPathTaskDone`; `lastDoneStep` + `ShareStepDialog` (home card and path panel); `POST /api/feed` with `pathTaskId` (`entityType: "path_step"`), the "From the path" chip in `client/src/components/feed-post-card.tsx`; comments on it notify the builder (`server/notifications.ts`) | `test/integration/path-return.test.ts`, `e2e/retention-loop.spec.ts` |
| ↺ | Come back: a notification (a teammate or Nova finished a step, feedback on the shared step, or a `next_step` nudge after `NUDGE_AFTER_DAYS` away) opens the project's path, where the next step is waiting | `notify` / `nudgeIfAway` in `server/path-return.ts`, links from `notificationHref` in `shared/notifications.ts`, bell in `client/src/components/notification-bell.tsx` and `mobile/app/notifications.tsx` | `test/integration/path-return.test.ts` |

## Rules

- A builder finishing their own step on a solo project isn't notified about it; on a team, everyone else is. When nobody on the team finished it (Nova's answer was chosen, an audit found it done), the whole team is.
- The nudge is once per waiting step (`once`), after two days without activity on that path.
- Only a finished step on the project's own path can be shared as a path step.
