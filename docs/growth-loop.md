# Growth loop: publish a path artifact

Something a builder finishes becomes the page the next stranger finds.

| Step | Where it lives | Proof |
| --- | --- | --- |
| Finish a path step → **Generate artifact** (a stored `path_artifacts` row made from the step's answer, build files or plan) | `server/artifact-routes.ts` (`generateArtifact`, `POST /api/projects/:id/path/tasks/:taskId/artifact`), `shared/path-artifacts.ts` (`artifactFromStep`), `shared/schema.ts` (`pathArtifacts`), `migrations/0008_path_artifacts.sql` | `test/integration/path-artifacts.test.ts`, `test/unit/path-artifacts.test.ts` |
| **Publish** with a public title, tags and a backlink to the project and its path; a feed post links to it | `POST /api/artifacts/:id/publish` (`validatePublish`, feed post `entityType: "path_artifact"`, `markStepsShared`), `client/src/components/continue-path-card.tsx` (`PublishArtifactDialog`), `client/src/components/path-panel.tsx` ("Publish as artifact"), `client/src/components/feed-post-card.tsx` (public page chip) | `e2e/growth-loop.spec.ts` |
| A **shareable, indexable URL**: `/a/:id`, readable with no account, with its own `<title>`, description, canonical and Open Graph tags in the HTML | `GET /api/public/artifacts/:id`, `artifactPageMeta` + `injectPageMeta` applied in `server/static.ts` and `server/vite.ts`, `client/src/pages/public-artifact.tsx`, `client/src/App.tsx` (public route) | `e2e/growth-loop.spec.ts` (og:title in the HTML, logged-out read) |
| A stranger lands → **Start your own path** on the same goal → signs up | `public-artifact.tsx` (`PENDING_PATH_KEY`), `client/src/pages/landing.tsx` (`?signup=1`), `client/src/pages/project-create.tsx` (goal preselected), `server/attribution.ts` (first-touch landing path → `creditArtifactSignup`) | integration: `signups` counted, `signupLandingPath` = `/a/:id`; e2e: signup from the page |
| **The way back**: the author is notified (`artifact_signup`), and the newcomer finishes their first step and publishes their own artifact | `server/notifications.ts`, `shared/notifications.ts`, the same publish flow | integration + e2e: author's bell, newcomer's artifact public |

Safety: only the project's team can generate or publish; private projects can't publish, and making a project private (or a moderator hiding the feed post, or unpublishing) takes the page down. Artifacts list file paths and purposes, never file contents. Anonymous page views read path progress without syncing anything (`pathProgress`).
