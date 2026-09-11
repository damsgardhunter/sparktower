# The editor bridge

Nova in the editor, two ways onto one API: an MCP server for people whose
editor already drives an agent, and a VS Code extension for everyone else.

## The split

> Nova owns the plan, the path, the artifacts and the verification.
> The editor-side agent owns the reading and the editing.

Making the server do the editing would be the weak version. It would be working
from a stale, partial copy of a tree the agent is already sitting in, with no
language server, no test runner, and no way to ask the person first — and it
would be reimplementing, badly, what every editor agent already does well.

What the agent doesn't have is the plan: which milestone is next, what "done"
means at this verification tier, what has already been built, and whether the
thing just written proves anything. That's Nova's, and it's the only half the
bridge ships.

So the contract, everywhere: **Nova returns specifications and verdicts; the
agent returns evidence.** No tool returns file contents to be written out, and
no tool accepts a patch to apply.

## The shape of it

```
editor agent ──stdio──▶ @sparktower/nova-mcp  ─┐
                                               ├─ https + token ──▶ /api/mcp/*
VS Code UI ────────────▶ nova-sparktower      ─┘
```

Both front ends call the same endpoints with the same token. That's the point:
one place decides what a milestone is, what it costs, and whether it's done —
and a person who uses the extension on Monday and an agent on Tuesday is
working the same path either way.

Pieces:

- **`shared/mcp.ts`** — the tool catalogue: names, descriptions written for an
  agent, JSON Schema, and the HTTP call behind each. Shared so the description
  an agent reads and the endpoint that answers it can't drift apart.
- **`server/mcp-routes.ts`** — the endpoints. Every one is token-authenticated,
  member-checked, and behind the `mcp` kill switch.
- **`packages/nova-core`** — the client and the tree walker, shared. Two copies
  of "which files count as source" would disagree within a release, and the
  failure would be quiet: an audit that saw a different tree than the one the
  verification ran against, with no way to tell which was right. Bundled into
  both front ends rather than published; it is not a public package.
- **`packages/nova-mcp`** — the npm shim. Transport only: it holds the token,
  fills path parameters, and reads the working tree. It contains no opinion
  about the plan.
- **`packages/nova-vscode`** — the extension. The sidebar, the packet, and the
  diff. It has opinions about presentation and none about the plan.

The shim fetches the tool list from `GET /api/mcp/manifest` at startup rather
than compiling one in, so a new tool is a deploy and not a release nobody
installs.

## The loop

1. `nova_status` — the next task and its actor. An agent that invents its own
   plan here is worse than one with no plan, because now there are two.
2. Actor `user-does` → stop. That step is a human's.
3. `nova_work` — Nova's build packet for the task. The same call the app's own
   path UI makes, so what the agent implements is what the builder would have
   seen in the product.
4. The agent implements it, in the editor, with the user's normal approvals.
5. `nova_submit` — the record of what changed. Lands on the task as its written
   answer, which later Nova steps read.
6. `nova_verify` — Nova decides whether it's done.


## The extension

Layer 1 assumes an agent that already reads and writes files. Layer 2 is for
everyone else, and it has to be the polished one — the path visible, one button
that produces the next step's work, and a diff before anything lands.

### What it draws

`GET /api/mcp/projects/:id/status` is deliberately trimmed: an agent pays for
its context and only ever acts on the next step. A sidebar draws a map, so
there's `GET .../phases` — every phase and milestone in one call, because a
tree that fetches per expanded node feels slow the first time someone opens
three of them.

Two more endpoints exist for a UI rather than an agent. `GET .../work/:taskId`
reads back a packet already produced, free: a conversation doesn't need this
but a view that redraws does, and re-deriving it would charge for a redraw.
`POST .../work/:workId/choose` records the builder's answer — the option they
picked or their own words — which is the artifact the rest of the path reads.

### The diff, and the rule under it

**Nothing is written that hasn't been shown.** A build packet carries complete
files. Each one is classified against the working tree — new, changed, or
already identical — and openable as a real diff before it lands. Proposals are
served through a `nova-proposed:` virtual document scheme, so nothing hits disk
before someone agrees to it and there's nothing to clean up if they don't.

Applying is a single `WorkspaceEdit`: one undo puts the whole packet back, and
a file that's open and dirty is VS Code's problem to handle rather than ours to
overwrite.

Paths from a packet are model-written, so `safeRelativePath` in nova-core
refuses anything absolute, anything that climbs, and anything with a drive
letter — refuses rather than repairs, because a repaired path lands somewhere
the person didn't expect and the diff they approved was for somewhere else.
That function and the tree walker are the two pure things everything trusts, so
they're the two with tests.

Run steps are typed into a terminal and not executed. An extension that runs
shell commands a model wrote, on someone's machine, without a keypress, is a
different product with a different risk profile.

### What costs money

Two commands: **Work this step** and **Audit this codebase**. Both behind an
explicit press, both confirmed when they'd repeat work already paid for.
Refreshing, redrawing, opening a milestone and verifying are free and never
triggered by a file save. That rule lives in the extension host, not in the
webview's markup, so it's decided in one place.

### Testing it

The apply flow is tested against a stubbed editor API. The alternative,
`@vscode/test-electron`, downloads a real VS Code and drives it — the right
tool for asserting a view renders, the wrong one for asking whether `classify`
calls an identical file identical.

The test worth singling out is the manifest one: VS Code puts every command in
`contributes.commands` into the palette whether or not a handler exists, so a
command renamed in one place stays visible, fails when run, and compiles
perfectly. Activation runs in the suite and every advertised command has to
have been registered.

### Shipping it

`packages` in CI builds all three packages, runs their tests, and packages the
extension into a .vsix — a release that can't assemble should fail before the
tag, not after. It also runs the MCP bundle with its workspace dependency
deleted, which is how you find out that "bundled" wasn't true.

Publishing is tag-driven (`.github/workflows/publish-packages.yml`):
`nova-mcp-v*` goes to npm, `nova-vscode-v*` to the marketplace and, when a
token is set, to Open VSX — VS Code forks install from there, and an extension
only on Microsoft's marketplace is invisible to them. Both jobs check the tag
against `package.json` first.


## Loops

A product's loops are what week 1 turns on: the sequence someone actually
repeats and gets something from each time. They aren't milestones, so none of
the endpoints above reached them — which meant an agent parked on the core-loop
milestone could read what it was being asked for and had no way to do any of
it, and the extension showed a milestone about loops with the loops missing.

Four endpoints, all under the same guards as the rest:

| | |
| --- | --- |
| `GET .../loops` | the loops, each with a `state` — `unwritten`, `written`, `planned`, `building`, `built` — plus the rejected titles and how many more will fit |
| `POST .../loops` | record another one (six is the cap) |
| `DELETE .../loops/:taskId` | "not a loop" |
| `POST .../loops/:taskId/steps` | break one into the steps that build it |

Three things worth knowing about them.

**`rejected` is the load-bearing field.** Removing a loop isn't a delete, it's
a judgement: the title goes on the project's rejected list, and
`reconcileLoops` matches against it loosely, so "post a weekly check-in and get
feedback" doesn't come back as "ship weekly check-ins on a project". Anything
proposing loops has to read that list first. The tool description says so in as
many words, because a model that re-proposes what someone just rejected is the
specific failure this list exists to prevent.

**Whether a path does loops is read from the tree, not from what exists.**
`pathStatus.loopTree` is built around the loops a project *has*, so it is null
until the first one is written — which made an empty ship-an-MVP project look
like a path with no loops at all, and left nowhere to put the first one. The
structure is in the authored tree (`expandsFrom`) and doesn't depend on anyone
having answered anything. A path with no fan-out milestone answers
`supported: false` and says so, rather than returning an empty list that reads
as "none yet".

**An unwritten loop is a branch, not an error.** There is nothing to expand
from, so `/steps` answers `artifact_missing` — and `draft: true` has Nova write
the sequence from the project and hand it back. That is a draft and not a
decision: nothing lands on the loop until the person sends their edited version
as `artifact`. The extension runs exactly that: draft into an editor, "Build the
steps" once they've fixed it.

The loops also ride along on `status.next.loops`, because on the core-loop
milestone they *are* the milestone — reading "define your core loop" without
being handed the loops is reading half of it.

## Verification

`nova_submit` deliberately does not close anything. An agent reporting its own
work as complete is the failure the whole design exists to prevent.

`nova_verify` is separate, deterministic and free. It takes the working tree,
builds the same digest the codebase audit uses, probes the runtime, and runs
the verifiers in `server/phase-tree-verifiers.ts` — the handful of milestones an
audit can genuinely see. Those get marked done with the evidence as the reason.
Everything else comes back unproven with what's missing, which is more useful
than a refusal and more honest than taking the agent's word.

It never un-marks. A thinner snapshot is not proof something was removed.

Two verifiers read the capability inventory, which only a full audit produces.
The reply says which audit it used and when — stale capability data should be
visible rather than quietly load-bearing.

`nova_audit` runs the full audit from the working tree. The interesting
difference from the web app's version is that it sees uncommitted work: an
audit of the last push judges a repository the builder may have moved past.

## Tokens

Neither existing auth style fits. A cookie session belongs to a browser; the
mobile access token lives fifteen minutes and refreshes itself. So the bridge
has its own: `nova_pat_…`, created in Profile → Editor access, shown once.

The design assumes it will leak eventually and that the person will find out
late:

- only a SHA-256 is stored, so a database read gives an attacker nothing;
- it can be pinned to one project, so a token in a repo's config reaches that
  repo's project and nothing else;
- `lastUsedAt` is written on every call, so "is this still in use?" is
  answerable *before* revoking;
- revoking is immediate — the guard reads the row every request, no cache;
- a token can't mint another token. Those routes are session-only, so a leak is
  the end of the damage rather than the start of a chain.

A cookie session isn't accepted on `/api/mcp` either. Browsers send cookies on
cross-site requests they were never asked to make; a token has to be pasted
deliberately, which makes the surface CSRF-proof by construction.

The pin is enforced in the middleware, read from the URL — `req.params` is
empty in a prefix-mounted handler, and trusting it let a pinned token reach
every project in the account until a test caught it.

## Limits and the kill switch

Whole source trees and long-lived tokens arrive here, so the bridge is its own
surface: `mcp`, in `shared/surfaces.ts`, covering `/api/mcp` and
`/api/mcp-tokens`. Turning it off is the first move if a token leaks.

Snapshots are bounded by the same ceilings as the audit's zip ingest — 4,000
files, 512KB per file — enforced server-side on whatever arrives, because the
client is someone else's process on someone else's machine. The shim applies
the same limits before it sends, so an over-large tree fails locally.

Costly routes are credit-metered at the route, not inside the function they
call: "what does this endpoint cost, and what stops it" has to be answerable
from the route table, which is what `test/unit/route-guards.test.ts` checks.

## Adding a tool

1. An entry in `NOVA_MCP_TOOLS` (`shared/mcp.ts`) with the description an agent
   will read.
2. The route in `server/mcp-routes.ts`, under the existing guards.
3. Nothing in the shim. It registers whatever the manifest offers — a new tool
   reached the smoke-test client with no change to it at all.
4. The extension only if it needs a button for it; it names endpoints rather
   than reading the catalogue.

## Deploying the schema

`mcp_tokens` is a new table: `npm run db:push`.

## The coding model

Build packets — complete files for someone's repository — are written by a
coding model: `CODE_MODEL` in `server/aiModels.ts`, `gpt-5.3-codex` unless
`AI_CODE_MODEL` says otherwise, at `AI_CODE_REASONING` effort (default
`medium`). Everything else Nova produces — options to choose from, templates
for the human part — stays on the general model, where a better sentence is
what matters.

Codex models are served on the Responses API, not Chat Completions, and reject
a temperature, so `complete()` in `server/phase-trees-nova.ts` routes by what's
being produced. Two failure rules, both tested in
`test/integration/code-model.test.ts`:

- **Refused** (no access, a proxy that doesn't carry it, an outage): the packet
  still arrives, from the general model, charged once, and the log says so.
- **Unreadable**: an uncharged 502, like every other AI route. It is not retried
  on the general model — quietly spending a second call to paper over a bad
  answer would hide the thing worth knowing.

Each packet records `model`, and the editor shows it.

## Loops in the editor

Loops have their own view, between Next step and The path. They are the
product the milestones build, not a stop on the way — an earlier version drew
them only while the core-loop milestone was next, and they vanished from the
editor the moment it was done. Opening a step is free; building one is an
explicit press that makes one request, and the packet opens in the Next step
panel, which already knows how to preview and apply it.
