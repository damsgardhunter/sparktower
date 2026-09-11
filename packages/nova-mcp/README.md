# @sparktower/nova-mcp

Nova, in your editor, over MCP.

```
Nova owns the plan, the path, the artifacts and the verification.
Your editor's agent owns the reading and the editing.
```

Claude Code, Cursor and VS Code's agent mode already read repositories, run
tests and ask before touching a file. None of them knows what your next
milestone is, what "done" means for it, or whether the thing you just built
actually proves it. That is the half this ships.

No tool here writes a file, and none hands back code to paste in. Your agent
asks Nova what to build, builds it, reports what it did, and Nova decides
whether that counts.

## Setup

Create a token in SparkTower under **Profile → Editor access**. It's shown
once. Then add the server to your MCP client:

```json
{
  "mcpServers": {
    "nova": {
      "command": "npx",
      "args": ["-y", "@sparktower/nova-mcp"],
      "env": { "NOVA_TOKEN": "nova_pat_…" }
    }
  }
}
```

Claude Code, from the repository you're working in:

```sh
claude mcp add nova --env NOVA_TOKEN=nova_pat_… -- npx -y @sparktower/nova-mcp
```

### Options

Flags or environment, whichever your client makes easier.

| Flag | Environment | Default | |
| --- | --- | --- | --- |
| `--token` | `NOVA_TOKEN` | — | Required. |
| `--url` | `NOVA_BASE_URL` | `https://sparktower.app` | For self-hosted or staging. |
| `--project` | `NOVA_PROJECT_ID` | the token's pin, if any | Default project for every call, so nothing has to mention ids. |
| `--root` | `NOVA_ROOT` | the working directory | Which tree gets read. |

A token can be pinned to a single project when you create it. Pin the one that
lives in a repository's config: it should reach that repository's project and
nothing else in your account.

## The tools

| Tool | |
| --- | --- |
| `nova_projects` | Your projects, with the path each is on. |
| `nova_status` | Where the project is: phase, next milestone, its actor, the task to work on. |
| `nova_milestone` | One milestone in full. |
| `nova_work` | Nova works the task and hands back the build packet. Costs credits. |
| `nova_submit` | Report what you changed. Records it; does **not** mark it done. |
| `nova_verify` | Send the tree; Nova marks what the code proves, and says what it couldn't. Free. |
| `nova_audit` | The full audit against the plan. Expensive; run it at checkpoints. |
| `nova_ask` / `nova_apply` | Nova's help on one area, proposed then applied. |
| `nova_mark` | The builder's own word that something is done. Only when they say so. |

The list isn't compiled in — it's fetched from Nova at startup, so a new tool
arrives without upgrading this package.

## What reading the tree means

`nova_verify` and `nova_audit` need source, and a repository can't travel
through a tool call an agent types out. So they don't ask for one: the shim
walks the working directory itself, skipping dependencies, build output,
binaries and lockfiles, and sends what's left. Nothing about your source enters
the conversation, and the model never sees a file it didn't ask to read.

Symlinks aren't followed. The server enforces its own limits on whatever
arrives, and a snapshot that hit one comes back marked truncated — an agent
that doesn't know the snapshot was cut short will read "unproven" as "not
built".

## Verification, and why it's Nova's call

`nova_submit` records what your agent did. It does not close anything.

An agent marking its own work complete is the failure this design exists to
prevent: it closes the milestone on the strength of having tried. `nova_verify`
is separate, deterministic, and free — Nova reads the code for the things it
can see for itself and marks those, with the evidence as the reason. What it
can't prove comes back unproven, with what's missing.

It never un-marks. A snapshot that shows less than the last one is not evidence
that something was removed.

## Building

```sh
npm install && npm run build
```
