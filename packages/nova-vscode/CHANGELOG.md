# Changelog

## 0.1.0

First release.

- Sign in inside the Nova sidebar — server and token in the panel you're already
  looking at, not the quick-input at the top of the window. Failures come back
  in the form.
- **Loops** as their own view, between the next step and the path — visible
  whatever step you're on. Break a loop into steps, say it isn't a loop, open a
  step for free, or have Nova build it.
- Build packets written by `gpt-5.3-codex`, with the model named on the packet.
- **Have Nova redo it.** Every packet can be regenerated from the panel, and
  building a step that already has a packet asks before making a new one.
- **Run steps as blocks.** Grouped by where they run, one Copy per block, and a
  break wherever you have to stop — a server you leave running, a switch to the
  browser console, a new terminal tab. A terminal block can be typed into a
  terminal as one line joined by `&&`: one Enter runs it all.
- **A packet that would delete code is flagged.** Rewriting an existing file
  that drops its exports — or most of it — shows a ⚠ with the names, starts
  unticked, and asks again before writing. Packets are whole files written from
  a summary of your project, so this is the failure to catch.

- The path in the sidebar: phases, milestones, and which one is next.
- **Work this step** — Nova produces the packet for the next milestone.
- Build packets previewed as a diff, file by file, before anything is written.
  Applying is one undoable edit.
- Options and templates answered in place; your own wording accepted instead.
- **Verify against the code** — free, deterministic, and Nova's call, not the
  editor's.
- **Audit this codebase** — the full audit from the working tree, no GitHub and
  no zip. It sees uncommitted work.
