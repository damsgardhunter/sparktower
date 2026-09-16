# The collaborator loop

An invite brings someone in, the work they do here gives them something worth sharing, and that is where they're asked to bring in the next person.

| Step | Where it lives | Proof |
| --- | --- | --- |
| A member (not only the owner) creates an invite: a role, an optional address, a single-use link that expires | `server/invite-routes.ts` (`teamProject`, hashed token, per-person and per-project caps), `client/src/components/invite-collaborator-dialog.tsx` | `test/integration/invites.test.ts`, `e2e/project-invite.spec.ts` |
| The link opens signed out, says who invited them to what, and survives a sign-up (`PENDING_INVITE_KEY`) | `client/src/pages/invite-accept.tsx`, `client/src/App.tsx` (public route) | `e2e/project-invite.spec.ts` |
| Accepting adds them to the project and tells the owner (`invite_accepted`) | `POST /api/invites/:token/accept`, `server/notifications.ts` | `test/integration/invites.test.ts` |
| **Landing on the work**: accepting goes to the project's path, not the member list, and the welcome names the project and points at the next step. A new account is sent through onboarding first, so the marker is kept in storage (`JOINED_PROJECT_KEY`) rather than the URL | `client/src/pages/invite-accept.tsx`, `client/src/pages/project-manager.tsx` (`just-joined`), `shared/invites.ts` | `e2e/project-invite.spec.ts` |
| **Doing a step**: the new member takes the next action on the team's path and writes the answer themselves | `client/src/components/section/next-step.tsx` (`Write it myself`) | `e2e/project-invite.spec.ts`, `e2e/growth-loop.spec.ts` |
| **Back to step one**: publishing that step offers "Invite a collaborator", wired to the same dialog and endpoint the owner used — the invite goes out with something finished attached to it | `PublishArtifactDialog` in `client/src/components/continue-path-card.tsx` | `e2e/project-invite.spec.ts` (the second link differs from the first) |

An invite reaches another person, so it needs a confirmed address (`server/email-verification.ts`) — the same gate as posting and messaging. A solo project refuses invites outright.

The published page is also the other loop's front door: a stranger who reads it can start their own path (`docs/growth-loop.md`).
