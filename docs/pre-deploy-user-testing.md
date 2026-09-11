# Before deployment: what needs a person to test

The automated suites (331 app tests, 8 browser specs) prove the code does what
it says against a test database, stubbed Stripe, and a desktop browser. They
can't prove any of this: real money moves, a real phone signs in, a real
proxy passes the right address, or a real person understands the screen.
That's this list.

Deploy mechanics — CI, migrations, secrets, the post-deploy smoke — live in
[release-checklist.md](release-checklist.md). This list comes first.

**Blocker** = don't deploy until it passes. **Should** = test before
inviting people; fine to deploy behind a kill switch meanwhile.

---

## 0. Before anyone tests

- [ ] **Blocker — Everything is on `main`.** The last three rounds of fixes are
  uncommitted: unguarded writes and `/api/seed` removed, reviewer and payout
  limits, Stripe refunds and webhook secret. Commit, open a PR, and let CI go
  green.
- [ ] **Blocker — Schema pushed to production** (`drizzle-kit push`, reviewed).
  New since the last deploy: `user_follows`, `mcp_tokens`, `connections.note`,
  `project_comments.hidden_mode`, `moderation_log.reason_code` /
  `previous_state` / `resulting_state`, `donations.refunded_amount`.
- [ ] **Blocker — The moderation log trigger is in place.** After boot, run
  `UPDATE moderation_log SET reason = reason WHERE false;` then try a real row;
  a real `UPDATE` must fail with *append-only*.
- [ ] **Blocker — Production database timezone is UTC** (`SHOW timezone;`).
  Locally it's `America/Chicago`, which is why times read about 5 hours off
  here. If production isn't UTC, check-in weeks and "new since you looked"
  drift the same way.
- [ ] **Blocker — New environment variables set** (not yet in
  [env-contract.md](env-contract.md)):
  - `PUBLIC_URL` — so boot registers the Stripe webhook, *or*
  - `STRIPE_WEBHOOK_SECRET` — the dashboard endpoint's signing secret
  - `RATE_LIMIT_EXEMPT_EMAILS` — your testers, so testing doesn't trip limits
  - `AI_CODE_MODEL` / `AI_CODE_REASONING` — only if not using the defaults
- [ ] **Should — Test accounts ready.** One owner (`PLATFORM_OWNER_EMAIL`), one
  reviewer (`PLATFORM_REVIEWER_EMAILS`), and at least three ordinary builders
  on different devices and networks.

## 1. Money (Stripe) — test mode first, then one real payment

Runbook: [stripe-e2e.md](stripe-e2e.md).

- [ ] **Blocker — Stripe can reach production.** Open
  `/api/admin/stripe/health` as the owner. The verdict isn't
  `no_webhook_secret`, and the Stripe dashboard's endpoint shows 2xx
  deliveries.
- [ ] **Blocker — A donation.** Donate with `4242 4242 4242 4242`. The project's
  total rises by exactly that amount, once, even after a refresh.
- [ ] **Blocker — A partial refund, then the rest.** Refund part of it from the
  dashboard: the total drops by *that part*. Refund the remainder: the rest
  comes off, and the total never goes below what it should be.
- [ ] **Blocker — Subscribe, trial, cancel.** Upgrade from the pricing page; the
  tier and credits change right away. A trial counts as paid, including after
  **Sync subscription**. Cancel in the dashboard: back to free.
- [ ] **Should — Billing portal** opens and returns to the app.
- [ ] **Should — One real card, small amount, in live mode**, then refund it.
  Test mode can't catch a live-mode key or webhook mix-up.
- [ ] **Decision — Backing stays off** (`backing` kill switch, off by default)
  until someone has walked pledge → hold → release, and pledge → refund, end to
  end in test mode.

## 2. Signing in and out — every way in

- [ ] **Blocker — Two people on different networks can both sign in** after a
  few wrong passwords each. The sign-in limit is keyed on the address the proxy
  sees. If production has more than one proxy hop, everyone shares one address,
  and one person's typos lock out everyone. If that happens, stop and fix
  `trust proxy`.
- [ ] **Blocker — Sign up, sign in, sign out on web.** Sign out now uses POST.
  After signing out, the back button doesn't show private pages.
- [ ] **Blocker — Google sign-in**, web and mobile.
- [ ] **Should — A link to `/api/logout` on another site doesn't sign you out.**
  Your own sign-out button, and typing the URL, still do.
- [ ] **Should — Sign out everywhere** ends the session on a second browser and
  on the phone.
- [ ] **Should — A suspended account** can read and sign out, but can't post.

## 3. Mobile, on a real phone

- [ ] **Blocker — The app builds and runs on a device.** Note: Expo here needs
  Node 23; Node 20 failed to export.
- [ ] **Blocker — Sign in, close the app, reopen a day later.** Still signed in:
  the refresh token rotates.
- [ ] **Should — Discover "For you"**: cards load, refresh works, and a return
  shows what's new.
- [ ] **Should — Connect with a note, message, follow** from a profile. Each
  works once; a double tap doesn't double-send.

## 4. The social loop — with at least three real people

- [ ] **Should — Follow a builder and a project**; their posts appear on the
  **Following** tab straight away and after a reload. Someone who follows no
  one sees "Follow builders to see updates".
- [ ] **Should — Connect with a note**; the other person sees the note and can
  accept. The profile's **Message** button opens that conversation.
- [ ] **Should — Come back a day later**; the Discover banner and badges show
  only genuinely new posts. Your own posts and hidden ones don't count.
- [ ] **Should — Nobody trips a limit in normal use.** An hour of real activity
  — commenting, posting, reacting — produces no "slow down" messages. If one
  appears, it should be readable ("Ready again in about 3 minutes"), never
  `429: {…}`.

## 5. Moderation — as the reviewer

Runbook: [moderation-e2e.md](moderation-e2e.md).

- [ ] **Blocker — Report → queue → remove.** A builder reports a comment. It
  appears under **Open → Comments**. Remove it with a reason code: it disappears
  for everyone, and **History** shows who, why, and when.
- [ ] **Should — Shadow-hide**: the author still sees their comment; others
  don't.
- [ ] **Should — Ban author**: the account can't post and sees why; the comment
  is gone.
- [ ] **Should — Dismiss**: nothing changes except the report, and it's still in
  History.
- [ ] **Should — A reviewer working fast** (say 30 reports in 10 minutes) isn't
  stopped. The limit is 120.

## 6. Nova in the editor — outside this repo

Guide: [editor-bridge.md](editor-bridge.md).

- [ ] **Should — Install the VS Code extension** from the `.vsix` on a clean
  machine. Sign in from the sidebar with a token made on the dashboard.
- [ ] **Should — Work a step end to end**: **Next step → Work this step →**
  preview the diff → apply. Only the files shown are written. **Have Nova redo
  it** gives a new answer.
- [ ] **Should — Loops view** builds steps for a loop. Run-step blocks copy and
  run in the right folders.
- [ ] **Should — The MCP server in Claude Code or Cursor** lists the project and
  the next step. A revoked token stops working immediately.
- [ ] **Should — The code model is available** on the production OpenAI account
  (`gpt-5.3-codex`). If it isn't, it falls back to `gpt-5.2`. Check the answers
  are still usable.

## 7. Uploads and the rest

- [ ] **Blocker — Uploads go to real storage** (`PRIVATE_OBJECT_DIR` set).
  Upload an avatar and a project image; both still show after a redeploy.
- [ ] **Should — Kill switches**: turn off `feed` in `/admin/surfaces`; the feed
  says it's paused rather than erroring. Turn it back on.
- [ ] **Should — The owner's analytics** shows the Explore funnel moving as
  testers use Discover.

## 8. Watch people use it

- [ ] **Should — Three people who've never seen it**, from sign-up to their
  first post or check-in, with no help from you. Write down every hesitation.
  The board already has "Watch three people use it" and "Fix the top three
  frictions" waiting for this.

---

## Not ready to test — not built yet

These are on the board and blocked. Don't test them; don't promise them.

- **Path Home as the default landing** — `/` is still the feed. Blocked by
  "create Path Home screens".
- **Check-ins retired or demoted to an artifact** — blocked by artifact
  persistence.

## Known and accepted

- **CodeQL alerts stay open** — mostly "missing rate limit" on routes behind
  our own limiter, which CodeQL can't see. Triage them in the Security tab;
  none of them block a deploy.
- **The Stripe event ledger and payment tables are empty locally.** This
  machine can't verify Stripe's events without a secret. See §1.
