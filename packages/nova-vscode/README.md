# Nova for SparkTower

Your project's path, in the sidebar. The next milestone, what counts as done,
and Nova's work on it — with a diff before anything is written.

## What it does

**The path.** Every phase and milestone, with the next one marked. Milestones
Nova verified from your code look different from ones you ticked, because they
are different.

**Work this step.** One button. Nova produces the work for the milestone in
front of you, and what that means follows the actor:

- *Nova drafts / you decide* → three real options, full text, pick one or write
  your own.
- *Nova builds* → complete files, run steps, and the check that proves it works.
- *Only you can do this* → the template for the human part, and a plain sentence
  about which part is still yours.

**Preview and apply.** A build packet's files are classified against your
working tree — new, changed, or already identical — and every one can be opened
as a real diff before it lands. You tick what to write. The write is a single
edit, so one undo puts everything back.

Nothing is written that you haven't been shown. Run steps are typed into a
terminal, never executed for you.

**Verify against the code.** Free and deterministic. Nova reads what it can
prove — the scaffold, a live URL that answers, persistence and auth, analytics
wiring — and marks those milestones with the evidence as the reason. What it
can't prove comes back unproven with the reason. It never un-marks: a snapshot
that shows less is not proof something was removed.

**Audit this codebase.** The full audit against the plan, from the working tree
— no GitHub, no zip upload, and it sees uncommitted work.

**Loops.** Their own view, between the next step and the path: the sequences
your product runs on — the thing someone repeats and gets something from each
time. Each shows how far it has got. Break one into steps, or drop it as "not a
loop" (remembered, so nothing proposes it again). Click a step to open it; press
✨ and Nova builds it — the packet opens in the Next step panel, ready to
preview and apply.

**The code is written by a coding model.** Build packets come from OpenAI's
`gpt-5.3-codex` (the server's `AI_CODE_MODEL`), and each packet says which model
wrote it. Drafts and options stay on the general model.

## Setup

1. In SparkTower, open a project and press **Connect** at the top of the
   dashboard. The token is shown once. **Open in VS Code** does the rest.
2. Or, by hand: click the Nova icon in the activity bar, put your server and
   token into the form, and press **Sign in**.
3. **Nova: Choose project** — the choice is saved per workspace, so each
   repository remembers its own.

If your SparkTower isn't at the default address, the sign-in form is where you
say so: it asks for the server alongside the token.

The token is kept in VS Code's secret storage, not in settings: settings sync
across machines in plaintext.

Pin a token to a single project when you create it. A token that lives beside a
repository should reach that repository's project and nothing else.

### Settings

| Setting | |
| --- | --- |
| `nova.baseUrl` | Where SparkTower is. Change it for a self-hosted instance. |
| `nova.projectId` | The project this workspace belongs to. Set by **Choose project**. |

## What costs credits

Two things, both behind an explicit press: **Work this step** and **Audit this
codebase**. Refreshing, redrawing, opening a milestone and verifying are all
free, and none of them happens on a file save.

## Using an agent instead

If your editor already drives an agent that reads and writes files — Claude
Code, Cursor, VS Code agent mode — `@sparktower/nova-mcp` gives it the same
Nova over MCP, and the agent does the editing. The two work together: same
account, same path, same verification.
