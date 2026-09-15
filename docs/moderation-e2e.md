# Moderation, end to end (comments)

The loop for one content type — comments on projects (and their milestones and roadmap phases):

**create → report → queue → decide (action + reason code) → visibility changes → audit entry**

Everything here is live code. The automated version of this runbook is
`e2e/moderation-loop.spec.ts` (browser: the reviewer's queue, decision,
history and undo; the report itself is filed through the API) and
`test/integration/moderation-loop.test.ts` (API); the manual version is below.

## The pieces

| Step | Where |
|---|---|
| Report (reason + optional note) | Flag icon on a comment → `POST /api/reports` `{targetType:"comment", targetId, reason, note?}` |
| Queue, by status and kind | `/admin/reports` → Open / Actioned / Dismissed, All kinds / Comments → `GET /api/admin/reports?status=open&type=comment` |
| Decide | The report's panel: **Action** + **Reason code** (both required) + note → `POST /api/admin/reports/:id/act` |
| Audit | The report's **History**, or `GET /api/admin/moderation-log?targetType=comment&targetId=<id>` |

### Actions

| Action | Effect |
|---|---|
| `remove` | Hidden from everyone, its author included. |
| `shadow_hide` | Hidden from everyone but its author, who still sees it as posted. |
| `ban` | Suspends the author (writes refused with `account_suspended`) and removes the comment. |
| `dismiss` | Nothing changes but the report, which closes as dismissed. |

Reason codes (`MODERATION_REASON_CODES` in `shared/moderation.ts`): violations
`spam`, `harassment`, `hate`, `sexual`, `misleading`, `off_topic` go with
remove / shadow-hide / ban; dismissals `no_violation`, `duplicate`,
`insufficient_context` go only with dismiss. A missing or mismatched code is a
400 with `field: "reasonCode"`, and nothing changes.

### What protects against a reviewer's mistake

- **A reason code, always.** A wrong call can be found later by code, not by
  reading notes.
- **The state before, kept exactly.** Each entry has `previousState` and
  `resultingState`: the comment's `hiddenAt / hiddenMode / hiddenById /
  hiddenReason`, the report's status, and for a ban the author's
  `suspendedAt / suspendedReason`. An undo is putting `previousState` back.
  That's the next step, and nothing it needs is lost.
- **All or nothing.** The content change, the suspension, closing the report
  and the log entry are one transaction. If any part fails, none of it
  happened. The report row is locked while it's decided, so a second
  reviewer gets `409 already_resolved` instead of a second action.
- **An immutable log.** A database trigger (`server/moderation-log-rules.ts`,
  applied at every boot) refuses `UPDATE` and `DELETE` on `moderation_log`
  from anyone, including a console session.

The older takedown, restore, suspend and resolve buttons, used for other
content types, now record the state before as well.

## Manual run (local)

Needs a signed-in reviewer. Roles come from `PLATFORM_REVIEWER_EMAILS` at boot.
Add your address and restart, or for a local account:

```sql
UPDATE users SET platform_role = 'reviewer' WHERE email = 'you@example.com';
```

1. **Create.** As builder A, post a comment on your own project
   (`POST /api/projects/<id>/comments` with `targetType: "project"`).
2. **Report.** As builder B, report the comment
   (`POST /api/reports` with `targetType: "comment"`, a reason, and a note).
3. **Queue.** As the reviewer, open `/admin/reports` → **Open** →
   **Comments**. The report shows the reason, the note, and a snapshot of
   the comment.
4. **Decide.** Choose **Remove** and a reason code, add a note, and click
   **Apply**. Apply stays disabled until both are chosen. The report leaves
   Open.
5. **Visibility.** As B, read the project's comments
   (`GET /api/projects/<id>/comments?targetType=project&targetId=<id>`): the
   comment is gone. For a shadow-hide, A still sees it and B doesn't.
6. **Audit.** Under **Actioned**, the report's **History** shows the action,
   the code, the reviewer and the time. Or query it:

```bash
# Sign in as the reviewer and keep the session cookie (no copy-pasting cookies).
curl -s -c /tmp/mod.jar -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"…"}' http://localhost:5000/api/auth/login >/dev/null

curl -s -b /tmp/mod.jar \
  "http://localhost:5000/api/admin/moderation-log?targetType=comment&targetId=<commentId>"
```

Or straight from the database:

```sql
SELECT created_at, action, actor_id, reason_code, reason, previous_state, resulting_state
FROM moderation_log
WHERE target_type = 'comment' AND target_id = '<commentId>'
ORDER BY created_at;

-- And that it can't be changed:
UPDATE moderation_log SET reason_code = 'x' WHERE target_id = '<commentId>';
-- ERROR:  moderation_log is append-only: UPDATE refused
```

## Automated run

```bash
npx vitest run test/integration/moderation-loop.test.ts
npx playwright test e2e/moderation-loop.spec.ts
```

## Undo

`POST /api/admin/moderation-log/:id/undo` (`server/moderation.ts`), reviewer only, rate-limited (`review`), from the **Undo** link beside a decision in the report's **History** (`client/src/pages/admin-reports.tsx`).

- **Its own reason code** (`UNDO_REASON_CODES` in `shared/moderation.ts`): `reviewer_error`, `appeal_upheld`, `new_context`. Missing or wrong is a 400, and nothing changes.
- **The state before, exactly**: the comment's `hiddenAt / hiddenMode / hiddenById / hiddenReason`, the author's suspension for a ban, and the report's status. The report goes back to **Open**, to be decided again.
- **One transaction, appended**: a new `comment_restore` entry (or `report_reopened` for a dismissal), with `details.undoes` pointing at the original. The original entry isn't touched, and the database wouldn't allow it.
- **Once, and never over a later change**: `409 already_undone` if it was undone (two at once serialize on the report row), and `409 state_changed` if the comment, author or report has changed since the decision (for example, restored by hand). An undo can't itself be undone (`not_undoable`); decide the reopened report instead.

Proof: `test/integration/moderation-loop.test.ts` (undo, ban undo, concurrent undo, state changed) and `e2e/moderation-loop.spec.ts` step 7.

## Where decisions are enforced on read

Hidden content is filtered where it is read, not only flagged:

| Content | Read path | Filter |
|---|---|---|
| Project comments | `server/storage.ts` (`commentVisibleTo`, the project comments list), `GET /api/projects/:id/comments` | `hiddenAt IS NULL`, or the author for a shadow-hide |
| Feed posts | `server/storage.ts` (`getFeedPosts`: `isNull(feedPosts.hiddenAt)`; `getFeedPost`: 404 unless author) | same |
| Feed comments | `server/storage.ts` (`getFeedComments`: hidden kept only for its author) and `server/feed-routes.ts` (no replies or reactions on hidden) | same |
| Suspended accounts | `blockSuspended` in `server/moderation.ts` (writes refused with `account_suspended`) | — |

## Retired check-ins

Weekly check-ins were retired. Reports filed against one before that still
load in `/admin/reports` (target `check_in`, labelled "Check-in (retired)" by
`REPORT_TARGET_LABEL`, filterable with `?type=check_in`) and can still be
decided, but `POST /api/reports` refuses a new `check_in` target, comments
can't target one, and there is no takedown for one (`not_takedownable`).
Proof: `test/integration/moderation-drill.test.ts` ("retired check-ins").

## Reviewer console routes

`/admin/reports` uses `server/moderation.ts` (`/api/admin/reports*`, `/api/admin/moderation-log*`, `/api/admin/content/:type/:id/hide|restore`, `/api/admin/users/:id/suspend`). `/admin/safety` uses `server/safety-routes.ts` (`GET/POST /api/admin/safety/review`, `GET /api/admin/safety/status`, `GET /api/admin/safety/impact/:logId`). `/admin/surfaces` uses `server/surfaces.ts` (`GET /api/admin/surfaces`, `PATCH /api/admin/surfaces/:id`). All three are registered in `server/routes.ts` behind `isAuthenticated` + `requireReviewer`.
